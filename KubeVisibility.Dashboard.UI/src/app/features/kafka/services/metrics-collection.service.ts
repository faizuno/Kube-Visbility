import { Injectable, inject, signal } from '@angular/core';
import { KafkaService } from '../../../core/services/api/kafka.service';
import {
  AggregatedMetricsSnapshot,
  TopicMetrics,
  ConsumerGroupMetrics,
  PartitionMetrics,
  MetricsCollectionConfig,
} from '../models/metrics.models';
import { ConsumerGroupInfo, TopicPartitionsResponse, ConsumerGroupDetailsResponse } from '../../../core/models/kafka.models';

/**
 * Service responsible for collecting metrics from Kafka API
 * Following Single Responsibility Principle - only collects data, doesn't store or compute
 */
@Injectable({
  providedIn: 'root',
})
export class MetricsCollectionService {
  private kafkaService = inject(KafkaService);
  private isCollecting = signal(false);
  private collectionInterval?: number;

  /**
   * Collect a complete snapshot of metrics for a topic
   */
  async collectSnapshot(topicName: string): Promise<AggregatedMetricsSnapshot> {
    const timestamp = Date.now();

    try {
      // Fetch all data in parallel for efficiency
      const [partitionsResponse, consumerGroupsResponse, consumerGroupDetails] =
        await Promise.all([
          this.kafkaService.getTopicPartitions(topicName).toPromise() as Promise<TopicPartitionsResponse | undefined>,
          this.kafkaService.getConsumerGroups(topicName).toPromise(),
          this.kafkaService.getConsumerGroupDetails(topicName).toPromise() as Promise<ConsumerGroupDetailsResponse | undefined>,
        ]);

      // Build topic metrics
      const topicMetrics: TopicMetrics = {
        timestamp,
        topicName,
        messageCount: partitionsResponse?.overview.messageCount || 0,
        partitionCount: partitionsResponse?.overview.partitions || 0,
        underReplicatedPartitions:
          partitionsResponse?.overview.underReplicatedPartitions || 0,
        averageMessagesPerPartition:
          (partitionsResponse?.overview.messageCount || 0) /
            (partitionsResponse?.overview.partitions || 1),
      };

      // Build consumer group metrics
      const consumerGroupMetrics: ConsumerGroupMetrics[] =
        consumerGroupDetails?.groups.map((group: { groupId: string; totalLag: number; activeConsumerCount: number }) => ({
          timestamp,
          topicName,
          groupId: group.groupId,
          totalLag: group.totalLag,
          activeConsumers: group.activeConsumerCount,
          partitionCount: consumerGroupsResponse?.groups.filter(
            (g: ConsumerGroupInfo) => g.groupId === group.groupId
          ).length || 0,
        })) || [];

      // Build partition metrics
      const partitionMetrics: PartitionMetrics[] =
        partitionsResponse?.partitions.map((partition: { partitionId: number; messageCount: number; firstOffset: number; nextOffset: number; leader: number }) => ({
          timestamp,
          topicName,
          partitionId: partition.partitionId,
          messageCount: partition.messageCount,
          firstOffset: partition.firstOffset,
          nextOffset: partition.nextOffset,
          leader: partition.leader,
        })) || [];

      return {
        timestamp,
        topicName,
        topicMetrics,
        consumerGroupMetrics,
        partitionMetrics,
      };
    } catch (error) {
      console.error('Error collecting metrics snapshot:', error);
      throw new Error('Failed to collect metrics snapshot');
    }
  }

  /**
   * Start automatic collection at specified interval
   */
  startAutoCollection(
    config: MetricsCollectionConfig,
    onSnapshot: (snapshot: AggregatedMetricsSnapshot) => void,
    onError: (error: Error) => void
  ): void {
    if (this.isCollecting()) {
      console.warn('Collection already in progress');
      return;
    }

    this.isCollecting.set(true);

    // Collect immediately
    this.collectSnapshot(config.topicName)
      .then(onSnapshot)
      .catch(onError);

    // Then collect at intervals
    this.collectionInterval = window.setInterval(async () => {
      try {
        const snapshot = await this.collectSnapshot(config.topicName);
        onSnapshot(snapshot);
      } catch (error) {
        onError(error as Error);
      }
    }, config.collectionIntervalMs);
  }

  /**
   * Stop automatic collection
   */
  stopAutoCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = undefined;
    }
    this.isCollecting.set(false);
  }

  /**
   * Check if collection is currently active
   */
  isCurrentlyCollecting(): boolean {
    return this.isCollecting();
  }
}

