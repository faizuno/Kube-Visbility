import { Injectable, inject } from '@angular/core';
import { AggregatedMetricsSnapshot } from '../models/metrics.models';
import { 
  Anomaly, 
  AnomalyType, 
  Severity, 
  Baseline, 
  AnomalyDetectionConfig 
} from '../models/diagnostics.models';
import { StatisticsComputationService } from './statistics-computation.service';

/**
 * Service for detecting anomalies in Kafka metrics
 * Following Single Responsibility Principle - only detects anomalies
 */
@Injectable({
  providedIn: 'root',
})
export class AnomalyDetectionService {
  private statisticsService = inject(StatisticsComputationService);
  
  // Store baselines per topic per metric
  private baselines = new Map<string, Map<string, Baseline>>();
  
  // Default configuration
  private config: AnomalyDetectionConfig = {
    enabled: true,
    sensitivity: 'medium',
    minBaselineSamples: 48,  // At least 24 hours of data at 30s intervals
    maxAnomaliesPerType: 3
  };

  /**
   * Main entry point - detect all anomalies
   */
  detectAnomalies(
    topicName: string,
    snapshots: AggregatedMetricsSnapshot[],
    config?: Partial<AnomalyDetectionConfig>
  ): Anomaly[] {
    if (!this.config.enabled) return [];
    
    // Merge config if provided
    if (config) {
      this.config = { ...this.config, ...config };
    }

    const anomalies: Anomaly[] = [];

    // Need at least 2 snapshots for comparisons
    if (snapshots.length < 2) return [];

    // Update baseline with historical data
    this.updateBaseline(topicName, snapshots);

    const baseline = this.baselines.get(topicName);
    const latest = snapshots[snapshots.length - 1];

    // 1. Statistical anomalies (if we have baseline)
    if (baseline && snapshots.length >= this.config.minBaselineSamples) {
      anomalies.push(...this.detectStatisticalAnomalies(latest, baseline));
    }

    // 2. Rate-based anomalies (don't need baseline)
    anomalies.push(...this.detectRateAnomalies(snapshots));

    // 3. Pattern-based anomalies
    anomalies.push(...this.detectPatternAnomalies(latest));

    // 4. Trend-based anomalies
    anomalies.push(...this.detectTrendAnomalies(snapshots));

    // 5. Consumer-specific anomalies
    anomalies.push(...this.detectConsumerAnomalies(snapshots));

    // Deduplicate and prioritize
    return this.deduplicateAndPrioritize(anomalies);
  }

  /**
   * Update baseline with historical data
   */
  private updateBaseline(topicName: string, snapshots: AggregatedMetricsSnapshot[]): void {
    if (snapshots.length < this.config.minBaselineSamples) return;

    const topicBaselines = new Map<string, Baseline>();

    // Calculate baseline for message count
    const messageCounts = snapshots.map(s => s.topicMetrics.messageCount);
    topicBaselines.set('messageCount', this.calculateBaseline('messageCount', messageCounts));

    // Calculate baseline for total lag
    const totalLags = snapshots.map(s => 
      s.consumerGroupMetrics.reduce((sum, g) => sum + g.totalLag, 0)
    );
    topicBaselines.set('totalLag', this.calculateBaseline('totalLag', totalLags));

    // Calculate baseline for URP
    const urps = snapshots.map(s => s.topicMetrics.underReplicatedPartitions);
    topicBaselines.set('urp', this.calculateBaseline('urp', urps));

    this.baselines.set(topicName, topicBaselines);
  }

