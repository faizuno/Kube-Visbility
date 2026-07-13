import { Component, OnInit, OnDestroy, inject, computed, signal, PLATFORM_ID, output } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { KafkaStateService } from '../../services/kafka-state.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { SearchBarComponent } from '../../../../shared/components/search-bar/search-bar.component';
import type { TopicInfo } from '../../../../core/models/kafka.models';
import type { ConsumerGroupSummary } from '../../../../core/models/kafka.models';

@Component({
  selector: 'app-scanning-view',
  standalone: true,
  imports: [CommonModule, RouterLink, SearchBarComponent],
  template: `
    <div class="scanning-view-container" [ngStyle]="containerHeightStyle()">
    <div class="scanning-view">
      <div class="cluster-top-controls-row">
        <div class="cluster-top-controls-left">
          <span class="global-total-applications">
            <i class="fas fa-stream"></i>
            Total Items: {{ allTopics().length + allConsumerGroupSummaries().length }}
          </span>
          <button type="button" class="btn-manage-alerts" (click)="manageAlertsClick.emit()">
            <i class="fas fa-bell"></i>
            Manage Alerts
          </button>
        </div>
        <div class="cluster-search-row">
          <app-search-bar
            appearance="header-compact"
            [searchTerm]="activeSearchQuery()"
            [placeholderText]="'Search Topics'"
            (searchChange)="onInlineSearchChange($event)"
          />
        </div>
      </div>
      @if (hasActiveFilters()) {
        <div class="active-filters-summary">
          <span class="summary-text">
            Showing {{ topics().length + consumerGroupSummaries().length }} items
            @if (activeSearchQuery()) {
              for "{{ activeSearchQuery() }}"
            }
          </span>
          <button type="button" class="summary-clear-btn" (click)="clearSearchFilters()">Clear filters</button>
        </div>
      }
      <!-- Topics Accordion -->
      <div class="scanning-section" data-section="topics">
        <div
          class="scanning-section-header"
          (click)="toggleSection('topics')"
        >
          <div class="section-info">
            <i class="fas fa-database"></i>
            <span class="section-name">Topics</span>
            <span class="section-description">Browse topics and open details</span>
            <span class="badge badge-primary">
              {{ allTopics().length }}
            </span>
          </div>
          <i
            class="fas toggle-icon"
            [class.fa-chevron-down]="!isSectionOpen('topics')"
            [class.fa-chevron-up]="isSectionOpen('topics')"
          ></i>
      </div>

        @if (isSectionOpen('topics')) {
          <div class="scanning-table-container">
            @if (topics().length === 0 && !showTopicSkeletonRows()) {
        <div class="empty-state">
          <i class="fas fa-filter"></i>
          <h3>{{ allTopics().length === 0 ? 'No topics available' : 'No topics match your filters' }}</h3>
          <p>{{ allTopics().length === 0 ? 'Kafka topics will appear here once available.' : 'Try clearing search to see more topics.' }}</p>
          @if (activeSearchQuery()) {
            <button type="button" class="summary-clear-btn" (click)="clearSearchFilters()">Clear filters</button>
          }
        </div>
      } @else {
              <div class="table-wrapper">
                <div class="table-header-wrapper">
                  <table class="scanning-table scanning-table-header">
                    <thead>
                      <tr>
                        <th class="col-name sortable" (click)="sortTable('topics', 'name')">
                          Topic Name
                          @if (getSortColumn('topics') === 'name') {
                            <i class="fas" [class.fa-sort-up]="getSortDirection('topics') === 'asc'" [class.fa-sort-down]="getSortDirection('topics') === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="col-partitions sortable" (click)="sortTable('topics', 'partitions')">
                          Partitions
                          @if (getSortColumn('topics') === 'partitions') {
                            <i class="fas" [class.fa-sort-up]="getSortDirection('topics') === 'asc'" [class.fa-sort-down]="getSortDirection('topics') === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="col-replication sortable" (click)="sortTable('topics', 'replication')">
                          Replication Factor
                          @if (getSortColumn('topics') === 'replication') {
                            <i class="fas" [class.fa-sort-up]="getSortDirection('topics') === 'asc'" [class.fa-sort-down]="getSortDirection('topics') === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="col-actions"></th>
                      </tr>
                    </thead>
                  </table>
                </div>
                <div class="table-body-container topics-table-body-container">
                  <table class="scanning-table scanning-table-body">
                    <tbody>
                      @if (showTopicSkeletonRows()) {
                        @for (row of skeletonRows; track row) {
                          <tr class="skeleton-row">
                            <td class="col-name"><span class="table-skeleton skeleton-name"></span></td>
                            <td class="col-partitions"><span class="table-skeleton skeleton-sm"></span></td>
                            <td class="col-replication"><span class="table-skeleton skeleton-sm"></span></td>
                            <td class="col-actions"><span class="table-skeleton skeleton-action"></span></td>
                          </tr>
                        }
                      } @else {
                        @for (topic of getSortedTopics(); track topic.name) {
                          <tr>
                            <td class="col-name">
                              <a 
                                [routerLink]="['/messages']"
                                [queryParams]="{ view: 'deepdive', topic: topic.name, tab: 'messages' }"
                                class="topic-name-link"
                                (click)="$event.stopPropagation()"
                                [title]="topic.name"
                              >
                                {{ topic.name }}
                              </a>
                            </td>
                            <td class="col-partitions">{{ topic.partitionCount }}</td>
                            <td class="col-replication">{{ topic.replicationFactor }}</td>
                            <td class="col-actions" (click)="$event.stopPropagation()">
                              <button class="btn-action" (click)="viewTopicDetails(topic.name)" title="View Details" [attr.aria-label]="'View details for topic ' + topic.name">
                                <i class="fas fa-eye"></i>
                                View Details
                              </button>
                            </td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Consumer Groups Accordion -->
      <div class="scanning-section" data-section="consumerGroups">
        <div
          class="scanning-section-header"
          (click)="toggleSection('consumerGroups')"
        >
          <div class="section-info">
            <i class="fas fa-users"></i>
            <span class="section-name">Consumer Groups</span>
            <span class="section-description">Monitor group activity by ID</span>
            <span class="badge badge-primary">
              {{ allConsumerGroupSummaries().length }}
            </span>
          </div>
          <i
            class="fas toggle-icon"
            [class.fa-chevron-down]="!isSectionOpen('consumerGroups')"
            [class.fa-chevron-up]="isSectionOpen('consumerGroups')"
          ></i>
        </div>

        @if (isSectionOpen('consumerGroups')) {
          <div class="scanning-table-container">
            @if (consumerGroupSummaries().length === 0 && !showConsumerGroupSkeletonRows()) {
              <div class="empty-state">
                <i class="fas fa-filter"></i>
                <h3>{{ allConsumerGroupSummaries().length === 0 ? 'No consumer groups available' : 'No groups match your filters' }}</h3>
                <p>{{ allConsumerGroupSummaries().length === 0 ? 'Consumer groups will appear here once available.' : 'Try clearing search to see more groups.' }}</p>
                @if (activeSearchQuery()) {
                  <button type="button" class="summary-clear-btn" (click)="clearSearchFilters()">Clear filters</button>
                }
              </div>
            } @else {
              <div class="table-wrapper">
                <div class="table-header-wrapper">
                  <table class="scanning-table scanning-table-header">
                    <thead>
                      <tr>
                        <th class="col-name sortable" (click)="sortTable('consumerGroups', 'groupId')">
                          Group ID
                          @if (getSortColumn('consumerGroups') === 'groupId') {
                            <i class="fas" [class.fa-sort-up]="getSortDirection('consumerGroups') === 'asc'" [class.fa-sort-down]="getSortDirection('consumerGroups') === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                      </tr>
                    </thead>
                  </table>
                </div>
                <div class="table-body-container">
                  <table class="scanning-table scanning-table-body">
                    <tbody>
                      @if (showConsumerGroupSkeletonRows()) {
                        @for (row of skeletonRows; track row) {
                          <tr class="skeleton-row">
                            <td class="col-name"><span class="table-skeleton skeleton-name"></span></td>
                          </tr>
                        }
                      } @else {
                        @for (group of getSortedConsumerGroupSummaries(); track group.groupId) {
                          <tr>
                            <td class="col-name">{{ group.groupId }}</td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
        </div>
      }
      </div>
    </div>
    </div>
  `,
  styles: [
    `
      .scanning-view-container {
        position: relative;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
        width: var(--base-viewport-width);
        background-color: var(--theme-bg-app);
        padding-right: 2rem;
      }
      .scanning-view {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }
      .cluster-top-controls-row {
        margin-top: 0.75rem;
        margin-bottom: -0.55rem;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .cluster-top-controls-left {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }
      .global-total-applications {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        border-radius: 999px;
        padding: 0.34rem 0.75rem;
        border: 1px solid var(--theme-border-teal, #5fa6a3);
        background: var(--theme-bg-surface);
        color: #0f766e;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
      }
      .btn-manage-alerts {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        height: 36px;
        min-height: 36px;
        border-radius: 10px;
        padding: 0 0.95rem;
        border: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-surface);
        color: var(--theme-table-header-color);
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-header-weight);
        line-height: 1;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      }
      .btn-manage-alerts:hover {
        background: var(--theme-bg-app);
        border-color: var(--theme-border-gray);
      }
      .cluster-search-row {
        display: flex;
        justify-content: flex-end;
        flex: 1;
      }
      .cluster-search-row app-search-bar {
        width: 50%;
        min-width: 340px;
        max-width: 680px;
      }
      .active-filters-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.6rem 0.85rem;
        background: var(--theme-bg-app);
        border: 1px solid var(--theme-border-gray);
        border-radius: 10px;
      }
      .summary-text {
        font-size: var(--theme-font-body);
        color: var(--theme-table-header-color);
        font-weight: var(--theme-font-table-header-weight);
      }
      .summary-clear-btn {
        border: 1px solid var(--theme-border-gray);
        border-radius: 999px;
        background: var(--theme-bg-app);
        color: var(--theme-table-header-color);
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        padding: 0.3rem 0.6rem;
        cursor: pointer;
      }
      .summary-clear-btn:hover {
        background: var(--theme-bg-teal-lighter);
      }

      .scanning-section {
        background-color: var(--theme-bg-surface);
        border-radius: 12px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        overflow: hidden;
      }

      .scanning-section-header {
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

      .scanning-section-header:hover {
        background-color: var(--theme-bg-surface);
      }

      .section-info {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex: 1;
      }

      .section-info i {
        font-size: var(--theme-font-section-title);
        color: var(--theme-button-primary);
      }

      .section-name {
        font-size: var(--theme-font-section-title);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
      }
      .section-description {
        font-size: var(--theme-font-table-header);
        color: var(--theme-text-gray);
      }

      .badge {
        border-radius: 999px;
        padding: 0.22rem 0.72rem;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        line-height: 1.1;
      }

      .badge-primary {
        background: var(--theme-bg-teal-lighter);
        color: var(--theme-button-primary-hover);
      }

      .toggle-icon {
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
        transition: transform 0.3s ease;
      }

      .scanning-table-container {
        padding: 1.5rem;
        background-color: var(--theme-bg-app);
      }

      .table-wrapper {
        display: block;
        border: 1px solid var(--theme-border-gray);
        border-radius: 8px;
        overflow: hidden;
        width: 100%;
        position: relative;
      }

      .table-header-wrapper {
        width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        background-color: var(--theme-table-header-bg);
        position: relative;
        box-sizing: border-box;
      }

      .scanning-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: var(--theme-font-body);
      }

      .scanning-table-header {
        background-color: var(--theme-table-header-bg);
      }

      .scanning-table-header thead {
        background-color: var(--theme-table-header-bg);
      }

      .scanning-table-header th {
        padding: 0.58rem 0.65rem;
        text-align: left;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--text-secondary, var(--theme-text-gray));
        text-transform: uppercase;
        font-size: var(--theme-font-table-header);
        letter-spacing: 0.5px;
        vertical-align: middle;
        background-color: var(--theme-table-header-bg);
        border-bottom: none;
      }

      .scanning-table-header th.sortable {
        cursor: pointer;
        user-select: none;
        transition: background-color 0.2s;
      }

      .scanning-table-header th.sortable:hover {
        background-color: var(--theme-table-header-bg-hover);
        color: var(--primary-color, var(--theme-text-teal));
      }

      .scanning-table-header th.sortable i {
        margin-left: 0.5rem;
        font-size: var(--theme-font-caption);
        opacity: 0.5;
        transition: opacity 0.3s ease;
      }

      .scanning-table-header th.sortable i.sort-inactive {
        opacity: 0.4;
      }

      .scanning-table-header th.sortable i.fa-sort-up,
      .scanning-table-header th.sortable i.fa-sort-down {
        opacity: 1;
        color: var(--theme-button-primary);
      }

      .table-body-container {
        max-height: 300px;
        overflow-y: auto;
        overflow-x: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
        width: 100%;
        position: relative;
        box-sizing: border-box;
      }

      .topics-table-body-container {
        max-height: 420px;
      }

      .scanning-table-body {
        background: var(--theme-bg-surface);
        margin: 0;
        table-layout: fixed;
      }

      .scanning-table-body td {
        padding: 0.42rem 0.65rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        vertical-align: top;
        word-wrap: break-word;
        font-size: var(--theme-font-table-body);
      }

      .scanning-table-body tbody tr {
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .scanning-table-body tbody tr:hover {
        background-color: var(--theme-bg-teal-lighter);
      }

      .col-name {
        width: 46%;
      }

      .topic-name-link {
        color: var(--theme-button-primary);
        cursor: pointer;
        text-decoration: none;
        transition: all 0.2s ease;
        display: inline-block;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-table-body);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .topic-name-link:hover {
        color: var(--theme-button-primary-hover, #851697);
        text-decoration: underline;
      }

      .topic-name-link:active {
        transform: translateY(1px);
      }

      .topic-name-link:visited {
        color: var(--theme-button-primary);
      }

      .col-partitions,
      .col-replication {
        width: 12%;
        text-align: center;
      }

      .col-actions {
        width: 30%;
        text-align: right;
      }

      .btn-action {
        padding: 0.34rem 0.65rem;
        background: var(--theme-button-primary);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-body-weight);
      }

      .btn-action:hover {
        background: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px var(--theme-button-primary-shadow);
      }

      .empty-state {
        text-align: center;
        padding: 3rem;
        color: var(--theme-text-gray);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
      }

      .empty-state i {
        font-size: var(--theme-font-page-title);
        opacity: 0.75;
      }
      .empty-state h3 {
        margin: 0.1rem 0;
        font-size: var(--theme-font-section-title);
        color: var(--theme-table-header-color);
      }
      .empty-state p {
        margin: 0 0 0.35rem;
      }

      .skeleton-row {
        pointer-events: none;
        cursor: default !important;
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

      .skeleton-name {
        width: min(75%, 380px);
        height: 14px;
      }

      .skeleton-sm {
        width: 48px;
        height: 14px;
      }

      .skeleton-action {
        width: 110px;
        height: 32px;
        border-radius: 6px;
      }

      @keyframes table-skeleton-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
    `,
  ],
})
export class ScanningViewComponent implements OnInit, OnDestroy {
  readonly manageAlertsClick = output<void>();
  private stateService = inject(KafkaStateService);
  private viewportScaleService = inject(ViewportScaleService);
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  
  // Signal to track the Y offset of this component from top of viewport
  private componentOffsetTop = signal<number>(0);
  
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

