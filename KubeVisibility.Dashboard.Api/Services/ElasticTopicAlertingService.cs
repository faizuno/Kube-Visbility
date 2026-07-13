using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Options;
using KubeVisibility.Dashboard.Api.Services.Shared;
using Microsoft.Extensions.Options;

namespace KubeVisibility.Dashboard.Api.Services;

public sealed class ElasticTopicAlertingService : ITopicAlertingService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    private static readonly Regex EmailRegex = new(
        @"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> AllowedTargetTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "topics",
        "group"
    };

    private static readonly HashSet<string> AllowedJoins = new(StringComparer.OrdinalIgnoreCase)
    {
        "AND",
        "OR"
    };

    private static readonly HashSet<string> AllowedFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "message",
        "exception",
        "serviceName",
        "applicationName"
    };

    private static readonly HashSet<string> AllowedOperators = new(StringComparer.OrdinalIgnoreCase)
    {
        "contains",
        "equals",
        "startsWith",
        "endsWith",
        "wildcard"
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly IOptions<TopicAlertingOptions> _topicAlertingOptions;
    private readonly ILogger<ElasticTopicAlertingService> _logger;

    public ElasticTopicAlertingService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IOptions<TopicAlertingOptions> topicAlertingOptions,
        ILogger<ElasticTopicAlertingService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _topicAlertingOptions = topicAlertingOptions;
        _logger = logger;
    }

    public Task<IReadOnlyList<TopicAlertGroup>> GetGroupsAsync(CancellationToken cancellationToken = default)
        => SearchByDocTypeAsync<TopicAlertGroup>(TopicAlertingDocTypes.Group, cancellationToken);

    public Task<IReadOnlyList<TopicAlertRule>> GetRulesAsync(CancellationToken cancellationToken = default)
        => SearchByDocTypeAsync<TopicAlertRule>(TopicAlertingDocTypes.Rule, cancellationToken);

    public Task<TopicAlertGroup?> GetGroupAsync(string groupId, CancellationToken cancellationToken = default)
        => GetByIdAsync<TopicAlertGroup>(groupId, cancellationToken);

    public Task<TopicAlertRule?> GetRuleAsync(string ruleId, CancellationToken cancellationToken = default)
        => GetByIdAsync<TopicAlertRule>(ruleId, cancellationToken);

    public async Task<TopicAlertGroup> UpsertGroupAsync(
        UpsertTopicAlertGroupRequest request,
        string actor,
        CancellationToken cancellationToken = default)
    {
        ValidateGroupRequest(request);
        var groupId = string.IsNullOrWhiteSpace(request.GroupId) ? Guid.NewGuid().ToString("N") : request.GroupId.Trim();
        var existing = await GetGroupAsync(groupId, cancellationToken);
        var normalizedTopics = NormalizeTopics(request.TopicNames);

        var entity = new TopicAlertGroup
        {
            GroupId = groupId,
            DocType = TopicAlertingDocTypes.Group,
            Name = request.Name.Trim(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            TopicNames = normalizedTopics,
            CreatedAtUtc = existing?.CreatedAtUtc ?? AlertTimeZone.EasternNow(),
            UpdatedAtUtc = AlertTimeZone.EasternNow(),
            CreatedBy = existing?.CreatedBy ?? actor,
            UpdatedBy = actor
        };

        await UpsertAsync(groupId, entity, cancellationToken);
        return entity;
    }

    public async Task<TopicAlertRule> UpsertRuleAsync(
        UpsertTopicAlertRuleRequest request,
        string actor,
        CancellationToken cancellationToken = default)
    {
        ValidateRuleRequest(request);
        var ruleId = string.IsNullOrWhiteSpace(request.RuleId) ? Guid.NewGuid().ToString("N") : request.RuleId.Trim();
        var existing = await GetRuleAsync(ruleId, cancellationToken);
        var normalizedTargetType = request.TargetType.Trim().ToLowerInvariant();
        var normalizedTopics = NormalizeTopics(request.TopicNames);
        var normalizedEmails = NormalizeEmails(request.RecipientEmailsCsv);
        var normalizedConditions = NormalizeConditions(request.Conditions);

        if (normalizedTargetType == "group")
        {
            if (string.IsNullOrWhiteSpace(request.TopicGroupId))
            {
                throw new InvalidOperationException("topicGroupId is required when targetType is group.");
            }

            var group = await GetGroupAsync(request.TopicGroupId.Trim(), cancellationToken);
            if (group == null)
            {
                throw new InvalidOperationException($"Topic group '{request.TopicGroupId}' does not exist.");
            }
        }
        else if (normalizedTopics.Count == 0)
        {
            throw new InvalidOperationException("At least one topic is required when targetType is topics.");
        }

        var entity = new TopicAlertRule
        {
            RuleId = ruleId,
            DocType = TopicAlertingDocTypes.Rule,
            Name = request.Name.Trim(),
            Enabled = request.Enabled,
            TargetType = normalizedTargetType,
            TopicNames = normalizedTargetType == "topics" ? normalizedTopics : Array.Empty<string>(),
            TopicGroupId = normalizedTargetType == "group" ? request.TopicGroupId?.Trim() : null,
            RecipientEmails = normalizedEmails,
            Conditions = normalizedConditions,
            CreatedAtUtc = existing?.CreatedAtUtc ?? AlertTimeZone.EasternNow(),
            UpdatedAtUtc = AlertTimeZone.EasternNow(),
            CreatedBy = existing?.CreatedBy ?? actor,
            UpdatedBy = actor
        };

        await UpsertAsync(ruleId, entity, cancellationToken);
        return entity;
    }

    public async Task<TopicAlertRule?> SetRuleEnabledAsync(
        string ruleId,
        bool enabled,
        string actor,
        CancellationToken cancellationToken = default)
    {
        var existing = await GetRuleAsync(ruleId, cancellationToken);
        if (existing == null)
        {
            return null;
        }

        existing.Enabled = enabled;
        existing.UpdatedBy = actor;
        existing.UpdatedAtUtc = AlertTimeZone.EasternNow();
        await UpsertAsync(ruleId, existing, cancellationToken);
        return existing;
    }

    public async Task<bool> DeleteGroupAsync(string groupId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(groupId))
        {
            return false;
        }

        var rules = await GetRulesAsync(cancellationToken);
        if (rules.Any(rule => string.Equals(rule.TopicGroupId, groupId, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("Cannot delete group because it is referenced by one or more rules.");
        }

        return await DeleteAsync(groupId.Trim(), cancellationToken);
    }

    public async Task<bool> DeleteRuleAsync(string ruleId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(ruleId))
        {
            return false;
        }

        return await DeleteAsync(ruleId.Trim(), cancellationToken);
    }

    private async Task<IReadOnlyList<T>> SearchByDocTypeAsync<T>(string docType, CancellationToken cancellationToken)
    {
        var baseUrl = ResolveElasticBaseUrl();
        var indexAlias = ResolveIndexAlias();
        var requestUrl = $"{baseUrl.TrimEnd('/')}/{indexAlias}/_search";

        var query = new
        {
            size = 5000,
            sort = new object[]
            {
                new { updatedAtUtc = new { order = "desc" } }
            },
            query = new
            {
                @bool = new
                {
                    filter = new object[]
                    {
                        new { term = new Dictionary<string, object> { ["docType.keyword"] = docType } }
                    }
                }
            }
        };

        var searchResponse = await ExecuteSearchAsync(requestUrl, query, cancellationToken);
        if (searchResponse?.Hits?.Hits == null || searchResponse.Hits.Hits.Count == 0)
        {
            return Array.Empty<T>();
        }

        var result = new List<T>(searchResponse.Hits.Hits.Count);
        foreach (var hit in searchResponse.Hits.Hits)
        {
            if (hit.Source.ValueKind == JsonValueKind.Undefined || hit.Source.ValueKind == JsonValueKind.Null)
            {
                continue;
            }

            try
            {
                var item = JsonSerializer.Deserialize<T>(hit.Source.GetRawText(), JsonOptions);
                if (item != null)
                {
                    result.Add(item);
                }
            }
            catch
            {
                // Ignore malformed documents and continue.
            }
        }

        return result;
    }

    private async Task<T?> GetByIdAsync<T>(string id, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return default;
        }

        var baseUrl = ResolveElasticBaseUrl();
        var indexAlias = ResolveIndexAlias();
        var requestUrl = $"{baseUrl.TrimEnd('/')}/{indexAlias}/_doc/{Uri.EscapeDataString(id.Trim())}";
        var client = _httpClientFactory.CreateClient("Elasticsearch");
        client.Timeout = TimeSpan.FromSeconds(15);

        using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
        ApplyAuthenticationHeader(request);
        using var response = await client.SendAsync(request, cancellationToken);

        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return default;
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogError("Failed retrieving document {Id}. Status: {StatusCode}, Response: {Body}", id, (int)response.StatusCode, body);
            return default;
        }

        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        var esDoc = JsonSerializer.Deserialize<ElasticGetDocumentResponse>(responseBody, JsonOptions);
        if (esDoc == null || !esDoc.Found || esDoc.Source.ValueKind == JsonValueKind.Null || esDoc.Source.ValueKind == JsonValueKind.Undefined)
        {
            return default;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(esDoc.Source.GetRawText(), JsonOptions);
        }
        catch
        {
            return default;
        }
    }

    private async Task UpsertAsync<T>(string id, T document, CancellationToken cancellationToken)
    {
        var baseUrl = ResolveElasticBaseUrl();
        var indexAlias = ResolveIndexAlias();
        var requestUrl = $"{baseUrl.TrimEnd('/')}/{indexAlias}/_doc/{Uri.EscapeDataString(id)}";
        var client = _httpClientFactory.CreateClient("Elasticsearch");
        client.Timeout = TimeSpan.FromSeconds(20);

        using var request = new HttpRequestMessage(HttpMethod.Put, requestUrl)
        {
            Content = new StringContent(JsonSerializer.Serialize(document, JsonOptions), Encoding.UTF8, "application/json")
        };
        ApplyAuthenticationHeader(request);

        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Elasticsearch upsert failed: {(int)response.StatusCode} {body}");
        }
    }

    private async Task<bool> DeleteAsync(string id, CancellationToken cancellationToken)
    {
        var baseUrl = ResolveElasticBaseUrl();
        var indexAlias = ResolveIndexAlias();
        var requestUrl = $"{baseUrl.TrimEnd('/')}/{indexAlias}/_doc/{Uri.EscapeDataString(id)}";
        var client = _httpClientFactory.CreateClient("Elasticsearch");
        client.Timeout = TimeSpan.FromSeconds(15);

        using var request = new HttpRequestMessage(HttpMethod.Delete, requestUrl);
        ApplyAuthenticationHeader(request);
        using var response = await client.SendAsync(request, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return false;
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Elasticsearch delete failed: {(int)response.StatusCode} {body}");
        }

        return true;
    }

    private async Task<ElasticSearchResponse?> ExecuteSearchAsync(string requestUrl, object query, CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient("Elasticsearch");
        client.Timeout = TimeSpan.FromSeconds(20);

        using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
        {
            Content = new StringContent(JsonSerializer.Serialize(query, JsonOptions), Encoding.UTF8, "application/json")
        };
        ApplyAuthenticationHeader(request);

        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogError("Elasticsearch search failed. Status: {StatusCode}, Response: {Body}", (int)response.StatusCode, body);
            return null;
        }

        var payload = await response.Content.ReadAsStringAsync(cancellationToken);
        return JsonSerializer.Deserialize<ElasticSearchResponse>(payload, JsonOptions);
    }

    private static List<string> NormalizeTopics(IReadOnlyList<string> topics)
    {
        return topics
            .Where(topic => !string.IsNullOrWhiteSpace(topic))
            .Select(topic => topic.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(topic => topic, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static List<string> NormalizeEmails(string emailsCsv)
    {
        var emails = emailsCsv
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(email => !string.IsNullOrWhiteSpace(email))
            .Select(email => email.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (emails.Count == 0)
        {
            throw new InvalidOperationException("At least one recipient email is required.");
        }

        var invalid = emails.Where(email => !EmailRegex.IsMatch(email)).ToList();
        if (invalid.Count > 0)
        {
            throw new InvalidOperationException($"Invalid recipient email(s): {string.Join(", ", invalid)}");
        }

        return emails;
    }

    private static List<TopicAlertCondition> NormalizeConditions(IReadOnlyList<TopicAlertCondition> conditions)
    {
        if (conditions == null || conditions.Count == 0)
        {
            return [];
        }

        var normalized = new List<TopicAlertCondition>(conditions.Count);
        for (var index = 0; index < conditions.Count; index++)
        {
            var condition = conditions[index];
            if (condition == null || string.IsNullOrWhiteSpace(condition.Value))
            {
                continue;
            }

            var join = string.IsNullOrWhiteSpace(condition.JoinWithPrevious) ? "AND" : condition.JoinWithPrevious.Trim().ToUpperInvariant();
            if (index == 0)
            {
                join = "AND";
            }

            if (!AllowedJoins.Contains(join))
            {
                throw new InvalidOperationException($"Invalid JoinWithPrevious '{condition.JoinWithPrevious}'. Allowed: AND, OR.");
            }

            var field = (condition.Field ?? string.Empty).Trim();
            if (!AllowedFields.Contains(field))
            {
                throw new InvalidOperationException($"Invalid condition field '{condition.Field}'.");
            }

            var op = (condition.Operator ?? string.Empty).Trim();
            if (!AllowedOperators.Contains(op))
            {
                throw new InvalidOperationException($"Invalid condition operator '{condition.Operator}'.");
            }

            normalized.Add(new TopicAlertCondition
            {
                JoinWithPrevious = join,
                Negate = condition.Negate,
                Field = field,
                Operator = op,
                Value = condition.Value.Trim()
            });
        }

        return normalized;
    }

    private static void ValidateGroupRequest(UpsertTopicAlertGroupRequest request)
    {
        if (request == null)
        {
            throw new InvalidOperationException("Request is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new InvalidOperationException("Group name is required.");
        }

        var normalizedTopics = NormalizeTopics(request.TopicNames);
        if (normalizedTopics.Count == 0)
        {
            throw new InvalidOperationException("At least one topic is required in a group.");
        }
    }

    private static void ValidateRuleRequest(UpsertTopicAlertRuleRequest request)
    {
        if (request == null)
        {
            throw new InvalidOperationException("Request is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new InvalidOperationException("Rule name is required.");
        }

        if (string.IsNullOrWhiteSpace(request.TargetType) || !AllowedTargetTypes.Contains(request.TargetType.Trim()))
        {
            throw new InvalidOperationException("TargetType must be either 'topics' or 'group'.");
        }

        _ = NormalizeEmails(request.RecipientEmailsCsv);
        _ = NormalizeConditions(request.Conditions);
    }

    private string ResolveElasticBaseUrl()
    {
        var baseUrl = _configuration["Elasticsearch:Url"];
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            throw new InvalidOperationException("Elasticsearch:Url is not configured.");
        }

        return baseUrl;
    }

    private string ResolveIndexAlias()
    {
        return string.IsNullOrWhiteSpace(_topicAlertingOptions.Value.ElasticIndexAlias)
            ? "kube-topic-alert-config"
            : _topicAlertingOptions.Value.ElasticIndexAlias;
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

    private sealed class ElasticSearchResponse
    {
        [JsonPropertyName("hits")]
        public ElasticSearchHits? Hits { get; set; }
    }

    private sealed class ElasticSearchHits
    {
        [JsonPropertyName("hits")]
        public List<ElasticSearchHit> Hits { get; set; } = [];
    }

    private sealed class ElasticSearchHit
    {
        [JsonPropertyName("_source")]
        public JsonElement Source { get; set; }
    }

    private sealed class ElasticGetDocumentResponse
    {
        [JsonPropertyName("found")]
        public bool Found { get; set; }

        [JsonPropertyName("_source")]
        public JsonElement Source { get; set; }
    }
}