  /**
   * Calculate statistical baseline
   */
  private calculateBaseline(metricName: string, values: number[]): Baseline {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((s, v) => s + v, 0);
    const mean = sum / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
      metric: metricName,
      mean,
      stdDev,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      sampleSize: values.length,
      lastUpdated: Date.now(),
      trend: this.calculateTrendDirection(values)
    };
  }

  /**
   * Calculate trend direction
   */
  private calculateTrendDirection(values: number[]): 'stable' | 'increasing' | 'decreasing' {
    if (values.length < 4) return 'stable';

    const midPoint = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, midPoint);
    const secondHalf = values.slice(midPoint);

    const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

    const threshold = firstAvg * 0.1; // 10% threshold

    if (secondAvg > firstAvg + threshold) return 'increasing';
    if (secondAvg < firstAvg - threshold) return 'decreasing';
    return 'stable';
  }

  /**
   * Detect statistical anomalies using Z-score
   */
  private detectStatisticalAnomalies(
    snapshot: AggregatedMetricsSnapshot,
    baselines: Map<string, Baseline>
  ): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const threshold = this.getSensitivityThreshold();

    // Check message count
    const messageCountBaseline = baselines.get('messageCount');
    if (messageCountBaseline) {
      const currentCount = snapshot.topicMetrics.messageCount;
      const zScore = (currentCount - messageCountBaseline.mean) / (messageCountBaseline.stdDev || 1);

      if (Math.abs(zScore) > threshold) {
        anomalies.push({
          type: zScore > 0 ? 'lag_spike' : 'throughput_drop',
          severity: this.calculateSeverityFromZScore(zScore),
          timestamp: snapshot.timestamp,
          description: `Message count is ${Math.abs(zScore).toFixed(1)}σ from normal`,
          details: `Current: ${currentCount.toLocaleString()}, Expected: ${messageCountBaseline.mean.toFixed(0)}`,
          suggestedAction: zScore > 0 
            ? 'Investigate sudden increase in message production'
            : 'Check if producers are healthy',
          metric: {
            name: 'Message Count',
            currentValue: currentCount,
            expectedValue: messageCountBaseline.mean,
            threshold: messageCountBaseline.mean + threshold * messageCountBaseline.stdDev
          }
        });
      }
    }

    // Check lag
    const lagBaseline = baselines.get('totalLag');
    if (lagBaseline) {
      const currentLag = snapshot.consumerGroupMetrics.reduce((sum, g) => sum + g.totalLag, 0);
      const zScore = (currentLag - lagBaseline.mean) / (lagBaseline.stdDev || 1);

      if (zScore > threshold) {
        anomalies.push({
          type: 'lag_spike',
          severity: this.calculateSeverityFromZScore(zScore),
          timestamp: snapshot.timestamp,
          description: `Consumer lag is ${zScore.toFixed(1)}σ above normal`,
          details: `Current lag: ${currentLag.toLocaleString()}, Expected: ${lagBaseline.mean.toFixed(0)}`,
          suggestedAction: 'Scale up consumers or investigate slow processing',
          metric: {
            name: 'Total Lag',
            currentValue: currentLag,
            expectedValue: lagBaseline.mean
          }
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect rate-based anomalies (rapid changes)
   */
  private detectRateAnomalies(snapshots: AggregatedMetricsSnapshot[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    
    if (snapshots.length < 10) return anomalies;

    const recent = snapshots.slice(-5);  // Last 5 snapshots (~2.5 minutes)
    const previous = snapshots.slice(-10, -5);  // Previous 5 snapshots

    // Calculate lag change rate
    const recentLag = recent.map(s => 
      s.consumerGroupMetrics.reduce((sum, g) => sum + g.totalLag, 0)
    );
    const previousLag = previous.map(s =>
      s.consumerGroupMetrics.reduce((sum, g) => sum + g.totalLag, 0)
    );

    const recentAvg = recentLag.reduce((s, v) => s + v, 0) / recentLag.length;
    const previousAvg = previousLag.reduce((s, v) => s + v, 0) / previousLag.length;

    if (previousAvg > 0) {
      const percentChange = ((recentAvg - previousAvg) / previousAvg) * 100;

      if (percentChange > 50) {
        anomalies.push({
          type: 'lag_spike',
          severity: percentChange > 100 ? 'critical' : 'high',
          timestamp: recent[recent.length - 1].timestamp,
          description: `Lag increased ${percentChange.toFixed(0)}% in last 2.5 minutes`,
          details: `From ${previousAvg.toFixed(0)} to ${recentAvg.toFixed(0)}`,
          suggestedAction: 'Check for consumer failures or sudden traffic spike'
        });
      } else if (percentChange < -70) {
        anomalies.push({
          type: 'throughput_drop',
          severity: 'high',
          timestamp: recent[recent.length - 1].timestamp,
          description: `Throughput dropped ${Math.abs(percentChange).toFixed(0)}%`,
          details: `Lag decreased from ${previousAvg.toFixed(0)} to ${recentAvg.toFixed(0)}`,
          suggestedAction: 'Check producer health and network connectivity'
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect pattern-based anomalies
   */
  private detectPatternAnomalies(snapshot: AggregatedMetricsSnapshot): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // 1. Consumer down detection
    for (const group of snapshot.consumerGroupMetrics) {
      if (group.activeConsumers === 0 && group.totalLag > 0) {
        anomalies.push({
          type: 'consumer_down',
          severity: 'critical',
          timestamp: snapshot.timestamp,
          description: `Consumer group "${group.groupId}" has no active consumers`,
          details: `${group.totalLag.toLocaleString()} messages waiting to be processed`,
          affectedConsumerGroups: [group.groupId],
          suggestedAction: 'Restart consumer application immediately and check logs'
        });
      }
    }

    // 2. Partition imbalance detection
    const partitionCounts = snapshot.partitionMetrics.map(p => p.messageCount);
    const avgCount = partitionCounts.reduce((s, c) => s + c, 0) / partitionCounts.length;
    const maxCount = Math.max(...partitionCounts);

    if (maxCount > avgCount * 3 && avgCount > 1000) {
      const hotPartitions = snapshot.partitionMetrics
        .filter(p => p.messageCount > avgCount * 3)
        .map(p => p.partitionId);

      anomalies.push({
        type: 'partition_imbalance',
        severity: 'medium',
        timestamp: snapshot.timestamp,
        description: `Severe partition imbalance detected`,
        details: `${hotPartitions.length} partition(s) have 3x more messages than average`,
        affectedPartitions: hotPartitions,
        suggestedAction: 'Review partition key strategy to ensure even distribution'
      });
    }

    // 3. Under-replicated partitions
    if (snapshot.topicMetrics.underReplicatedPartitions > 0) {
      anomalies.push({
        type: 'partition_imbalance',
        severity: 'critical',
        timestamp: snapshot.timestamp,
        description: `${snapshot.topicMetrics.underReplicatedPartitions} under-replicated partition(s)`,
        details: 'Risk of data loss if broker fails',
        suggestedAction: 'Check broker health and replication status immediately'
      });
    }

    return anomalies;
  }

  /**
   * Detect trend-based anomalies
   */
  private detectTrendAnomalies(snapshots: AggregatedMetricsSnapshot[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    
    if (snapshots.length < 10) return anomalies;

    const recentSnapshots = snapshots.slice(-10);
    const lags = recentSnapshots.map(s =>
      s.consumerGroupMetrics.reduce((sum, g) => sum + g.totalLag, 0)
    );

    // Simple linear regression to find trend
    const trend = this.calculateLinearTrend(lags);

    // If lag is continuously increasing
    if (trend.slope > 50) {  // Growing by 50+ messages per snapshot
      const currentLag = lags[lags.length - 1];
      const timeToThreshold = (100000 - currentLag) / trend.slope;

      if (timeToThreshold > 0 && timeToThreshold < 20) {
        anomalies.push({
          type: 'trend_warning',
          severity: timeToThreshold < 10 ? 'critical' : 'high',
          timestamp: recentSnapshots[recentSnapshots.length - 1].timestamp,
          description: `Lag is continuously increasing at ${trend.slope.toFixed(1)}/interval`,
          details: `Will exceed 100K in approximately ${(timeToThreshold * 0.5).toFixed(0)} minutes`,
          suggestedAction: 'Scale up consumers immediately or investigate slow processing'
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect consumer-specific anomalies
   */
  private detectConsumerAnomalies(snapshots: AggregatedMetricsSnapshot[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    
    if (snapshots.length < 2) return anomalies;

    const latest = snapshots[snapshots.length - 1];
    const previous = snapshots[snapshots.length - 2];

    // Detect rebalances (change in consumer count)
    for (const currentGroup of latest.consumerGroupMetrics) {
      const previousGroup = previous.consumerGroupMetrics.find(g => g.groupId === currentGroup.groupId);
      
      if (previousGroup && previousGroup.activeConsumers !== currentGroup.activeConsumers) {
        anomalies.push({
          type: 'rebalance_detected',
          severity: 'low',
          timestamp: latest.timestamp,
          description: `Consumer group "${currentGroup.groupId}" rebalanced`,
          details: `Consumer count changed from ${previousGroup.activeConsumers} to ${currentGroup.activeConsumers}`,
          affectedConsumerGroups: [currentGroup.groupId],
          suggestedAction: 'Monitor for lag spikes during rebalance'
        });
      }
    }

    return anomalies;
  }

  /**
   * Calculate linear trend
   */
  private calculateLinearTrend(values: number[]): { slope: number; intercept: number } {
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;  // Sum of indices
    const sumY = values.reduce((s, v) => s + v, 0);
    const sumXY = values.reduce((s, v, i) => s + i * v, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  /**
   * Deduplicate and prioritize anomalies
   */
  private deduplicateAndPrioritize(anomalies: Anomaly[]): Anomaly[] {
    // Group by type and keep only the most severe
    const grouped = new Map<AnomalyType, Anomaly[]>();
    
    for (const anomaly of anomalies) {
      if (!grouped.has(anomaly.type)) {
        grouped.set(anomaly.type, []);
      }
      grouped.get(anomaly.type)!.push(anomaly);
    }

    const result: Anomaly[] = [];
    const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low'];

    for (const [type, typeAnomalies] of grouped) {
      // Sort by severity and take top N
      const sorted = typeAnomalies.sort((a, b) => 
        severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
      );
      
      result.push(...sorted.slice(0, this.config.maxAnomaliesPerType));
    }

    // Final sort by severity
    return result.sort((a, b) => 
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
    );
  }

  /**
   * Get threshold based on sensitivity
   */
  private getSensitivityThreshold(): number {
    switch (this.config.sensitivity) {
      case 'low': return 3;     // 3 standard deviations
      case 'medium': return 2.5; // 2.5 standard deviations
      case 'high': return 2;    // 2 standard deviations
      default: return 2.5;
    }
  }

  /**
   * Calculate severity from Z-score
   */
  private calculateSeverityFromZScore(zScore: number): Severity {
    const absZ = Math.abs(zScore);
    
    if (absZ > 5) return 'critical';
    if (absZ > 4) return 'high';
    if (absZ > 3) return 'medium';
    return 'low';
  }

  /**
   * Get baseline for a topic
   */
  getBaseline(topicName: string): Map<string, Baseline> | undefined {
    return this.baselines.get(topicName);
  }

  /**
   * Clear baselines
   */
  clearBaselines(topicName?: string): void {
    if (topicName) {
      this.baselines.delete(topicName);
    } else {
      this.baselines.clear();
    }
  }
}

