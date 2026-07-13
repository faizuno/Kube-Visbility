import { Component, OnInit, OnDestroy, inject, computed, signal, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { KafkaStateService } from '../../services/kafka-state.service';
import { NavigationService } from '../../../../core/services/navigation.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { OverviewTabComponent } from './tabs/overview-tab.component';
import { MessagesTabComponent } from './tabs/messages-tab.component';
import { ConsumersTabComponent } from './tabs/consumers-tab.component';
import { SettingsTabComponent } from './tabs/settings-tab.component';
import { StatisticsTabComponent } from './tabs/statistics-tab.component';
import { SearchBarComponent } from '../../../../shared/components/search-bar/search-bar.component';

type TabType = 'overview' | 'messages' | 'consumers' | 'settings' | 'statistics';

@Component({
  selector: 'app-deep-dive-view',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    OverviewTabComponent,
    MessagesTabComponent,
    ConsumersTabComponent,
    SettingsTabComponent,
    StatisticsTabComponent,
    SearchBarComponent,
  ],
  template: `
    <div class="deepdive-layout" [ngStyle]="layoutHeightStyle()" [class.sidebar-collapsed]="isSidebarCollapsed()">
      <div class="deepdive-sidebar">
        <div class="sidebar-header">
          <div class="sidebar-header-top">
            <h3>Topics</h3>
            <div class="sidebar-controls">
              <div class="sidebar-search-row">
                <app-search-bar
                  appearance="header-compact"
                  [searchTerm]="topicFilterQuery()"
                  [placeholderText]="'Search Topics'"
                  (searchChange)="onTopicFilterChange($event)"
                />
              </div>
              <button class="btn-topic-sort" (click)="toggleTopicSort()" [title]="topicSortMode() === 'az' ? 'Sort Z-A' : 'Sort A-Z'">
                <i class="fas" [class.fa-sort-alpha-down]="topicSortMode() === 'az'" [class.fa-sort-alpha-up]="topicSortMode() === 'za'"></i>
                {{ topicSortMode() === 'az' ? 'A-Z' : 'Z-A' }}
              </button>
            </div>
            @if (isMobileViewport()) {
              <button class="btn-sidebar-close" (click)="setSidebarCollapsed(true)" title="Hide topic list">
                <i class="fas fa-times"></i>
              </button>
            }
          </div>
        </div>
        <div class="sidebar-topics">
          @if (isLoadingTopics() && allTopics().length === 0) {
            @for (row of skeletonRows; track row) {
              <div class="sidebar-topic-item sidebar-topic-item-skeleton">
                <span class="topic-name-skeleton table-skeleton"></span>
              </div>
            }
          } @else if (allTopics().length === 0) {
            <div class="sidebar-empty">No topics to display.</div>
          } @else if (displayedTopics().length === 0) {
            <div class="sidebar-empty">No topics match the current search.</div>
          } @else {
            @for (topic of displayedTopics(); track topic.name) {
              <a
                [routerLink]="['/messages']"
                [queryParams]="{ view: 'deepdive', topic: topic.name, tab: currentTab() }"
                class="sidebar-topic-item"
                [class.selected]="selectedTopic() === topic.name"
                (click)="selectTopic(topic.name)"
                [title]="'View topic details'"
                >
                <i class="fas fa-stream"></i>
                <span>{{ topic.name }}</span>
                <button
                  type="button"
                  class="btn-pin-topic"
                  [class.pinned]="isTopicPinned(topic.name)"
                  [title]="isTopicPinned(topic.name) ? 'Unpin topic' : 'Pin topic'"
                  [attr.aria-label]="isTopicPinned(topic.name) ? 'Unpin topic ' + topic.name : 'Pin topic ' + topic.name"
                  (click)="toggleTopicPin(topic.name, $event)"
                >
                  <i class="fas fa-thumbtack"></i>
                </button>
              </a>
            }
          }
        </div>
      </div>
      @if (isMobileViewport() && !isSidebarCollapsed()) {
        <div class="sidebar-backdrop" (click)="setSidebarCollapsed(true)"></div>
      }
      <div class="deepdive-content">
        @if (selectedTopic(); as topicName) {
          <div class="detail-breadcrumb">
            <a [routerLink]="['/messages']" [queryParams]="{ view: 'scanning' }">Messaging</a>
            <span>/</span>
            <span class="breadcrumb-current">{{ topicName }}</span>
          </div>
          <div class="content-header">
            @if (isMobileViewport()) {
              <button class="btn-sidebar-toggle" (click)="setSidebarCollapsed(false)">
                <i class="fas fa-list"></i>
                Topics
              </button>
            }
            <h2>{{ topicName }}</h2>
          </div>
          <div class="tab-navigation">
            @for (tab of tabs; track tab) {
              <button
                class="tab-nav-button"
                [class.active]="currentTab() === tab.value"
                [attr.data-tab]="tab.value"
                (click)="setCurrentTab(tab.value)"
                >
                <i [class]="tab.icon"></i>
                {{ tab.label }}
              </button>
            }
          </div>
          <div class="tab-content">
            @if (currentTab() === 'overview') {
              <app-overview-tab [topicName]="topicName" />
            } @else if (currentTab() === 'messages') {
              <app-messages-tab [topicName]="topicName" />
            } @else if (currentTab() === 'consumers') {
              <app-consumers-tab [topicName]="topicName" />
            } @else if (currentTab() === 'settings') {
              <app-settings-tab [topicName]="topicName" />
            } @else if (currentTab() === 'statistics') {
              <app-statistics-tab [topicName]="topicName" />
            }
          </div>
        } @else {
          <div class="no-selection">
            <i class="fas fa-hand-point-left"></i>
            <h3>Select a topic</h3>
            <p>Select a topic from the sidebar to view details.</p>
            <div class="no-selection-actions">
              <button class="btn-empty-cta" (click)="selectFirstAvailableTopic()">
                <i class="fas fa-stream"></i>
                Select first topic
              </button>
              <button class="btn-empty-secondary" (click)="goToScanningView()">
                <i class="fas fa-list"></i>
                Go to List
              </button>
            </div>
          </div>
        }
      </div>
    </div>
    `,
  styles: [
    `
      .deepdive-layout {
        display: flex;
        min-height: 0;
        overflow: hidden;
      }

      .deepdive-sidebar {
        width: 22%;
        border-right: 1px solid var(--theme-border-gray-light);
        background: var(--theme-bg-surface);
        padding: 0 1rem 1rem;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
      }
      
      .deepdive-sidebar::-webkit-scrollbar {
        width: 17px;
      }
      
      .deepdive-sidebar::-webkit-scrollbar-track {
        background: transparent;
      }
      
      .deepdive-sidebar::-webkit-scrollbar-thumb {
        background-color: var(--theme-border-gray);
        border-radius: 10px;
        border: 3px solid transparent;
        background-clip: content-box;
      }
      
      .deepdive-sidebar::-webkit-scrollbar-thumb:hover {
        background-color: var(--theme-border-gray);
      }

      .sidebar-header {
        min-height: 52px;
        margin-bottom: 0.7rem;
        padding: 0.5rem 0 1rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        overflow: hidden;
      }

      .sidebar-header-top {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        min-height: 40px;
      }

      .sidebar-header h3 {
        margin: 0;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-section-title);
        color: var(--theme-text-dark);
        white-space: nowrap;
      }

      .btn-sidebar-close {
        border: none;
        background: transparent;
        color: var(--theme-text-gray);
        cursor: pointer;
        font-size: var(--theme-font-body);
      }

      .sidebar-controls {
        display: flex;
        gap: 0.4rem;
        align-items: center;
        margin-left: auto;
        flex: 1;
        min-width: 0;
        justify-content: flex-end;
      }
      .sidebar-search-row {
        flex: 1;
        min-width: 120px;
        max-width: 220px;
      }
      .sidebar-search-row app-search-bar {
        width: 100%;
      }

      .btn-topic-sort {
        border: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-surface);
        color: var(--theme-table-header-color);
        border-radius: 8px;
        padding: 0.34rem 0.5rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      .sidebar-topics {
        display: flex;
        flex-direction: column;
        gap: 0.16rem;
        padding-top: 0.15rem;
        max-height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
      }
      .sidebar-topics::-webkit-scrollbar {
        width: 17px;
      }
      
      .sidebar-topics::-webkit-scrollbar-track {
        background: transparent;
      }
      
      .sidebar-topics::-webkit-scrollbar-thumb {
        background-color: var(--theme-border-gray);
        border-radius: 10px;
        border: 3px solid transparent;
        background-clip: content-box;
      }
      
      .sidebar-topics::-webkit-scrollbar-thumb:hover {
        background-color: var(--theme-border-gray);
      }

      .sidebar-empty {
        padding: 1rem;
        text-align: center;
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
      }

      .sidebar-topic-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.36rem 0.5rem;
        margin: 0.16rem 0;
        cursor: pointer;
        border-radius: 6px;
        transition: all 0.3s ease;
        border-left: 3px solid transparent;
        gap: 0.5rem;
        color: var(--theme-text-dark);
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-table-body);
        line-height: 1.32;
        text-decoration: none;
      }

      .sidebar-topic-item:hover {
        background-color: var(--theme-bg-app);
        border-left-color: var(--theme-button-primary);
      }

      .sidebar-topic-item.selected {
        background-color: var(--theme-bg-teal-lighter);
        border-left-color: var(--theme-button-primary);
      }

      .sidebar-topic-item:visited {
        color: var(--theme-text-dark);
      }

      .sidebar-topic-item-skeleton {
        cursor: default;
        border-left-color: transparent !important;
        background: transparent !important;
      }

      .sidebar-topic-item-skeleton:hover {
        background: transparent !important;
        border-left-color: transparent !important;
      }

      .sidebar-topic-item i {
        font-size: var(--theme-font-table-body);
        color: var(--theme-text-gray);
      }

      .sidebar-topic-item.selected i {
        color: var(--theme-text-teal);
      }

      .sidebar-topic-item span {
        flex: 1;
      }

      .btn-pin-topic {
        border: none;
        background: transparent;
        color: var(--theme-text-gray);
        cursor: pointer;
        font-size: var(--theme-font-caption);
        opacity: 0.85;
      }

      .btn-pin-topic.pinned {
        color: var(--theme-text-teal);
        opacity: 1;
      }

      .table-skeleton {
        display: inline-block;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--theme-skeleton-base) 25%,
          var(--theme-skeleton-highlight) 50%,
          var(--theme-skeleton-base) 75%
        );
        background-size: 200% 100%;
        animation: table-skeleton-shimmer 1.4s ease-in-out infinite;
      }

      .topic-name-skeleton {
        width: 100%;
        height: 14px;
      }

      @keyframes table-skeleton-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      .deepdive-content {
        flex: 1;
        padding: 0;
        background: var(--theme-bg-surface);
        overflow-y: auto;
        overflow-x: hidden;
        box-sizing: border-box;
        overflow: auto;
        display: flex;
        flex-direction: column;
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
      }
      
      .deepdive-content::-webkit-scrollbar {
        width: 17px;
      }
      
      .deepdive-content::-webkit-scrollbar-track {
        background: transparent;
      }
      
      .deepdive-content::-webkit-scrollbar-thumb {
        background-color: var(--theme-border-gray);
        border-radius: 10px;
        border: 3px solid transparent;
        background-clip: content-box;
      }
      
      .deepdive-content::-webkit-scrollbar-thumb:hover {
        background-color: var(--theme-border-gray);
      }

      .content-header {
        margin-bottom: 0;
        padding: 0.8rem 1.1rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .content-header h2 {
        margin: 0;
        font-size: var(--theme-font-page-title);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
      }

      .btn-sidebar-toggle {
        border: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-surface);
        color: var(--theme-table-header-color);
        border-radius: 8px;
        padding: 0.45rem 0.6rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      .sidebar-backdrop {
        display: none;
      }

      .tab-navigation {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0;
        border-bottom: 1px solid var(--theme-border-gray-light);
      }

      .tab-nav-button {
        padding: 0.75rem 1.5rem;
        background: transparent;
        border: none;
        border-bottom: 3px solid transparent;
        cursor: pointer;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.3s ease;
        margin-bottom: -1px;
      }

      .tab-nav-button:hover {
        color: var(--theme-text-dark);
        background: var(--theme-bg-app);
      }

      .tab-nav-button.active {
        color: var(--theme-text-teal);
        border-bottom-color: var(--theme-button-primary);
      }

      .tab-nav-button i {
        font-size: var(--theme-font-body);
      }

      /* Colorful tab icons */
      .tab-nav-button[data-tab="overview"] i {
        color: var(--theme-text-teal);
      }

      .tab-nav-button[data-tab="messages"] i {
        color: #10b981;
      }

      .tab-nav-button[data-tab="consumers"] i {
        color: #8b5cf6;
      }

      .tab-nav-button[data-tab="settings"] i {
        color: #f59e0b;
      }

      .tab-nav-button[data-tab="statistics"] i {
        color: #ef4444;
      }

      /* Active state - icons become more vibrant */
      .tab-nav-button.active[data-tab="overview"] i {
        color: var(--theme-text-teal-dark);
      }

      .tab-nav-button.active[data-tab="messages"] i {
        color: #059669;
      }

      .tab-nav-button.active[data-tab="consumers"] i {
        color: #7c3aed;
      }

      .tab-nav-button.active[data-tab="settings"] i {
        color: #d97706;
      }

      .tab-nav-button.active[data-tab="statistics"] i {
        color: #dc2626;
      }

      .tab-content {
        flex: 1;
        padding: .5rem;
      }
      .detail-breadcrumb {
        display: flex;
        align-items: center;
        gap: 0.42rem;
        min-height: 52px;
        padding: 0.5rem 1.1rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
        position: sticky;
        top: 0;
        background: var(--theme-bg-surface);
        z-index: 5;
      }
      .detail-breadcrumb a {
        color: var(--theme-text-teal);
        text-decoration: none;
        font-weight: var(--theme-font-table-header-weight);
      }
      .detail-breadcrumb a:hover {
        text-decoration: underline;
      }
      .breadcrumb-current {
        color: var(--theme-text-dark);
        font-weight: var(--theme-font-table-header-weight);
      }

      .no-selection {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--theme-text-gray);
        gap: 0.5rem;
      }
      .no-selection > i {
        font-size: var(--theme-font-page-title);
        opacity: 0.5;
      }
      .no-selection-actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: center;
      }
      .btn-empty-cta,
      .btn-empty-secondary {
        border-radius: 8px;
        border: 1px solid transparent;
        padding: 0.6rem 0.9rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .btn-empty-cta {
        background: var(--theme-button-primary);
        color: #fff;
      }
      .btn-empty-secondary {
        background: var(--theme-bg-surface);
        color: var(--theme-table-header-color);
        border-color: var(--theme-border-gray);
      }

      @media (max-width: 1024px) {
        .deepdive-layout {
          position: relative;
        }

        .deepdive-sidebar {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: min(360px, 88vw);
          z-index: 30;
          box-shadow: 0 18px 40px rgba(2, 6, 23, 0.18);
          transition: transform 0.22s ease;
          background: var(--theme-bg-surface);
        }

        .deepdive-layout.sidebar-collapsed .deepdive-sidebar {
          transform: translateX(-105%);
        }

        .sidebar-backdrop {
          display: block;
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.24);
          z-index: 25;
        }

        .tab-navigation {
          overflow-x: auto;
          white-space: nowrap;
          padding-bottom: 0.25rem;
        }
        .sidebar-controls {
          flex: 1;
          min-width: 0;
        }
        .sidebar-search-row {
          width: 100%;
          min-width: 0;
        }
      }
    `,
  ],
})
export class DeepDiveViewComponent implements OnInit, OnDestroy {
  private stateService = inject(KafkaStateService);
  private navigationService = inject(NavigationService);
  private viewportScaleService = inject(ViewportScaleService);
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  
  private urlChangeSubscription?: Subscription;
  private urlRestoreAttempted = signal<string>('');
  private resizeHandler = () => this.handleResize();
  private readonly pinnedTopicsStorageKey = 'kafka.deepdive.pinnedTopics';
  
