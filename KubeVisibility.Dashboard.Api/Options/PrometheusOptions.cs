namespace KubeVisibility.Dashboard.Api.Options;

/// <summary>
/// Configuration for Prometheus server used for node and cluster metrics.
/// </summary>
public class PrometheusOptions
{
    public const string SectionName = "Prometheus";

    /// <summary>
    /// Prometheus base URL (e.g. http://prometheus-kube-prometheus-prometheus.monitoring:9090).
    /// </summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// Request timeout in seconds. Default 10.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 10;

    /// <summary>
    /// When false, Prometheus-backed node metrics endpoints return empty or disabled response.
    /// </summary>
    public bool Enabled { get; set; } = true;
}