  topics = this.stateService.filteredTopics;
  allTopics = this.stateService.topics; // For checking if data is loaded
  consumerGroupSummaries = this.stateService.filteredConsumerGroupSummaries;
  allConsumerGroupSummaries = this.stateService.consumerGroupSummaries; // For checking if data is loaded
  searchQuery = this.stateService.searchQuery;
  loadingStates = this.stateService.loadingStates;
  activeSearchQuery = computed(() => this.searchQuery().trim());
  hasActiveFilters = computed(() => this.activeSearchQuery().length > 0);

  // Accordion state - default only topics open
  private _openSections = signal<Set<string>>(new Set(['topics']));

  // Sort state: section -> { column, direction }
  private sortState = signal<Record<string, { column: string; direction: 'asc' | 'desc' }>>({});

  isLoadingTopics = computed(() => this.loadingStates()['topics'] === true);
  isLoadingConsumerGroupSummaries = computed(() => this.loadingStates()['consumerGroupSummaries'] === true);
  isLoadingConsumerGroupDetails = computed(() => this.loadingStates()['allConsumerGroupDetails'] === true);
  readonly skeletonRows = [1, 2, 3, 4, 5];
  showTopicSkeletonRows = computed(() => this.isLoadingTopics() && this.allTopics().length === 0);
  showConsumerGroupSkeletonRows = computed(
    () => this.isLoadingConsumerGroupSummaries() && this.allConsumerGroupSummaries().length === 0
  );

