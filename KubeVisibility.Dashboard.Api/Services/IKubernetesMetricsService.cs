using KubeVisibility.Dashboard.Api.Models.Health;

namespace KubeVisibility.Dashboard.Api.Services
{
    public interface IKubernetesMetricsService
    {
        /// <summary>
        /// Gets metrics for all nodes in the cluster from the Metrics Server API
        /// </summary>
        Task<List<Models.Health.NodeMetrics>> GetAllNodesMetricsAsync();

        /// <summary>
        /// Gets metrics for a specific node from the Metrics Server API
        /// </summary>
        Task<Models.Health.NodeMetrics?> GetNodeMetricsAsync(string nodeName);

        /// <summary>
        /// Gets pod metrics for a specific namespace
        /// </summary>
        Task<Dictionary<string, PodMetrics>> GetPodMetricsAsync(string namespaceName);

        /// <summary>
        /// Gets pod metrics for a specific pod
        /// </summary>
        Task<PodMetrics?> GetPodMetricsByNameAsync(string namespaceName, string podName);
    }

    public class PodMetrics
    {
        public string PodName { get; set; } = string.Empty;
        public string NamespaceName { get; set; } = string.Empty;
        public string CpuUsage { get; set; } = string.Empty;
        public string MemoryUsage { get; set; } = string.Empty;
        public DateTime Timestamp { get; set; }
    }
}

