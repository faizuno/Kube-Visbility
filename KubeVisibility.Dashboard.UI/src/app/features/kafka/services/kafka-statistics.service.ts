import { Injectable, inject, signal, computed } from '@angular/core';
import { MetricsCollectionService } from './metrics-collection.service';
import { StatisticsComputationService } from './statistics-computation.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { QuickDiagnosticsService } from './quick-diagnostics.service';
import { LocalStorageMetricsService } from './storage/local-storage-metrics.service';
import { IMetricsStorage } from './storage/metrics-storage.interface';
import {
  AggregatedMetricsSnapshot,
  MetricsCollectionConfig,
  TimeSeriesDataPoint,
  StatisticalSummary,
} from '../models/metrics.models';
import { Anomaly, QuickDiagnostics } from '../models/diagnostics.models';

/**
 * Facade service that orchestrates metrics collection, storage, and computation
 * Following Facade Pattern and Dependency Inversion Principle
 */
@Injectable({
  providedIn: 'root',
})
export class KafkaStatisticsService {
  private metricsCollector = inject(MetricsCollectionService);
  private statisticsComputer = inject(StatisticsComputationService);
  private anomalyDetector = inject(AnomalyDetectionService);
  private diagnosticsService = inject(QuickDiagnosticsService);
  private storage: IMetricsStorage = inject(LocalStorageMetricsService);

  // State signals
  private _snapshots = signal<AggregatedMetricsSnapshot[]>([]);
  private _isCollecting = signal(false);
  private _lastError = signal<string | null>(null);
  private _currentTopic = signal<string | null>(null);

  // Public readonly signals
  readonly snapshots = this._snapshots.asReadonly();
  readonly isCollecting = this._isCollecting.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly currentTopic = this._currentTopic.asReadonly();

  // Computed signals for different time series
  readonly messageCountTimeSeries = computed(() =>
    this.statisticsComputer.extractMessageCountTimeSeries(this._snapshots())
  );

  readonly totalLagTimeSeries = computed(() =>
    this.statisticsComputer.extractTotalLagTimeSeries(this._snapshots())
  );

  readonly urpTimeSeries = computed(() =>
    this.statisticsComputer.extractURPTimeSeries(this._snapshots())
  );

  // Computed statistics
  readonly messageCountStats = computed(() =>
    this.statisticsComputer.calculateStatistics(this.messageCountTimeSeries())
  );

  readonly lagStats = computed(() =>
    this.statisticsComputer.calculateStatistics(this.totalLagTimeSeries())
  );

  // Latest snapshot
  readonly latestSnapshot = computed(() => {
    const snapshots = this._snapshots();
    return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  });

  // Consumer group health
  readonly consumerGroupHealth = computed(() => {
    const latest = this.latestSnapshot();
    return latest
      ? this.statisticsComputer.calculateConsumerGroupHealth(
          latest.consumerGroupMetrics
        )
      : [];
  });

  // Hot partitions
  readonly hotPartitions = computed(() => {
    const latest = this.latestSnapshot();
    return latest
      ? this.statisticsComputer.detectHotPartitions(latest)
      : [];
  });

  // Anomalies
  readonly anomalies = computed(() => {
    const topic = this._currentTopic();
    const snapshots = this._snapshots();
    return topic ? this.anomalyDetector.detectAnomalies(topic, snapshots) : [];
  });

  // Quick diagnostics
  readonly quickDiagnostics = computed(() => {
    const snapshots = this._snapshots();
    if (snapshots.length === 0) return null;
    
    const latest = snapshots[snapshots.length - 1];
    const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : undefined;
    
    return this.diagnosticsService.runDiagnostics(latest, previous);
  });

  /**
   * Initialize and start collecting metrics for a topic
   */
  async startCollection(
    topicName: string,
    config: Partial<MetricsCollectionConfig> = {}
  ): Promise<void> {
    // Stop any existing collection
    this.stopCollection();

    this._currentTopic.set(topicName);
    this._lastError.set(null);

    // Load historical data from storage
    await this.loadHistoricalData(topicName);

    // Setup collection config with defaults
    const fullConfig: MetricsCollectionConfig = {
      topicName,
      collectionIntervalMs: config.collectionIntervalMs || 30000, // 30 seconds default
      retentionHours: config.retentionHours || 24, // 24 hours default
      enableAutoCollection: config.enableAutoCollection ?? true,
    };

    if (fullConfig.enableAutoCollection) {
      this._isCollecting.set(true);

      // Start auto collection
      this.metricsCollector.startAutoCollection(
        fullConfig,
        (snapshot) => this.handleNewSnapshot(snapshot, fullConfig.retentionHours),
        (error) => this.handleCollectionError(error)
      );
    }
  }

