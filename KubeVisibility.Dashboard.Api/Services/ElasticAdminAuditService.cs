using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Options;
using Microsoft.Extensions.Options;

namespace KubeVisibility.Dashboard.Api.Services;

/// <summary>
/// Stores and queries admin audit events from Elasticsearch.
/// </summary>
public sealed class ElasticAdminAuditService : IAdminAuditService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly IOptions<AdminAuditOptions> _options;
    private readonly ILogger<ElasticAdminAuditService> _logger;

    public ElasticAdminAuditService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IOptions<AdminAuditOptions> options,
        ILogger<ElasticAdminAuditService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _options = options;
        _logger = logger;
    }

    public async Task WriteEventAsync(AdminAuditEvent auditEvent, CancellationToken cancellationToken = default)
    {
        if (!_options.Value.Enabled)
        {
            return;
        }

        var baseUrl = _configuration["Elasticsearch:Url"];
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            _logger.LogWarning("Admin auditing is enabled but Elasticsearch:Url is not configured.");
            return;
        }

        var indexAlias = ResolveIndexAlias();
        var encodedId = Uri.EscapeDataString(auditEvent.EventId);
        var requestUrl = $"{baseUrl.TrimEnd('/')}/{indexAlias}/_doc/{encodedId}";

        try
        {
            var httpClient = _httpClientFactory.CreateClient("Elasticsearch");
            httpClient.Timeout = TimeSpan.FromSeconds(15);

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(auditEvent, JsonOptions),
                    Encoding.UTF8,
                    "application/json")
            };

            ApplyAuthenticationHeader(request);

            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogError(
                    "Failed writing admin audit event to Elasticsearch. Status: {StatusCode}, Response: {ResponseBody}",
                    (int)response.StatusCode,
                    body);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed writing admin audit event to Elasticsearch");
        }
    }

    public async Task<IReadOnlyList<AdminAuditEvent>> ReadEventsAsync(
        DateTime startUtc,
        DateTime endUtc,
        int limit = 500,
        string? user = null,
        string? actor = null,
        string? actorEmail = null,
        IReadOnlyList<string>? namespaces = null,
        string? action = null,
        string? resourceName = null,
        CancellationToken cancellationToken = default)
    {
        if (endUtc < startUtc)
        {
            return Array.Empty<AdminAuditEvent>();
        }

        var baseUrl = _configuration["Elasticsearch:Url"];
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            _logger.LogWarning("Admin auditing is enabled but Elasticsearch:Url is not configured.");
            return Array.Empty<AdminAuditEvent>();
        }

        var effectiveLimit = limit <= 0 ? 500 : Math.Min(limit, 5000);
        var indexAlias = ResolveIndexAlias();
        var requestUrl = $"{baseUrl.TrimEnd('/')}/{indexAlias}/_search";

        var filters = new List<object>
        {
            new
            {
                range = new
                {
                    timestampUtc = new
                    {
                        gte = startUtc.ToString("O"),
                        lte = endUtc.ToString("O")
                    }
                }
            }
        };

        AddUserWildcardFilter(filters, user);
        AddWildcardFilter(filters, "actor.keyword", actor);
        AddWildcardFilter(filters, "actorEmail.keyword", actorEmail);
        AddNamespaceTermsFilter(filters, namespaces);
        AddWildcardFilter(filters, "action.keyword", action);
        AddWildcardFilter(filters, "resourceName.keyword", resourceName);

        var query = new Dictionary<string, object>
        {
            ["size"] = effectiveLimit,
            ["sort"] = new object[]
            {
                new { timestampUtc = new { order = "desc" } }
            },
            ["query"] = new
            {
                @bool = new
                {
                    filter = filters
                }
            }
        };

        try
        {
            var httpClient = _httpClientFactory.CreateClient("Elasticsearch");
            httpClient.Timeout = TimeSpan.FromSeconds(20);

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(query),
                    Encoding.UTF8,
                    "application/json")
            };

            ApplyAuthenticationHeader(request);

            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogError(
                    "Failed reading admin audit events from Elasticsearch. Status: {StatusCode}, Response: {ResponseBody}",
                    (int)response.StatusCode,
                    body);
                return Array.Empty<AdminAuditEvent>();
            }

            var responseContent = await response.Content.ReadAsStringAsync(cancellationToken);
            var searchResponse = JsonSerializer.Deserialize<AdminAuditSearchResponse>(responseContent, JsonOptions);
            if (searchResponse?.Hits?.Hits == null || searchResponse.Hits.Hits.Count == 0)
            {
                return Array.Empty<AdminAuditEvent>();
            }

            var result = new List<AdminAuditEvent>(searchResponse.Hits.Hits.Count);
            foreach (var hit in searchResponse.Hits.Hits)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (hit.Source.ValueKind == JsonValueKind.Undefined || hit.Source.ValueKind == JsonValueKind.Null)
                {
                    continue;
                }

                AdminAuditEvent? entry;
                try
                {
                    entry = JsonSerializer.Deserialize<AdminAuditEvent>(hit.Source.GetRawText(), JsonOptions);
                }
                catch
                {
                    continue;
                }

                if (entry == null)
                {
                    continue;
                }

                result.Add(entry);
            }

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed reading admin audit events from Elasticsearch");
            return Array.Empty<AdminAuditEvent>();
        }
    }

    private string ResolveIndexAlias()
    {
        var configuredAlias = _options.Value.ElasticIndexAlias;
        return string.IsNullOrWhiteSpace(configuredAlias) ? "kube-admin-audit" : configuredAlias;
    }

    private static void AddWildcardFilter(List<object> filters, string fieldName, string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return;
        }

        var escapedValue = EscapeWildcardValue(value.Trim());
        filters.Add(new
        {
            wildcard = new Dictionary<string, object>
            {
                [fieldName] = new
                {
                    value = $"*{escapedValue}*",
                    case_insensitive = true
                }
            }
        });
    }

    private static void AddUserWildcardFilter(List<object> filters, string? user)
    {
        if (string.IsNullOrWhiteSpace(user))
        {
            return;
        }

        var escapedValue = EscapeWildcardValue(user.Trim());
        filters.Add(new
        {
            @bool = new
            {
                should = new object[]
                {
                    new
                    {
                        wildcard = new Dictionary<string, object>
                        {
                            ["actor.keyword"] = new
                            {
                                value = $"*{escapedValue}*",
                                case_insensitive = true
                            }
                        }
                    },
                    new
                    {
                        wildcard = new Dictionary<string, object>
                        {
                            ["actorEmail.keyword"] = new
                            {
                                value = $"*{escapedValue}*",
                                case_insensitive = true
                            }
                        }
                    }
                },
                minimum_should_match = 1
            }
        });
    }

    private static void AddNamespaceTermsFilter(List<object> filters, IReadOnlyList<string>? namespaces)
    {
        if (namespaces == null || namespaces.Count == 0)
        {
            return;
        }

        var values = namespaces
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (values.Length == 0)
        {
            return;
        }

        filters.Add(new
        {
            terms = new Dictionary<string, object>
            {
                ["namespace.keyword"] = values
            }
        });
    }

    private static string EscapeWildcardValue(string value)
    {
        return value
            .Replace(@"\", @"\\", StringComparison.Ordinal)
            .Replace("*", "\\*", StringComparison.Ordinal)
            .Replace("?", "\\?", StringComparison.Ordinal);
    }

    private void ApplyAuthenticationHeader(HttpRequestMessage request)
    {
        var apiKey = Environment.GetEnvironmentVariable("Elasticsearch__Key")
            ?? _configuration["Elasticsearch:ApiKey"];
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("ApiKey", apiKey);
            return;
        }

        var username = Environment.GetEnvironmentVariable("ELASTIC_USER")
            ?? _configuration["Elasticsearch:Username"];
        var password = Environment.GetEnvironmentVariable("ELASTIC_PASSWORD")
            ?? _configuration["Elasticsearch:Password"];

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            return;
        }

        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
    }

    private sealed class AdminAuditSearchResponse
    {
        public AdminAuditSearchHits? Hits { get; set; }
    }

    private sealed class AdminAuditSearchHits
    {
        public List<AdminAuditSearchHit> Hits { get; set; } = [];
    }

    private sealed class AdminAuditSearchHit
    {
        [JsonPropertyName("_source")]
        public JsonElement Source { get; set; }
    }
}
