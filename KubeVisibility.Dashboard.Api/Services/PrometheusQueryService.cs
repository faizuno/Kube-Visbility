using System.Text.Json;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Options;
using Microsoft.Extensions.Options;

namespace KubeVisibility.Dashboard.Api.Services;

/// <summary>
/// Executes PromQL via Prometheus HTTP API. Uses configured base URL and timeout.
/// </summary>
public sealed class PrometheusQueryService : IPrometheusQueryService
{
    public const string HttpClientName = "Prometheus";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PrometheusOptions _options;
    private readonly ILogger<PrometheusQueryService> _logger;

    public PrometheusQueryService(
        IHttpClientFactory httpClientFactory,
        IOptions<PrometheusOptions> options,
        ILogger<PrometheusQueryService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<PrometheusQueryResult?> QueryInstantAsync(string query, CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled || string.IsNullOrWhiteSpace(_options.Url))
            return null;

        var baseUrl = _options.Url.TrimEnd('/');
        var encoded = Uri.EscapeDataString(query);
        var url = $"{baseUrl}/api/v1/query?query={encoded}";

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

            var client = _httpClientFactory.CreateClient(HttpClientName);
            var response = await client.GetAsync(url, cts.Token);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync(cts.Token);
            return ParseResponse(json, instant: true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Prometheus instant query failed: {Query}", query);
            return null;
        }
    }

    public async Task<PrometheusQueryResult?> QueryRangeAsync(string query, DateTime start, DateTime end, string step, CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled || string.IsNullOrWhiteSpace(_options.Url))
            return null;

        var baseUrl = _options.Url.TrimEnd('/');
        var encoded = Uri.EscapeDataString(query);
        var startSec = ToUnixSeconds(start);
        var endSec = ToUnixSeconds(end);
        var url = $"{baseUrl}/api/v1/query_range?query={encoded}&start={startSec}&end={endSec}&step={Uri.EscapeDataString(step)}";

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

            var client = _httpClientFactory.CreateClient(HttpClientName);
            var response = await client.GetAsync(url, cts.Token);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync(cts.Token);
            return ParseResponse(json, instant: false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Prometheus range query failed: {Query}", query);
            return null;
        }
    }

    private static long ToUnixSeconds(DateTime dt)
    {
        return new DateTimeOffset(dt.ToUniversalTime()).ToUnixTimeSeconds();
    }

    private static PrometheusQueryResult? ParseResponse(string json, bool instant)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("status", out var status) && status.GetString() != "success")
                return null;
            if (!root.TryGetProperty("data", out var data) || !data.TryGetProperty("result", out var result))
                return null;

            var list = new List<PrometheusSeries>();
            foreach (var item in result.EnumerateArray())
            {
                var labels = new Dictionary<string, string>();
                if (item.TryGetProperty("metric", out var metric))
                {
                    foreach (var prop in metric.EnumerateObject())
                        labels[prop.Name] = prop.Value.GetString() ?? string.Empty;
                }

                var points = new List<(DateTime, double)>();

                if (instant && item.TryGetProperty("value", out var valueEl))
                {
                    if (ParseValueElement(valueEl, out var ts, out var val))
                        points.Add((ts, val));
                }
                else if (!instant && item.TryGetProperty("values", out var valuesEl))
                {
                    foreach (var v in valuesEl.EnumerateArray())
                    {
                        if (ParseValueElement(v, out var ts, out var val))
                            points.Add((ts, val));
                    }
                }

                list.Add(new PrometheusSeries { Labels = labels, Points = points });
            }

            return new PrometheusQueryResult { Series = list };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Parse [unix_ts, value] array from Prometheus. Timestamp may be int or float; value may be string or number.</summary>
    private static bool ParseValueElement(JsonElement el, out DateTime timestamp, out double value)
    {
        timestamp = default;
        value = 0;
        if (el.ValueKind != JsonValueKind.Array) return false;
        var arr = el.EnumerateArray().ToList();
        if (arr.Count < 2) return false;

        long unixSec = 0;
        if (arr[0].ValueKind == JsonValueKind.Number)
        {
            if (arr[0].TryGetInt64(out unixSec)) { }
            else if (arr[0].TryGetDouble(out var unixDouble))
                unixSec = (long)unixDouble;
            else
                return false;
        }
        else if (arr[0].ValueKind == JsonValueKind.String)
        {
            if (!long.TryParse(arr[0].GetString(), out unixSec))
                return false;
        }
        else
            return false;

        timestamp = DateTimeOffset.FromUnixTimeSeconds(unixSec).UtcDateTime;

        if (arr[1].ValueKind == JsonValueKind.Number)
            return arr[1].TryGetDouble(out value);
        var valStr = arr[1].GetString();
        return !string.IsNullOrEmpty(valStr) && double.TryParse(valStr, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value);
    }
}
