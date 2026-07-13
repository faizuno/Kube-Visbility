import { Injectable, inject } from '@angular/core';
import {
  AggregatedMetricsSnapshot,
  TimeSeriesDataPoint,
  StatisticalSummary,
} from '../models/metrics.models';

/**
 * Service for computing statistics from collected metrics
 * Following Single Responsibility Principle - only computes, doesn't collect or store
 */
@Injectable({
  providedIn: 'root',
})
export class StatisticsComputationService {
  /**
   * Extract time series data for message count
   */
  extractMessageCountTimeSeries(
    snapshots: AggregatedMetricsSnapshot[]
  ): TimeSeriesDataPoint[] {
    return snapshots.map((snapshot) => ({
      timestamp: snapshot.timestamp,
      value: snapshot.topicMetrics.messageCount,
    }));
  }

  /**
   * Extract time series data for total consumer lag
   */
  extractTotalLagTimeSeries(
    snapshots: AggregatedMetricsSnapshot[]
  ): TimeSeriesDataPoint[] {
    return snapshots.map((snapshot) => {
      const totalLag = snapshot.consumerGroupMetrics.reduce(
        (sum, group) => sum + group.totalLag,
        0
      );
      return {
        timestamp: snapshot.timestamp,
        value: totalLag,
      };
    });
  }

  /**
   * Extract time series data for a specific consumer group's lag
   */
  extractConsumerGroupLagTimeSeries(
    snapshots: AggregatedMetricsSnapshot[],
    groupId: string
  ): TimeSeriesDataPoint[] {
    return snapshots
      .map((snapshot) => {
        const group = snapshot.consumerGroupMetrics.find(
          (g) => g.groupId === groupId
        );
        return group
          ? {
              timestamp: snapshot.timestamp,
              value: group.totalLag,
              label: group.groupId,
            }
          : null;
      })
      .filter((point): point is NonNullable<typeof point> => point !== null) as TimeSeriesDataPoint[];
  }

  /**
   * Extract time series data for under-replicated partitions
   */
  extractURPTimeSeries(
    snapshots: AggregatedMetricsSnapshot[]
  ): TimeSeriesDataPoint[] {
    return snapshots.map((snapshot) => ({
      timestamp: snapshot.timestamp,
      value: snapshot.topicMetrics.underReplicatedPartitions,
    }));
  }

  /**
   * Extract partition distribution (message count per partition)
   */
  extractPartitionDistribution(
    snapshot: AggregatedMetricsSnapshot
  ): { partitionId: number; messageCount: number }[] {
    return snapshot.partitionMetrics.map((p) => ({
      partitionId: p.partitionId,
      messageCount: p.messageCount,
    }));
  }

  /**
   * Calculate statistical summary for a time series
   */
  calculateStatistics(dataPoints: TimeSeriesDataPoint[]): StatisticalSummary {
    if (dataPoints.length === 0) {
      return {
        min: 0,
        max: 0,
        average: 0,
        median: 0,
        trend: 'stable',
      };
    }

    const values = dataPoints.map((p) => p.value);
    const sorted = [...values].sort((a, b) => a - b);

    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

    // Calculate trend using linear regression
    const trend = this.calculateTrend(dataPoints);

    // Calculate percent change from first to last
    const percentChange =
      values.length > 1 && values[0] !== 0
        ? ((values[values.length - 1] - values[0]) / values[0]) * 100
        : undefined;

    return {
      min,
      max,
      average,
      median,
      trend,
      percentChange,
    };
  }

  /**
   * Calculate trend direction using simple linear regression
   */
  private calculateTrend(
    dataPoints: TimeSeriesDataPoint[]
  ): 'increasing' | 'decreasing' | 'stable' {
    if (dataPoints.length < 2) {
      return 'stable';
    }

    // Simple approach: compare first half average to second half average
    const midPoint = Math.floor(dataPoints.length / 2);
    const firstHalf = dataPoints.slice(0, midPoint);
    const secondHalf = dataPoints.slice(midPoint);

    const firstAvg =
      firstHalf.reduce((sum, p) => sum + p.value, 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((sum, p) => sum + p.value, 0) / secondHalf.length;

    const threshold = firstAvg * 0.05; // 5% threshold

    if (secondAvg > firstAvg + threshold) {
      return 'increasing';
    } else if (secondAvg < firstAvg - threshold) {
      return 'decreasing';
    } else {
      return 'stable';
    }
  }

  /**
   * Detect hot partitions (partitions with disproportionately high message counts)
   */
  detectHotPartitions(
    snapshot: AggregatedMetricsSnapshot,
    threshold: number = 1.5
  ): number[] {
    const partitions = snapshot.partitionMetrics;
    if (partitions.length === 0) return [];

    const average =
      partitions.reduce((sum, p) => sum + p.messageCount, 0) /
      partitions.length;

    return partitions
      .filter((p) => p.messageCount > average * threshold)
      .map((p) => p.partitionId);
  }

  /**
   * Calculate consumer group health score (0-100)
   */
  calculateConsumerGroupHealth(
    consumerGroupMetrics: AggregatedMetricsSnapshot['consumerGroupMetrics']
  ): { groupId: string; score: number; status: 'healthy' | 'warning' | 'critical' }[] {
    return consumerGroupMetrics.map((group) => {
      let score = 100;

      // Deduct points for lag
      if (group.totalLag > 10000) {
        score -= 50;
      } else if (group.totalLag > 1000) {
        score -= 25;
      } else if (group.totalLag > 100) {
        score -= 10;
      }

      // Deduct points for no active consumers
      if (group.activeConsumers === 0) {
        score -= 40;
      }

      score = Math.max(0, score);

      const status =
        score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical';

      return {
        groupId: group.groupId,
        score,
        status,
      };
    });
  }

  /**
   * Calculate message throughput (messages per second) between two snapshots
   */
  calculateThroughput(
    snapshot1: AggregatedMetricsSnapshot,
    snapshot2: AggregatedMetricsSnapshot
  ): number {
    const timeDiffSeconds = (snapshot2.timestamp - snapshot1.timestamp) / 1000;
    if (timeDiffSeconds <= 0) return 0;

    const messageDiff =
      snapshot2.topicMetrics.messageCount - snapshot1.topicMetrics.messageCount;
    return messageDiff / timeDiffSeconds;
  }

  /**
   * Format time series data for charting libraries
   */
  formatForChart(
    dataPoints: TimeSeriesDataPoint[],
    labelFormat: 'time' | 'datetime' | 'relative' = 'time'
  ): { labels: string[]; values: number[] } {
    const labels = dataPoints.map((p) => {
      const date = new Date(p.timestamp);
      switch (labelFormat) {
        case 'time':
          return date.toLocaleTimeString();
        case 'datetime':
          return date.toLocaleString();
        case 'relative':
          return this.getRelativeTimeString(p.timestamp);
        default:
          return date.toLocaleTimeString();
      }
    });

    const values = dataPoints.map((p) => p.value);

    return { labels, values };
  }

  /**
   * Get relative time string (e.g., "5m ago", "2h ago")
   */
  private getRelativeTimeString(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  }
}

