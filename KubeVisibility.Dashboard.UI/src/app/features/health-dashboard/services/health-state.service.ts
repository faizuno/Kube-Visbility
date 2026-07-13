import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, switchMap, catchError, of, tap, Subscription, forkJoin, Observable, startWith, retry, finalize } from 'rxjs';
import { HealthApiService } from './health-api.service';
import { HealthMetricsStorageService } from './health-metrics-storage.service';
import { ClusterStateService } from '../../../core/services/cluster-state.service';
import {
  HealthOverview,
  NodeHealthResponse,
  ApplicationHealthResponse,
  KafkaClusterHealth,
  ServicesHealthResponse,
  ConsumersHealthResponse,
  JobsHealthResponse,
  PrometheusAlertStats,
  PrometheusFiringAlert,
  ClusterHealthSummary,
  KafkaHealthSummary,
  ApplicationHealthSummary
} from '../models/health.models';

@Injectable({
  providedIn: 'root'
})
export class HealthStateService {
  private static readonly OVERVIEW_RETRY_COUNT = 2; // total attempts = 3
  private static readonly OVERVIEW_RETRY_DELAY_MS = 1000;

  private readonly healthApi = inject(HealthApiService);
  private readonly metricsStorage = inject(HealthMetricsStorageService);
  private readonly clusterStateService = inject(ClusterStateService);
  private readonly destroyRef = inject(DestroyRef);

  // Auto-refresh settings
  public readonly autoRefreshInterval = signal(60); // 60 seconds (in seconds, not milliseconds)
  public readonly autoRefreshEnabled = signal(true);
  public readonly isLoading = signal(false);
  public readonly isInitialLoading = signal(true); // Separate signal for initial load
  public readonly lastUpdated = signal<Date | null>(null);
  public readonly error = signal<string | null>(null);
  
  // Section-specific loading states
  public readonly isLoadingNodeHealth = signal(false);
  public readonly isLoadingApplicationHealth = signal(false);
  public readonly isLoadingKafkaHealth = signal(false);
  public readonly isLoadingPrometheusAlertStats = signal(false);
  public readonly isLoadingPrometheusFiringAlerts = signal(false);
  public readonly prometheusAlertRangeHours = signal(168);
  public readonly isLoadingServicesHealth = signal(false);
  public readonly isLoadingConsumersHealth = signal(false);
  public readonly isLoadingJobsHealth = signal(false);
  public readonly isSectionRefreshInProgress = signal(false);
  
  // Overview-specific loading states
  public readonly isLoadingKubernetesOverview = signal(false);
  public readonly isLoadingKafkaOverview = signal(false);
  public readonly isLoadingApplicationOverview = signal(false);
  
  // Track which sections have been loaded
  private readonly loadedSections = signal<Set<string>>(new Set());
  private activeSectionsProvider?: () => Set<string>;
  
  // Auto-refresh subscription management
  private autoRefreshSubscription?: Subscription;
  private alertPollingSubscription?: Subscription;
  private alertMessageTimeout?: ReturnType<typeof setTimeout>;
  private hasAlertPollingBaseline = false;
  private seenAlertInstanceKeys = new Set<string>();

  // Health data signals
  public readonly healthOverview = signal<HealthOverview | null>(null);
  public readonly nodeHealth = signal<NodeHealthResponse | null>(null);
  public readonly applicationHealth = signal<ApplicationHealthResponse | null>(null);
  public readonly kafkaHealth = signal<KafkaClusterHealth | null>(null);
  public readonly prometheusAlertStats = signal<PrometheusAlertStats | null>(null);
  public readonly prometheusFiringAlerts = signal<PrometheusFiringAlert[]>([]);
  public readonly servicesHealth = signal<ServicesHealthResponse | null>(null);
  public readonly consumersHealth = signal<ConsumersHealthResponse | null>(null);
  public readonly jobsHealth = signal<JobsHealthResponse | null>(null);

  public readonly alertPollingIntervalSeconds = signal(60);
  public readonly alertPollingRangeHours = signal(24);
  public readonly alertNotificationCount = signal(0);
  public readonly alertNotificationMessage = signal('');
  public readonly alertNotificationItems = signal<PrometheusFiringAlert[]>([]);
  public readonly alertNotificationToasts = signal<{ id: string; message: string }[]>([]);

