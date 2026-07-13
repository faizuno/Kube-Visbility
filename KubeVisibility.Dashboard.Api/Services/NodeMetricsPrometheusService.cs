using KubeVisibility.Dashboard.Api.Models.Health;

namespace KubeVisibility.Dashboard.Api.Services;

/// <summary>
/// Builds PromQL for node_exporter and maps results to node metrics DTOs. Single responsibility: node metrics from Prometheus.
/// </summary>
public sealed class NodeMetricsPrometheusService : INodeMetricsPrometheusService
{
    private readonly IPrometheusQueryService _queryService;
    private readonly ILogger<NodeMetricsPrometheusService> _logger;

    private const string NodeLabel = "node";
    private const string InstanceLabel = "instance";

    public NodeMetricsPrometheusService(
        IPrometheusQueryService queryService,
        ILogger<NodeMetricsPrometheusService> logger)
    {
        _queryService = queryService;
        _logger = logger;
    }

    public async Task<NodePrometheusMetricsCurrentResponse> GetCurrentNodeMetricsAsync(CancellationToken cancellationToken = default)
    {
        var response = new NodePrometheusMetricsCurrentResponse { Nodes = new List<NodePrometheusMetricCurrent>() };

        var cpuResult = await _queryService.QueryInstantAsync(PrometheusQueries.NodeCpuUsagePercent, cancellationToken);
        var memResult = await _queryService.QueryInstantAsync(PrometheusQueries.NodeMemoryUsagePercent, cancellationToken);
        var diskResult = await _queryService.QueryInstantAsync(PrometheusQueries.NodeDiskUsagePercent, cancellationToken);

        var nodeNames = CollectNodeNames(cpuResult, memResult, diskResult);
        if (nodeNames.Count == 0)
            return response;

        foreach (var nodeName in nodeNames.OrderBy(n => n))
        {
            var node = new NodePrometheusMetricCurrent { NodeName = nodeName };
            node.CpuUsagePercent = GetSingleValue(cpuResult, nodeName);
            node.MemoryUsagePercent = GetSingleValue(memResult, nodeName);
            node.DiskUsagePercent = GetSingleValue(diskResult, nodeName);
            response.Nodes.Add(node);
        }

        response.Timestamp = DateTime.UtcNow;
        return response;
    }

    /// <summary>
    /// Returns CPU, Memory, and Disk usage time series for historical charts.
    /// </summary>
    public async Task<List<NodePrometheusMetricsTimeSeriesResponse>> GetNodeMetricsTimeSeriesAsync(string? nodeName, DateTime start, DateTime end, string step, CancellationToken cancellationToken = default)
    {
        var list = new List<NodePrometheusMetricsTimeSeriesResponse>();

        // Run all three range queries in parallel to avoid sequential timeouts
        var cpuTask = _queryService.QueryRangeAsync(PrometheusQueries.NodeCpuUsagePercent, start, end, step, cancellationToken);
        var memTask = _queryService.QueryRangeAsync(PrometheusQueries.NodeMemoryUsagePercent, start, end, step, cancellationToken);
        var diskTask = _queryService.QueryRangeAsync(PrometheusQueries.NodeDiskUsagePercent, start, end, step, cancellationToken);

        var cpuResult = await cpuTask;
        var memResult = await memTask;
        var diskResult = await diskTask;

        if (cpuResult == null)
            _logger.LogWarning("Prometheus range query for CPU returned no data");
        if (memResult == null)
            _logger.LogWarning("Prometheus range query for Memory returned no data");
        if (diskResult == null)
            _logger.LogWarning("Prometheus range query for Disk returned no data");

        if (cpuResult == null && memResult == null && diskResult == null)
            return list;

        var nodeNames = CollectNodeNames(cpuResult, memResult, diskResult);
        if (nodeName != null)
            nodeNames = nodeNames.Where(n => string.Equals(n, nodeName, StringComparison.OrdinalIgnoreCase)).ToHashSet();

        foreach (var n in nodeNames.OrderBy(x => x))
        {
            var item = new NodePrometheusMetricsTimeSeriesResponse { NodeName = n, Series = new List<MetricSeries>() };
            AddSeries(item.Series, "Cpu", cpuResult, n);
            AddSeries(item.Series, "Memory", memResult, n);
            AddSeries(item.Series, "Disk", diskResult, n);
            list.Add(item);
        }

        return list;
    }

    private static HashSet<string> CollectNodeNames(PrometheusQueryResult? r1, PrometheusQueryResult? r2, PrometheusQueryResult? r3)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in new[] { r1, r2, r3 })
        {
            if (r == null) continue;
            foreach (var s in r.Series)
            {
                var name = GetNodeNameFromLabels(s.Labels);
                if (!string.IsNullOrEmpty(name)) set.Add(name);
            }
        }
        return set;
    }

    private static string? GetNodeNameFromLabels(Dictionary<string, string> labels)
    {
        if (labels.TryGetValue(NodeLabel, out var node) && !string.IsNullOrEmpty(node))
            return node;
        if (labels.TryGetValue(InstanceLabel, out var instance) && !string.IsNullOrEmpty(instance))
            return instance.Contains(':') ? instance[..instance.IndexOf(':')] : instance;
        return null;
    }

    private static double? GetSingleValue(PrometheusQueryResult? result, string nodeName)
    {
        if (result == null) return null;
        var series = result.Series.FirstOrDefault(s => string.Equals(GetNodeNameFromLabels(s.Labels), nodeName, StringComparison.OrdinalIgnoreCase));
        return series?.Points.Count > 0 ? series.Points[0].Value : null;
    }

    private static void AddSeries(List<MetricSeries> target, string metricType, PrometheusQueryResult? result, string nodeName)
    {
        if (result == null) return;
        var series = result.Series.FirstOrDefault(s => string.Equals(GetNodeNameFromLabels(s.Labels), nodeName, StringComparison.OrdinalIgnoreCase));
        if (series == null || series.Points.Count == 0) return;
        target.Add(new MetricSeries
        {
            MetricType = metricType,
            DataPoints = series.Points.Select(p => new MetricDataPoint { Timestamp = p.Timestamp, Value = p.Value }).ToList()
        });
    }

    private static class PrometheusQueries
    {
        // node_exporter: "instance" = "host:9100"; Prometheus Operator may add "node" = node name.
        public const string NodeCpuUsagePercent =
            "100 * (1 - sum(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) by (instance) / sum(rate(node_cpu_seconds_total[5m])) by (instance))";
        public const string NodeMemoryUsagePercent =
            "100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))";
        public const string NodeDiskUsagePercent =
            "100 * (1 - (node_filesystem_avail_bytes{mountpoint=\"/\",fstype!=\"rootfs\"} / node_filesystem_size_bytes{mountpoint=\"/\",fstype!=\"rootfs\"}))";
    }
}
