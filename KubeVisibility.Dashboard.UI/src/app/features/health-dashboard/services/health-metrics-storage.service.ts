import { Injectable } from '@angular/core';
import { NodeMetrics, NodeMetricsDataPoint, ResourceTrendDataPoint } from '../models/health.models';

/**
 * Interface for metrics snapshot storage
 */
export interface MetricsSnapshot<T> {
  timestamp: number;
  data: T;
}

/**
 * LocalStorage implementation for health metrics storage
 * Following the same pattern as Kafka metrics storage
 */
@Injectable({
  providedIn: 'root',
})
export class HealthMetricsStorageService {
  private readonly STORAGE_PREFIX = 'health-metrics-';
  private readonly INDEX_KEY = 'health-metrics-index';
  private readonly DEFAULT_RETENTION_HOURS = 24;

  /**
   * Get the storage key for a specific metric type and resource
   */
  private getMetricKey(metricType: string, resource: string): string {
    return `${this.STORAGE_PREFIX}${metricType}-${resource}`;
  }

  /**
   * Get the index of all metrics that have been stored
   */
  private getMetricsIndex(): string[] {
    try {
      const index = localStorage.getItem(this.INDEX_KEY);
      return index ? JSON.parse(index) : [];
    } catch (error) {
      console.error('Error reading metrics index:', error);
      return [];
    }
  }

  /**
   * Update the metrics index
   */
  private updateMetricsIndex(key: string): void {
    try {
      const index = this.getMetricsIndex();
      if (!index.includes(key)) {
        index.push(key);
        localStorage.setItem(this.INDEX_KEY, JSON.stringify(index));
      }
    } catch (error) {
      console.error('Error updating metrics index:', error);
    }
  }