  // Individual overview summaries for parallel loading
  public readonly kubernetesOverview = signal<ClusterHealthSummary | null>(null);
  public readonly kafkaOverview = signal<KafkaHealthSummary | null>(null);
  public readonly applicationOverview = signal<ApplicationHealthSummary | null>(null);

  // Computed signals
  public readonly overallHealthScore = computed(() => {
    const k8sOverview = this.kubernetesOverview();
    const kafkaOverview = this.kafkaOverview();
    const appOverview = this.applicationOverview();
    const isKafkaEnabled = this.clusterStateService.hasConsumersNamespace();
    
    // Calculate overall score based on available components
    if (k8sOverview && appOverview) {
      if (isKafkaEnabled && kafkaOverview) {
        // All three components: Cluster 40%, Application 40%, Kafka 20%
        return Math.round(
          (k8sOverview.healthScore * 0.4) +
          (appOverview.healthScore * 0.4) +
          (kafkaOverview.healthScore * 0.2)
        );
      } else {
        // Only Kubernetes and Application: 50% each
        return Math.round(
          (k8sOverview.healthScore * 0.5) +
          (appOverview.healthScore * 0.5)
        );
      }
    }
    
    // Fallback to legacy overview if available
    return this.healthOverview()?.overallHealthScore ?? 0;
  });

  public readonly healthStatus = computed(() => {
    const score = this.overallHealthScore();
    if (score >= 90) return { label: 'Healthy', color: '#10b981' };
    if (score >= 70) return { label: 'Warning', color: '#f59e0b' };
    return { label: 'Critical', color: '#ef4444' };
  });

  public readonly totalNodes = computed(() => {
    return this.nodeHealth()?.summary.total ?? 0;
  });

  public readonly readyNodes = computed(() => {
    return this.nodeHealth()?.summary.ready ?? 0;
  });

  public readonly totalDeployments = computed(() => {
    return this.applicationHealth()?.summary.totalDeployments ?? 0;
  });

  public readonly healthyDeployments = computed(() => {
    return this.applicationHealth()?.summary.healthyDeployments ?? 0;
  });

  // Computed signal to track if ANY API call is in progress
  // This is used for the refresh button spinner
  public readonly isRefreshing = computed(() => {
    // Only show refreshing if we're actually loading data AND not in initial load
    // Initial load has its own indicator
    if (this.isInitialLoading()) {
      return false;
    }
    
    return this.isLoadingNodeHealth() || 
           this.isLoadingApplicationHealth() || 
           this.isLoadingKafkaHealth() || 
           this.isLoadingPrometheusAlertStats() ||
           this.isLoadingPrometheusFiringAlerts() ||
           this.isLoadingServicesHealth() ||
           this.isLoadingConsumersHealth() ||
           this.isLoadingJobsHealth() ||
           this.isLoadingKubernetesOverview() ||
           this.isLoadingKafkaOverview() ||
           this.isLoadingApplicationOverview() ||
           this.isSectionRefreshInProgress();
  });

  // Header chips should show skeleton when overview summaries are still loading
  // and no values are available yet (common on direct ?section deep links).
  public readonly isDashboardHeaderOverviewLoading = computed(() => {
    const isKafkaEnabled = this.clusterStateService.hasConsumersNamespace();
    const kubernetesPending = this.isLoadingKubernetesOverview() && this.kubernetesOverview() === null;
    const kafkaPending = isKafkaEnabled && this.isLoadingKafkaOverview() && this.kafkaOverview() === null;
    const applicationPending = this.isLoadingApplicationOverview() && this.applicationOverview() === null;
    return kubernetesPending || kafkaPending || applicationPending;
  });

  constructor() {
    // Don't start auto-refresh automatically - component will call startAutoRefresh()
  }