  // Signal to track the Y offset of this component from top of viewport
  private componentOffsetTop = signal<number>(0);
  
  // Dynamic height style for the layout - accounts for header and padding
  layoutHeightStyle = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    const offsetTop = this.componentOffsetTop();
    
    // Calculate available height: baseHeight - offset from top
    const availableHeight = Math.max(baseHeight - offsetTop, 300); // Minimum 300px
    
    return {
      height: `${availableHeight}px`
    };
  });

  // Use filteredTopics for display (respects search query)
  filteredTopics = this.stateService.filteredTopics;
  // Use topics for checking if data is loaded (unfiltered)
  allTopics = this.stateService.topics;
  topicFilterQuery = computed(() => this.stateService.searchQuery());
  topicSortMode = signal<'az' | 'za'>('az');
  pinnedTopics = signal<Set<string>>(new Set<string>());
  isMobileViewport = signal(false);
  isSidebarCollapsed = signal(false);
  displayedTopics = computed(() => {
    const pinned = this.pinnedTopics();
    const direction = this.topicSortMode() === 'az' ? 1 : -1;
    const filtered = this.filteredTopics();

    return [...filtered].sort((a, b) => {
      const aPinned = pinned.has(a.name) ? 1 : 0;
      const bPinned = pinned.has(b.name) ? 1 : 0;
      if (aPinned !== bPinned) {
        return bPinned - aPinned;
      }
      return a.name.localeCompare(b.name) * direction;
    });
  });
  loadingStates = this.stateService.loadingStates;
  isLoadingTopics = computed(() => this.loadingStates()['topics'] === true);
  readonly skeletonRows = Array.from({ length: 20 }, (_, index) => index + 1);
  selectedTopic = this.stateService.selectedTopic;
  currentTab = this.stateService.currentTab;

  tabs = [
    { value: 'messages' as TabType, label: 'Messages', icon: 'fas fa-envelope' },
    { value: 'overview' as TabType, label: 'Overview', icon: 'fas fa-chart-line' },
    { value: 'consumers' as TabType, label: 'Consumers', icon: 'fas fa-users' },
    { value: 'settings' as TabType, label: 'Settings', icon: 'fas fa-cog' },
    { value: 'statistics' as TabType, label: 'Statistics', icon: 'fas fa-chart-bar' },
  ];

  ngOnInit(): void {
    // Calculate the offset from top of viewport
    this.calculateComponentOffset();
    this.handleResize();
    this.restorePinnedTopics();
    
    // Recalculate on window resize
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('resize', this.resizeHandler);
    }
    
    // Read URL params first
    this.readUrlParams();
    
    // Subscribe to global URL changes from NavigationService
    this.urlChangeSubscription = this.navigationService.urlChanges$.subscribe(() => {
      // URL changed - re-read params and reset restoration flag
      this.readUrlParams();
      this.tryRestoreFromUrl();
    });
    
    // Load topics if not already loaded (check unfiltered topics)
    if (this.allTopics().length === 0) {
      this.stateService.loadTopics().then(() => {
        // After topics load, try to restore from URL
        this.tryRestoreFromUrl();
      });
    } else {
      // Topics already loaded, try to restore from URL
      this.tryRestoreFromUrl();
    }
  }
  
  ngOnDestroy(): void {
    // Unsubscribe from URL changes
    if (this.urlChangeSubscription) {
      this.urlChangeSubscription.unsubscribe();
    }
    
    // Remove resize listener
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.resizeHandler);
    }
  }

  private handleResize(): void {
    this.calculateComponentOffset();
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const isMobile = window.innerWidth <= 1024;
    this.isMobileViewport.set(isMobile);
    this.isSidebarCollapsed.set(isMobile);
  }

  private restorePinnedTopics(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const raw = window.localStorage.getItem(this.pinnedTopicsStorageKey);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.pinnedTopics.set(new Set<string>(parsed.filter(v => typeof v === 'string')));
      }
    } catch {
      this.pinnedTopics.set(new Set<string>());
    }
  }

  private persistPinnedTopics(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    window.localStorage.setItem(this.pinnedTopicsStorageKey, JSON.stringify(Array.from(this.pinnedTopics())));
  }
  
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
      const element = document.querySelector('.deepdive-layout');
      if (element) {
        const rect = element.getBoundingClientRect();
        const scale = this.viewportScaleService.scaleFactor();
        
        // Convert actual pixel offset to base coordinates
        const offsetInBaseCoords = rect.top / scale;
        
        this.componentOffsetTop.set(offsetInBaseCoords);
      }
    }, 0);
  }

  private readUrlParams(): void {
    const params = new URLSearchParams(window.location.search);
    const topic = params.get('topic');
    const tab = params.get('tab') as TabType | null;
    
    // Create URL key for tracking restoration
    const newUrlKey = topic ? `${topic}:${tab || ''}` : '';
    const currentUrlKey = this.urlRestoreAttempted();
    
    // If URL params changed, reset the restoration flag
    if (newUrlKey !== currentUrlKey && currentUrlKey !== '') {
      this.urlRestoreAttempted.set('');
    }
    
    // Restore topic from URL if present and different from current selection
    if (topic && this.selectedTopic() !== topic) {
      this.stateService.setSelectedTopic(topic);
    }
    
    // If no topic in URL, clear selection
    if (!topic && this.selectedTopic()) {
      this.stateService.setSelectedTopic(null);
    }
    
    // Restore tab from URL if present and valid
    if (tab && this.isValidTab(tab) && this.currentTab() !== tab) {
      this.stateService.setCurrentTab(tab);
    }
  }

  private tryRestoreFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const topic = params.get('topic');
    const tab = params.get('tab') as TabType | null;
    
    // Create URL key for tracking restoration
    const urlKey = topic ? `${topic}:${tab || ''}` : '';
    
    if (this.urlRestoreAttempted() === urlKey) {
      return;
    }
    
    // If URL has topic, select it (check against all topics, not filtered)
    if (topic) {
      const topicExists = this.allTopics().some(t => t.name === topic);
      if (topicExists) {
        if (this.selectedTopic() !== topic) {
          this.stateService.setSelectedTopic(topic);
        }
        // Set tab if provided
        if (tab && this.isValidTab(tab)) {
          this.stateService.setCurrentTab(tab);
        }
        // Mark that we've restored for this URL
        this.urlRestoreAttempted.set(urlKey);
        return;
      } else {
        // Topic not found - still mark as attempted to avoid repeated searches
        this.urlRestoreAttempted.set(urlKey);
      }
    }
    
    // If no topic in URL and no topic selected, select first filtered topic
    if (!this.selectedTopic() && this.displayedTopics().length > 0) {
      this.selectTopic(this.displayedTopics()[0].name);
    }
    // Mark as attempted
    this.urlRestoreAttempted.set(urlKey);
  }

  private isValidTab(tab: string): tab is TabType {
    return ['overview', 'messages', 'consumers', 'settings', 'statistics'].includes(tab);
  }

  selectTopic(topicName: string): void {
    this.stateService.setSelectedTopic(topicName);
    // Reset to messages tab when selecting a new topic
    this.stateService.setCurrentTab('messages');
    this.isSidebarCollapsed.set(this.isMobileViewport());
    // Update URL
    this.updateUrl({ topic: topicName, tab: 'messages' });
    
    // Scroll to top of the page when a topic is selected
    setTimeout(() => {
      const contentHeader = document.querySelector('.content-header');
      if (contentHeader) {
        contentHeader.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 100);
  }

  setCurrentTab(tab: TabType): void {
    this.stateService.setCurrentTab(tab);
    // Update URL
    const currentTopic = this.selectedTopic();
    if (currentTopic) {
      this.updateUrl({ topic: currentTopic, tab });
    }
    
    // Scroll to top of the page when switching tabs
    setTimeout(() => {
      const contentHeader = document.querySelector('.content-header');
      if (contentHeader) {
        contentHeader.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 100);
  }

  selectFirstAvailableTopic(): void {
    const filtered = this.displayedTopics();
    if (filtered.length > 0) {
      this.selectTopic(filtered[0].name);
      return;
    }

    const all = this.allTopics();
    if (all.length > 0) {
      this.stateService.setSearchQuery('');
      this.selectTopic(all[0].name);
    }
  }

  onTopicFilterChange(query: string): void {
    this.stateService.setSearchQuery(query);
  }

  toggleTopicSort(): void {
    this.topicSortMode.set(this.topicSortMode() === 'az' ? 'za' : 'az');
  }

  isTopicPinned(topicName: string): boolean {
    return this.pinnedTopics().has(topicName);
  }

  toggleTopicPin(topicName: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const next = new Set(this.pinnedTopics());
    if (next.has(topicName)) {
      next.delete(topicName);
    } else {
      next.add(topicName);
    }
    this.pinnedTopics.set(next);
    this.persistPinnedTopics();
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.isSidebarCollapsed.set(collapsed);
  }

  goToScanningView(): void {
    this.router.navigate(['/messages'], { queryParams: { view: 'scanning' } });
  }

  private updateUrl(params: {
    topic?: string;
    tab?: string;
  }): void {
    const queryParams: Record<string, string> = {};
    const current = new URLSearchParams(window.location.search);

    current.forEach((value, key) => {
      queryParams[key] = value;
    });

    queryParams['view'] = 'deepdive';

    if (params.topic) {
      queryParams['topic'] = params.topic;
    }
    if (params.tab) {
      queryParams['tab'] = params.tab;
    }

    this.router.navigate(['/messages'], { queryParams });
  }
}

