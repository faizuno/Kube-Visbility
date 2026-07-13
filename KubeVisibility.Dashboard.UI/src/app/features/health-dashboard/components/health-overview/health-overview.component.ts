import { Component, computed, inject, output, ViewChild, signal, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { EchartsWrapperComponent } from '../../../../shared/components/echarts-wrapper/echarts-wrapper.component';
import { LoadingSkeletonComponent } from '../../../../shared/components/loading-skeleton/loading-skeleton.component';
import { ErrorAnalyticsPanelComponent } from '../error-analytics-panel/error-analytics-panel.component';
import { HealthStateService } from '../../services/health-state.service';
import { ClusterStateService } from '../../../../core/services/cluster-state.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { ElasticsearchService, ErrorGroup } from '../../../../core/services/api/elasticsearch.service';
import type { EChartsOption } from 'echarts';

@Component({
  selector: 'app-health-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, EchartsWrapperComponent, LoadingSkeletonComponent, ErrorAnalyticsPanelComponent],
  template: `
    <div class="health-overview">
      <div class="overview-cards">
        <!-- Cluster Health Card -->
        <div class="health-card clickable-card" (click)="onCardClick('kubernetes')" [title]="'Click to view Kubernetes Health details'">
          <h3>Kubernetes Health</h3>
          @if (healthState.isLoadingKubernetesOverview()) {
            <app-loading-skeleton [count]="1" height="140px" borderRadius="6px" />
          } @else {
            <app-echarts-wrapper
              [chartOption]="clusterHealthChart()"
              [loadingState]="false"
              height="140px">
            </app-echarts-wrapper>
          }
          <div class="card-stats stacked-stats">
            @if (nodeTypeHealthRows().length > 0) {
              @for (row of nodeTypeHealthRows(); track row.typeKey) {
                <div class="stat" [class.has-issues]="row.active !== row.total">
                  <span class="label">{{ row.label }}:</span>
                  <span class="value">{{ row.active }}/{{ row.total }}</span>
                </div>
              }
            } @else if (healthState.kubernetesOverview(); as k8s) {
              <div class="stat" [class.has-issues]="k8s.readyNodes !== k8s.totalNodes">
                <span class="label">Nodes:</span>
                <span class="value">{{ k8s.readyNodes }}/{{ k8s.totalNodes }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Kafka Health Card -->
        @if (isMessagingEnabled()) {
          <div class="health-card clickable-card" (click)="onCardClick('kafka')" [title]="'Click to view Kafka Health details'">
            <h3>Kafka Health</h3>
            @if (healthState.isLoadingKafkaOverview()) {
              <app-loading-skeleton [count]="1" height="140px" borderRadius="6px" />
            } @else {
              <app-echarts-wrapper
                [chartOption]="kafkaHealthChart()"
                [loadingState]="false"
                height="140px">
              </app-echarts-wrapper>
            }
            <div class="card-stats stacked-stats">
              @if (healthState.kafkaOverview(); as kafka) {
                <div class="stat" [class.has-issues]="kafka.onlineBrokers !== kafka.totalBrokers">
                  <span class="label">Brokers:</span>
                  <span class="value">{{ kafka.onlineBrokers }}/{{ kafka.totalBrokers }}</span>
                  @if (kafka.offlineBrokers > 0) {
                    <span class="offline-count">({{ kafka.offlineBrokers }} offline)</span>
                  }
                </div>
                @if (kafka.totalControllers > 0) {
                  <div class="stat" [class.has-issues]="kafka.onlineControllers !== kafka.totalControllers">
                    <span class="label">Controllers:</span>
                    <span class="value">{{ kafka.onlineControllers }}/{{ kafka.totalControllers }}</span>
                    @if (kafka.offlineControllers > 0) {
                      <span class="offline-count">({{ kafka.offlineControllers }} offline)</span>
                    }
                  </div>
                }
              }
            </div>
          </div>
        }

        <!-- Application Health Card -->
        <div class="health-card clickable-card" (click)="onCardClick('application')" [title]="'Click to view Application Health details'">
          <h3>Application Health</h3>
          @if (healthState.isLoadingApplicationOverview()) {
            <app-loading-skeleton [count]="1" height="140px" borderRadius="6px" />
          } @else {
            <app-echarts-wrapper
              [chartOption]="applicationHealthChart()"
              [loadingState]="false"
              height="140px">
            </app-echarts-wrapper>
          }
          <div class="card-stats stacked-stats">
            @if (healthState.applicationOverview(); as app) {
            <div class="stat">
              <span class="label">Applications (active):</span>
                <span class="value">{{ app.healthyApplications }}/{{ applicationActiveTotal() }}</span>
            </div>
            <div class="stat">
              <span class="label">Total:</span>
                <span class="value">{{ app.totalApplications }}</span>
            </div>
            <div class="stat" [class.has-issues]="applicationInactiveCount() > 0">
              <span class="label">Inactive:</span>
                <span class="value">Stopped consumers {{ stoppedConsumersCount() }}, Paused jobs {{ pausedJobsCount() }}</span>
            </div>
            }
          </div>
        </div>

        <!-- Error Analytics Card -->
        <div class="health-card clickable-card" 
             (click)="navigateToErrorPage()" 
             [title]="'Click to view detailed error analytics'">
          <app-error-analytics-panel #errorAnalyticsPanel></app-error-analytics-panel>
        </div>
      </div>

      <!-- Error Details Modal - At overview-cards level -->
      @if (showErrorModal() && selectedError()) {
        <div class="modal-overlay" (click)="closeErrorModal()" [style.height]="modalHeight()">
          <div class="modal-container" (click)="$event.stopPropagation()" [style.max-height]="modalMaxHeight()">
            <div class="modal-header">
              <h2>
                <i class="fas fa-exclamation-triangle"></i>
                Error Details
              </h2>
              <button class="close-button" (click)="closeErrorModal()">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <div class="modal-body">
              <div class="error-details">
                <div class="detail-row">
                  <strong>Error Message:</strong>
                  <div class="error-message-text">{{ selectedError()!.errorMessage }}</div>
                </div>

                <div class="detail-grid">
                  <div class="detail-row compact">
                    <strong>Occurrences:</strong>
                    <span class="error-count-badge">{{ selectedError()!.count | number }}</span>
                  </div>
                  <div class="detail-row compact">
                    <strong>Service:</strong>
                    @if (selectedError()!.serviceName) {
                      <a
                        [routerLink]="['/cluster']"
                        [queryParams]="{ view: 'deepdive', resource: selectedError()!.serviceName }"
                        class="service-link"
                        [title]="'View resource in Cluster Info'"
                      >{{ selectedError()!.serviceName }}</a>
                    } @else {
                      <span>N/A</span>
                    }
                  </div>
                  <div class="detail-row compact">
                    <strong>First Occurrence:</strong>
                    <div class="occurrence-inline">
                      <span>{{ formatDate(selectedError()!.firstOccurrence) }}</span>
                      <button
                        class="btn-focus-inline"
                        (click)="focusErrorOccurrenceInGlobalLogs('first')"
                        title="Focus Global Logs around first occurrence (+/- 1 minute) with service filter"
                      >
                        <i class="fas fa-crosshairs"></i>
                        Focus First
                      </button>
                    </div>
                  </div>
                  <div class="detail-row compact">
                    <strong>Last Occurrence:</strong>
                    <div class="occurrence-inline">
                      <span>{{ formatDate(selectedError()!.lastOccurrence) }}</span>
                      <button
                        class="btn-focus-inline"
                        (click)="focusErrorOccurrenceInGlobalLogs('last')"
                        title="Focus Global Logs around last occurrence (+/- 1 minute) with service filter"
                      >
                        <i class="fas fa-crosshairs"></i>
                        Focus Last
                      </button>
                    </div>
                  </div>
                </div>

                <div class="modal-action-row">
                  <button
                    class="btn-primary"
                    (click)="openErrorInGlobalLogs()"
                    title="Open this error in Global Logs with service filter"
                  >
                    <i class="fas fa-search"></i>
                    Global Logs
                  </button>
                </div>

                <div class="detail-row">
                  <strong>Normalized Pattern:</strong>
                  <div class="normalized-pattern">{{ selectedError()!.normalizedMessage }}</div>
                </div>
                @if (selectedError()!.sampleLogs && selectedError()!.sampleLogs.length > 0) {
                  <div class="detail-row">
                    <strong>Sample Logs:</strong>
                    <div class="sample-logs">
                      @for (log of selectedError()!.sampleLogs; track $index) {
                        <div class="sample-log-item">
                          <div class="log-meta">
                            <span class="log-time">{{ formatDate(log.timestamp) }}</span>
                            <span class="log-service">{{ log.serviceName || 'N/A' }}</span>
                          </div>
                          <div class="log-message">{{ log.message || 'N/A' }}</div>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-primary" (click)="navigateToErrorPage()">
                <i class="fas fa-external-link-alt"></i>
                Open Errors Page
              </button>
              <button class="btn-secondary" (click)="closeErrorModal()">Close</button>
            </div>
          </div>
        </div>
      }

    </div>
  `,
  styles: [`
    .health-overview {
      margin-bottom: 1.5rem;
    }

    .overview-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .health-card {
      background: var(--theme-bg-surface);
      border-radius: 8px;
      padding: 1rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      transition: all 0.3s ease;
      border: 1px solid #e5e7eb;
    }

    .health-card:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      transform: translateY(-2px);
    }

    .health-card.clickable-card {
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .health-card.clickable-card:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transform: translateY(-2px);
      border: 2px solid var(--theme-button-primary);
    }

    .health-card h3 {
      margin: 0 0 0.75rem 0;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .health-card h3::before {
      content: '';
      width: 4px;
      height: 20px;
      background: linear-gradient(135deg, var(--theme-button-primary) 0%, var(--theme-primary-teal-light) 100%);
      border-radius: 2px;
    }

    .card-stats {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid #e5e7eb;
    }

    .stacked-stats {
      flex-wrap: wrap;
    }

    .stacked-stats .stat {
      flex: 1 1 100%;
      justify-content: space-between;
    }

    .card-stats .stat {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: var(--theme-bg-app);
      border-radius: 6px;
      font-size: var(--theme-font-body);
    }

    .card-stats .stat .label {
      color: var(--theme-text-gray);
      font-weight: var(--theme-font-table-body-weight);
    }

    .card-stats .stat .value {
      color: var(--theme-text-dark);
      font-weight: var(--theme-font-table-header-weight);
    }

    .stat .label {
      color: var(--theme-text-gray);
    }

    .stat .value {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .stat.has-issues .value {
      color: #dc2626;
    }

    .stat .offline-count {
      font-size: var(--theme-font-caption);
      color: #dc2626;
      font-weight: var(--theme-font-table-body-weight);
      margin-left: 0.25rem;
    }

    /* Error Details Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10020;
      padding: 1rem;
      animation: fadeIn 0.2s;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .modal-container {
      background: var(--theme-bg-app);
      border-radius: 12px;
      max-width: 900px;
      width: 100%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      animation: slideUp 0.3s;
    }

    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem 2.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      background: linear-gradient(135deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 50%, var(--theme-primary-teal-light) 100%);
      color: white;
      flex-shrink: 0;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    }

    .modal-header h2 {
      margin: 0;
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: white;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .modal-header i {
      color: white;
    }

    .close-button {
      background: none;
      border: none;
      font-size: var(--theme-font-page-title);
      color: rgba(255, 255, 255, 0.95);
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .close-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
      color: white;
    }

    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
      background: var(--theme-bg-app);
    }

    .error-details {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem 1rem;
    }

    .detail-row {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .detail-row.compact {
      gap: 0.35rem;
      padding: 0.55rem 0.65rem;
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 8px;
    }

    .detail-row strong {
      color: var(--theme-text-gray-dark);
      font-size: var(--theme-font-body);
    }

    .error-message-text {
      padding: 0.75rem;
      background: var(--theme-bg-surface);
      border-radius: 6px;
      word-wrap: break-word;
      color: var(--theme-text-dark);
      font-family: monospace;
      font-size: var(--theme-font-body);
      border: 1px solid var(--theme-border-gray);
    }

    .error-count-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: var(--theme-status-critical);
      color: white;
      border-radius: 12px;
      font-weight: var(--theme-font-table-header-weight);
      font-size: var(--theme-font-body);
    }

    .service-link {
      color: var(--theme-button-primary);
      text-decoration: none;
      font-weight: var(--theme-font-table-body-weight);
    }
    .service-link:hover {
      text-decoration: underline;
    }

    .normalized-pattern {
      padding: 0.75rem;
      background: var(--theme-bg-surface);
      border-radius: 6px;
      word-wrap: break-word;
      font-family: monospace;
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
    }
    .modal-action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      align-items: center;
      justify-content: flex-end;
    }
    .occurrence-inline {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .btn-focus-inline {
      height: 24px;
      padding: 0 0.45rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: var(--theme-bg-surface);
      color: var(--theme-text-gray-dark);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-focus-inline:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }

    .sample-logs {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-height: 300px;
      overflow-y: auto;
    }

    .sample-log-item {
      padding: 0.75rem;
      background: var(--theme-bg-surface);
      border-radius: 6px;
      border: 1px solid #e5e7eb;
    }

    .log-meta {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.5rem;
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
    }

    .log-message {
      word-wrap: break-word;
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray-dark);
    }

    .modal-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid #e5e7eb;
      display: flex;
      gap: 0.75rem;
      justify-content: flex-end;
      background: var(--theme-bg-app);
    }

    .btn-primary,
    .btn-secondary {
      padding: 0.5rem 1rem;
      border: 1px solid transparent;
      border-radius: 6px;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .btn-primary {
      background: var(--theme-button-primary);
      color: white;
    }

    .btn-primary:hover {
      background: var(--theme-button-primary-hover);
    }

    .btn-secondary {
      background: var(--theme-bg-surface);
      color: var(--theme-text-gray-dark);
      border-color: var(--theme-border-gray);
    }

    .btn-secondary:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
    @media (max-width: 900px) {
      .detail-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class HealthOverviewComponent implements OnInit, AfterViewInit, OnDestroy {
  healthState = inject(HealthStateService);
  clusterStateService = inject(ClusterStateService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  location = inject(Location);
  viewportScaleService = inject(ViewportScaleService);
  elasticsearchService = inject(ElasticsearchService);
  
  @ViewChild('errorAnalyticsPanel') errorAnalyticsPanel?: ErrorAnalyticsPanelComponent;
  
  private queryParamsSubscription?: Subscription;
  private pendingModalRetryTimeout?: ReturnType<typeof setTimeout>;
  
  // Modal state
  showErrorModal = signal(false);
  selectedError = signal<ErrorGroup | null>(null);
  
  // Viewport-based height calculations
  modalHeight = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    return `${baseHeight}px`;
  });
  
  modalMaxHeight = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    return `${baseHeight * 0.85}px`; // 85% of viewport height
  });
  
  ngOnInit(): void {
    // Subscribe to query params to open/close modal based on URL
    this.queryParamsSubscription = this.route.queryParams.subscribe(params => {
      this.checkQueryParamsForModal(params);
    });
  }
  
  ngAfterViewInit(): void {
    // Check query params after view is initialized (ViewChild is available)
    const params = this.route.snapshot.queryParams;
    this.checkQueryParamsForModal(params);
  }
  
  private checkQueryParamsForModal(params: any): void {
    const modalView = params['modal'];
    const errorIndex = params['errorIndex'];
    
    if (modalView === 'error' && errorIndex !== undefined) {
      const index = parseInt(errorIndex, 10);
      if (!isNaN(index) && this.errorAnalyticsPanel) {
        const errorData = this.errorAnalyticsPanel.errorData();
        if (errorData && index >= 0 && index < errorData.errorGroups.length) {
          if (this.pendingModalRetryTimeout) {
            clearTimeout(this.pendingModalRetryTimeout);
            this.pendingModalRetryTimeout = undefined;
          }
          this.selectedError.set(errorData.errorGroups[index]);
          this.showErrorModal.set(true);
          return;
        }

        // Direct deep links can arrive before error analytics data is loaded.
        // Retry briefly so the modal opens as soon as data becomes available.
        if (!errorData) {
          this.scheduleModalRetry();
          return;
        }
      }
    }
    
    // Close modal if conditions not met
    this.showErrorModal.set(false);
    this.selectedError.set(null);
  }

  private scheduleModalRetry(): void {
    if (this.pendingModalRetryTimeout) {
      return;
    }

    this.pendingModalRetryTimeout = setTimeout(() => {
      this.pendingModalRetryTimeout = undefined;
      this.checkQueryParamsForModal(this.route.snapshot.queryParams);
    }, 250);
  }
  
  ngOnDestroy(): void {
    this.queryParamsSubscription?.unsubscribe();
    if (this.pendingModalRetryTimeout) {
      clearTimeout(this.pendingModalRetryTimeout);
      this.pendingModalRetryTimeout = undefined;
    }
  }
  
  closeErrorModal(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { 
        modal: null,
        errorIndex: null
      },
      queryParamsHandling: 'merge'
    });
  }

  openErrorInGlobalLogs(): void {
    const item = this.selectedError();
    if (!item) {
      return;
    }

    const serviceName = (item.serviceName || '').trim();
    const message = (item.errorMessage || '').trim();
    const fromMs = this.parseTimestampMs(item.firstOccurrence);
    const toMs = this.parseTimestampMs(item.lastOccurrence);
    const from = fromMs === null ? new Date(Date.now() - 24 * 60 * 60 * 1000) : new Date(fromMs);
    const to = toMs === null ? new Date() : new Date(toMs);

    this.navigateToGlobalLogs({
      serviceName,
      message,
      from,
      to
    });
  }

  focusErrorOccurrenceInGlobalLogs(anchor: 'first' | 'last'): void {
    const item = this.selectedError();
    if (!item) {
      return;
    }

    const centerRaw = anchor === 'first' ? item.firstOccurrence : item.lastOccurrence;
    const centerMs = this.parseTimestampMs(centerRaw);
    const focusSec = 60;
    const windowMs = focusSec * 1000;
    const centerDate = centerMs === null ? new Date() : new Date(centerMs);

    this.navigateToGlobalLogs({
      serviceName: (item.serviceName || '').trim(),
      message: '',
      from: new Date(centerDate.getTime() - windowMs),
      to: new Date(centerDate.getTime() + windowMs),
      focusSec
    });
  }

  private navigateToGlobalLogs(options: {
    serviceName: string;
    message: string;
    from: Date;
    to: Date;
    focusSec?: number;
  }): void {
    this.router.navigate(['/dashboard'], {
      queryParamsHandling: 'merge',
      queryParams: {
        globalLogs: '1',
        svc: options.serviceName || null,
        msg: options.message || null,
        from: options.from.toISOString(),
        to: options.to.toISOString(),
        searched: '1',
        focusSec: options.focusSec ?? null,
        // Clear stale global logs filters for deterministic focus.
        pod: null,
        key: null,
        levels: null,
        preset: null,
        size: null,
        page: null,
        sort: null,
        q: null,
        // Close this modal when navigating to Global Logs.
        modal: null,
        errorIndex: null
      }
    });
  }
  
  navigateToErrorPage(): void {
    const urlTree = this.router.createUrlTree(['/errors']);
    const url = this.router.serializeUrl(urlTree);
    // Use Location service to prepare external URL with base href
    const externalUrl = this.location.prepareExternalUrl(url);
    const fullUrl = `${window.location.origin}${externalUrl}`;
    window.open(fullUrl, '_blank');
  }
  
  formatDate(dateString: string | Date): string {
    try {
      const date = typeof dateString === 'string'
        ? this.parseTimestamp(dateString)
        : dateString;
      if (!date || Number.isNaN(date.getTime())) {
        return String(dateString);
      }
      return date.toLocaleString();
    } catch {
      return String(dateString);
    }
  }

  private parseTimestampMs(value?: string | null): number | null {
    const raw = (value ?? '').trim();
    if (!raw) {
      return null;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseTimestamp(value?: string | null): Date | null {
    const timestampMs = this.parseTimestampMs(value);
    return timestampMs === null ? null : new Date(timestampMs);
  }

  // Check if messaging/Kafka is enabled (consumers namespace exists)
  isMessagingEnabled = computed(() => {
    return this.clusterStateService.hasConsumersNamespace();
  });

  stoppedConsumersCount = computed(() =>
    this.healthState.applicationOverview()?.stoppedConsumers ??
    this.healthState.consumersHealth()?.summary.stoppedConsumers ??
    0
  );
  pausedJobsCount = computed(() =>
    this.healthState.applicationOverview()?.pausedJobs ??
    this.healthState.jobsHealth()?.summary.pausedJobs ??
    0
  );
  applicationInactiveCount = computed(() => this.stoppedConsumersCount() + this.pausedJobsCount());
  applicationActiveTotal = computed(() => {
    const totalApplications = this.healthState.applicationOverview()?.totalApplications ?? 0;
    return Math.max(0, totalApplications - this.applicationInactiveCount());
  });
  nodeTypeHealthRows = computed(() => {
    const nodes = this.healthState.nodeHealth()?.nodes ?? [];
    if (!nodes.length) {
      return [] as Array<{ typeKey: string; label: string; total: number; active: number }>;
    }

    const grouped = new Map<string, { label: string; total: number; active: number }>();
    for (const node of nodes) {
      const rawType = (node.type ?? '').trim();
      const typeKey = (rawType || 'unknown').toLowerCase();
      const label = rawType || 'unknown';
      const current = grouped.get(typeKey) ?? { label, total: 0, active: 0 };

      current.total += 1;
      if (node.status === 'Ready') {
        current.active += 1;
      }
      grouped.set(typeKey, current);
    }

    return Array.from(grouped.entries())
      .map(([typeKey, value]) => ({ typeKey, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  clusterHealthChart = computed((): EChartsOption => {
    const overview = this.healthState.kubernetesOverview();
    const score = overview?.healthScore ?? 0;
    
    return this.createGaugeChart(score, 'Cluster');
  });

  kafkaHealthChart = computed((): EChartsOption => {
    const overview = this.healthState.kafkaOverview();
    const score = overview?.healthScore ?? 0;
    
    return this.createGaugeChart(score, 'Kafka');
  });

  applicationHealthChart = computed((): EChartsOption => {
    const overview = this.healthState.applicationOverview();
    const score = overview?.healthScore ?? 0;
    
    return this.createGaugeChart(score, 'Applications');
  });

  private createGaugeChart(score: number, title: string): EChartsOption {
    const primaryColor = score >= 90 ? '#10b981' : score >= 70 ? '#f59e0b' : '#ef4444';
    const secondaryColor = score >= 90 ? '#34d399' : score >= 70 ? '#fbbf24' : '#f87171';
    const bgColor = '#f3f4f6';
    
    // Calculate angles for the progress ring
    const progressAngle = (score / 100) * 360;
    
    return {
      backgroundColor: 'transparent',
      series: [
        // Background ring
        {
          type: 'pie',
          radius: ['70%', '85%'],
          center: ['50%', '50%'],
          startAngle: 90,
          avoidLabelOverlap: false,
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 0
          },
          label: {
            show: false
          },
          data: [
            {
              value: 100,
              itemStyle: {
                color: bgColor
              }
            }
          ],
          silent: true
        },
        // Progress ring
        {
          type: 'pie',
          radius: ['70%', '85%'],
          center: ['50%', '50%'],
          startAngle: 90,
          avoidLabelOverlap: false,
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 2
          },
          label: {
            show: false
          },
          emphasis: {
            disabled: true
          },
          data: [
            {
              value: score,
              itemStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 1,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: primaryColor },
                    { offset: 1, color: secondaryColor }
                  ]
                },
                shadowBlur: 10,
                shadowColor: primaryColor + '40'
              }
            },
            {
              value: 100 - score,
              itemStyle: {
                color: 'transparent'
              }
            }
          ],
          animationType: 'scale',
          animationEasing: 'elasticOut',
          animationDelay: (idx: number) => idx * 50
        }
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'center',
          style: {
            text: score.toFixed(0) + '%',
            fontSize: 24,
            fontWeight: 'bold',
            fill: primaryColor
          }
        },
        {
          type: 'text',
          left: 'center',
          top: '60%',
          style: {
            text: this.getHealthLabel(score),
            fontSize: 11,
            fontWeight: 500,
            fill: '#6b7280'
          }
        }
      ]
    };
  }

  private getHealthLabel(score: number): string {
    if (score >= 90) return 'Healthy';
    if (score >= 70) return 'Warning';
    return 'Critical';
  }

  // Output event to notify parent when a card is clicked
  cardClick = output<'kubernetes' | 'kafka' | 'application'>();

  /**
   * Handle card click - emit event to parent to open respective accordion
   */
  onCardClick(accordion: 'kubernetes' | 'kafka' | 'application'): void {
    this.cardClick.emit(accordion);
  }
}