  /**
   * Start auto-refresh mechanism (called by component when it becomes active)
   */
  startAutoRefresh(initialSection: string = 'overview'): void {
    // Don't start if already running
    if (this.autoRefreshSubscription) {
      return;
    }

    // Initial load strategy:
    // - Overview route: keep existing full overview skeleton + parallel overview APIs
    // - Deep-link section route: skip overview preload and load only requested section
    if (initialSection === 'overview') {
      this.isInitialLoading.set(true);
      this.loadHealthOverviewParallel().subscribe({
        complete: () => {
          this.isInitialLoading.set(false);
        },
        error: () => {
          this.isInitialLoading.set(false);
        }
      });
    } else {
      this.isInitialLoading.set(false);
      // Deep-link routes (e.g. ?section=kubernetes) still need overview summaries
      // for header percentage chips. Load in background without blocking section content.
      this.loadHealthOverviewParallel().subscribe();
      switch (initialSection) {
        case 'kubernetes':
          this.loadNodeHealth(true).subscribe();
          break;
        case 'kafka':
          this.loadKafkaHealth(true).subscribe();
          break;
        case 'application':
          this.loadApplicationHealth(true).subscribe();
          break;
        case 'alerts':
          this.loadHealthAlertsSection(true).subscribe();
          break;
      }
    }

    // Set up interval for auto-refresh - only refresh loaded sections
    // Convert seconds to milliseconds
    this.autoRefreshSubscription = interval(this.autoRefreshInterval() * 1000)
      .pipe(
        switchMap(() => {
          if (this.autoRefreshEnabled()) {
            // Refresh only loaded sections
            return this.refreshLoadedSections();
          }
          return of(null);
        })
      )
      .subscribe();
  }

  /**
   * Stop auto-refresh mechanism (called by component when it becomes inactive)
   */
  stopAutoRefresh(): void {
    if (this.autoRefreshSubscription) {
      this.autoRefreshSubscription.unsubscribe();
      this.autoRefreshSubscription = undefined;
    }
  }

  /**
   * Restart auto-refresh with new interval (called when interval changes)
   */
  restartAutoRefresh(): void {
    this.stopAutoRefresh();
    this.startAutoRefresh();
  }

  /**
   * Load health overview only (for initial load)
   */
  loadHealthOverview(isInitialLoad: boolean = false) {
    if (isInitialLoad) {
      this.isLoading.set(true);
    }
    this.error.set(null);

    return this.healthApi.getHealthOverview().pipe(
      tap(overview => {
        this.healthOverview.set(overview);
        this.lastUpdated.set(new Date());
        
        // Store metrics for historical tracking
        if (overview.kubernetesHealth) {
          this.storeClusterMetrics(overview);
        }
      }),
      tap(() => {
        if (isInitialLoad) {
          this.isLoading.set(false);
        }
      }),
      catchError(error => {
        console.error('Error loading health overview:', error);
        this.error.set('Failed to load health overview. Please try again.');
        if (isInitialLoad) {
          this.isLoading.set(false);
        }
        return of(null);
      })
    );
  }

  /**
   * Load health overview summaries in parallel (OPTIMIZED VERSION)
   * Each API call is independent and displays data as soon as it loads
   */
  loadHealthOverviewParallel(): Observable<any> {
    this.error.set(null);

    // Load node health and derive Kubernetes overview from it.
    const nodeHealthOverview$ = this.loadNodeHealthForOverview();

    // Load Kafka overview only if enabled
    const kafkaOverview$ = this.clusterStateService.hasConsumersNamespace() 
      ? this.loadKafkaOverview() 
      : of(null);

    // Load Application overview
    const applicationOverview$ = this.loadApplicationOverview();

    // Return an observable that completes when all are done
    // but each one updates the UI independently as it completes
    return forkJoin({
      nodeHealth: nodeHealthOverview$,
      kafka: kafkaOverview$,
      application: applicationOverview$
    }).pipe(
      tap(() => {
        this.loadedSections.update(sections => new Set(sections).add('overview'));
        this.lastUpdated.set(new Date());
      }),
      catchError(error => {
        console.error('Error loading health overview summaries:', error);
        this.error.set('Failed to load some health overview data. Please try again.');
        return of(null);
      })
    );
  }

