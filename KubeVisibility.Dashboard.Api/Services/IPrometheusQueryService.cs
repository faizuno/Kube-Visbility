namespace KubeVisibility.Dashboard.Api.Services;

/// <summary>
/// Executes PromQL queries against Prometheus. Single responsibility: run query, return parsed result.
/// </summary>
public interface IPrometheusQueryService
{
    /// <summary>
    /// Runs an instant query at the current time.
    /// </summary>
    /// <param name="query">PromQL expression</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Series with one value per metric (labels + value), or null if disabled/failed</returns>
    Task<PrometheusQueryResult?> QueryInstantAsync(string query, CancellationToken cancellationToken = default);

    /// <summary>
    /// Runs a range query.
    /// </summary>
    /// <param name="query">PromQL expression</param>
    /// <param name="start">Range start (UTC)</param>
    /// <param name="end">Range end (UTC)</param>
    /// <param name="step">Step duration (e.g. "60s")</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Series with values per metric over time, or null if disabled/failed</returns>
    Task<PrometheusQueryResult?> QueryRangeAsync(string query, DateTime start, DateTime end, string step, CancellationToken cancellationToken = default);
}

/// <summary>
/// Parsed result: list of series, each with labels and one value (instant) or many (range).
/// </summary>
public sealed class PrometheusQueryResult
{
    public List<PrometheusSeries> Series { get; set; } = new();
}

public sealed class PrometheusSeries
{
    public Dictionary<string, string> Labels { get; set; } = new();
    /// <summary>Instant: one element. Range: multiple [timestamp, value]</summary>
    public List<(DateTime Timestamp, double Value)> Points { get; set; } = new();
}
