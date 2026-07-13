import { Component, Input, OnInit, OnDestroy, inject, computed, signal } from '@angular/core';

import { KafkaStatisticsService } from '../../../services/kafka-statistics.service';
import { KafkaStateService } from '../../../services/kafka-state.service';
import { SimpleLineChartComponent } from '../../../../../shared/components/simple-line-chart/simple-line-chart.component';
import { DiagnosticsPanelComponent } from '../../diagnostics-panel/diagnostics-panel.component';
import { AnomalyAlertsComponent } from '../../anomaly-alerts/anomaly-alerts.component';

/**
 * Statistics tab component following Single Responsibility Principle
 * Responsible only for displaying statistics, delegates computation to services
 */
@Component({
  selector: 'app-statistics-tab',
  standalone: true,
  imports: [SimpleLineChartComponent, DiagnosticsPanelComponent, AnomalyAlertsComponent],
  template: `
    <div class="statistics-tab">
      <!-- Header with controls -->
      <div class="stats-header">
        <div class="header-left">
          <h3><i class="fas fa-chart-line"></i> Statistics & Metrics</h3>
          <p class="subtitle">Real-time and historical topic metrics</p>
        </div>
        <div class="header-controls">
          @if (statsService.isCollecting()) {
            <button class="btn btn-stop" (click)="stopCollection()">
              <i class="fas fa-stop"></i>
              Stop Collecting
            </button>
          } @else {
            <button class="btn btn-start" (click)="startCollection()">
              <i class="fas fa-play"></i>
              Start Collecting
            </button>
          }
          <button class="btn btn-refresh" (click)="collectNow()" [disabled]="isLoading()">
            <i class="fas fa-sync-alt" [class.spinning]="isLoading()"></i>
            Refresh Now
          </button>
          <button class="btn btn-clear" (click)="clearData()" title="Clear stored data">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>

      @if (statsService.lastError()) {
        <div class="error-banner">
          <i class="fas fa-exclamation-triangle"></i>
          {{ statsService.lastError() }}
        </div>
      }

      <!-- Quick Diagnostics Panel -->
      @if (hasData() && statsService.quickDiagnostics()) {
        <app-diagnostics-panel [data]="statsService.quickDiagnostics()" />
      }

      <!-- Anomaly Alerts -->
      @if (hasData() && statsService.anomalies().length > 0) {
        <app-anomaly-alerts [data]="statsService.anomalies()" />
      }

      <!-- Summary Cards -->
      @if (summary(); as sum) {
        <div class="summary-grid">
          <div class="summary-card">
            <div class="card-icon" style="background: var(--theme-button-primary);">
              <i class="fas fa-database"></i>
            </div>
            <div class="card-content">
              <div class="card-label">Total Messages</div>
              <div class="card-value">{{ formatNumber(currentMessageCount()) }}</div>
              @if (sum.messageCountStats.percentChange !== undefined) {
                <div class="card-change" [class.positive]="sum.messageCountStats.percentChange > 0"
                     [class.negative]="sum.messageCountStats.percentChange < 0">
                  <i class="fas" [class.fa-arrow-up]="sum.messageCountStats.percentChange > 0"
                     [class.fa-arrow-down]="sum.messageCountStats.percentChange < 0"></i>
                  {{ Math.abs(sum.messageCountStats.percentChange).toFixed(1) }}%
                </div>
              }
            </div>
          </div>

          <div class="summary-card">
            <div class="card-icon" style="background: #f59e0b;">
              <i class="fas fa-clock"></i>
            </div>
            <div class="card-content">
              <div class="card-label">Total Consumer Lag</div>
              <div class="card-value">{{ formatNumber(currentTotalLag()) }}</div>
              <div class="card-trend">{{ sum.lagStats.trend }}</div>
            </div>
          </div>

          <div class="summary-card">
            <div class="card-icon" style="background: #10b981;">
              <i class="fas fa-tachometer-alt"></i>
            </div>
            <div class="card-content">
              <div class="card-label">Throughput</div>
              <div class="card-value">{{ sum.throughput.toFixed(2) }}</div>
              <div class="card-unit">msg/sec</div>
            </div>
          </div>

          <div class="summary-card">
            <div class="card-icon" style="background: #8b5cf6;">
              <i class="fas fa-chart-bar"></i>
            </div>
            <div class="card-content">
              <div class="card-label">Data Points</div>
              <div class="card-value">{{ sum.snapshotCount }}</div>
              @if (sum.timeRange) {
                <div class="card-unit">{{ getTimeRangeText(sum.timeRange) }}</div>
              }
            </div>
          </div>
        </div>
      }

      <!-- Charts Section -->
      @if (hasData()) {
        <div class="charts-section">
          <!-- Message Count Chart -->
          <app-simple-line-chart
            [data]="messageCountChartData()"
            [chartTitle]="'Message Count Over Time'"
            [displayStats]="true"
          />

          <!-- Consumer Lag Chart -->
          <app-simple-line-chart
            [data]="lagChartData()"
            [chartTitle]="'Total Consumer Lag Over Time'"
            [displayStats]="true"
          />

          <!-- Under-Replicated Partitions Chart -->
          @if (urpChartData().values.length > 0) {
            <app-simple-line-chart
              [data]="urpChartData()"
              [chartTitle]="'Under-Replicated Partitions'"
              [displayStats]="true"
            />
          }
        </div>

        <!-- Consumer Groups Health -->
        @if (consumerGroupHealth().length > 0) {
          <div class="consumer-groups-section">
            <h4><i class="fas fa-users"></i> Consumer Groups Health</h4>
            <div class="consumer-groups-grid">
              @for (group of consumerGroupHealth(); track group.groupId) {
                <div class="consumer-group-card" [class]="'status-' + group.status">
                  <div class="group-header">
                    <span class="group-name">{{ group.groupId }}</span>
                    <span class="health-badge" [class]="'badge-' + group.status">
                      {{ group.status }}
                    </span>
                  </div>
                  <div class="health-score">
                    <div class="score-label">Health Score</div>
                    <div class="score-value">{{ group.score }}/100</div>
                    <div class="score-bar">
                      <div class="score-fill" [style.width.%]="group.score"></div>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Partition Distribution -->
        @if (partitionDistribution().length > 0) {
          <div class="partition-section">
            <h4><i class="fas fa-chart-pie"></i> Partition Distribution</h4>
            @if (hotPartitions().length > 0) {
              <div class="hot-partitions-alert">
                <i class="fas fa-fire"></i>
                Hot partitions detected: {{ hotPartitions().join(', ') }}
              </div>
            }
            <div class="partition-bars">
              @for (partition of partitionDistribution(); track partition.partitionId) {
                <div class="partition-bar-item">
                  <span class="partition-label">P{{ partition.partitionId }}</span>
                  <div class="bar-container">
                    <div 
                      class="bar-fill" 
                      [class.hot]="hotPartitions().includes(partition.partitionId)"
                      [style.width.%]="getPartitionPercentage(partition.messageCount)"
                    ></div>
                  </div>
                  <span class="partition-value">{{ formatNumber(partition.messageCount) }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Storage Info -->
        @if (storageInfo()) {
          <div class="storage-info">
            <i class="fas fa-hdd"></i>
            Storage: {{ storageInfo()!.itemCount }} snapshots, ~{{ storageInfo()!.estimatedSizeKB }}KB
          </div>
        }
      } @else {
        <div class="no-data-state">
          <i class="fas fa-chart-line"></i>
          <h3>No Statistics Available</h3>
          <p>Click "Start Collecting" to begin gathering metrics for this topic.</p>
          <p class="hint">Metrics will be collected every 30 seconds and stored locally in your browser.</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .statistics-tab {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .stats-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 1rem;
        border-bottom: 2px solid var(--theme-border-gray);
      }

      .header-left h3 {
        margin: 0;
        font-size: var(--theme-font-page-title);
        color: var(--theme-text-dark);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .subtitle {
        margin: 0.25rem 0 0 0;
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
      }

      .header-controls {
        display: flex;
        gap: 0.5rem;
      }

      .btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s;
      }

      .btn-start {
        background: #10b981;
        color: white;
      }

      .btn-start:hover {
        background: #059669;
      }

      .btn-stop {
        background: #ef4444;
        color: white;
      }

      .btn-stop:hover {
        background: #dc2626;
      }

      .btn-refresh {
        background: var(--theme-button-primary);
        color: white;
      }

      .btn-refresh:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
      }

      .btn-refresh:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-clear {
        background: var(--theme-text-gray);
        color: white;
      }

      .btn-clear:hover {
        background: var(--theme-text-gray-dark);
      }

      .spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .error-banner {
        background: #fee2e2;
        border: 1px solid #fecaca;
        color: #991b1b;
        padding: 1rem;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
      }

      .summary-card {
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray);
        border-radius: 8px;
        padding: 1rem;
        display: flex;
        gap: 1rem;
      }

      .card-icon {
        width: 48px;
        height: 48px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: var(--theme-font-page-title);
        flex-shrink: 0;
      }

      .card-content {
        flex: 1;
      }

      .card-label {
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
        text-transform: uppercase;
        font-weight: var(--theme-font-table-header-weight);
        margin-bottom: 0.25rem;
      }

      .card-value {
        font-size: var(--theme-font-page-title);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
      }

      .card-change {
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        margin-top: 0.25rem;
      }

      .card-change.positive {
        color: #10b981;
      }

      .card-change.negative {
        color: #ef4444;
      }

      .card-trend, .card-unit {
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
        margin-top: 0.25rem;
      }

      .charts-section {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
        gap: 1rem;
      }

      .consumer-groups-section, .partition-section {
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray);
        border-radius: 8px;
        padding: 1.5rem;
      }

      .consumer-groups-section h4, .partition-section h4 {
        margin: 0 0 1rem 0;
        font-size: var(--theme-font-body);
        color: var(--theme-text-dark);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .consumer-groups-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1rem;
      }

      .consumer-group-card {
        border: 2px solid #e5e7eb;
        border-radius: 6px;
        padding: 1rem;
      }

      .consumer-group-card.status-healthy {
        border-color: #10b981;
      }

      .consumer-group-card.status-warning {
        border-color: #f59e0b;
      }

      .consumer-group-card.status-critical {
        border-color: #ef4444;
      }

      .group-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0.75rem;
        gap: 0.75rem;
      }

      .group-name {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
        font-size: var(--theme-font-body);
        word-break: break-word;
        flex: 1;
        min-width: 0;
      }

      .health-badge {
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        text-transform: uppercase;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .health-badge.badge-healthy {
        background: #d1fae5;
        color: #065f46;
      }

      .health-badge.badge-warning {
        background: #fef3c7;
        color: #92400e;
      }

      .health-badge.badge-critical {
        background: #fee2e2;
        color: #991b1b;
      }

      .health-score {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .score-label {
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
      }

      .score-value {
        font-size: var(--theme-font-page-title);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
      }

      .score-bar {
        height: 6px;
        background: var(--theme-border-gray);
        border-radius: 3px;
        overflow: hidden;
      }

      .score-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--theme-button-primary) 0%, var(--theme-button-primary-hover) 100%);
        transition: width 0.3s;
      }

      .hot-partitions-alert {
        background: #fef3c7;
        border: 1px solid #fcd34d;
        color: #92400e;
        padding: 0.75rem;
        border-radius: 6px;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--theme-font-body);
      }

      .partition-bars {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .partition-bar-item {
        display: grid;
        grid-template-columns: 3rem 1fr 6rem;
        align-items: center;
        gap: 0.5rem;
      }

      .partition-label {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
      }

      .bar-container {
        height: 24px;
        background: var(--theme-border-gray);
        border-radius: 4px;
        overflow: hidden;
      }

      .bar-fill {
        height: 100%;
        background: var(--theme-button-primary);
        transition: width 0.3s;
      }

      .bar-fill.hot {
        background: #ef4444;
      }

      .partition-value {
        text-align: right;
        font-size: var(--theme-font-body);
        color: var(--theme-text-dark);
        font-weight: var(--theme-font-table-body-weight);
      }

      .storage-info {
        text-align: center;
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
        padding: 0.5rem;
        background: var(--theme-bg-app);
        border-radius: 4px;
      }

      .no-data-state {
        text-align: center;
        padding: 4rem 2rem;
        color: var(--theme-text-gray);
      }

      .no-data-state i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1rem;
        opacity: 0.5;
        color: var(--theme-text-teal);
      }

      .no-data-state h3 {
        margin: 0 0 0.5rem 0;
        font-size: var(--theme-font-page-title);
        color: var(--theme-text-dark);
      }

      .no-data-state p {
        margin: 0.5rem 0;
        font-size: var(--theme-font-body);
      }

      .hint {
        font-size: var(--theme-font-body) !important;
        color: var(--theme-text-gray) !important;
      }
    `,
  ],
})
export class StatisticsTabComponent implements OnInit, OnDestroy {
  @Input({ required: true }) topicName!: string;

