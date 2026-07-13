using KubeVisibility.Dashboard.Api.Models.Health;

namespace KubeVisibility.Dashboard.Api.Services
{
    public interface IHealthService
    {
        /// <summary>
        /// Gets overall system health overview including all components
        /// </summary>
        Task<HealthOverviewResponse> GetHealthOverviewAsync();

        /// <summary>
        /// Gets Kafka health summary only
        /// </summary>
        Task<KafkaHealthSummary> GetKafkaHealthSummaryAsync();

        /// <summary>
        /// Gets Application health summary only
        /// </summary>
        Task<ApplicationHealthSummary> GetApplicationHealthSummaryAsync();

        /// <summary>
        /// Gets detailed health information for all Kubernetes nodes
        /// </summary>
        Task<NodeHealthResponse> GetNodeHealthAsync();

        /// <summary>
        /// Gets a map of node InternalIP address to Kubernetes node name (for resolving Prometheus instance/IP to node name).
        /// </summary>
        Task<IReadOnlyDictionary<string, string>> GetNodeInternalIpToNameMapAsync();

        /// <summary>
        /// Gets health metrics for a specific node with historical data
        /// </summary>
        Task<NodeMetricsResponse> GetNodeMetricsAsync(string nodeName, DateTime? startTime, DateTime? endTime);

        /// <summary>
        /// Gets application health aggregated by namespace
        /// </summary>
        Task<ApplicationHealthResponse> GetApplicationHealthAsync();

        /// <summary>
        /// Gets health information for a specific namespace
        /// </summary>
        Task<NamespaceHealthResponse> GetNamespaceHealthAsync(string namespaceName);

        /// <summary>
        /// Gets resource summary across namespaces
        /// </summary>
        Task<ResourceSummaryResponse> GetResourceSummaryAsync();

        /// <summary>
        /// Gets health information for services (application namespaces)
        /// </summary>
        Task<ServicesHealthResponse> GetServicesHealthAsync();

        /// <summary>
        /// Gets health information for consumers (configured consumers namespace)
        /// </summary>
        Task<ConsumersHealthResponse> GetConsumersHealthAsync();

        /// <summary>
        /// Gets health information for jobs (configured jobs namespace with CronWorkflows)
        /// </summary>
        Task<JobsHealthResponse> GetJobsHealthAsync();
    }
}

