using KubeVisibility.Dashboard.Api.Models.Kafka;
using KubeVisibility.Dashboard.Api.Models.Health;

namespace KubeVisibility.Dashboard.Api.Services.Kafka
{
    public interface IKafkaService
    {
        Task<List<TopicInfo>> GetTopicsAsync();
        Task<TopicInfo?> GetTopicInfoAsync(string topicName);
        Task<MessageSearchResponse> SearchMessagesAsync(MessageSearchRequest request);
        Task<int> GetMessageCountAsync(MessageSearchRequest request);
        Task SearchMessagesStreamAsync(MessageSearchRequest request, IProgressReporter progressReporter, CancellationToken cancellationToken = default);
        Task<KafkaMessage?> GetMessageByOffsetAsync(string topic, int partition, long offset);
        Task<RequeueResponse> RequeueMessagesAsync(RequeueRequest request);
        Task<ConsumerGroupResponse> GetConsumerGroupsAsync(string? topicName = null);
        Task<ConsumerGroupTopicAssociationsResponse> GetConsumerGroupTopicAssociationsAsync(string? topicName = null);
        Task<ConsumerGroupDetailResponse> GetConsumerGroupInfoAsync(string groupId, string topic);
        Task<TopicPartitionsResponse> GetTopicPartitionsAsync(string topicName);
        Task<ConsumerGroupSummariesResponse> GetConsumerGroupSummariesAsync();
        Task<ConsumerGroupDetailsResponse> GetConsumerGroupDetailsAsync(string topicName);
        Task<ConsumerGroupDetailsResponse> GetAllConsumerGroupDetailsAsync();
        Task<ConsumerGroupDetailsResponse> GetConsumerGroupDetailsByIdAsync(string groupId);
        
        // Health monitoring methods
        Task<KafkaClusterHealthResponse> GetClusterHealthAsync();
        Task<KafkaBrokerHealthResponse> GetBrokerHealthAsync();
        Task<TopicHealthSummaryResponse> GetTopicHealthSummaryAsync();
        Task<ConsumerLagSummaryResponse> GetConsumerLagSummaryAsync(string[]? topicNames = null);
        
        // Configuration methods
        KafkaConfig GetKafkaConfig();
    }
}