  statsService = inject(KafkaStatisticsService);
  private stateService = inject(KafkaStateService);
  isLoading = signal(false);
  Math = Math;

  // Computed values for UI
  readonly summary = computed(() => this.statsService.getStatisticsSummary());
  
  readonly hasData = computed(() => this.statsService.snapshots().length > 0);
  
  readonly currentMessageCount = computed(() => {
    const latest = this.statsService.latestSnapshot();
    return latest?.topicMetrics.messageCount || 0;
  });

  readonly currentTotalLag = computed(() => {
    const latest = this.statsService.latestSnapshot();
    return latest?.consumerGroupMetrics.reduce((sum: number, g) => sum + g.totalLag, 0) || 0;
  });

  readonly consumerGroupHealth = computed(() => this.statsService.consumerGroupHealth());
  
  readonly hotPartitions = computed(() => this.statsService.hotPartitions());
  
  readonly partitionDistribution = computed(() => this.statsService.getPartitionDistribution());

  readonly storageInfo = signal<{ itemCount: number; estimatedSizeKB: number } | null>(null);

  // Chart data
  readonly messageCountChartData = computed(() => {
    const timeSeries = this.statsService.messageCountTimeSeries();
    const formatted = this.statsService.getFormattedChartData(timeSeries, 'time');
    return {
      labels: formatted.labels,
      values: formatted.values,
      color: 'var(--theme-button-primary)'
    };
  });