  /**
   * Load Kafka health overview
   */
  loadKafkaOverview(): Observable<KafkaHealthSummary | null> {
    // Check if Kafka is enabled before making API call
    if (!this.clusterStateService.hasConsumersNamespace()) {
      console.log('[Health State] Kafka is disabled - skipping Kafka overview load');
      this.isLoadingKafkaOverview.set(false);
      return of(null);
    }
    
    console.log('[Health State] Loading Kafka overview...');
    this.isLoadingKafkaOverview.set(true);
    
    return this.healthApi.getKafkaOverview().pipe(
      retry({
        count: HealthStateService.OVERVIEW_RETRY_COUNT,
        delay: HealthStateService.OVERVIEW_RETRY_DELAY_MS
      }),
      tap(overview => {
        console.log('[Health State] Kafka overview loaded');
        this.kafkaOverview.set(overview);
        this.isLoadingKafkaOverview.set(false);
      }),
      catchError(error => {
        console.error('Error loading Kafka overview:', error);
        this.isLoadingKafkaOverview.set(false);
        return of(null);
      })
    );
  }

  /**
   * Load Application health overview
   */
  loadApplicationOverview(): Observable<ApplicationHealthSummary | null> {
    console.log('[Health State] Loading Application overview...');
    this.isLoadingApplicationOverview.set(true);
    
    return this.healthApi.getApplicationOverview().pipe(
      retry({
        count: HealthStateService.OVERVIEW_RETRY_COUNT,
        delay: HealthStateService.OVERVIEW_RETRY_DELAY_MS
      }),
      tap(overview => {
        console.log('[Health State] Application overview loaded');
        this.applicationOverview.set(overview);
        this.isLoadingApplicationOverview.set(false);
      }),
      catchError(error => {
        console.error('Error loading Application overview:', error);
        this.isLoadingApplicationOverview.set(false);
        return of(null);
      })
    );
  }

  /**
   * Load all health data (for refresh of all loaded sections)
   */
  private refreshLoadedSections() {
    const sections = this.getSectionsForRefresh();
    return this.refreshSections(sections);
  }

  /**
   * Register the current UI section provider.
   * When provided, auto-refresh will strictly use these active sections.
   */
  setActiveSectionsProvider(provider?: () => Set<string>): void {
    this.activeSectionsProvider = provider;
  }

  private getSectionsForRefresh(): Set<string> {
    const sections = this.activeSectionsProvider
      ? new Set(this.activeSectionsProvider())
      : new Set(this.loadedSections());

    // Keep header/accordion pills fresh even when overview is collapsed.
    sections.add('overview');
    return sections;
  }

  /**
   * Refresh specific sections (for conscious refresh based on open accordions)
   * @param sectionsToRefresh Set of section names to refresh. If not provided, refreshes all loaded sections.
   */
  refreshSections(sectionsToRefresh?: Set<string>) {
    // If no sections specified, use all loaded sections (backward compatibility)
    const sections = new Set(sectionsToRefresh ?? this.loadedSections());
    // Ensure manual refresh still performs useful work even when all accordions are collapsed.
    sections.add('overview');
    const isKafkaEnabled = this.clusterStateService.hasConsumersNamespace();
    
    const observables: Observable<any>[] = [];
    
    // Only refresh overview summaries if 'overview' is in the sections to refresh
    if (sections.has('overview')) {
      observables.push(
        this.loadNodeHealthForOverview(),
        this.loadApplicationOverview()
      );
      
      // Only include Kafka overview if enabled
      if (isKafkaEnabled) {
        observables.push(this.loadKafkaOverview());
      }
    }
    
    // Add other sections only if they're in the set to refresh
    if (sections.has('kubernetes')) {
      observables.push(this.loadNodeHealth(false));
    }
    if (sections.has('application')) {
      observables.push(this.loadApplicationHealth(false));
    }
    if (sections.has('kafka') && isKafkaEnabled) {
      observables.push(this.loadKafkaHealth(false));
    }
    if (sections.has('alerts')) {
      observables.push(this.loadHealthAlertsSection(false));
    }
    
    // If no observables, return empty observable
    if (observables.length === 0) {
      return of(null);
    }
    
    this.isSectionRefreshInProgress.set(true);
    return forkJoin(observables).pipe(
      tap(() => {
        this.lastUpdated.set(new Date());
      }),
      catchError(error => {
        console.error('Error refreshing sections:', error);
        return of(null);
      }),
      finalize(() => {
        this.isSectionRefreshInProgress.set(false);
      })
    );
  }

