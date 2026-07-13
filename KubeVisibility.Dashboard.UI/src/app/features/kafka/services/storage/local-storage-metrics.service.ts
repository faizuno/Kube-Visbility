import { Injectable } from '@angular/core';
import { IMetricsStorage } from './metrics-storage.interface';
import { AggregatedMetricsSnapshot } from '../../models/metrics.models';

/**
 * LocalStorage implementation of metrics storage
 * Following Single Responsibility Principle - only handles storage operations
 */
@Injectable({
  providedIn: 'root',
})
export class LocalStorageMetricsService implements IMetricsStorage {
  private readonly STORAGE_PREFIX = 'kafka-metrics-';
  private readonly INDEX_KEY = 'kafka-metrics-index';

  /**
   * Get the storage key for a topic
   */
  private getTopicKey(topicName: string): string {
    return `${this.STORAGE_PREFIX}${topicName}`;
  }

  /**
   * Get the index of all topics that have stored metrics
   */
  private getTopicIndex(): string[] {
    try {
      const index = localStorage.getItem(this.INDEX_KEY);
      return index ? JSON.parse(index) : [];
    } catch (error) {
      console.error('Error reading topic index:', error);
      return [];
    }
  }

  /**
   * Update the topic index
   */
  private updateTopicIndex(topicName: string): void {
    try {
      const index = this.getTopicIndex();
      if (!index.includes(topicName)) {
        index.push(topicName);
        localStorage.setItem(this.INDEX_KEY, JSON.stringify(index));
      }
    } catch (error) {
      console.error('Error updating topic index:', error);
    }
  }

  /**
   * Remove a topic from the index
   */
  private removeFromIndex(topicName: string): void {
    try {
      const index = this.getTopicIndex();
      const filtered = index.filter((t) => t !== topicName);
      localStorage.setItem(this.INDEX_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error removing from index:', error);
    }
  }

  async saveSnapshot(snapshot: AggregatedMetricsSnapshot): Promise<void> {
    try {
      const key = this.getTopicKey(snapshot.topicName);
      const existing = await this.getSnapshots(snapshot.topicName);
      
      // Add new snapshot
      existing.push(snapshot);
      
      // Sort by timestamp
      existing.sort((a, b) => a.timestamp - b.timestamp);
      
      // Store
      localStorage.setItem(key, JSON.stringify(existing));
      
      // Update index
      this.updateTopicIndex(snapshot.topicName);
    } catch (error) {
      console.error('Error saving snapshot:', error);
      throw new Error('Failed to save metrics snapshot');
    }
  }

  async getSnapshots(
    topicName: string,
    fromTimestamp?: number
  ): Promise<AggregatedMetricsSnapshot[]> {
    try {
      const key = this.getTopicKey(topicName);
      const data = localStorage.getItem(key);
      
      if (!data) {
        return [];
      }

      const snapshots: AggregatedMetricsSnapshot[] = JSON.parse(data);
      
      // Filter by timestamp if provided
      if (fromTimestamp !== undefined) {
        return snapshots.filter((s) => s.timestamp >= fromTimestamp);
      }

      return snapshots;
    } catch (error) {
      console.error('Error getting snapshots:', error);
      return [];
    }
  }

  async getLatestSnapshot(topicName: string): Promise<AggregatedMetricsSnapshot | null> {
    try {
      const snapshots = await this.getSnapshots(topicName);
      return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    } catch (error) {
      console.error('Error getting latest snapshot:', error);
      return null;
    }
  }

  async clearOldSnapshots(retentionHours: number): Promise<void> {
    try {
      const cutoffTime = Date.now() - retentionHours * 60 * 60 * 1000;
      const topics = this.getTopicIndex();

      for (const topicName of topics) {
        const key = this.getTopicKey(topicName);
        const snapshots = await this.getSnapshots(topicName);
        
        // Filter out old snapshots
        const filtered = snapshots.filter((s) => s.timestamp >= cutoffTime);
        
        if (filtered.length === 0) {
          // No data left, remove the key
          localStorage.removeItem(key);
          this.removeFromIndex(topicName);
        } else {
          // Save filtered data
          localStorage.setItem(key, JSON.stringify(filtered));
        }
      }
    } catch (error) {
      console.error('Error clearing old snapshots:', error);
    }
  }

  async clearTopicSnapshots(topicName: string): Promise<void> {
    try {
      const key = this.getTopicKey(topicName);
      localStorage.removeItem(key);
      this.removeFromIndex(topicName);
    } catch (error) {
      console.error('Error clearing topic snapshots:', error);
    }
  }

  async clearAll(): Promise<void> {
    try {
      const topics = this.getTopicIndex();
      
      // Remove all topic data
      for (const topicName of topics) {
        localStorage.removeItem(this.getTopicKey(topicName));
      }
      
      // Remove index
      localStorage.removeItem(this.INDEX_KEY);
    } catch (error) {
      console.error('Error clearing all data:', error);
    }
  }

  async getStorageInfo(): Promise<{ itemCount: number; estimatedSizeKB: number }> {
    try {
      const topics = this.getTopicIndex();
      let totalSize = 0;
      let itemCount = 0;

      for (const topicName of topics) {
        const snapshots = await this.getSnapshots(topicName);
        itemCount += snapshots.length;
        
        // Estimate size
        const data = localStorage.getItem(this.getTopicKey(topicName));
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
}

