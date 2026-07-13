import { Component, OnInit, OnDestroy, inject, computed, signal } from '@angular/core';

import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { KafkaStateService, KafkaViewMode } from './services/kafka-state.service';
import { RefreshPreferencesService } from '../../core/services/refresh-preferences.service';
import { NavigationService, UrlChangeEvent } from '../../core/services/navigation.service';
import { HeaderComponent } from '../../layout/header/header.component';
import { ScanningViewComponent } from './components/scanning-view/scanning-view.component';
import { DeepDiveViewComponent } from './components/deep-dive-view/deep-dive-view.component';

@Component({
  selector: 'app-kafka',
  standalone: true,
  imports: [
    RouterModule,
    HeaderComponent,
    ScanningViewComponent,
    DeepDiveViewComponent
],
  template: `
    <div class="kafka-container">
      <app-header
                    [headerMode]="'standard'"
                    [currentView]="currentViewForToggle()"
        [customStatsText]="statsText()"
        [showHealthFilter]="false"
        [autoRefreshEnabled]="autoRefreshEnabled"
        [autoRefreshInterval]="autoRefreshInterval"
        [externalIsRefreshing]="isRefreshing()"
                    (viewChange)="onViewChange($event)"
                      (searchChange)="onSearchChange($event)"
        (refreshClick)="refresh()"
        (autoRefreshEnabledChange)="onAutoRefreshEnabledChange($event)"
        (autoRefreshIntervalChange)="onAutoRefreshIntervalChange($event)"
      />
      <div class="view-container">
        @if (currentView() === 'scanning') {
          <app-scanning-view (manageAlertsClick)="openTopicAlertingPage()" />
        } @else if (currentView() === 'deepdive') {
          <app-deep-dive-view />
        }
      </div>
    </div>
  `,
  styles: [
    `
      .kafka-container {
        width: 100%;
        background: #f5f5f5;
        padding: 0 1rem;
        min-height: 100vh;
      }

      .view-container {
        padding: 1rem 0;
        max-width: 100%;
      }
    `,
  ],
})
export class KafkaComponent implements OnInit, OnDestroy {
  private stateService = inject(KafkaStateService);
  private refreshPreferences = inject(RefreshPreferencesService);
  private router = inject(Router);
  private navigationService = inject(NavigationService);

  currentView = this.stateService.currentView;
  topics = this.stateService.topics;
  consumerGroupSummaries = this.stateService.consumerGroupSummaries;
  loadingStates = this.stateService.loadingStates;
  lastUpdated = this.stateService.lastUpdated;
  isRefreshing = signal(false);
  autoRefreshEnabled = true;
  autoRefreshInterval = 60;
  
  private urlChangeSubscription?: Subscription;
  private routerSubscription?: Subscription;
  private previousRoutePath: string = '';
  private previousQueryParams: string = '';
  private isInitialized = false;
  private autoRefreshTimer?: number;
  private isAutoRefreshActive = false;

  // Convert KafkaViewMode to ViewMode for view-toggle component
  currentViewForToggle = computed(() => {
    const view = this.currentView();
    return view === 'scanning' ? 'scanning' : 'deepdive';
  });

  stats = computed(() => {
    const topicsCount = this.topics().length;
    const consumerGroupsCount = this.consumerGroupSummaries().length;
    return {
      topics: topicsCount,
      consumerGroups: consumerGroupsCount,
    };
  });

  statsText = computed(() => {
    const loadingStates = this.loadingStates();
    const isLoading = loadingStates['topics'] || loadingStates['consumerGroupSummaries'];
    if (isLoading && this.topics().length === 0 && this.consumerGroupSummaries().length === 0) {
      return 'Loading...';
    }
    const s = this.stats();
    return `Topics: ${s.topics} | Consumer Groups: ${s.consumerGroups}`;
  });
  ngOnInit(): void {
    // Read URL params to set view mode
    this.readUrlParams();
    
    // Track current route path and query params
    this.previousRoutePath = this.router.url.split('?')[0];
    this.previousQueryParams = this.router.url.split('?')[1] || '';
    
    // Subscribe to global URL changes from NavigationService
    this.urlChangeSubscription = this.navigationService.urlChanges$.subscribe((event: UrlChangeEvent) => {
      // Only handle if we're on the messages route
      if (this.isMessagesRoute(event.path)) {
        this.handleUrlParamsChange();
      }
    });
    
    // Subscribe to router events to detect navigation and URL changes
    this.routerSubscription = this.router.events.subscribe((event) => {
      // Capture route before navigation starts
      if (event instanceof NavigationEnd) {
        const currentPath = event.urlAfterRedirects.split('?')[0];
        const currentQueryParams = event.urlAfterRedirects.split('?')[1] || '';
        
        // Update previous route path and query params for next navigation
        this.previousRoutePath = currentPath;
        this.previousQueryParams = currentQueryParams;
        this.isInitialized = true;
      }
    });
    
    // Topics will be loaded by scanning-view component when needed
    this.autoRefreshEnabled = this.refreshPreferences.autoRefreshEnabled();
    this.autoRefreshInterval = this.refreshPreferences.autoRefreshInterval();
    this.setupAutoRefresh();
  }

