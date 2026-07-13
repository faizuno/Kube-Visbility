export interface TopicInfo {
  name: string;
  partitionCount: number;
  replicationFactor: number;
  configs: Record<string, string>;
}

export interface TopicsResponse {
  topics: TopicInfo[];
}

export enum FilterMode {
  Substring = 0,
  Regex = 1,
  Exact = 2,
  JsonPath = 3
}

export enum FilterOperator {
  And = 0,
  Or = 1
}

export interface SearchFilter {
  field: string; // "key", "value", "header:name"
  value: string;
  mode: FilterMode;
  negate: boolean;
}

export interface TimeRange {
  startTime: string; // ISO 8601 date string
  endTime: string; // ISO 8601 date string
  maxRangeDays: number;
}

export interface KafkaConfig {
  maxDaysBack: number;
  maxRangeDays: number;
  defaultRangeDays: number;
}

export interface MessageSearchRequest {
  topic: string;
  key?: string; // Deprecated - use filters instead
  value?: string; // Deprecated - use filters instead
  headers?: Record<string, string>; // Deprecated - use filters instead
  filters?: SearchFilter[];
  filterOperator?: FilterOperator;
  timeRange?: TimeRange;
  partition?: number;
  pageSize: number;
  pageNumber: number; // Deprecated - use continuationToken instead
  continuationToken?: string;
}

export interface KafkaMessage {
  key?: string;
  value: string;
  headers: Record<string, string>;
  partition: number;
  offset: number;
  timestamp: string; // ISO 8601 date string
  timestampType: string;
}

export interface MessageSearchResponse {
  messages: KafkaMessage[];
  totalCount: number;
  exactTotalCount?: number;
  hasMore: boolean;
  pageNumber: number; // Deprecated - use continuationToken instead
  pageSize: number;
  continuationToken?: string;
  previousToken?: string;
}

export interface MessageReference {
  partition: number;
  offset: number;
  messageText?: string;
}

export interface RequeueRequest {
  sourceTopic: string;
  targetTopic: string;
  messages: MessageReference[];
  preserveHeaders: boolean;
  addRequeueMetadata: boolean;
}

export interface RequeueResponse {
  requeuedCount: number;
  failedCount: number;
  errors: string[];
}

export interface ConsumerGroupInfo {
  groupId: string;
  topic: string;
  partition: number;
  currentOffset: number;
  logEndOffset: number;
  lag: number;
  clientId?: string;
  host?: string;
}

export interface ConsumerGroupResponse {
  groups: ConsumerGroupInfo[];
  topic?: string;
}

export interface ConsumerGroupDetailResponse {
  groupId: string;
  topic: string;
  partitions: ConsumerGroupInfo[];
  totalLag: number;
}

export interface ConsumerGroupSummary {
  groupId: string;
  activeConsumerCount: number;
  totalLag: number;
}

export interface ConsumerGroupSummariesResponse {
  summaries: ConsumerGroupSummary[];
}

export interface ConsumerPartitionAssignment {
  topic: string;
  partition: number;
  currentOffset: number;
  logEndOffset: number;
  lag: number;
}

export interface ConsumerMember {
  memberId: string;
  clientId?: string;
  host?: string;
  assignedPartitions: ConsumerPartitionAssignment[]; // Partitions assigned to this consumer for the current topic
}

export interface ConsumerGroupDetail {
  groupId: string;
  activeConsumerCount: number;
  totalLag: number;
  coordinator: number;
  state: string;
  topics: string[]; // Topics this consumer group is consuming from
  consumers?: ConsumerMember[]; // Active consumers in this group consuming from the current topic
}

export interface ConsumerGroupDetailsResponse {
  groups: ConsumerGroupDetail[];
  topic?: string;
}

export interface PartitionInfo {
  partitionId: number;
  replicas: number[]; // Broker IDs
  leader: number; // Leader broker ID
  isr: number[]; // In-sync replica broker IDs
  firstOffset: number;
  nextOffset: number;
  messageCount: number;
}

export interface TopicOverview {
  partitions: number;
  replicationFactor: number;
  underReplicatedPartitions: number;
  inSyncReplicas: number;
  totalInSyncReplicas: number;
  type: string;
  segmentSize: string;
  segmentCount: number;
  cleanupPolicy: string;
  messageCount: number;
}

export interface TopicPartitionsResponse {
  topicName: string;
  partitions: PartitionInfo[];
  overview: TopicOverview;
}

export interface ConsumerGroupPartitionAssociation {
  partition: number;
  currentOffset: number;
  logEndOffset: number;
  lag: number;
}

export interface ConsumerGroupTopicAssociation {
  groupId: string;
  topic: string;
  totalLag: number;
  partitions: ConsumerGroupPartitionAssociation[];
  hasActiveConsumers?: boolean; // True if group has active consumers, false if only inactive
}

export interface ConsumerGroupTopicAssociationsResponse {
  associations: ConsumerGroupTopicAssociation[];
  topic?: string;
}

// Models for streaming search with real-time progress
export interface SearchProgress {
  status: 'searching' | 'complete' | 'error';
  messages?: KafkaMessage[];
  partitionId?: number;
  partitionsScanned: number;
  totalPartitions: number;
  totalMessagesFound: number;
  totalBytes: number;
  error?: string;
}

