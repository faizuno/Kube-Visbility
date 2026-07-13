namespace KubeVisibility.Dashboard.Api.Models.Kafka
{
    public enum FilterMode
    {
        Substring,
        Regex,
        Exact,
        JsonPath
    }

    public enum FilterOperator
    {
        And,
        Or
    }

    public class SearchFilter
    {
        public string Field { get; set; } = string.Empty; // "key", "value", "header:name"
        public string Value { get; set; } = string.Empty;
        public FilterMode Mode { get; set; } = FilterMode.Substring;
        public bool Negate { get; set; } = false;
    }

    [Flags]
    public enum ProjectionFields
    {
        None = 0,
        Key = 1,
        Value = 2,
        Headers = 4,
        Metadata = 8, // Partition, Offset, Timestamp
        All = Key | Value | Headers | Metadata
    }

    public class ProjectionOptions
    {
        public ProjectionFields Fields { get; set; } = ProjectionFields.All;
        public int? MaxValueLength { get; set; }
    }

    public class TopicInfo
    {
        public string Name { get; set; } = string.Empty;
        public int PartitionCount { get; set; }
        public short ReplicationFactor { get; set; }
        public Dictionary<string, string> Configs { get; set; } = new();
    }

    public class TopicsResponse
    {
        public List<TopicInfo> Topics { get; set; } = new();
    }

    public class TimeRange
    {
        public DateTime StartTime { get; set; }
        public DateTime EndTime { get; set; }
        public int MaxRangeDays { get; set; } = 1;
    }

    public class KafkaConfig
    {
        public int MaxDaysBack { get; set; }
        public int MaxRangeDays { get; set; }
        public int DefaultRangeDays { get; set; }
    }

    public class SearchPosition
    {
        public int Partition { get; set; }
        public long Offset { get; set; }
    }

    public class SearchCursor
    {
        public List<SearchPosition> Positions { get; set; } = new();
        public DateTime? LastTimestamp { get; set; }
        
        public string Encode()
        {
            var json = System.Text.Json.JsonSerializer.Serialize(this);
            var bytes = System.Text.Encoding.UTF8.GetBytes(json);
            return Convert.ToBase64String(bytes);
        }

        public static SearchCursor? Decode(string token)
        {
            try
            {
                var bytes = Convert.FromBase64String(token);
                var json = System.Text.Encoding.UTF8.GetString(bytes);
                return System.Text.Json.JsonSerializer.Deserialize<SearchCursor>(json);
            }
            catch
            {
                return null;
            }
        }
    }

    public class MessageSearchRequest
    {
        public string Topic { get; set; } = string.Empty;
        public string? Key { get; set; } // Deprecated - use Filters instead
        public string? Value { get; set; } // Deprecated - use Filters instead
        public Dictionary<string, string>? Headers { get; set; } // Deprecated - use Filters instead
        public List<SearchFilter>? Filters { get; set; }
        public FilterOperator FilterOperator { get; set; } = FilterOperator.And;
        public ProjectionOptions? Projection { get; set; }
        public TimeRange? TimeRange { get; set; }
        public int? Partition { get; set; }
        public int PageSize { get; set; } = 100;
        public int PageNumber { get; set; } = 1; // Deprecated - use ContinuationToken instead
        public string? ContinuationToken { get; set; }
    }

    public class KafkaMessage
    {
        public string? Key { get; set; }
        public string Value { get; set; } = string.Empty;
        public Dictionary<string, string> Headers { get; set; } = new();
        public int Partition { get; set; }
        public long Offset { get; set; }
        public DateTime Timestamp { get; set; }
        public string TimestampType { get; set; } = string.Empty;
        public bool IsTruncated { get; set; } = false;
    }

    public class MessageSearchResponse
    {
        public List<KafkaMessage> Messages { get; set; } = new();
        public int TotalCount { get; set; }
        public int? ExactTotalCount { get; set; }
        public bool HasMore { get; set; }
        public int PageNumber { get; set; } // Deprecated - use ContinuationToken instead
        public int PageSize { get; set; }
        public string? ContinuationToken { get; set; }
        public string? PreviousToken { get; set; }
    }

    public class RequeueRequest
    {
        public string SourceTopic { get; set; } = string.Empty;
        public string TargetTopic { get; set; } = string.Empty;
        public List<MessageReference> Messages { get; set; } = new();
        public bool PreserveHeaders { get; set; } = true;
        public bool AddRequeueMetadata { get; set; } = true;
    }

    public class MessageReference
    {
        public int Partition { get; set; }
        public long Offset { get; set; }
        public string? MessageText { get; set; }
    }

    public class RequeueResponse
    {
        public int RequeuedCount { get; set; }
        public int FailedCount { get; set; }
        public List<string> Errors { get; set; } = new();
    }

    public class ConsumerGroupInfo
    {
        public string GroupId { get; set; } = string.Empty;
        public string Topic { get; set; } = string.Empty;
        public int Partition { get; set; }
        public long CurrentOffset { get; set; }
        public long LogEndOffset { get; set; }
        public long Lag { get; set; }
        public string? ClientId { get; set; }
        public string? Host { get; set; }
    }

    public class ConsumerGroupResponse
    {
        public List<ConsumerGroupInfo> Groups { get; set; } = new();
        public string? Topic { get; set; }
    }

    public class ConsumerGroupSummary
    {
        public string GroupId { get; set; } = string.Empty;
        public int ActiveConsumerCount { get; set; }
        public long TotalLag { get; set; }
    }

    public class ConsumerGroupSummariesResponse
    {
        public List<ConsumerGroupSummary> Summaries { get; set; } = new();
    }

    public class ConsumerMember
    {
        public string MemberId { get; set; } = string.Empty;
        public string? ClientId { get; set; }
        public string? Host { get; set; }
        public List<ConsumerPartitionAssignment> AssignedPartitions { get; set; } = new(); // Partitions assigned to this consumer for the current topic
    }

    public class ConsumerPartitionAssignment
    {
        public string Topic { get; set; } = string.Empty;
        public int Partition { get; set; }
        public long CurrentOffset { get; set; }
        public long LogEndOffset { get; set; }
        public long Lag { get; set; }
    }

    public class ConsumerGroupDetail
    {
        public string GroupId { get; set; } = string.Empty;
        public int ActiveConsumerCount { get; set; }
        public long TotalLag { get; set; }
        public int Coordinator { get; set; }
        public string State { get; set; } = string.Empty;
        public List<string> Topics { get; set; } = new(); // Topics this consumer group is consuming from
        public List<ConsumerMember> Consumers { get; set; } = new(); // Active consumers in this group consuming from the current topic
    }

    public class ConsumerGroupDetailsResponse
    {
        public List<ConsumerGroupDetail> Groups { get; set; } = new();
        public string? Topic { get; set; }
    }

    public class ConsumerGroupPartitionAssociation
    {
        public int Partition { get; set; }
        public long CurrentOffset { get; set; }
        public long LogEndOffset { get; set; }
        public long Lag { get; set; }
    }

    public class ConsumerGroupTopicAssociation
    {
        public string GroupId { get; set; } = string.Empty;
        public string Topic { get; set; } = string.Empty;
        public List<ConsumerGroupPartitionAssociation> Partitions { get; set; } = new();
        public long TotalLag { get; set; }
        public bool HasActiveConsumers { get; set; } = true; // True if group has active consumers, false if only inactive
    }

    public class ConsumerGroupTopicAssociationsResponse
    {
        public List<ConsumerGroupTopicAssociation> Associations { get; set; } = new();
        public string? Topic { get; set; }
    }

    public class ConsumerGroupDetailResponse
    {
        public string GroupId { get; set; } = string.Empty;
        public string Topic { get; set; } = string.Empty;
        public List<ConsumerGroupInfo> Partitions { get; set; } = new();
        public long TotalLag { get; set; }
    }

    public class PartitionInfo
    {
        public int PartitionId { get; set; }
        public List<int> Replicas { get; set; } = new();
        public int Leader { get; set; }
        public List<int> Isr { get; set; } = new();
        public long FirstOffset { get; set; }
        public long NextOffset { get; set; }
        public long MessageCount { get; set; }
    }

    public class TopicOverview
    {
        public int Partitions { get; set; }
        public short ReplicationFactor { get; set; }
        public int UnderReplicatedPartitions { get; set; }
        public int InSyncReplicas { get; set; }
        public int TotalInSyncReplicas { get; set; }
        public string Type { get; set; } = string.Empty;
        public string SegmentSize { get; set; } = string.Empty;
        public int SegmentCount { get; set; }
        public string CleanupPolicy { get; set; } = string.Empty;
        public long MessageCount { get; set; }
    }

    public class TopicPartitionsResponse
    {
        public string TopicName { get; set; } = string.Empty;
        public List<PartitionInfo> Partitions { get; set; } = new();
        public TopicOverview Overview { get; set; } = new();
    }

    // Models for streaming search with real-time progress
    public class SearchProgress
    {
        public string Status { get; set; } = "searching"; // searching, complete, error
        public List<KafkaMessage> Messages { get; set; } = new();
        public int PartitionId { get; set; }
        public int PartitionsScanned { get; set; }
        public int TotalPartitions { get; set; }
        public long TotalMessagesFound { get; set; }
        public long TotalBytes { get; set; }
        public string? Error { get; set; }
    }

    // Interface for progress reporting - follows Interface Segregation Principle
    public interface IProgressReporter
    {
        Task ReportProgressAsync(SearchProgress progress);
    }

    // Models for Consumer Group Offset Cache
    public class PartitionOffsetInfo
    {
        public int PartitionId { get; set; }
        public long LastCommittedOffset { get; set; }
    }

    public class TopicOffsetInfo
    {
        public string TopicName { get; set; } = string.Empty;
        public List<PartitionOffsetInfo> Partitions { get; set; } = new();
    }

    public class ConsumerGroupOffsetInfo
    {
        public string GroupId { get; set; } = string.Empty;
        public List<TopicOffsetInfo> Topics { get; set; } = new();
    }

    public class ConsumerGroupOffsetCache
    {
        public List<ConsumerGroupOffsetInfo> ConsumerGroups { get; set; } = new();
        public DateTime FetchedAt { get; set; }
    }
}