  isSectionOpen = (section: string): boolean => {
    return this._openSections().has(section);
  };

  getSortColumn(section: string): string | null {
    return this.sortState()[section]?.column ?? null;
  }

  getSortDirection(section: string): 'asc' | 'desc' {
    return this.sortState()[section]?.direction ?? 'asc';
  }

  getSortedTopics(): TopicInfo[] {
    const list = [...this.topics()];
    const sort = this.sortState()['topics'];
    if (!sort) {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sort.column) {
        case 'name':
          aVal = a.name;
          bVal = b.name;
          return sort.direction === 'asc'
            ? (aVal as string).localeCompare(bVal as string)
            : (bVal as string).localeCompare(aVal as string);
        case 'partitions':
          aVal = a.partitionCount;
          bVal = b.partitionCount;
          return sort.direction === 'asc' ? aVal - bVal : bVal - aVal;
        case 'replication':
          aVal = a.replicationFactor;
          bVal = b.replicationFactor;
          return sort.direction === 'asc' ? aVal - bVal : bVal - aVal;
        default:
          return 0;
      }
    });
  }

  getSortedConsumerGroupSummaries(): ConsumerGroupSummary[] {
    const list = [...this.consumerGroupSummaries()];
    const sort = this.sortState()['consumerGroups'];
    if (!sort) {
      return list.sort((a, b) => a.groupId.localeCompare(b.groupId));
    }
    if (sort.column === 'groupId') {
      return list.sort((a, b) =>
        sort.direction === 'asc'
          ? a.groupId.localeCompare(b.groupId)
          : b.groupId.localeCompare(a.groupId)
      );
    }
    return list;
  }

  sortTable(section: string, column: string): void {
    const current = { ...this.sortState() };
    const existing = current[section];
    if (existing?.column === column) {
      current[section] = {
        column,
        direction: existing.direction === 'asc' ? 'desc' : 'asc',
      };
    } else {
      current[section] = { column, direction: 'asc' };
    }
    this.sortState.set(current);
  }

  toggleSection(section: string): void {
    const current = this._openSections();
    const wasOpen = current.has(section);
    const newSet = new Set(current);
    if (wasOpen) {
      newSet.delete(section);
    } else {
      newSet.add(section);
      // Lazy load consumer group details when section is opened
      if (section === 'consumerGroups' && this.stateService.allConsumerGroupDetails().length === 0) {
        this.stateService.loadAllConsumerGroupDetails().catch((error) => {
          console.error('Error loading consumer group details:', error);
        });
      }
    }
    this._openSections.set(newSet);

    if (!wasOpen) {
      this.scrollSectionToTop(section);
    }
  }

  private scrollSectionToTop(section: string, attempt: number = 0): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    setTimeout(() => {
      const host = document.querySelector('.scanning-view-container') as HTMLElement | null;
      if (!host) {
        return;
      }

      const sectionElements = Array.from(
        host.querySelectorAll('.scanning-section')
      ) as HTMLElement[];
      const targetSection = sectionElements.find(
        (element) => element.dataset['section'] === section
      );
      const targetHeader = targetSection?.querySelector(
        '.scanning-section-header'
      ) as HTMLElement | null;

      if (!targetHeader) {
        if (attempt < 5) {
          this.scrollSectionToTop(section, attempt + 1);
        }
        return;
      }

      const container = this.getScrollableAncestor(targetHeader, host) ?? host;
      const containerRect = container.getBoundingClientRect();
      const headerRect = targetHeader.getBoundingClientRect();
      const desiredTop = Math.max(
        0,
        container.scrollTop + (headerRect.top - containerRect.top) - 8
      );

      if (Math.abs(container.scrollTop - desiredTop) > 2) {
        container.scrollTo({ top: desiredTop, behavior: 'smooth' });
      }

      if (attempt < 2) {
        setTimeout(() => this.scrollSectionToTop(section, attempt + 1), 180);
      }
    }, attempt === 0 ? 40 : 80);
  }

  private getScrollableAncestor(element: HTMLElement, fallbackRoot: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element.parentElement;
    while (current && current !== fallbackRoot) {
      const styles = window.getComputedStyle(current);
      const overflowY = styles.overflowY;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
      if (isScrollable) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  ngOnInit(): void {
    // Calculate the offset from top of viewport
    this.calculateComponentOffset();
    
    // Recalculate on window resize
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('resize', () => this.calculateComponentOffset());
    }
    
    if (this.allTopics().length === 0 || this.allConsumerGroupSummaries().length === 0) {
      this.refreshData();
    }
  }
  
  ngOnDestroy(): void {
    // Remove resize listener
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', () => this.calculateComponentOffset());
    }
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
      const element = document.querySelector('.scanning-view-container');
      if (element) {
        const rect = element.getBoundingClientRect();
        const scale = this.viewportScaleService.scaleFactor();
        
        // Convert actual pixel offset to base coordinates
        const offsetInBaseCoords = rect.top / scale;
        
        this.componentOffsetTop.set(offsetInBaseCoords);
      }
    }, 0);
  }

  async refreshData(): Promise<void> {
    try {
      await Promise.all([
        this.stateService.loadTopics(),
        this.stateService.loadConsumerGroupSummaries(),
      ]);
    } catch (error) {
      console.error('Error refreshing scanning data:', error);
    }
  }

  openInDeepDive(topicName: string): void {
    this.stateService.setCurrentView('deepdive');
    this.stateService.setSelectedTopic(topicName);
    this.stateService.setCurrentTab('messages');
    this.updateUrl({
      view: 'deepdive',
      topic: topicName,
      tab: 'messages',
    });
  }

  viewTopicDetails(topicName: string): void {
    // Same as openInDeepDive but called from button
    this.openInDeepDive(topicName);
  }


  clearSearchFilters(): void {
    this.stateService.setSearchQuery('');
  }

  onInlineSearchChange(query: string): void {
    this.stateService.setSearchQuery(query);
  }

  private updateUrl(params: {
    view?: string;
    topic?: string;
    tab?: string;
  }): void {
    const url = new URLSearchParams(window.location.search);
    
    if (params.view) {
      url.set('view', params.view);
    }
    if (params.topic) {
      url.set('topic', params.topic);
    }
    if (params.tab) {
      url.set('tab', params.tab);
    }
    
    // Use window.location.pathname to get the full path including base href
    const currentPath = window.location.pathname;
    const queryString = url.toString();
    const newUrl = queryString ? `${currentPath}?${queryString}` : currentPath;
    window.history.pushState({}, '', newUrl);
  }
}

