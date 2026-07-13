using KubeVisibility.Dashboard.Api.Models.Kafka;

namespace KubeVisibility.Dashboard.Api.Services.Kafka
{
    /// <summary>
    /// Service for caching consumer group offsets per HTTP request.
    /// Scoped service - one instance per request, caches data for the duration of the request.
    /// </summary>
    public interface IConsumerGroupOffsetCacheService
    {
        /// <summary>
        /// Gets or fetches offsets for ALL consumer groups across ALL topics.
        /// Use this for reports and comprehensive views.
        /// </summary>
        Task<ConsumerGroupOffsetCache> GetOrFetchAllConsumerGroupOffsetsAsync();
        
        /// <summary>
        /// Gets or fetches offsets for ALL consumer groups for a SPECIFIC topic.
        /// Use this for consumer tab refresh (faster, more efficient).
        /// </summary>
        Task<ConsumerGroupOffsetCache> GetOrFetchConsumerGroupOffsetsForTopicAsync(string topicName);
        
        /// <summary>
        /// Clears the cache (useful for manual cache invalidation if needed).
        /// </summary>
        void ClearCache();
    }
}