  /**
   * Check if a route path is the messages route
   */
  private isMessagesRoute(path: string): boolean {
    return path === '/messages' || path.endsWith('/messages');
  }

  /**
   * Handle URL parameter changes (e.g., from browser back/forward or direct URL changes)
   */
  private handleUrlParamsChange(): void {
    this.readUrlParams();
  }


  private readUrlParams(): void {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const topic = params.get('topic');
    
    // Determine view mode:
    // - If view=deepdive explicitly → deepdive
    // - If view=scanning explicitly → scanning
    // - If topic is present but no view → deepdive (topic implies deepdive)
    // - Otherwise (no view, no topic) → scanning (default)
    if (view === 'deepdive') {
      this.stateService.setCurrentView('deepdive');
    } else if (view === 'scanning') {
      this.stateService.setCurrentView('scanning');
    } else if (topic) {
      // Topic present but no explicit view → deepdive
      this.stateService.setCurrentView('deepdive');
    } else {
      // No view and no topic → scanning (default)
      this.stateService.setCurrentView('scanning');
    }
  }

  ngOnDestroy(): void {
    this.clearAutoRefresh();

    // Unsubscribe from URL changes
    if (this.urlChangeSubscription) {
      this.urlChangeSubscription.unsubscribe();
    }
    
    // Unsubscribe from router events
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
  }

  onViewChange(view: 'scanning' | 'deepdive'): void {
    this.stateService.setCurrentView(view as KafkaViewMode);
    // Update URL immediately - use setTimeout to ensure state is updated
    setTimeout(() => {
      this.updateUrl({ view });
    }, 0);
  }

  private updateUrl(params: { view?: string }): void {
    const url = new URLSearchParams(window.location.search);
    
    if (params.view) {
      url.set('view', params.view);
      
      // If switching to scanning view, remove topic and tab params
      if (params.view === 'scanning') {
        url.delete('topic');
        url.delete('tab');
      }
    } else {
      // If no view specified, keep current view or default to scanning
      const currentView = this.currentView();
      if (currentView) {
        url.set('view', currentView);
      } else {
        url.set('view', 'scanning');
      }
    }
    
    // Use window.location.pathname to get the full path including base href
    const currentPath = window.location.pathname;
    const queryString = url.toString();
    const newUrl = queryString ? `${currentPath}?${queryString}` : currentPath;
    window.history.pushState({}, '', newUrl);
  }

  onSearchChange(query: string): void {
    this.stateService.setSearchQuery(query);
  }

  openTopicAlertingPage(): void {
    this.router.navigate(['/messages/alerts']);
  }

  onAutoRefreshEnabledChange(enabled: boolean): void {
    this.refreshPreferences.setAutoRefreshEnabled(enabled);
    this.autoRefreshEnabled = enabled;
    if (enabled) {
      this.setupAutoRefresh();
    } else {
      this.clearAutoRefresh();
    }
  }

  onAutoRefreshIntervalChange(interval: number): void {
    this.refreshPreferences.setAutoRefreshInterval(interval);
    this.autoRefreshInterval = this.refreshPreferences.autoRefreshInterval();
    this.clearAutoRefresh();
    this.setupAutoRefresh();
  }

  async refresh(): Promise<void> {
    await this.refreshContextAware(false);
  }

  private async refreshContextAware(isAutoRefresh: boolean = false): Promise<void> {
    if (this.isRefreshing()) {
      return;
    }

    this.isRefreshing.set(true);
    try {
      const refreshTasks: Array<Promise<void>> = [this.stateService.loadTopics()];

      if (this.currentView() === 'scanning') {
        refreshTasks.push(this.stateService.loadConsumerGroupSummaries());
      } else {
        const tab = this.stateService.currentTab();
        // Auto-refresh should not disrupt the interactive message table state.
        if (isAutoRefresh && tab === 'messages') {
          await Promise.all(refreshTasks);
          return;
        }

        const callback = this.stateService.getRefreshCallback(`${tab}-tab`);
        if (callback) {
          refreshTasks.push(callback());
        } else {
          refreshTasks.push(this.stateService.loadConsumerGroupSummaries());
        }
      }

      await Promise.all(refreshTasks);
    } catch (error) {
      console.error('Error refreshing Kafka data:', error);
    } finally {
      this.isRefreshing.set(false);
    }
  }

  private setupAutoRefresh(): void {
    this.clearAutoRefresh();

    if (this.autoRefreshEnabled && this.autoRefreshInterval > 0) {
      this.isAutoRefreshActive = true;
      this.scheduleNextRefresh(this.autoRefreshInterval);
    }
  }

  private scheduleNextRefresh(interval: number): void {
    if (!this.isAutoRefreshActive) {
      return;
    }

    this.autoRefreshTimer = window.setTimeout(async () => {
      if (!this.isAutoRefreshActive) {
        return;
      }

      await this.refreshContextAware(true);

      if (this.isAutoRefreshActive) {
        this.scheduleNextRefresh(interval);
      }
    }, interval * 1000);
  }

  private clearAutoRefresh(): void {
    this.isAutoRefreshActive = false;
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;
    }
  }
}

