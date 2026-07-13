using KubeVisibility.Dashboard.Api.Models.Health;

namespace KubeVisibility.Dashboard.Api.Services;

/// <summary>
/// Provides node metrics from Prometheus (node_exporter). Depends only on IPrometheusQueryService.
/// </summary>
public interface INodeMetricsPrometheusService
{
    /// <summary>
    /// Gets current CPU, memory, and optional disk usage per node.
    /// </summary>
    Task<NodePrometheusMetricsCurrentResponse> GetCurrentNodeMetricsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets time series for one node (or all nodes if nodeName is null) for CPU and memory.
    /// Returns one item per node.
    /// </summary>
    Task<List<NodePrometheusMetricsTimeSeriesResponse>> GetNodeMetricsTimeSeriesAsync(string? nodeName, DateTime start, DateTime end, string step, CancellationToken cancellationToken = default);
}