  /**
   * Remove a key from the index
   */
  private removeFromIndex(key: string): void {
    try {
      const index = this.getMetricsIndex();
      const filtered = index.filter((k) => k !== key);
      localStorage.setItem(this.INDEX_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error removing from index:', error);
    }
  }

  /**
   * Save a metrics snapshot
   */
  async saveMetricsSnapshot<T>(
    metricType: string,
    resource: string,
    data: T
  ): Promise<void> {
    try {
      const key = this.getMetricKey(metricType, resource);
      const existing = await this.getMetricsSnapshots<T>(key);

      // Add new snapshot
      existing.push({
        timestamp: Date.now(),
        data: data,
      });

      // Sort by timestamp
      existing.sort((a, b) => a.timestamp - b.timestamp);

      // Store
      localStorage.setItem(key, JSON.stringify(existing));

      // Update index
      this.updateMetricsIndex(key);
    } catch (error) {
      console.error('Error saving metrics snapshot:', error);
      throw new Error('Failed to save metrics snapshot');
    }
  }

  /**
   * Get all snapshots for a specific metric key
   */
  async getMetricsSnapshots<T>(
    key: string,
    fromTimestamp?: number
  ): Promise<MetricsSnapshot<T>[]> {
    try {
      const data = localStorage.getItem(key);

      if (!data) {
        return [];
      }

      const snapshots: MetricsSnapshot<T>[] = JSON.parse(data);

      // Filter by timestamp if provided
      if (fromTimestamp !== undefined) {
        return snapshots.filter((s) => s.timestamp >= fromTimestamp);
      }

      return snapshots;
    } catch (error) {
      console.error('Error getting metrics snapshots:', error);
      return [];
    }
  }

  /**
   * Get snapshots for a specific metric type and resource
   */
  async getMetricsSnapshotsByType<T>(
    metricType: string,
    resource: string,
    fromTimestamp?: number
  ): Promise<MetricsSnapshot<T>[]> {
    const key = this.getMetricKey(metricType, resource);
    return this.getMetricsSnapshots<T>(key, fromTimestamp);
  }

  /**
   * Get the latest snapshot for a specific metric
   */
  async getLatestSnapshot<T>(
    metricType: string,
    resource: string
  ): Promise<MetricsSnapshot<T> | null> {
    try {
      const key = this.getMetricKey(metricType, resource);
      const snapshots = await this.getMetricsSnapshots<T>(key);
      return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    } catch (error) {
      console.error('Error getting latest snapshot:', error);
      return null;
    }
  }

  /**
   * Get node metrics history for charting
   */
  async getNodeMetricsHistory(
    nodeName: string,
    hoursBack: number = 1
  ): Promise<NodeMetricsDataPoint[]> {
    const fromTimestamp = Date.now() - hoursBack * 60 * 60 * 1000;
    const snapshots = await this.getMetricsSnapshotsByType<NodeMetrics>(
      'node',
      nodeName,
      fromTimestamp
    );

    return snapshots.map((snapshot) => ({
      timestamp: new Date(snapshot.timestamp).toISOString(),
      cpuUsagePercent: snapshot.data.cpuUsagePercent,
      memoryUsagePercent: snapshot.data.memoryUsagePercent,
      cpuUsage: snapshot.data.cpuUsage,
      memoryUsage: snapshot.data.memoryUsage,
    }));
  }

  /**
   * Get resource trends history
   */
  async getResourceTrendsHistory(
    namespaceName: string,
    hoursBack: number = 1
  ): Promise<ResourceTrendDataPoint[]> {
    const fromTimestamp = Date.now() - hoursBack * 60 * 60 * 1000;
    const snapshots = await this.getMetricsSnapshotsByType<ResourceTrendDataPoint>(
      'resource-trend',
      namespaceName,
      fromTimestamp
    );

    return snapshots.map((snapshot) => snapshot.data);
  }

  /**
   * Clear old snapshots based on retention policy
   */
  async clearOldSnapshots(retentionHours: number = this.DEFAULT_RETENTION_HOURS): Promise<void> {
    try {
      const cutoffTime = Date.now() - retentionHours * 60 * 60 * 1000;
      const metricsKeys = this.getMetricsIndex();

      for (const key of metricsKeys) {
        const snapshots = await this.getMetricsSnapshots(key);

        // Filter out old snapshots
        const filtered = snapshots.filter((s) => s.timestamp >= cutoffTime);

        if (filtered.length === 0) {
          // No data left, remove the key
          localStorage.removeItem(key);
          this.removeFromIndex(key);
        } else {
          // Save filtered data
          localStorage.setItem(key, JSON.stringify(filtered));
        }
      }
    } catch (error) {
      console.error('Error clearing old snapshots:', error);
    }
  }

  /**
   * Clear all metrics for a specific type and resource
   */
  async clearMetrics(metricType: string, resource: string): Promise<void> {
    try {
      const key = this.getMetricKey(metricType, resource);
      localStorage.removeItem(key);
      this.removeFromIndex(key);
    } catch (error) {
      console.error('Error clearing metrics:', error);
    }
  }

  /**
   * Clear all stored metrics
   */
  async clearAll(): Promise<void> {
    try {
      const metricsKeys = this.getMetricsIndex();

      // Remove all metric data
      for (const key of metricsKeys) {
        localStorage.removeItem(key);
      }

      // Remove index
      localStorage.removeItem(this.INDEX_KEY);
    } catch (error) {
      console.error('Error clearing all metrics:', error);
    }
  }

  /**
   * Get storage information
   */
  async getStorageInfo(): Promise<{ itemCount: number; estimatedSizeKB: number }> {
    try {
      const metricsKeys = this.getMetricsIndex();
      let totalSize = 0;
      let itemCount = 0;

      for (const key of metricsKeys) {
        const snapshots = await this.getMetricsSnapshots(key);
        itemCount += snapshots.length;

        // Estimate size
        const data = localStorage.getItem(key);
        if (data) {
          totalSize += new Blob([data]).size;
        }
      }

      return {
        itemCount,
        estimatedSizeKB: Math.round(totalSize / 1024),
      };
    } catch (error) {
      console.error('Error getting storage info:', error);
      return { itemCount: 0, estimatedSizeKB: 0 };
    }
  }

  /**
   * Initialize storage cleanup on service creation
   */
  constructor() {
    // Clear old metrics on initialization (runs once when service is created)
    this.clearOldSnapshots().catch((error) => {
      console.error('Error during initial cleanup:', error);
    });
  }
}

