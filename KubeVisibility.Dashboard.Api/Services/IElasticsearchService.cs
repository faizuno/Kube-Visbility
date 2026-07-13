using System.Text.Json;
using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services
{
    public interface IElasticsearchService
    {
        /// <summary>
        /// Gets logs from Elasticsearch matching the specified criteria
        /// </summary>
        Task<ElasticsearchLogsResponse> GetLogsAsync(ElasticsearchLogsRequest request);

        /// <summary>
        /// Gets error analytics grouped by error message for the specified time range
        /// </summary>
        Task<ErrorAnalyticsResponse> GetErrorAnalyticsAsync(
            string? serviceName,
            DateTime timeFrom,
            DateTime timeTo,
            int minCount);

        /// <summary>
        /// Finds similar errors to the given error message
        /// </summary>
        Task<SimilarErrorsResponse> GetSimilarErrorsAsync(
            string serviceName,
            string errorMessage,
            DateTime timeFrom,
            DateTime timeTo,
            int maxResults,
            bool strictPattern = false,
            bool includeAllServices = false);

        /// <summary>
        /// Gets error logs that contain topic information
        /// </summary>
        Task<TopicErrorsResponse> GetTopicErrorsAsync(TopicErrorsRequest request);

        /// <summary>
        /// Ingests topic error events and applies dedupe-window tracking in Elasticsearch
        /// </summary>
        Task<TopicErrorEventsIngestResponse> IngestTopicErrorEventsAsync(
            TopicErrorEventsIngestRequest request,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Ingests OTLP /v1/logs payload and applies topic-error dedupe-window tracking.
        /// </summary>
        Task<TopicErrorEventsIngestResponse> IngestOtlpTopicErrorLogsAsync(
            JsonElement otlpPayload,
            CancellationToken cancellationToken = default);
    }
}

