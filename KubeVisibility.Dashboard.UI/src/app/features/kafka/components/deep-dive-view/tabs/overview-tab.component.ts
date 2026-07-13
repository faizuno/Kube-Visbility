import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, inject, signal, computed } from '@angular/core';

import { KafkaService } from '../../../../../core/services/api/kafka.service';
import { TopicPartitionsResponse } from '../../../../../core/models/kafka.models';
import { KafkaStateService } from '../../../services/kafka-state.service';

@Component({
  selector: 'app-overview-tab',
  standalone: true,
  imports: [],
  template: `
    <div class="overview-tab">
      @if (error()) {
        <div class="error-message">
          <i class="fas fa-exclamation-circle"></i>
          <p>{{ error() }}</p>
        </div>
      } @else {
        <!-- Summary Metrics Grid -->
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-label">Partitions</div>
            <div class="metric-value">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ partitionsData()?.overview?.partitions ?? '-' }}
              }
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Replication Factor</div>
            <div class="metric-value">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ partitionsData()?.overview?.replicationFactor ?? '-' }}
              }
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">URP</div>
            <div class="metric-value" [class.warning]="!isLoading() && (partitionsData()?.overview?.underReplicatedPartitions ?? 0) > 0">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ partitionsData()?.overview?.underReplicatedPartitions ?? '-' }}
              }
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">In Sync Replicas</div>
            <div class="metric-value">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ partitionsData()?.overview?.totalInSyncReplicas ?? '-' }}
              }
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Type</div>
            <div class="metric-value">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ partitionsData()?.overview?.type ?? '-' }}
              }
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Segment Size</div>
            <div class="metric-value">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ formatBytes(partitionsData()?.overview?.segmentSize ?? 0) }}
              }
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Segment Count</div>
            <div class="metric-value">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ partitionsData()?.overview?.segmentCount ?? '-' }}
              }
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Clean Up Policy</div>
            <div class="metric-value">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ partitionsData()?.overview?.cleanupPolicy ?? '-' }}
              }
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Message Count</div>
            <div class="metric-value">
              @if (isLoading()) {
                <span class="table-skeleton metric-skeleton"></span>
              } @else {
                {{ formatNumber(partitionsData()?.overview?.messageCount ?? 0) }}
              }
            </div>
          </div>
        </div>

        <!-- Partitions Table -->
        <div class="partitions-section">
          <h3><i class="fas fa-list"></i> Partitions</h3>
          <div class="table-container">
            <table class="partitions-table">
              <thead>
                <tr>
                  <th>Partition ID</th>
                  <th>Replicas</th>
                  <th>Leader</th>
                  <th>ISR</th>
                  <th>First Offset</th>
                  <th>Next Offset</th>
                  <th>Message Count</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @if (isLoading()) {
                  @for (row of skeletonRows; track row) {
                    <tr class="skeleton-row">
                      <td><span class="table-skeleton skeleton-text-sm"></span></td>
                      <td><span class="table-skeleton skeleton-badge"></span></td>
                      <td><span class="table-skeleton skeleton-badge"></span></td>
                      <td><span class="table-skeleton skeleton-badge"></span></td>
                      <td><span class="table-skeleton skeleton-text-md"></span></td>
                      <td><span class="table-skeleton skeleton-text-md"></span></td>
                      <td><span class="table-skeleton skeleton-text-md"></span></td>
                      <td><span class="table-skeleton skeleton-action"></span></td>
                    </tr>
                  }
                } @else if ((partitionsData()?.partitions?.length ?? 0) > 0) {
                  @for (partition of partitionsData()!.partitions; track partition.partitionId) {
                    <tr>
                      <td>{{ partition.partitionId }}</td>
                      <td>
                        <div class="replicas-list">
                          @for (replica of partition.replicas; track replica) {
                            <span class="replica-badge">{{ replica }}</span>
                          }
                        </div>
                      </td>
                      <td>
                        <span class="leader-badge">{{ partition.leader }}</span>
                      </td>
                      <td>
                        <div class="replicas-list">
                          @for (isr of partition.isr; track isr) {
                            <span class="isr-badge">{{ isr }}</span>
                          }
                        </div>
                      </td>
                      <td>{{ formatNumber(partition.firstOffset) }}</td>
                      <td>{{ formatNumber(partition.nextOffset) }}</td>
                      <td>{{ formatNumber(partition.messageCount) }}</td>
                      <td>
                        <button class="btn-action" title="Actions">
                          <i class="fas fa-ellipsis-v"></i>
                        </button>
                      </td>
                    </tr>
                  }
                } @else {
                  <tr>
                    <td colspan="8" class="no-partitions">No partition details available</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .overview-tab {
        display: flex;
        flex-direction: column;
        gap: 2rem;
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

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
      }

      .metric-card {
        background: var(--theme-bg-surface);
        padding: 1.5rem;
        border-radius: 6px;
        border: 1px solid var(--theme-border-gray-light);
      }

      .metric-label {
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
        margin-bottom: 0.5rem;
        font-weight: var(--theme-font-table-header-weight);
        text-transform: uppercase;
      }

      .metric-value {
        font-size: var(--theme-font-page-title);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-dark);
      }

      .metric-value.warning {
        color: #f59e0b;
      }

      .partitions-section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .partitions-section h3 {
        margin: 0;
        font-size: var(--theme-font-section-title);
        color: var(--theme-text-dark);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .table-container {
        overflow-x: auto;
      }

      .partitions-table {
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
        color: var(--theme-table-header-color);
        border-bottom: 2px solid var(--theme-border-gray-light);
        font-size: var(--theme-font-body);
      }

      td {
        padding: 1rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        font-size: var(--theme-font-body);
      }

      tbody tr:hover {
        background: var(--theme-bg-app);
      }

      .skeleton-row {
        pointer-events: none;
      }

      .metric-skeleton {
        width: 110px;
        height: 22px;
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

      .skeleton-text-sm {
        width: 48px;
        height: 12px;
      }

      .skeleton-text-md {
        width: 90px;
        height: 12px;
      }

      .skeleton-badge {
        width: 64px;
        height: 20px;
        border-radius: 6px;
      }

      .skeleton-action {
        width: 24px;
        height: 24px;
        border-radius: 4px;
      }

      .no-partitions {
        text-align: center;
        color: var(--theme-text-gray);
        padding: 1.5rem;
      }

      @keyframes table-skeleton-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      .replicas-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }

      .replica-badge {
        background: #10b981;
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
      }

      .leader-badge {
        background: var(--theme-button-primary);
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
      }

      .isr-badge {
        background: #8b5cf6;
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
      }

      .btn-action {
        padding: 0.5rem;
        background: transparent;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 4px;
        cursor: pointer;
        color: var(--theme-text-gray);
        transition: all 0.3s ease;
      }

      .btn-action:hover {
        background: var(--theme-bg-app);
        color: var(--theme-text-dark);
      }
    `,
  ],
})
export class OverviewTabComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) topicName!: string;

  private kafkaService = inject(KafkaService);
  private stateService = inject(KafkaStateService);

  partitionsData = signal<TopicPartitionsResponse | null>(null);
  isLoading = signal(false);
  error = signal<string | null>(null);
  readonly skeletonRows = [1, 2, 3, 4, 5];
  
  // Static cache to persist data across component destruction/recreation
  private static dataCache = new Map<string, TopicPartitionsResponse>();

  ngOnInit(): void {
    this.stateService.registerRefreshCallback('overview-tab', async () => {
      await this.loadPartitions(false);
    });
    this.loadPartitionsIfNeeded();
  }

  ngOnDestroy(): void {
    this.stateService.unregisterRefreshCallback('overview-tab');
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Only reload if topic actually changed
    if (changes['topicName'] && !changes['topicName'].firstChange) {
      const previousTopic = changes['topicName'].previousValue;
      const currentTopic = changes['topicName'].currentValue;
      
      if (previousTopic !== currentTopic) {
        // Topic changed - reload with loading state
        this.loadPartitionsIfNeeded(true);
      }
      // If topic is the same, do nothing - data is already displayed
    }
  }

  private loadPartitionsIfNeeded(showLoading: boolean = true): void {
    // Check static cache first - this persists across component destruction
    const cachedData = OverviewTabComponent.dataCache.get(this.topicName);
    if (cachedData) {
      // Use cached data instantly - no loading, no API call
      this.partitionsData.set(cachedData);
      return;
    }

    // No cached data - load it with loading state (showLoading defaults to true for initial load)
    this.loadPartitions(showLoading);
  }

  async loadPartitions(showLoading: boolean = true): Promise<void> {
    if (showLoading) {
      this.isLoading.set(true);
    }
    this.error.set(null);
    try {
      const data = await this.kafkaService.getTopicPartitions(this.topicName).toPromise();
      if (data) {
        // Store in static cache for future use
        OverviewTabComponent.dataCache.set(this.topicName, data);
        this.partitionsData.set(data);
      }
    } catch (err: any) {
      this.error.set(err?.error?.error || err?.message || 'Failed to load partition details');
      console.error('Error loading partitions:', err);
    } finally {
      if (showLoading) {
        this.isLoading.set(false);
      }
    }
  }

  formatNumber(value: number | string): string {
    const num = typeof value === 'string' ? parseInt(value, 10) : value;
    if (isNaN(num)) return '0';
    return num.toLocaleString();
  }

  formatBytes(value: string | number): string {
    const bytes = typeof value === 'string' ? parseInt(value, 10) : value;
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

