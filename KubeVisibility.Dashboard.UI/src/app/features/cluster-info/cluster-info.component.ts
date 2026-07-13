import { Component, OnInit, OnDestroy, inject, computed, signal } from '@angular/core';

import { Router, NavigationEnd, NavigationStart } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { ClusterStateService } from '../../core/services/cluster-state.service';
import { RefreshPreferencesService } from '../../core/services/refresh-preferences.service';
import { NavigationService, UrlChangeEvent } from '../../core/services/navigation.service';
import { HeaderComponent } from '../../layout/header/header.component';
import { ScanningViewComponent } from './components/scanning-view/scanning-view.component';
import { DeepDiveViewComponent } from './components/deep-dive-view/deep-dive-view.component';
import { ViewMode, HealthFilterSelection } from '../../core/models/cluster-info.models';
@Component({
  selector: 'app-cluster-info',
  standalone: true,
  imports: [
    HeaderComponent,
    ScanningViewComponent,
    DeepDiveViewComponent
],
  template: `
    <div class="cluster-info-container">
      <app-header
            [headerMode]="'standard'"
            [currentView]="currentView()"
        [healthFilter]="healthFilter()"
        [healthFilterCounts]="healthFilterCounts()"
        [searchQuery]="searchQuery()"
        [autoRefreshEnabled]="autoRefreshEnabled()"
        [autoRefreshInterval]="autoRefreshInterval()"
        [externalIsRefreshing]="isRefreshing()"
        (searchChange)="onSearchChange($event)"
            (viewChange)="onViewChange($event)"
        (refreshClick)="refresh()"
        (healthFilterChange)="onHealthFilterChange($event)"
        (autoRefreshEnabledChange)="onAutoRefreshEnabledChange($event)"
        (autoRefreshIntervalChange)="onAutoRefreshIntervalChange($event)"
        />
      <div class="view-container">
        @if (currentView() === 'scanning') {
          <app-scanning-view />
        } @else if (currentView() === 'deepdive') {
          <app-deep-dive-view />
        }
      </div>
    </div>
  `,
  styles: [
    `
      .cluster-info-container {
        width: 100%;
        background: #f5f5f5;
        padding: 0 1rem;
        padding-bottom: 0;
      }
      .view-container {
        padding-bottom: 0;
        max-width: 100%;
      }
    `,
  ],
})
export class ClusterInfoComponent implements OnInit, OnDestroy {
  private static readonly MIN_REFRESH_SPINNER_MS = 700;
  private stateService = inject(ClusterStateService);
  private refreshPreferences = inject(RefreshPreferencesService);
  private router = inject(Router);
  private navigationService = inject(NavigationService);

  currentView = this.stateService.currentView;
  healthFilter = this.stateService.healthFilter;
  searchQuery = this.stateService.searchQuery;
  autoRefreshEnabled = this.refreshPreferences.autoRefreshEnabled;
  autoRefreshInterval = this.refreshPreferences.autoRefreshInterval;
  isRefreshing = signal(false);
  healthFilterCounts = computed(() => {
    const stats = this.stateService.stats();
    return {
      healthy: stats.healthy,
      degraded: stats.degraded,
      failed: stats.failed,
      paused: stats.paused,
      stopped: stats.stopped,
    };
  });

  private autoRefreshTimer?: number;
  private isAutoRefreshActive = false;
  private urlChangeSubscription?: Subscription;
  private routerSubscription?: Subscription;
  private previousRoutePath: string = '';
  private previousQueryParams: string = '';
  private isInitialized = false;

  ngOnInit(): void {
    // Read URL params and set view accordingly (important for direct navigation)
    this.readUrlParamsAndSetView();
    
    // Track current route path and query params
    this.previousRoutePath = this.router.url.split('?')[0];
    this.previousQueryParams = this.router.url.split('?')[1] || '';
    
    // Subscribe to global URL changes from NavigationService
    this.urlChangeSubscription = this.navigationService.urlChanges$.subscribe((event: UrlChangeEvent) => {
      // Only handle if we're on the cluster route
      if (this.isClusterRoute(event.path)) {
        this.handleUrlParamsChange();
      }
    });
    
    // Subscribe to router events to detect navigation away from or into cluster route
    this.routerSubscription = this.router.events.subscribe((event) => {
      // Capture route before navigation starts
      if (event instanceof NavigationStart) {
        this.previousRoutePath = this.router.url.split('?')[0];
        this.previousQueryParams = this.router.url.split('?')[1] || '';
      }
      
      // Handle navigation end
      if (event instanceof NavigationEnd) {
        const currentPath = event.urlAfterRedirects.split('?')[0];
        const currentQueryParams = event.urlAfterRedirects.split('?')[1] || '';
        const wasOnCluster = this.isClusterRoute(this.previousRoutePath);
        const isOnCluster = this.isClusterRoute(currentPath);
        
        // If we were on cluster route and now we're not, reset search query (leaving cluster)
        if (wasOnCluster && !isOnCluster) {
          this.stateService.setSearchQuery('');
        }
        
        // If we're entering cluster route from a different route, reset search query
        // But only if we weren't already on cluster (to avoid resetting when just switching views)
        // Also skip on first initialization to avoid resetting on direct navigation to cluster
        if (!wasOnCluster && isOnCluster && this.isInitialized) {
          this.stateService.setSearchQuery('');
        }
        
        // Mark as initialized after first navigation end
        this.isInitialized = true;
        
        // Update previous route path and query params for next navigation
        this.previousRoutePath = currentPath;
        this.previousQueryParams = currentQueryParams;
      }
    });
    
    this.stateService.setAutoRefreshEnabled(this.autoRefreshEnabled());
    this.stateService.setAutoRefreshInterval(this.autoRefreshInterval());
    this.stateService.loadAllNamespacesProgressive();
    this.setupAutoRefresh();
  }