  readonly lagChartData = computed(() => {
    const timeSeries = this.statsService.totalLagTimeSeries();
    const formatted = this.statsService.getFormattedChartData(timeSeries, 'time');
    return {
      labels: formatted.labels,
      values: formatted.values,
      color: '#f59e0b'
    };
  });

  readonly urpChartData = computed(() => {
    const timeSeries = this.statsService.urpTimeSeries();
    const formatted = this.statsService.getFormattedChartData(timeSeries, 'time');
    return {
      labels: formatted.labels,
      values: formatted.values,
      color: '#ef4444'
    };
  });

  async ngOnInit(): Promise<void> {
    this.stateService.registerRefreshCallback('statistics-tab', async () => {
      await this.collectNow();
    });

    // Start collecting metrics
    await this.startCollection();
    
    // Load storage info
    this.loadStorageInfo();
  }

  ngOnDestroy(): void {
    this.stateService.unregisterRefreshCallback('statistics-tab');
    this.stopCollection();
  }

  async startCollection(): Promise<void> {
    try {
      await this.statsService.startCollection(this.topicName, {
        collectionIntervalMs: 30000, // 30 seconds
        retentionHours: 24,
        enableAutoCollection: true
      });
    } catch (error) {
      console.error('Failed to start collection:', error);
    }
  }

  stopCollection(): void {
    this.statsService.stopCollection();
  }

  async collectNow(): Promise<void> {
    this.isLoading.set(true);
    try {
      await this.statsService.collectNow(this.topicName);
    } catch (error) {
      console.error('Failed to collect metrics:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async clearData(): Promise<void> {
    if (confirm('Are you sure you want to clear all stored statistics for this topic?')) {
      await this.statsService.clearCurrentTopicData();
    }
  }

  async loadStorageInfo(): Promise<void> {
    const info = await this.statsService.getStorageInfo();
    this.storageInfo.set(info);
  }

  formatNumber(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(2) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(2) + 'K';
    }
    return value.toString();
  }

  getPartitionPercentage(messageCount: number): number {
    const distribution = this.partitionDistribution();
    const max = Math.max(...distribution.map((p: { partitionId: number; messageCount: number }) => p.messageCount), 1);
    return (messageCount / max) * 100;
  }

  getTimeRangeText(range: { start: number; end: number }): string {
    const duration = range.end - range.start;
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
}