  /**
   * Load node health (lazy loaded when accordion opens)
   */
  loadNodeHealth(showLoading: boolean = true) {
    if (showLoading) {
      this.isLoadingNodeHealth.set(true);
    }
    
    return this.healthApi.getNodeHealth().pipe(
      tap(nodeHealth => {
        this.nodeHealth.set(nodeHealth);
        this.kubernetesOverview.set(this.buildKubernetesOverviewFromNodeHealth(nodeHealth));
        this.loadedSections.update(sections => new Set(sections).add('kubernetes'));
        
        // Store node metrics for each node
        nodeHealth.nodes.forEach(node => {
          if (node.currentMetrics) {
            this.metricsStorage.saveMetricsSnapshot('node', node.name, node.currentMetrics);
          }
        });
      }),
      tap(() => {
        if (showLoading) {
          this.isLoadingNodeHealth.set(false);
        }
      }),
      catchError(error => {
        console.error('Error loading node health:', error);
        if (showLoading) {
          this.isLoadingNodeHealth.set(false);
        }
        return of(null);
      })
    );
  }

  /**
   * Load node health silently for overview card grouping by node type.
   * This does not set section loading flags or loaded-section state.
   */
  private loadNodeHealthForOverview(): Observable<NodeHealthResponse | null> {
    this.isLoadingKubernetesOverview.set(true);
    return this.healthApi.getNodeHealth().pipe(
      retry({
        count: HealthStateService.OVERVIEW_RETRY_COUNT,
        delay: HealthStateService.OVERVIEW_RETRY_DELAY_MS
      }),
      tap(nodeHealth => {
        this.nodeHealth.set(nodeHealth);
        this.kubernetesOverview.set(this.buildKubernetesOverviewFromNodeHealth(nodeHealth));
        this.isLoadingKubernetesOverview.set(false);
      }),
      catchError(error => {
        console.error('Error loading node health for overview:', error);
        this.error.set('Kubernetes health overview failed after 3 attempts. Please verify the Kubernetes health API.');
        this.isLoadingKubernetesOverview.set(false);
        return of(null);
      })
    );
  }

  /**
   * Load application health (lazy loaded when accordion opens)
   * This now loads all three categories in parallel for efficiency
   */
  loadApplicationHealth(showLoading: boolean = true) {
    if (showLoading) {
      this.isLoadingApplicationHealth.set(true);
      this.isLoadingServicesHealth.set(true);
      this.isLoadingConsumersHealth.set(true);
      this.isLoadingJobsHealth.set(true);
    }
    
    // Check if namespaces are available
    const isKafkaEnabled = this.clusterStateService.hasConsumersNamespace();
    const isJobsEnabled = this.clusterStateService.hasJobsNamespace();
    
    // Conditionally include consumers and jobs based on namespace availability
    const consumers$ = isKafkaEnabled 
      ? this.healthApi.getConsumersHealth()
      : of(null);
    
    const jobs$ = isJobsEnabled
      ? this.healthApi.getJobsHealth()
      : of(null);
    
    // Load all categories in parallel for better performance
    return forkJoin({
      services: this.healthApi.getServicesHealth(),
      consumers: consumers$,
      jobs: jobs$,
      legacy: this.healthApi.getApplicationHealth() // Keep for backward compatibility if needed
    }).pipe(
      tap(({ services, consumers, jobs, legacy }) => {
        this.servicesHealth.set(services);
        if (isKafkaEnabled && consumers) {
          this.consumersHealth.set(consumers);
        }
        if (isJobsEnabled && jobs) {
          this.jobsHealth.set(jobs);
        }
        this.applicationHealth.set(legacy);
        this.loadedSections.update(sections => new Set(sections).add('application'));
      }),
      tap(() => {
        if (showLoading) {
          this.isLoadingApplicationHealth.set(false);
          this.isLoadingServicesHealth.set(false);
          this.isLoadingConsumersHealth.set(false);
          this.isLoadingJobsHealth.set(false);
        }
      }),
      catchError(error => {
        console.error('Error loading application health:', error);
        if (showLoading) {
          this.isLoadingApplicationHealth.set(false);
          this.isLoadingServicesHealth.set(false);
          this.isLoadingConsumersHealth.set(false);
          this.isLoadingJobsHealth.set(false);
        }
        return of(null);
      })
    );
  }

