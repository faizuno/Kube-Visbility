import { AggregatedMetricsSnapshot } from '../../models/metrics.models';

/**
 * Interface for metrics storage following Dependency Inversion Principle
 * Allows for different storage implementations (LocalStorage, IndexedDB, API, etc.)
 */
export interface IMetricsStorage {
  /**
   * Save a metrics snapshot
   */
  saveSnapshot(snapshot: AggregatedMetricsSnapshot): Promise<void>;

  /**
   * Get all snapshots for a topic
   */
  getSnapshots(topicName: string, fromTimestamp?: number): Promise<AggregatedMetricsSnapshot[]>;

  /**
   * Get the latest snapshot for a topic
   */
  getLatestSnapshot(topicName: string): Promise<AggregatedMetricsSnapshot | null>;

  /**
   * Clear old snapshots based on retention policy
   */
  clearOldSnapshots(retentionHours: number): Promise<void>;

  /**
   * Clear all snapshots for a topic
   */
  clearTopicSnapshots(topicName: string): Promise<void>;

  /**
   * Clear all stored data
   */
  clearAll(): Promise<void>;

  /**
   * Get storage size information
   */
  getStorageInfo(): Promise<{ itemCount: number; estimatedSizeKB: number }>;
}

