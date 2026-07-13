import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, inject, signal, computed } from '@angular/core';

import { RouterLink } from '@angular/router';
import { KafkaService } from '../../../../../core/services/api/kafka.service';
import { KafkaStateService } from '../../../services/kafka-state.service';
import { ConsumerGroupDetail } from '../../../../../core/models/kafka.models';

@Component({
  selector: 'app-consumers-tab',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="consumers-tab">
      <div class="tab-header">
        <div class="search-container">
          <div class="search-box">
            <i class="fas fa-search search-icon"></i>
            <input
              type="text"
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              placeholder="Search by Consumer Name"
              class="search-input"
            />
            @if (searchQuery()) {
              <button class="search-clear" (click)="clearSearch()" title="Clear search">
                <i class="fas fa-times"></i>
              </button>
            }
          </div>
        </div>
        <button class="btn-refresh" (click)="loadConsumerGroups()" [disabled]="isLoading()">
          <i class="fas fa-sync-alt" [class.spinning]="isLoading()"></i>
          Refresh
        </button>
      </div>

      @if (error()) {
        <div class="error-message">
          <i class="fas fa-exclamation-circle"></i>
          <p>{{ error() }}</p>
        </div>
      } @else if (!isLoading() && filteredConsumerGroups().length === 0) {
        <div class="empty-state">
          <i class="fas fa-users"></i>
          <p>No consumer groups found for this topic</p>
        </div>
      } @else {
        <div class="table-container">
          <table class="consumer-groups-table">
            <thead>
              <tr>
                <th>Consumer Group ID</th>
                <th>Active Consumers</th>
                <th>Consumer Lag</th>
                <th>Coordinator</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              @if (isLoading()) {
                @for (row of skeletonRows; track row) {
                  <tr class="skeleton-row">
                    <td class="col-group-id">
                      <span class="table-skeleton skeleton-expand"></span>
                      <span class="table-skeleton skeleton-group"></span>
                    </td>
                    <td class="col-consumers"><span class="table-skeleton skeleton-sm"></span></td>
                    <td class="col-lag"><span class="table-skeleton skeleton-md"></span></td>
                    <td class="col-coordinator"><span class="table-skeleton skeleton-md"></span></td>
                    <td class="col-state"><span class="table-skeleton skeleton-state"></span></td>
                  </tr>
                }
              } @else {
                @for (group of filteredConsumerGroups(); track group.groupId) {
                  <tr 
                    class="group-row"
                    (click)="toggleGroupExpanded(group.groupId)"
                    [title]="isGroupExpanded(group.groupId) ? 'Click to collapse details' : 'Click to expand details'"
                  >
                    <td class="col-group-id">
                      <button class="btn-expand" (click)="$event.stopPropagation()" [title]="isGroupExpanded(group.groupId) ? 'Collapse details' : 'Expand details'">
                        <i class="fas" [class.fa-chevron-down]="isGroupExpanded(group.groupId)" [class.fa-chevron-right]="!isGroupExpanded(group.groupId)"></i>
                      </button>
                      <a 
                        [routerLink]="['/cluster']"
                        [queryParams]="{ view: 'deepdive', resource: group.groupId }"
                        class="consumer-group-link"
                        (click)="$event.stopPropagation()"
                        [title]="'View resource details in Cluster Info'"
                      >
                        {{ group.groupId }}
                      </a>
                    </td>
                    <td class="col-consumers">
                      {{ group.activeConsumerCount > 0 ? group.activeConsumerCount : 'Not Active' }}
                    </td>
                    <td class="col-lag">
                      {{ formatNumber(group.totalLag) }}
                    </td>
                    <td class="col-coordinator">
                      {{ group.coordinator }}
                    </td>
                    <td class="col-state">
                      <span class="state-badge" 
                            [class.state-stable-green]="isStableState(group.state)" 
                            [class.state-empty]="isEmptyState(group.state)">
                        {{ group.state }}
                      </span>
                    </td>
                  </tr>
                  @if (isGroupExpanded(group.groupId)) {
                    <tr class="consumer-details-row">
                      <td colspan="5" class="consumer-details-cell">
                        <div class="consumers-list">
                          @if (group.consumers && group.consumers.length > 0) {
                            <div class="consumers-header">
                              <strong>Consumers in this group:</strong>
                            </div>
                            @for (consumer of group.consumers; track consumer.memberId) {
                              <div class="consumer-item">
                                <div class="consumer-info">
                                  @if (consumer.clientId) {
                                    <span class="consumer-id">
                                      <i class="fas fa-user"></i>
                                      <a
                                        [routerLink]="['/cluster']"
                                        [queryParams]="{ view: 'deepdive', resource: group.groupId, logsPod: consumer.clientId }"
                                        class="consumer-pod-link"
                                        (click)="$event.stopPropagation()"
                                        [title]="'View pod in Cluster Info'"
                                      >{{ consumer.clientId }}</a>
                                    </span>
                                    <span class="consumer-member-id">{{ consumer.memberId }}</span>
                                  } @else {
                                    <span class="consumer-id">
                                      <i class="fas fa-user"></i>
                                      <a
                                        [routerLink]="['/cluster']"
                                        [queryParams]="{ view: 'deepdive', resource: group.groupId, logsPod: consumer.memberId }"
                                        class="consumer-pod-link"
                                        (click)="$event.stopPropagation()"
                                        [title]="'View pod in Cluster Info'"
                                      >{{ consumer.memberId }}</a>
                                    </span>
                                  }
                                  @if (consumer.host) {
                                    <span class="consumer-host">
                                      <i class="fas fa-server"></i>
                                      {{ consumer.host }}
                                    </span>
                                  }
                                </div>
                                @if (consumer.assignedPartitions && consumer.assignedPartitions.length > 0) {
                                  <div class="partitions-list">
                                    <strong>Assigned Partitions:</strong>
                                    @for (partition of consumer.assignedPartitions; track partition.partition) {
                                      <div class="partition-item">
                                        <span class="partition-badge">P{{ partition.partition }}</span>
                                        <span class="partition-details">
                                          Offset: {{ formatNumber(partition.currentOffset) }} / {{ formatNumber(partition.logEndOffset) }}
                                        </span>
                                        @if (partition.lag > 0) {
                                          <span class="partition-lag" [class.lag-warning]="partition.lag > 1000" [class.lag-error]="partition.lag > 10000">
                                            Lag: {{ formatNumber(partition.lag) }}
                                          </span>
                                        } @else {
                                          <span class="partition-lag no-lag">No Lag</span>
                                        }
                                      </div>
                                    }
                                  </div>
                                }
                              </div>
                            }
                          } @else {
                            <div class="no-consumers-message">
                              <i class="fas fa-info-circle"></i>
                              <span>No active consumers for the consumer group</span>
                            </div>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                }
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .consumers-tab {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        padding: 0;
      }

      .tab-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .search-container {
        flex: 1;
        max-width: 400px;
      }

      .search-box {
        position: relative;
        display: flex;
        align-items: center;
      }

      .search-icon {
        position: absolute;
        left: 1rem;
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
        pointer-events: none;
      }

      .search-input {
        width: 100%;
        padding: 0.75rem 1rem 0.75rem 2.5rem;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 6px;
        font-size: var(--theme-font-body);
        transition: all 0.3s ease;
        background: var(--theme-bg-surface);
      }

      .search-input:focus {
        outline: none;
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
      }

      .search-clear {
        position: absolute;
        right: 0.75rem;
        background: none;
        border: none;
        color: var(--theme-text-gray);
        cursor: pointer;
        padding: 0.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s ease;
      }

      .search-clear:hover {
        background: var(--theme-bg-app);
        color: var(--theme-text-dark);
      }

      .btn-refresh {
        padding: 0.625rem 1.25rem;
        background: var(--theme-button-primary-hover);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.3s ease;
        white-space: nowrap;
      }

      .btn-refresh:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }

      .btn-refresh:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-refresh i.spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .error-message {
        text-align: center;
        padding: 3rem;
        color: #ef4444;
      }

      .error-message i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1rem;
        opacity: 0.5;
      }

      .empty-state {
        text-align: center;
        padding: 3rem;
        color: var(--theme-text-gray);
      }

      .empty-state i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1rem;
        opacity: 0.5;
      }

      .table-container {
        overflow-x: auto;
        background: var(--theme-bg-surface);
        border-radius: 6px;
        border: 1px solid var(--theme-border-gray-light);
      }

      .consumer-groups-table {
        width: 100%;
        border-collapse: collapse;
      }

      .consumer-groups-table thead {
        background: var(--theme-bg-app);
      }

      .consumer-groups-table th {
        padding: 1rem 1.25rem;
        text-align: left;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-table-header-color);
        border-bottom: 2px solid var(--theme-border-gray-light);
        font-size: var(--theme-font-body);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .consumer-groups-table td {
        padding: 1rem 1.25rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        font-size: var(--theme-font-body);
        color: var(--theme-text-dark);
      }

      .consumer-groups-table tbody tr.group-row {
        cursor: pointer;
        transition: background-color 0.2s ease;
      }

      .consumer-groups-table tbody tr.group-row:hover {
        background: var(--theme-bg-app);
      }

      .skeleton-row {
        pointer-events: none;
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

      .skeleton-expand {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        margin-right: 0.75rem;
        vertical-align: middle;
      }

      .skeleton-group {
        width: min(60%, 260px);
        height: 14px;
        vertical-align: middle;
      }

      .skeleton-sm {
        width: 54px;
        height: 12px;
      }

      .skeleton-md {
        width: 96px;
        height: 12px;
      }

      .skeleton-state {
        width: 78px;
        height: 24px;
      }

      @keyframes table-skeleton-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      .consumer-groups-table tbody tr:last-child td {
        border-bottom: none;
      }

      .col-group-id {
        font-weight: var(--theme-font-table-body-weight);
      }

      .col-consumers {
        text-align: center;
      }

      .col-lag {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .col-coordinator {
        text-align: center;
      }

      .col-state {
        text-align: center;
      }

      .state-badge {
        display: inline-block;
        padding: 0.375rem 0.875rem;
        border-radius: 999px;
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-header-weight);
        text-transform: uppercase;
        letter-spacing: 0.025em;
        background: var(--theme-bg-app);
        color: var(--theme-text-gray);
      }

      .state-badge.state-stable-green {
        background: #10b981;
        color: white;
      }

      .state-badge.state-empty {
        background: var(--theme-bg-app);
        color: var(--theme-text-gray);
      }

      .state-badge:not(.state-stable-green):not(.state-empty) {
        background: #fef3c7;
        color: #92400e;
      }

      .consumer-details-row {
        background: var(--theme-bg-app);
      }

      .consumer-details-cell {
        padding: 1.5rem 1.25rem !important;
        border-top: 2px solid var(--theme-border-gray-light);
      }

      .consumers-list {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .consumers-header {
        margin-bottom: 0.5rem;
        color: var(--theme-text-dark);
        font-size: var(--theme-font-body);
      }

      .consumer-item {
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 6px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .consumer-info {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: center;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
      }

      .consumer-id,
      .consumer-client-id,
      .consumer-host {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray-dark);
      }

      .consumer-id {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
      }

      .consumer-member-id {
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
        word-break: break-all;
      }

      .consumer-pod-link {
        color: var(--theme-button-primary);
        text-decoration: none;
        font-weight: var(--theme-font-table-header-weight);
      }
      .consumer-pod-link:hover {
        text-decoration: underline;
      }

      .consumer-id i,
      .consumer-client-id i,
      .consumer-host i {
        color: var(--theme-text-gray);
        font-size: var(--theme-font-caption);
      }

      .partitions-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .partitions-list strong {
        font-size: var(--theme-font-table-header);
        color: var(--theme-text-gray-dark);
        margin-bottom: 0.25rem;
      }

      .partition-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem;
        background: var(--theme-bg-app);
        border-radius: 4px;
        font-size: var(--theme-font-table-header);
      }

      .partition-badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        background: var(--theme-border-gray);
        color: var(--theme-text-gray-dark);
        border-radius: 4px;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-caption);
        min-width: 3rem;
        text-align: center;
      }

      .partition-details {
        color: var(--theme-text-gray);
        font-variant-numeric: tabular-nums;
      }

      .partition-lag {
        margin-left: auto;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-caption);
      }

      .partition-lag.no-lag {
        background: #d1fae5;
        color: #065f46;
      }

      .partition-lag.lag-warning {
        background: #fef3c7;
        color: #92400e;
      }

      .partition-lag.lag-error {
        background: #fee2e2;
        color: #991b1b;
      }

      .no-consumers-message {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1.5rem;
        color: var(--theme-text-gray);
        font-style: italic;
        justify-content: center;
      }

      .no-consumers-message i {
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
      }

      .btn-expand {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        margin-right: 0.5rem;
        color: var(--theme-text-gray);
        transition: color 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .btn-expand:hover {
        color: var(--theme-text-teal);
      }

      .btn-expand i {
        font-size: var(--theme-font-caption);
      }

      .consumer-group-link {
        color: var(--theme-button-primary);
        cursor: pointer;
        text-decoration: none;
        transition: all 0.2s ease;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        display: inline-block;
        font-weight: var(--theme-font-table-header-weight);
      }

      .consumer-group-link:hover {
        color: var(--theme-button-primary-hover, #851697);
        background-color: var(--theme-bg-teal-light);
        text-decoration: underline;
      }

      .consumer-group-link:active {
        transform: translateY(1px);
      }

      .consumer-group-link:visited {
        color: var(--theme-button-primary);
      }
    `,
  ],
})
export class ConsumersTabComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) topicName!: string;

  private kafkaService = inject(KafkaService);
  private stateService = inject(KafkaStateService);

  consumerGroups = signal<ConsumerGroupDetail[]>([]);
  searchQuery = signal<string>('');
  isLoading = signal(false);
  error = signal<string | null>(null);
  readonly skeletonRows = [1, 2, 3, 4, 5];
  private lastLoadedTopic: string | null = null;
  
  // Track which groups are expanded (default to all expanded)
  expandedGroups = signal<Set<string>>(new Set());
  
  // Static cache to persist data across component destruction/recreation
  private static dataCache = new Map<string, ConsumerGroupDetail[]>();

  filteredConsumerGroups = computed(() => {
    const groups = this.consumerGroups();
    const query = this.searchQuery().toLowerCase().trim();
    
    if (!query) {
      return groups;
    }
    
    return groups.filter(group => 
      group.groupId.toLowerCase().includes(query)
    );
  });

  ngOnInit(): void {
    this.stateService.registerRefreshCallback('consumers-tab', async () => {
      await this.loadConsumerGroups(false);
    });
    this.loadDataForTopic(this.topicName, true);
  }

  ngOnDestroy(): void {
    this.stateService.unregisterRefreshCallback('consumers-tab');
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Only reload if topic actually changed
    if (changes['topicName'] && !changes['topicName'].firstChange) {
      const previousTopic = changes['topicName'].previousValue;
      const currentTopic = changes['topicName'].currentValue;
      
      if (previousTopic !== currentTopic) {
        // Topic changed - reload with loading state
        this.loadDataForTopic(currentTopic, true);
      }
      // If topic is the same, do nothing - data is already displayed
    }
  }

  /**
   * Load data for a specific topic
   * @param topicName - The topic to load data for
   * @param showLoading - Whether to show loading state (true for initial load or topic change)
   */
  private loadDataForTopic(topicName: string, showLoading: boolean): void {
    // Check static cache first - this persists across component destruction
    const cachedData = ConsumersTabComponent.dataCache.get(topicName);
    if (cachedData && cachedData.length > 0) {
      // Use cached data instantly - no loading, no API call
      this.consumerGroups.set(cachedData);
      this.lastLoadedTopic = topicName;
      
      // Expand all groups by default
      const allGroupIds = new Set(cachedData.map(g => g.groupId));
      this.expandedGroups.set(allGroupIds);
      return;
    }

    // No cached data - need to load from API
    if (showLoading) {
      this.isLoading.set(true);
      this.error.set(null);
    }

    // Call API directly for this topic - this will use the cache service and return both active and inactive groups
    this.kafkaService.getConsumerGroupDetails(topicName).subscribe({
      next: (response) => {
        if (response && response.groups) {
          // Store in static cache
          ConsumersTabComponent.dataCache.set(topicName, response.groups);
          this.consumerGroups.set(response.groups);
          this.lastLoadedTopic = topicName;
          
          // Expand all groups by default
          const allGroupIds = new Set(response.groups.map(g => g.groupId));
          this.expandedGroups.set(allGroupIds);
        } else {
          this.consumerGroups.set([]);
        }
        if (showLoading) {
          this.isLoading.set(false);
        }
      },
      error: (err) => {
        console.error('Error loading consumer groups:', err);
        if (showLoading) {
          this.error.set(err?.error?.error || err?.message || 'Failed to load consumer groups');
          this.isLoading.set(false);
        }
      }
    });
  }

  async loadConsumerGroups(showLoading: boolean = true): Promise<void> {
    if (showLoading) {
      this.isLoading.set(true);
    }
    this.error.set(null);

    try {
      // Clear cache to force fresh data
      ConsumersTabComponent.dataCache.delete(this.topicName);

      const response = await this.kafkaService.getConsumerGroupDetails(this.topicName).toPromise();
      if (response && response.groups) {
        ConsumersTabComponent.dataCache.set(this.topicName, response.groups);
        this.consumerGroups.set(response.groups);
        this.lastLoadedTopic = this.topicName;

        const allGroupIds = new Set(response.groups.map(g => g.groupId));
        this.expandedGroups.set(allGroupIds);
      } else {
        this.consumerGroups.set([]);
      }
    } catch (err: any) {
      this.error.set(err?.error?.error || err?.message || 'Failed to load consumer groups');
      console.error('Error loading consumer groups:', err);
    } finally {
      if (showLoading) {
        this.isLoading.set(false);
      }
    }
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  formatNumber(value: number): string {
    return value.toLocaleString();
  }

  toggleGroupExpanded(groupId: string): void {
    const expanded = this.expandedGroups();
    const newExpanded = new Set(expanded);
    
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    
    this.expandedGroups.set(newExpanded);
  }

  isGroupExpanded(groupId: string): boolean {
    return this.expandedGroups().has(groupId);
  }

  isStableState(state: string): boolean {
    if (!state) return false;
    return state.toUpperCase() === 'STABLE';
  }

  isEmptyState(state: string): boolean {
    if (!state) return false;
    return state.toUpperCase() === 'EMPTY';
  }
}

