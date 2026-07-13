import { Component, OnInit, inject, signal, computed } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { KafkaStateService } from '../../services/kafka-state.service';
import { KafkaService } from '../../../../core/services/api/kafka.service';
import { ConsumerGroupResponse, ConsumerGroupInfo, ConsumerGroupDetail, ConsumerGroupDetailsResponse } from '../../../../core/models/kafka.models';
import { LoadingSkeletonComponent } from '../../../../shared/components/loading-skeleton/loading-skeleton.component';

@Component({
  selector: 'app-consumer-groups',
  standalone: true,
  imports: [FormsModule, LoadingSkeletonComponent],
  template: `
    <div class="consumer-groups-container">
      <div class="consumer-groups-header">
        <h2>Consumer Groups</h2>
        <div class="header-actions">
          <div class="filter-group">
            <label for="topicFilter">Filter by Topic:</label>
            <select
              id="topicFilter"
              [ngModel]="selectedTopicFilter()"
              (ngModelChange)="onTopicFilterChange($event)"
              [disabled]="isLoading()"
            >
              <option value="">All Topics</option>
              @for (topic of topics(); track topic.name) {
                <option [value]="topic.name">{{ topic.name }}</option>
              }
            </select>
          </div>
          <button class="btn-refresh" (click)="loadConsumerGroups()" [disabled]="isLoading()">
            <i class="fas fa-sync-alt" [class.spinning]="isLoading()"></i>
            Refresh
          </button>
        </div>
      </div>

      @if (isLoading()) {
        <app-loading-skeleton [count]="5" />
      } @else if (filteredConsumerGroups().length === 0) {
        <div class="empty-state">
          <i class="fas fa-users"></i>
          <p>No consumer groups found{{ selectedTopicFilter() ? ' for topic: ' + selectedTopicFilter() : '' }}</p>
        </div>
      } @else {
        <div class="consumer-groups-table">
          <table>
            <thead>
              <tr>
                <th>Consumer Group</th>
                <th>State</th>
                <th>Active Consumers</th>
                <th>Topics</th>
                <th>Total Lag</th>
                <th>Coordinator</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (group of filteredConsumerGroups(); track group.groupId) {
                <tr [class.has-lag]="group.totalLag > 0">
                  <td>
                    <strong>{{ group.groupId }}</strong>
                  </td>
                  <td>
                    <span class="state-badge" [class.stable]="group.state === 'Stable'" [class.empty]="group.state === 'Empty'">
                      {{ group.state }}
                    </span>
                  </td>
                  <td>{{ group.activeConsumerCount }}</td>
                  <td>
                    <div class="topics-list">
                      @for (topic of group.topics; track topic) {
                        <span class="topic-tag">{{ topic }}</span>
                      }
                      @if (group.topics.length === 0) {
                        <span class="no-topics">No topics assigned</span>
                      }
                    </div>
                  </td>
                  <td>
                    @if (group.totalLag > 0) {
                      <span class="lag-badge" [class.warning]="group.totalLag > 1000" [class.error]="group.totalLag > 10000">
                        {{ group.totalLag }}
                      </span>
                    } @else {
                      <span class="lag-badge" title="Click to load lag details">-</span>
                    }
                  </td>
                  <td>{{ group.coordinator }}</td>
                  <td>
                    <button class="btn-details" (click)="loadGroupDetails(group.groupId)" [disabled]="loadingGroupDetails() === group.groupId">
                      @if (loadingGroupDetails() === group.groupId) {
                        <i class="fas fa-spinner fa-spin"></i>
                      } @else {
                        <i class="fas fa-info-circle"></i> Details
                      }
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="summary">
          <div class="summary-item">
            <strong>Total Consumer Groups:</strong>
            <span>{{ filteredConsumerGroups().length }}</span>
          </div>
          <div class="summary-item">
            <strong>Total Lag:</strong>
            <span class="lag-total">{{ getTotalLag() }}</span>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .consumer-groups-container {
        background: var(--theme-bg-surface);
        border-radius: 12px;
        padding: 2rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }

      .consumer-groups-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
        gap: 1rem;
      }

      .consumer-groups-header h2 {
        margin: 0;
        font-size: var(--theme-font-page-title);
        color: var(--theme-text-dark);
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .filter-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .filter-group label {
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
      }

      .filter-group select {
        padding: 0.5rem 1rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: var(--theme-font-body);
      }

      .filter-group select:disabled {
        background: var(--theme-bg-app);
        cursor: not-allowed;
      }

      .btn-refresh {
        padding: 0.5rem 1rem;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s ease;
      }

      .btn-refresh:hover:not(:disabled) {
        background: #059669;
        transform: translateY(-1px);
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

      .consumer-groups-table {
        overflow-x: auto;
        margin-bottom: 2rem;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      thead {
        background: var(--theme-bg-app);
      }

      th {
        padding: 1rem;
        text-align: left;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray-dark);
        border-bottom: 2px solid var(--theme-border-gray);
      }

      td {
        padding: 1rem;
        border-bottom: 1px solid var(--theme-border-gray);
      }

      tbody tr:hover {
        background: var(--theme-bg-app);
      }

      tbody tr.has-lag {
        background: #fef3c7;
      }

      .lag-badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        background: #10b981;
        color: white;
        border-radius: 12px;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
      }

      .lag-badge.warning {
        background: #f59e0b;
      }

      .lag-badge.error {
        background: #dc2626;
      }

      .summary {
        display: flex;
        gap: 2rem;
        padding: 1rem;
        background: var(--theme-bg-app);
        border-radius: 8px;
      }

      .summary-item {
        display: flex;
        gap: 0.5rem;
      }

      .summary-item strong {
        color: var(--theme-text-gray-dark);
      }

      .lag-total {
        font-weight: var(--theme-font-table-header-weight);
        color: #dc2626;
      }

      .state-badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        border-radius: 12px;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        background: var(--theme-text-gray);
        color: white;
      }

      .state-badge.stable {
        background: #10b981;
      }

      .state-badge.empty {
        background: var(--theme-border-gray);
      }

      .topics-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .topic-tag {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        background: var(--theme-border-gray);
        color: var(--theme-text-gray-dark);
        border-radius: 6px;
        font-size: var(--theme-font-body);
      }

      .no-topics {
        color: var(--theme-text-gray);
        font-style: italic;
        font-size: var(--theme-font-body);
      }

      .btn-details {
        padding: 0.5rem 1rem;
        background: var(--theme-button-primary);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s ease;
      }

      .btn-details:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
      }

      .btn-details:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ],
})
export class ConsumerGroupsComponent implements OnInit {
  private stateService = inject(KafkaStateService);
  private kafkaService = inject(KafkaService);

  topics = this.stateService.topics;
  loadingStates = this.stateService.loadingStates;
  
  // Store all consumer groups with assignments (fetched once)
  allConsumerGroups = signal<ConsumerGroupDetail[]>([]);
  
  // Currently selected topic filter (frontend filtering)
  selectedTopicFilter = signal<string>('');
  
  // Currently loading group details (for refresh)
  loadingGroupDetails = signal<string | null>(null);

  isLoading = computed(() => this.loadingStates()['consumer-groups'] === true);

  // Display the consumer groups (no additional filtering needed since we load based on topic filter)
  filteredConsumerGroups = computed(() => {
    return this.allConsumerGroups();
  });

  ngOnInit(): void {
    if (this.topics().length === 0) {
      this.stateService.loadTopics();
    }
    
    // Load all consumer groups into state service first (for caching)
    const allGroupsInState = this.stateService.allConsumerGroupDetails();
    if (allGroupsInState.length === 0) {
      // Load all consumer groups in background for caching
      this.stateService.loadAllConsumerGroupDetails().then(() => {
        // After loading all groups, load filtered view
        this.loadConsumerGroups();
      });
    } else {
      // Already have all groups cached, just load filtered view
      this.loadConsumerGroups();
    }
  }

  /**
   * Load consumer groups based on selected topic filter
   * - If topic is selected: load only groups assigned to that topic
   * - If no topic selected: load all groups
   */
  async loadConsumerGroups(): Promise<void> {
    try {
      this.stateService.setLoadingState('consumer-groups', true);
      const topicFilter = this.selectedTopicFilter();
      
      let response: ConsumerGroupDetailsResponse | undefined;
      
      if (topicFilter && topicFilter !== '') {
        // Load only groups assigned to the selected topic
        response = await this.kafkaService.getConsumerGroupDetails(topicFilter).toPromise();
      } else {
        // Load all groups
        response = await this.kafkaService.getAllConsumerGroupDetails().toPromise();
      }
      
      if (response) {
        this.allConsumerGroups.set(response.groups);
        // Also update state service for caching
        this.stateService.setAllConsumerGroupDetails(response.groups);
      }
    } catch (error) {
      console.error('Error loading consumer groups:', error);
    } finally {
      this.stateService.setLoadingState('consumer-groups', false);
    }
  }


  /**
   * Handle topic filter change - reload groups for the selected topic
   */
  onTopicFilterChange(topic: string): void {
    this.selectedTopicFilter.set(topic);
    this.loadConsumerGroups();
  }

  /**
   * Load detailed information for a specific consumer group (including lag)
   * This syncs the fetched data back to the original list
   */
  async loadGroupDetails(groupId: string): Promise<void> {
    try {
      this.loadingGroupDetails.set(groupId);
      const response = await this.kafkaService.getConsumerGroupDetailsById(groupId).toPromise();
      
      if (response && response.groups.length > 0) {
        const updatedGroup = response.groups[0];
        
        // Sync the updated group data back to the original list
        const currentGroups = this.allConsumerGroups();
        const groupIndex = currentGroups.findIndex(g => g.groupId === groupId);
        
        if (groupIndex >= 0) {
          // Update existing group with fresh lag data and other details
          const updatedGroups = [...currentGroups];
          updatedGroups[groupIndex] = {
            ...updatedGroups[groupIndex],
            ...updatedGroup, // Merge all properties (including updated lag, state, etc.)
          };
          this.allConsumerGroups.set(updatedGroups);
        } else {
          // Group not in current list, add it (shouldn't happen, but handle gracefully)
          this.allConsumerGroups.set([...currentGroups, updatedGroup]);
        }
      }
    } catch (error) {
      console.error(`Error loading details for consumer group ${groupId}:`, error);
    } finally {
      this.loadingGroupDetails.set(null);
    }
  }

  getTotalLag(): number {
    return this.filteredConsumerGroups().reduce((sum, group) => sum + (group.totalLag || 0), 0);
  }
}

