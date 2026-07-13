using System.Text.Json.Serialization;

namespace KubeVisibility.Dashboard.Api.Models;

/// <summary>
/// Minimal DTOs for Prometheus HTTP API responses. Used only by the query service.
/// </summary>
public sealed class PrometheusQueryResponse
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("data")]
    public PrometheusData? Data { get; set; }
}

public sealed class PrometheusData
{
    [JsonPropertyName("resultType")]
    public string ResultType { get; set; } = string.Empty;

    [JsonPropertyName("result")]
    public List<PrometheusResult> Result { get; set; } = new();
}

public sealed class PrometheusResult
{
    [JsonPropertyName("metric")]
    public Dictionary<string, string> Metric { get; set; } = new();

    /// <summary>Instant query: single [timestamp, value]</summary>
    [JsonPropertyName("value")]
    public object? Value { get; set; }

    /// <summary>Range query: list of [timestamp, value]</summary>
    [JsonPropertyName("values")]
    public List<object>? Values { get; set; }
}