  /**
   * Stop collecting metrics
   */
  stopCollection(): void {
    this.metricsCollector.stopAutoCollection();
    this._isCollecting.set(false);
  }

  /**
   * Manually trigger a snapshot collection
   */
  async collectNow(topicName: string): Promise<void> {
    try {
      this._lastError.set(null);
      const snapshot = await this.metricsCollector.collectSnapshot(topicName);
      await this.handleNewSnapshot(snapshot, 24);
    } catch (error) {
      this.handleCollectionError(error as Error);
      throw error;
    }
  }

  /**
   * Load historical data from storage
   */
  private async loadHistoricalData(topicName: string): Promise<void> {
    try {
      const snapshots = await this.storage.getSnapshots(topicName);
      this._snapshots.set(snapshots);
    } catch (error) {
      console.error('Error loading historical data:', error);
      this._snapshots.set([]);
    }
  }

  /**
   * Handle a new snapshot
   */
  private async handleNewSnapshot(
    snapshot: AggregatedMetricsSnapshot,
    retentionHours: number
  ): Promise<void> {
    try {
      // Save to storage
      await this.storage.saveSnapshot(snapshot);

      // Clean old snapshots
      await this.storage.clearOldSnapshots(retentionHours);

      // Update in-memory state
      this._snapshots.update((snapshots) => [...snapshots, snapshot]);
    } catch (error) {
      console.error('Error handling new snapshot:', error);
      this._lastError.set('Failed to save metrics snapshot');
    }
  }

  /**
   * Handle collection error
   */
  private handleCollectionError(error: Error): void {
    console.error('Metrics collection error:', error);
    this._lastError.set(error.message);
    this._isCollecting.set(false);
  }

  /**
   * Get time series for a specific consumer group
   */
  getConsumerGroupTimeSeries(groupId: string): TimeSeriesDataPoint[] {
    return this.statisticsComputer.extractConsumerGroupLagTimeSeries(
      this._snapshots(),
      groupId
    );
  }

  /**
   * Get partition distribution from latest snapshot
   */
  getPartitionDistribution(): { partitionId: number; messageCount: number }[] {
    const latest = this.latestSnapshot();
    return latest
      ? this.statisticsComputer.extractPartitionDistribution(latest)
      : [];
  }

  /**
   * Calculate throughput if we have at least 2 snapshots
   */
  getCurrentThroughput(): number {
    const snapshots = this._snapshots();
    if (snapshots.length < 2) return 0;

    return this.statisticsComputer.calculateThroughput(
      snapshots[snapshots.length - 2],
      snapshots[snapshots.length - 1]
    );
  }

  /**
   * Get formatted chart data
   */
  getFormattedChartData(
    timeSeries: TimeSeriesDataPoint[],
    labelFormat: 'time' | 'datetime' | 'relative' = 'time'
  ): { labels: string[]; values: number[] } {
    return this.statisticsComputer.formatForChart(timeSeries, labelFormat);
  }

  /**
   * Clear all stored data for current topic
   */
  async clearCurrentTopicData(): Promise<void> {
    const topic = this._currentTopic();
    if (topic) {
      await this.storage.clearTopicSnapshots(topic);
      this._snapshots.set([]);
    }
  }

  /**
   * Clear all stored data
   */
  async clearAllData(): Promise<void> {
    await this.storage.clearAll();
    this._snapshots.set([]);
  }

  /**
   * Get storage information
   */
  async getStorageInfo(): Promise<{ itemCount: number; estimatedSizeKB: number }> {
    return this.storage.getStorageInfo();
  }

  /**
   * Get statistics summary for display
   */
  getStatisticsSummary(): {
    snapshotCount: number;
    timeRange: { start: number; end: number } | null;
    messageCountStats: StatisticalSummary;
    lagStats: StatisticalSummary;
    throughput: number;
  } {
    const snapshots = this._snapshots();
    
    return {
      snapshotCount: snapshots.length,
      timeRange:
        snapshots.length > 0
          ? {
              start: snapshots[0].timestamp,
              end: snapshots[snapshots.length - 1].timestamp,
            }
          : null,
      messageCountStats: this.messageCountStats(),
      lagStats: this.lagStats(),
      throughput: this.getCurrentThroughput(),
    };
  }
}