  /**
   * Load Kafka health (lazy loaded when accordion opens)
   */
  loadKafkaHealth(showLoading: boolean = true) {
    // Check if Kafka is enabled before making API call
    if (!this.clusterStateService.hasConsumersNamespace()) {
      console.log('[Health State] Kafka is disabled - skipping Kafka health load');
      if (showLoading) {
        this.isLoadingKafkaHealth.set(false);
      }
      return of(null);
    }
    
    if (showLoading) {
      this.isLoadingKafkaHealth.set(true);
    }
    
    return this.healthApi.getKafkaClusterHealth().pipe(
      tap(kafkaHealth => {
        this.kafkaHealth.set(kafkaHealth);
        this.loadedSections.update(sections => new Set(sections).add('kafka'));
      }),
      tap(() => {
        if (showLoading) {
          this.isLoadingKafkaHealth.set(false);
        }
      }),
      catchError(error => {
        console.error('Error loading Kafka health:', error);
        if (showLoading) {
          this.isLoadingKafkaHealth.set(false);
        }
        return of(null);
      })
    );
  }

  /**
   * Load health alerts (lazy loaded when accordion opens)
   */
  loadHealthAlertsSection(showLoading: boolean = true) {
    if (showLoading) {
      this.isLoadingPrometheusAlertStats.set(true);
      this.isLoadingPrometheusFiringAlerts.set(true);
    }

    const rangeHours = this.prometheusAlertRangeHours();
    return forkJoin({
      prometheusStats: this.healthApi.getPrometheusAlertStats(rangeHours).pipe(
        catchError(error => {
          console.error('Error loading Prometheus alert stats:', error);
          return of(null);
        })
      ),
      firingAlertsPage: this.healthApi.getPrometheusFiringAlerts({ limit: 50, offset: 0, rangeHours }).pipe(
        catchError(error => {
          console.error('Error loading Prometheus firing alerts:', error);
          return of(null);
        })
      )
    }).pipe(
      tap(({ prometheusStats, firingAlertsPage }) => {
        this.prometheusAlertStats.set(prometheusStats);
        this.prometheusFiringAlerts.set(firingAlertsPage?.items ?? []);
        this.loadedSections.update(sections => new Set(sections).add('alerts'));
      }),
      tap(() => {
        if (showLoading) {
          this.isLoadingPrometheusAlertStats.set(false);
          this.isLoadingPrometheusFiringAlerts.set(false);
        }
      }),
      catchError(error => {
        console.error('Error loading alerts section:', error);
        if (showLoading) {
          this.isLoadingPrometheusAlertStats.set(false);
          this.isLoadingPrometheusFiringAlerts.set(false);
        }
        return of(null);
      })
    );
  }

  loadPrometheusFiringAlerts(filters: {
    severity?: string;
    namespaceName?: string;
    alertName?: string;
    rangeHours?: number;
    limit?: number;
    offset?: number;
  } = {}): Observable<any> {
    this.isLoadingPrometheusFiringAlerts.set(true);

    const rangeHours = filters.rangeHours ?? this.prometheusAlertRangeHours();
    return this.healthApi.getPrometheusFiringAlerts({
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
      severity: filters.severity,
      namespaceName: filters.namespaceName,
      alertName: filters.alertName,
      rangeHours
    }).pipe(
      tap(page => {
        this.prometheusFiringAlerts.set(page.items ?? []);
      }),
      tap(() => {
        this.isLoadingPrometheusFiringAlerts.set(false);
      }),
      catchError(error => {
        console.error('Error loading filtered Prometheus firing alerts:', error);
        this.isLoadingPrometheusFiringAlerts.set(false);
        this.prometheusFiringAlerts.set([]);
        return of(null);
      })
    );
  }

  setPrometheusAlertRangeHours(rangeHours: number): void {
    if (rangeHours <= 0) return;
    this.prometheusAlertRangeHours.set(rangeHours);
  }

  private buildKubernetesOverviewFromNodeHealth(nodeHealth: NodeHealthResponse): ClusterHealthSummary {
    const summary = nodeHealth.summary;
    return {
      totalNodes: summary.total,
      readyNodes: summary.ready,
      notReadyNodes: summary.notReady,
      unknownNodes: summary.unknown,
      healthScore: this.calculateClusterHealthScore(summary.total, summary.notReady, summary.unknown, summary.averageCpuUsagePercent, summary.averageMemoryUsagePercent),
      resourceUtilization: {
        cpuUsagePercent: summary.averageCpuUsagePercent,
        memoryUsagePercent: summary.averageMemoryUsagePercent,
        diskUsagePercent: 0,
        cpuUsed: '',
        cpuTotal: '',
        memoryUsed: '',
        memoryTotal: ''
      }
    };
  }

