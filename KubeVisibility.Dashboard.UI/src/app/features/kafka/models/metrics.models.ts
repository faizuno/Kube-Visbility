// Metrics data models following Interface Segregation Principle
// Each interface represents a specific concern

/**
 * Snapshot of metrics at a specific point in time
 */
export interface MetricSnapshot {
  timestamp: number;
  topicName: string;
}

/**
 * Topic-level metrics
 */
export interface TopicMetrics extends MetricSnapshot {
  messageCount: number;
  partitionCount: number;
  underReplicatedPartitions: number;
  averageMessagesPerPartition: number;
}

/**
 * Consumer group metrics
 */
export interface ConsumerGroupMetrics extends MetricSnapshot {
  groupId: string;
  totalLag: number;
  activeConsumers: number;
  partitionCount: number;
}

/**
 * Partition-level metrics
 */
export interface PartitionMetrics extends MetricSnapshot {
  partitionId: number;
  messageCount: number;
  firstOffset: number;
  nextOffset: number;
  leader: number;
}

/**
 * Aggregated metrics snapshot containing all metric types
 */
export interface AggregatedMetricsSnapshot {
  timestamp: number;
  topicName: string;
  topicMetrics: TopicMetrics;
  consumerGroupMetrics: ConsumerGroupMetrics[];
  partitionMetrics: PartitionMetrics[];
}

/**
 * Time series data point for charting
 */
export interface TimeSeriesDataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

/**
 * Statistical summary
 */
export interface StatisticalSummary {
  min: number;
  max: number;
  average: number;
  median: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  percentChange?: number;
}

/**
 * Configuration for metrics collection
 */
export interface MetricsCollectionConfig {
  topicName: string;
  collectionIntervalMs: number;
  retentionHours: number;
  enableAutoCollection: boolean;
}