  /**
   * Check if a route path is the cluster route
   * Handles both /cluster and /dashboard/cluster paths
   */
  private isClusterRoute(path: string): boolean {
    return path === '/cluster' || path === '/dashboard/cluster' || path.endsWith('/cluster');
  }

  /**
   * Read URL parameters and set the current view
   * This is important when navigating directly to this route with query params
   */
  private readUrlParamsAndSetView(): void {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    
    if (view === 'deepdive') {
      this.stateService.setCurrentView('deepdive');
    } else {
      // Default to scanning view
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

  /**
   * Handle URL parameter changes (e.g., from browser back/forward or direct URL changes)
   */
  private handleUrlParamsChange(): void {
    this.readUrlParamsAndSetView();
    
    // The deep-dive view component will handle resource selection from URL
    // via its effect handler, so we just need to ensure the view is correct
  }


  onSearchChange(query: string): void {
    this.stateService.setSearchQuery(query);
  }

  onViewChange(view: ViewMode): void {
    this.stateService.setCurrentView(view);
    this.updateUrl({ view });
  }

  onHealthFilterChange(filter: HealthFilterSelection): void {
    this.stateService.setHealthFilter(filter);
    this.updateUrl({ health: filter.length ? filter.join(',') : '' });
  }

  private updateUrl(params: { view?: string; health?: string }): void {
    const url = new URLSearchParams(window.location.search);
    
    if (params.view && params.view !== 'scanning') {
      url.set('view', params.view);
    } else if (params.view === 'scanning') {
      url.delete('view');
    }
    
    if (params.health !== undefined) {
      if (params.health.length > 0) {
      url.set('health', params.health);
      } else {
      url.delete('health');
      }
    }
    
    // Use window.location.pathname to get the full path including base href
    const currentPath = window.location.pathname;
    const newUrl = url.toString() ? `${currentPath}?${url.toString()}` : currentPath;
    window.history.pushState({}, '', newUrl);
  }

  onAutoRefreshEnabledChange(enabled: boolean): void {
    this.refreshPreferences.setAutoRefreshEnabled(enabled);
    this.stateService.setAutoRefreshEnabled(enabled);
    if (enabled) {
      this.setupAutoRefresh();
    } else {
      this.clearAutoRefresh();
    }
  }

  onAutoRefreshIntervalChange(interval: number): void {
    this.refreshPreferences.setAutoRefreshInterval(interval);
    this.stateService.setAutoRefreshInterval(this.autoRefreshInterval());
    this.clearAutoRefresh();
    this.setupAutoRefresh();
  }

  async refresh(): Promise<void> {
    await this.refreshContextAware();
  }

  private async refreshContextAware(): Promise<void> {
    if (this.isRefreshing()) {
      return;
    }

    const refreshStartMs = Date.now();
    this.isRefreshing.set(true);
    try {
      await this.stateService.performContextAwareRefresh();
    } catch (error) {
      console.error('Error during refresh:', error);
    } finally {
      const elapsedMs = Date.now() - refreshStartMs;
      const remainingMs = ClusterInfoComponent.MIN_REFRESH_SPINNER_MS - elapsedMs;
      if (remainingMs > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), remainingMs);
        });
      }
      this.isRefreshing.set(false);
    }
  }

  private setupAutoRefresh(): void {
    this.clearAutoRefresh();
    
    const enabled = this.autoRefreshEnabled();
    const interval = this.autoRefreshInterval();
    
    if (enabled && interval > 0) {
      this.isAutoRefreshActive = true;
      this.scheduleNextRefresh(interval);
    }
  }

  private scheduleNextRefresh(interval: number): void {
    if (!this.isAutoRefreshActive) {
      return;
    }

    this.autoRefreshTimer = window.setTimeout(async () => {
      // Only proceed if auto-refresh is still active
      if (!this.isAutoRefreshActive) {
        return;
      }

      // Wait for the refresh to complete before scheduling the next one
      try {
        await this.refreshContextAware();
      } catch (error) {
        console.error('Error during auto-refresh:', error);
      }

      // Schedule the next refresh only if still active
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