  private calculateClusterHealthScore(
    totalNodes: number,
    notReadyNodes: number,
    unknownNodes: number,
    averageCpuUsagePercent: number,
    averageMemoryUsagePercent: number
  ): number {
    if (totalNodes === 0) {
      return 100;
    }

    let score = 100;
    const unhealthyRatio = (notReadyNodes + unknownNodes) / totalNodes;
    score -= unhealthyRatio * 40;

    if (averageCpuUsagePercent > 80) {
      score -= ((averageCpuUsagePercent - 80) / 20) * 30;
    }

    if (averageMemoryUsagePercent > 80) {
      score -= ((averageMemoryUsagePercent - 80) / 20) * 30;
    }

    return Math.max(0, Math.round(score * 100) / 100);
  }

  /**
   * Store cluster metrics for historical tracking
   */
  private async storeClusterMetrics(overview: HealthOverview): Promise<void> {
    try {
      // Store overall health score
      await this.metricsStorage.saveMetricsSnapshot(
        'overall-health',
        'cluster',
        { score: overview.overallHealthScore, timestamp: Date.now() }
      );

      // Store Kubernetes metrics
      if (overview.kubernetesHealth.resourceUtilization) {
        await this.metricsStorage.saveMetricsSnapshot(
          'cluster-resources',
          'kubernetes',
          overview.kubernetesHealth.resourceUtilization
        );
      }
    } catch (error) {
      console.error('Error storing cluster metrics:', error);
    }
  }

  /**
   * Toggle auto-refresh
   */
  toggleAutoRefresh(): void {
    this.autoRefreshEnabled.update(enabled => !enabled);
  }

  setAutoRefreshEnabled(enabled: boolean): void {
    this.autoRefreshEnabled.set(enabled);
  }

  /**
   * Set auto-refresh interval (in seconds)
   */
  setAutoRefreshInterval(intervalSeconds: number): void {
    if (intervalSeconds !== this.autoRefreshInterval()) {
      this.autoRefreshInterval.set(intervalSeconds);
      // Restart auto-refresh with new interval if currently running
      if (this.autoRefreshSubscription) {
        this.restartAutoRefresh();
      }
    }
  }

  /**
   * Manually refresh all data (no loading indicators)
   * @param sectionsToRefresh Optional set of section names to refresh. If not provided, refreshes all loaded sections.
   */
  refresh(sectionsToRefresh?: Set<string>): void {
    console.log('[Health State] Manual refresh triggered', sectionsToRefresh ? `for sections: ${Array.from(sectionsToRefresh).join(', ')}` : 'for all loaded sections');
    this.refreshSections(sectionsToRefresh).subscribe({
      next: () => {
        console.log('[Health State] Refresh completed successfully');
      },
      error: (error) => {
        console.error('[Health State] Refresh error:', error);
      }
    });
  }

  /**
   * Check if a section has been loaded
   */
  isSectionLoaded(section: string): boolean {
    return this.loadedSections().has(section);
  }

  /**
   * Get node metrics history for charting
   */
  async getNodeMetricsHistory(nodeName: string, hoursBack: number = 1) {
    return this.metricsStorage.getNodeMetricsHistory(nodeName, hoursBack);
  }

  /**
   * Get overall health score history for trend
   */
  async getHealthScoreHistory(hoursBack: number = 1) {
    const fromTimestamp = Date.now() - hoursBack * 60 * 60 * 1000;
    const snapshots = await this.metricsStorage.getMetricsSnapshotsByType<{score: number, timestamp: number}>(
      'overall-health',
      'cluster',
      fromTimestamp
    );

    return snapshots.map(s => ({
      timestamp: new Date(s.timestamp).toISOString(),
      value: s.data.score
    }));
  }

  /**
   * Clear error
   */
  clearError(): void {
    this.error.set(null);
  }

