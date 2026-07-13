import { Component, inject, computed, ElementRef, ViewChild, OnInit, AfterViewInit, OnDestroy, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { HealthStateService } from './services/health-state.service';
import { HealthOverviewSectionComponent } from './components/health-overview-section/health-overview-section.component';
import { HealthKafkaSectionComponent } from './components/health-kafka-section/health-kafka-section.component';
import { HealthKubernetesSectionComponent } from './components/health-kubernetes-section/health-kubernetes-section.component';
import { HealthApplicationSectionComponent } from './components/health-application-section/health-application-section.component';
import { PrometheusAlertStatsComponent } from './components/prometheus-alert-stats/prometheus-alert-stats.component';
import { PrometheusFiringAlertsTableComponent } from './components/prometheus-firing-alerts-table/prometheus-firing-alerts-table.component';
import { HeaderComponent } from '../../layout/header/header.component';
import { ViewportScaleService } from '../../core/services/viewport-scale.service';
import { NavigationService, UrlChangeEvent } from '../../core/services/navigation.service';
import { ClusterStateService } from '../../core/services/cluster-state.service';
import { RefreshPreferencesService } from '../../core/services/refresh-preferences.service';
import { ViewMode } from '../../core/models/cluster-info.models';

@Component({
  selector: 'app-health-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    HealthOverviewSectionComponent,
    HealthKubernetesSectionComponent,
    HealthKafkaSectionComponent,
    HealthApplicationSectionComponent,
    PrometheusAlertStatsComponent,
    PrometheusFiringAlertsTableComponent
  ],
  template: `
    <div class="health-dashboard-container">
      <app-header
        [headerMode]="'dashboard'"
        [currentView]="'scanning'"
        [healthFilter]="[]"
        [autoRefreshEnabled]="refreshPreferences.autoRefreshEnabled()"
        [autoRefreshInterval]="refreshPreferences.autoRefreshInterval()"
        [externalIsRefreshing]="healthState.isRefreshing()"
        [showDashboardQuickActions]="true"
        (searchChange)="onSearchChange($event)"
        (viewChange)="onViewChange($event)"
        (healthFilterChange)="onHealthFilterChange($event)"
        (autoRefreshEnabledChange)="onAutoRefreshEnabledChange($event)"
        (autoRefreshIntervalChange)="onAutoRefreshIntervalChange($event)"
        (refreshClick)="onRefreshClick()"
      />
      <div class="view-container">
        <div class="health-dashboard-content" #healthDashboardContent [ngStyle]="containerHeightStyle()">
          <!-- Error Message -->
          @if (healthState.error(); as error) {
            <div class="error-banner">
              <i class="fas fa-exclamation-circle"></i>
              <span>{{ error }}</span>
              <button (click)="healthState.clearError()">
                <i class="fas fa-times"></i>
              </button>
            </div>
          }

          <div class="dashboard-content">
            <!-- Health Accordions -->
            <div class="health-accordions">
              <app-health-overview-section
                [isLoading]="false"
                [isOpen]="isAccordionOpen('overview')"
                [isMessagingEnabled]="isMessagingEnabled()"
                (toggleAccordionRequested)="toggleAccordion('overview')"
                (cardClick)="onOverviewCardClick($event)"
              />

              <app-health-kubernetes-section
                #kubernetesSection
                [isOpen]="isAccordionOpen('kubernetes')"
                [isLoading]="healthState.isLoadingNodeHealth() && !healthState.nodeHealth()"
                (toggleRequested)="toggleAccordion('kubernetes')"
                (contentTransitionEnd)="onAccordionTransitionEnd('kubernetes', $event)"
              />

              <!-- Kafka Health Accordion -->
              @if (isMessagingEnabled()) {
                <app-health-kafka-section
                  #kafkaSection
                  [isOpen]="isAccordionOpen('kafka')"
                  [isLoading]="healthState.isLoadingKafkaHealth() && !healthState.kafkaHealth()"
                  (toggleRequested)="toggleAccordion('kafka')"
                  (contentTransitionEnd)="onAccordionTransitionEnd('kafka', $event)"
                />
              }

              <app-health-application-section
                #applicationSection
                [isOpen]="isAccordionOpen('application')"
                [isLoading]="healthState.isLoadingApplicationHealth() && !healthState.applicationHealth()"
                (toggleRequested)="toggleAccordion('application')"
                (contentTransitionEnd)="onAccordionTransitionEnd('application', $event)"
              />

              <!-- Alerts Accordion -->
              <div class="health-accordion" #alertsSection>
                <div
                  class="health-accordion-header"
                  (click)="toggleAccordion('alerts')"
                >
                  <div class="accordion-info">
                    <i class="fas fa-bell"></i>
                    <span class="accordion-title">Alerts</span>
                    @if (alertBadgeCount() > 0) {
                      <span class="badge badge-alert">
                        {{ alertBadgeCount() }}
                      </span>
                    }
                  </div>
                  <i
                    class="fas toggle-icon"
                    [class.fa-chevron-down]="!isAccordionOpen('alerts')"
                    [class.fa-chevron-up]="isAccordionOpen('alerts')"
                  ></i>
                </div>
                <div
                  class="health-accordion-content"
                  [class.accordion-content-wrapper]="isAccordionOpen('alerts')"
                  (transitionend)="onAccordionTransitionEnd('alerts', $event)"
                >
                  @if (isAccordionOpen('alerts')) {
                    <app-prometheus-alert-stats></app-prometheus-alert-stats>
                    <app-prometheus-firing-alerts-table></app-prometheus-firing-alerts-table>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .health-dashboard-container {
      width: 100%;
      background: #f5f5f5;
      padding: 0 1rem;
      padding-bottom: 0;
    }

    .view-container {
      padding: 0.6rem 0 1rem;
      padding-bottom: 0;
      max-width: 100%;
    }

    .health-dashboard-content {
      width: var(--base-viewport-width);
      padding-right: 1.5rem;
      padding-bottom: 1.5rem;
      position: fixed;
      z-index: 10020;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: var(--theme-border-gray) transparent;
    }

    .error-banner {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      background: #fef2f2;
      border: 1px solid #ef4444;
      border-radius: 8px;
      color: #991b1b;
      margin-bottom: 1rem;
    }
    .error-banner i {
      font-size: var(--theme-font-page-title);
      color: #ef4444;
    }

    .error-banner span {
      flex: 1;
    }

    .error-banner button {
      background: transparent;
      border: none;
      color: #991b1b;
      cursor: pointer;
      padding: 0.25rem;
      font-size: var(--theme-font-page-title);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .error-banner button:hover {
      color: #7f1d1d;
    }

    .dashboard-content {
      max-width: 100%;
    }

    .health-accordions {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      padding-bottom: 1rem;
    }

    .health-accordion {
      background-color: var(--theme-bg-app);
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .health-accordion-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 1.5rem;
      cursor: pointer;
      background-color: var(--theme-bg-surface);
      border-bottom: 1px solid var(--theme-border-gray-light);
      transition: all 0.3s ease;
      user-select: none;
    }

    .health-accordion-header:hover {
      background-color: var(--theme-bg-surface);
    }

    .accordion-info {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex: 1;
    }

    .accordion-info i {
      font-size: var(--theme-font-page-title);
    }

    .accordion-title {
      font-size: var(--theme-font-section-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      white-space: nowrap;
    }

    .badge {
      border-radius: 999px;
      padding: 0.15rem 0.75rem;
      font-weight: var(--theme-font-table-header-weight);
      font-size: var(--theme-font-body);
    }

    .badge-alert {
      background: #fee2e2;
      color: #991b1b;
    }

    .toggle-icon {
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .health-accordion-content {
      padding: 0;
      overflow: hidden;
      transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), 
                  opacity 0.3s ease-in-out,
                  padding 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      max-height: 0;
      opacity: 0;
      pointer-events: none;
    }

    .health-accordion-content.accordion-content-wrapper {
      max-height: 10000px; /* Large enough for any content */
      opacity: 1;
      pointer-events: auto;
      background-color: var(--theme-bg-app);
      transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), 
                  opacity 0.3s ease-in-out,
                  padding 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Ensure smooth animation for accordion content */
    .health-accordion {
      transition: box-shadow 0.3s ease;
    }

    .health-accordion:has(.health-accordion-content.accordion-content-wrapper) {
      box-shadow: 0 6px 12px -2px rgba(0, 0, 0, 0.15);
    }

    /* Style panels when inside accordion - remove outer styling */
    .accordion-content-wrapper ::ng-deep .cluster-health-panel,
    .accordion-content-wrapper ::ng-deep .kafka-health-panel,
    .accordion-content-wrapper ::ng-deep .application-health-panel,
    .accordion-content-wrapper ::ng-deep .health-overview {
      margin-bottom: 0;
      box-shadow: none;
      border-radius: 0;
      padding: 1rem; /* Ensure padding is applied directly */
    }
    .accordion-content-wrapper ::ng-deep .prom-alert-stats,
    .accordion-content-wrapper ::ng-deep .firing-alerts-panel {
      margin-bottom: 0;
      box-shadow: none;
      border-radius: 0;
      padding-left: 1rem;
      padding-right: 1rem;
    }
    .accordion-content-wrapper ::ng-deep .prom-alert-stats {
      padding-top: 0.75rem;
      padding-bottom: 0.35rem;
    }
    .accordion-content-wrapper ::ng-deep .firing-alerts-panel {
      padding-top: 0.35rem;
      padding-bottom: 0.85rem;
    }

  `]
})
export class HealthDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  healthState = inject(HealthStateService);
  refreshPreferences = inject(RefreshPreferencesService);
  viewportScaleService = inject(ViewportScaleService);
  navigationService = inject(NavigationService);
  clusterStateService = inject(ClusterStateService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  platformId = inject(PLATFORM_ID);

  // Check if messaging/Kafka is enabled (consumers namespace exists)
  isMessagingEnabled = computed(() => {
    return this.clusterStateService.hasConsumersNamespace();
  });

  private readonly scrollableAccordionSections = ['kubernetes', 'kafka', 'application', 'alerts'] as const;
  private openAccordions = signal<Set<string>>(new Set(['overview']));
  private pendingScrollAccordion: 'kubernetes' | 'kafka' | 'application' | 'alerts' | null = null;
  private urlChangeSubscription?: Subscription;

  @ViewChild('healthDashboardContent', { static: false }) contentElement?: ElementRef<HTMLElement>;
  @ViewChild('kubernetesSection', { static: false, read: ElementRef }) kubernetesSection?: ElementRef<HTMLElement>;
  @ViewChild('kafkaSection', { static: false, read: ElementRef }) kafkaSection?: ElementRef<HTMLElement>;
  @ViewChild('applicationSection', { static: false, read: ElementRef }) applicationSection?: ElementRef<HTMLElement>;
  @ViewChild('alertsSection', { static: false, read: ElementRef }) alertsSection?: ElementRef<HTMLElement>;

  // Signal to track the Y offset of this component from top of viewport
  private componentOffsetTop = signal<number>(0);
  alertBadgeCount = computed(() => {
    const prometheusTotal = this.healthState.prometheusAlertStats()?.totalFiring ?? 0;
    return prometheusTotal;
  });

  // Dynamic height style for the container - accounts for header and padding
  containerHeightStyle = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    const offsetTop = this.componentOffsetTop();
    
    // Calculate available height: baseHeight - offset from top
    const availableHeight = Math.max(baseHeight - offsetTop, 300); // Minimum 300px
    
    return {
      height: `${availableHeight}px`
    };
  });

  ngOnInit(): void {
    this.healthState.setActiveSectionsProvider(() => new Set(this.openAccordions()));

    // Read URL params first to decide initial section and avoid unnecessary overview preload
    const initialSection = this.readUrlParams(false);

    // Start auto-refresh when component becomes active.
    // If URL targets a specific section, load only that section initially.
    this.healthState.setAutoRefreshEnabled(this.refreshPreferences.autoRefreshEnabled());
    this.healthState.setAutoRefreshInterval(this.refreshPreferences.autoRefreshInterval());
    this.healthState.startAutoRefresh(initialSection);
    
    // Subscribe to global URL changes from NavigationService
    this.urlChangeSubscription = this.navigationService.urlChanges$.subscribe((event: UrlChangeEvent) => {
      // Check if we're on the dashboard route
      if (this.isDashboardRoute(event.path)) {
        this.readUrlParams();
      }
    });
  }
  
  /**
   * Check if a route path is the dashboard route
   */
  private isDashboardRoute(path: string): boolean {
    return path === '/' || path === '/dashboard' || path === '/health' || 
           path.endsWith('/dashboard') || path.endsWith('/health') || 
           path === '' || path === 'dashboard' || path === 'health';
  }

  private readUrlParams(shouldLoadData: boolean = true): string {
    if (!isPlatformBrowser(this.platformId)) {
      return 'overview';
    }
    
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');
    
    // Valid accordion sections
    const validSections = ['overview', 'kubernetes', 'kafka', 'application', 'alerts'];
    
    // Check if URL has modal parameter (like modal=nodes) - if so, preserve current section
    const hasModalParam = params.has('modal');
    const currentOpenSection = Array.from(this.openAccordions())[0] || 'overview';
    
    // If section is specified in URL, use it
    // If no section but modal param exists, preserve current section (don't reset to overview)
    // If no section and no modal, but we have a non-overview section open, preserve it
    // Otherwise, default to 'overview'
    let targetSection: string;
    if (section && validSections.includes(section)) {
      targetSection = section;
    } else if (hasModalParam && currentOpenSection && validSections.includes(currentOpenSection)) {
      // Preserve current section when modal param is present
      targetSection = currentOpenSection;
    } else if (!section && currentOpenSection && currentOpenSection !== 'overview' && validSections.includes(currentOpenSection)) {
      // Preserve current non-overview section when closing modal (no section param, no modal param)
      // This prevents resetting to overview when modal closes
      // Don't update URL here to avoid infinite loops - just preserve the current state
      targetSection = currentOpenSection;
    } else {
      targetSection = 'overview';
    }
    
    // Only update if the section is different from current
    if (!this.openAccordions().has(targetSection)) {
      // Open the specified section (or default to overview)
      this.openAccordions.set(new Set([targetSection]));

      // Use setTimeout to ensure view is initialized before loading/scrolling.
      setTimeout(() => {
        if (shouldLoadData) {
          this.loadAccordionData(targetSection);
        }

        // Always scroll when a section is opened, regardless of how it was opened (URL/click/quick-action).
        if (this.isScrollableAccordionSection(targetSection)) {
          this.scheduleAccordionScroll(targetSection);
        }
      }, 100);
    }

    return targetSection;
  }

  ngAfterViewInit(): void {
    // Calculate offset after view init
    this.calculateComponentOffset();
    
    // Recalculate on window resize
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('resize', this.handleResize);
    }

    // Ensure URL-opened accordions also scroll after view refs are available.
    const initiallyOpenSection = Array.from(this.openAccordions())[0];
    if (initiallyOpenSection && this.isScrollableAccordionSection(initiallyOpenSection)) {
      this.scheduleAccordionScroll(initiallyOpenSection);
    }
  }

  ngOnDestroy(): void {
    // Stop auto-refresh when component becomes inactive
    this.healthState.stopAutoRefresh();
    this.healthState.setActiveSectionsProvider(undefined);
    
    // Unsubscribe from URL changes
    if (this.urlChangeSubscription) {
      this.urlChangeSubscription.unsubscribe();
    }
    
    // Clean up resize listener
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.handleResize);
    }
  }

  private handleResize = (): void => {
    this.calculateComponentOffset();
  };

  /**
   * Calculate the offset of this component from the top of the viewport
   * This accounts for the header and any padding above this component
   */
  private calculateComponentOffset(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    // Use setTimeout to ensure DOM has rendered
    setTimeout(() => {
      const element = document.querySelector('.health-dashboard-content');
      if (element) {
        const rect = element.getBoundingClientRect();
        const scale = this.viewportScaleService.scaleFactor();
        
        // Convert actual pixel offset to base coordinates
        const offsetInBaseCoords = rect.top / scale;
        
        this.componentOffsetTop.set(offsetInBaseCoords);
      }
    }, 0);
  }

  onSearchChange(query: string): void {
    // Health dashboard doesn't use search, but required by header
  }

  onViewChange(view: ViewMode): void {
    // Health dashboard doesn't use view toggle, but required by header
  }

  onHealthFilterChange(filter: any[]): void {
    // Health dashboard doesn't use health filter, but required by header
  }

  onAutoRefreshEnabledChange(enabled: boolean): void {
    this.refreshPreferences.setAutoRefreshEnabled(enabled);
    this.healthState.setAutoRefreshEnabled(enabled);
  }

  onAutoRefreshIntervalChange(interval: number): void {
    this.refreshPreferences.setAutoRefreshInterval(interval);
    this.healthState.setAutoRefreshInterval(this.refreshPreferences.autoRefreshInterval());
  }

  onRefreshClick(): void {
    // Manually trigger a refresh of only the currently open sections
    // Don't force 'overview' - only refresh what's actually open
    const openSections = new Set(this.openAccordions());
    this.healthState.refresh(openSections);
  }

  openDashboardSection(section: 'overview' | 'kubernetes' | 'kafka' | 'application' | 'alerts'): void {
    this.openAccordions.set(new Set([section]));
    this.updateUrl({ section });
    this.loadAccordionData(section);
    if (this.isScrollableAccordionSection(section)) {
      this.scheduleAccordionScroll(section);
    }
  }

  toggleAccordion(accordion: string): void {
    const wasOpen = this.openAccordions().has(accordion);
    
    this.openAccordions.update(set => {
      const newSet = new Set<string>();
      // If clicking the currently open accordion, close it
      // Otherwise, close all and open the clicked one
      if (!set.has(accordion)) {
        newSet.add(accordion);
      }
      return newSet;
    });
    
    // Update URL
    this.updateUrl({ section: this.openAccordions().has(accordion) ? accordion : null });
    
    // Load data when accordion opens for the first time
    if (!wasOpen && this.openAccordions().has(accordion)) {
      this.loadAccordionData(accordion);
      if (this.isScrollableAccordionSection(accordion)) {
        this.scheduleAccordionScroll(accordion);
      }
    }
  }

  private updateUrl(params: { section?: string | null }): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const sectionValue =
      params.section !== undefined && params.section !== 'overview'
        ? params.section
        : null;

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section: sectionValue },
      queryParamsHandling: 'merge'
    });
  }

  private loadAccordionData(accordion: string): void {
    // Only load if not already loaded
    if (this.healthState.isSectionLoaded(accordion)) {
      return;
    }
    
    switch (accordion) {
      case 'overview':
        this.healthState.loadHealthOverviewParallel().subscribe();
        break;
      case 'kubernetes':
        this.healthState.loadNodeHealth(true).subscribe();
        break;
      case 'kafka':
        this.healthState.loadKafkaHealth(true).subscribe();
        break;
      case 'application':
        this.healthState.loadApplicationHealth(true).subscribe();
        break;
      case 'alerts':
        this.healthState.loadHealthAlertsSection(true).subscribe();
        break;
    }
  }

  isAccordionOpen(accordion: string): boolean {
    return this.openAccordions().has(accordion);
  }

  /**
   * Handle card click from overview component
   * Opens the respective accordion and closes overview, then scrolls to it after animation
   */
  onOverviewCardClick(accordion: 'kubernetes' | 'kafka' | 'application'): void {
    // Close overview and open the clicked accordion
    this.openAccordions.set(new Set([accordion]));
    
    // Load data for the accordion if not already loaded
    this.loadAccordionData(accordion);
    
    // Update URL
    this.updateUrl({ section: accordion });
    this.scheduleAccordionScroll(accordion);
  }

  /**
   * Handle accordion transition end event
   * Scrolls to the accordion when the opening animation completes
   */
  onAccordionTransitionEnd(accordion: string, event: TransitionEvent): void {
    // Only handle max-height transitions (accordion open/close)
    if (event.propertyName === 'max-height' && this.pendingScrollAccordion === accordion) {
      // Small delay to ensure DOM is fully updated
      setTimeout(() => {
        this.scrollToAccordion(this.pendingScrollAccordion!);
        this.pendingScrollAccordion = null;
      }, 50);
    }
  }

  /**
   * Scroll to the specified accordion section header
   * Calculates scroll position relative to the scroll container
   */
  private scrollToAccordion(accordion: 'kubernetes' | 'kafka' | 'application' | 'alerts'): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    let headerElement: ElementRef<HTMLElement> | undefined;
    
    switch (accordion) {
      case 'kubernetes':
        headerElement = this.kubernetesSection;
        break;
      case 'kafka':
        headerElement = this.kafkaSection;
        break;
      case 'application':
        headerElement = this.applicationSection;
        break;
      case 'alerts':
        headerElement = this.alertsSection;
        break;
    }

    if (headerElement?.nativeElement && this.contentElement?.nativeElement) {
      const header = headerElement.nativeElement;
      const scrollContainer = this.contentElement.nativeElement;
      const headerTopWithinContainer = this.getElementTopWithinContainer(header, scrollContainer);
      if (headerTopWithinContainer === null) {
        return false;
      }

      const targetScrollTop = Math.max(0, headerTopWithinContainer - 6);
      scrollContainer.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      });
      return true;
    }

    return false;
  }

  private isScrollableAccordionSection(section: string): section is typeof this.scrollableAccordionSections[number] {
    return this.scrollableAccordionSections.includes(section as typeof this.scrollableAccordionSections[number]);
  }

  private scheduleAccordionScroll(accordion: 'kubernetes' | 'kafka' | 'application' | 'alerts'): void {
    this.pendingScrollAccordion = accordion;
    setTimeout(() => {
      if (this.pendingScrollAccordion === accordion) {
        const scrolled = this.scrollToAccordion(accordion);
        if (!scrolled) {
          // Fallback retry when section refs are not yet ready.
          setTimeout(() => {
            if (this.pendingScrollAccordion === accordion) {
              this.scrollToAccordion(accordion);
              this.pendingScrollAccordion = null;
            }
          }, 250);
          return;
        }
        this.pendingScrollAccordion = null;
      }
    }, 500);
  }

  private getElementTopWithinContainer(element: HTMLElement, container: HTMLElement): number | null {
    let top = 0;
    let current: HTMLElement | null = element;

    while (current && current !== container) {
      top += current.offsetTop;
      current = current.offsetParent as HTMLElement | null;
    }

    if (current !== container) {
      return null;
    }

    return top;
  }
}