  startAlertPolling(): void {
    if (this.alertPollingSubscription) return;
    const intervalMs = Math.max(10, this.alertPollingIntervalSeconds()) * 1000;
    this.alertPollingSubscription = interval(intervalMs)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.healthApi.getPrometheusFiringAlerts({
            rangeHours: this.alertPollingRangeHours(),
            limit: 200,
            offset: 0
          }).pipe(
            catchError(() => of(null))
          )
        ),
        tap(page => {
          if (!page) return;
          const items = page.items ?? [];
          const activeItems = items.filter(a => {
            const state = (a.state || '').toLowerCase();
            return !state || state === 'firing';
          });
          const recentActiveItems = this.filterRecentAlerts(activeItems);
          const currentKeys = new Set(activeItems.map(a => this.buildAlertKey(a)));

          if (!this.hasAlertPollingBaseline) {
            this.seenAlertInstanceKeys = currentKeys;
            this.hasAlertPollingBaseline = true;
            return;
          }

          const newAlerts = recentActiveItems.filter(a => !this.seenAlertInstanceKeys.has(this.buildAlertKey(a)));
          if (newAlerts.length > 0) {
            console.debug('[alert-poll] new alerts detected', {
              count: newAlerts.length,
              keys: newAlerts.map(a => this.buildAlertKey(a))
            });
            this.alertNotificationCount.update(count => count + newAlerts.length);
            const message = `${newAlerts.length} new alert${newAlerts.length > 1 ? 's' : ''} detected`;
            this.alertNotificationMessage.set(message);
            if (this.alertMessageTimeout) clearTimeout(this.alertMessageTimeout);
            this.alertMessageTimeout = setTimeout(() => this.alertNotificationMessage.set(''), 6000);
            this.alertNotificationItems.set(newAlerts.slice(0, 5));
            newAlerts.forEach(alert => this.pushAlertToast(alert));
          }

          currentKeys.forEach(key => this.seenAlertInstanceKeys.add(key));
          if (this.seenAlertInstanceKeys.size > 5000) {
            this.seenAlertInstanceKeys = currentKeys;
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  stopAlertPolling(): void {
    if (this.alertPollingSubscription) {
      this.alertPollingSubscription.unsubscribe();
      this.alertPollingSubscription = undefined;
    }
  }

  clearAlertNotifications(): void {
    this.alertNotificationCount.set(0);
    this.alertNotificationMessage.set('');
    this.alertNotificationItems.set([]);
    this.alertNotificationToasts.set([]);
  }

  private filterRecentAlerts(alerts: PrometheusFiringAlert[]): PrometheusFiringAlert[] {
    if (alerts.length === 0) {
      return alerts;
    }

    const nowMs = Date.now();
    const maxAgeMs = this.getNotificationRecencyWindowMs();
    return alerts.filter(alert => {
      const timestampMs = this.getAlertActivityTimestampMs(alert);
      if (timestampMs === null) {
        return false;
      }

      return (nowMs - timestampMs) <= maxAgeMs;
    });
  }

  private getNotificationRecencyWindowMs(): number {
    // Prevent stale alerts (hours old) from repeatedly showing as "new".
    // Window is dynamic to polling interval but never less than 10 minutes.
    const intervalMs = Math.max(10, this.alertPollingIntervalSeconds()) * 1000;
    return Math.max(intervalMs * 3, 10 * 60 * 1000);
  }

  private getAlertActivityTimestampMs(alert: PrometheusFiringAlert): number | null {
    const candidate =
      alert.updatedAt ||
      alert.lastOccurrenceAt ||
      alert.startsAt ||
      alert.firstOccurrenceAt ||
      null;

    if (!candidate) {
      return null;
    }

    const parsed = Date.parse(candidate);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private buildAlertKey(alert: PrometheusFiringAlert): string {
    const startsAt = alert.startsAt || alert.firstOccurrenceAt || '';
    return [
      alert.alertName || '',
      alert.namespaceName || '',
      alert.podName || '',
      alert.severity || '',
      startsAt
    ].join('|');
  }

  private pushAlertToast(alert: PrometheusFiringAlert): void {
    const message = `Alert: ${alert.alertName || 'New alert detected'}`;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.alertNotificationToasts.update(items => [...items, { id, message }]);
    setTimeout(() => {
      this.alertNotificationToasts.update(items => items.filter(item => item.id !== id));
    }, 6000);
  }
}

