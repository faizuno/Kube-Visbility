using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Net.Http.Json;
using System.IO.Compression;
using KubeVisibility.Dashboard.Api.Models.PrometheusAlerts;
using KubeVisibility.Dashboard.Api.Options;
using KubeVisibility.Dashboard.Api.Services.Shared;
using k8s;
using k8s.Models;
using Microsoft.Extensions.Options;
using YamlDotNet.Serialization;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class PrometheusAlertService : IPrometheusAlertService
    {
        private static readonly JsonSerializerOptions SerializerOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        private readonly IKubernetes _kubernetesClient;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IPrometheusQueryService _prometheusQueryService;
        private readonly PrometheusAlertingOptions _options;
        private readonly ILogger<PrometheusAlertService> _logger;
        private const string PrometheusRuleGroup = "monitoring.coreos.com";
        private const string PrometheusRuleVersion = "v1";
        private const string PrometheusRulePlural = "prometheusrules";
        private const string AlertmanagerConfigGroup = "monitoring.coreos.com";
        private const string AlertmanagerConfigVersion = "v1alpha1";
        private const string AlertmanagerConfigPlural = "alertmanagerconfigs";
        private const string DashboardManagedLabelValue = "kube-dashboard";
        private readonly string _dashboardManagedLabelKey;
        private readonly string _componentLabelKey;
        private readonly string _purposeAnnotationKey;

        public PrometheusAlertService(
            IKubernetesClientFactory kubernetesClientFactory,
            IHttpClientFactory httpClientFactory,
            IPrometheusQueryService prometheusQueryService,
            IOptions<PrometheusAlertingOptions> options,
            IConfiguration configuration,
            ILogger<PrometheusAlertService> logger)
        {
            _kubernetesClient = kubernetesClientFactory.CreateClient();
            _httpClientFactory = httpClientFactory;
            _prometheusQueryService = prometheusQueryService;
            _options = options.Value;
            _logger = logger;
            var labelPrefix = KubernetesInfoConfiguration.GetManagedLabelPrefix(configuration);
            _dashboardManagedLabelKey = $"{labelPrefix}/managed-by";
            _componentLabelKey = $"{labelPrefix}/component";
            _purposeAnnotationKey = $"{labelPrefix}/purpose";
        }

        public async Task<IReadOnlyList<PrometheusFiringAlert>> GetFiringAlertsAsync(
            int? rangeHours = null,
            CancellationToken cancellationToken = default)
        {
            var effectiveRangeHours = NormalizeRangeHours(rangeHours);
            return await QueryHistoricalAlertsAsync(effectiveRangeHours, cancellationToken);
        }

        public async Task<PrometheusFiringAlertsPage> SearchFiringAlertsAsync(
            PrometheusFiringAlertsQuery query,
            CancellationToken cancellationToken = default)
        {
            var effectiveLimit = query.Limit <= 0 ? 50 : Math.Min(query.Limit, 200);
            var effectiveOffset = query.Offset < 0 ? 0 : query.Offset;
            var effectiveRangeHours = NormalizeRangeHours(query.RangeHours);
            var alerts = await GetFiringAlertsAsync(effectiveRangeHours, cancellationToken);

            var filtered = alerts
                .Where(a => string.IsNullOrWhiteSpace(query.Severity) ||
                            a.Severity.Equals(query.Severity.Trim(), StringComparison.OrdinalIgnoreCase))
                .Where(a => string.IsNullOrWhiteSpace(query.NamespaceName) ||
                            (a.NamespaceName ?? string.Empty).Equals(query.NamespaceName.Trim(), StringComparison.OrdinalIgnoreCase))
                .Where(a => string.IsNullOrWhiteSpace(query.AlertName) ||
                            a.AlertName.Equals(query.AlertName.Trim(), StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(a => a.StartsAt)
                .ToList();

            return new PrometheusFiringAlertsPage
            {
                Total = filtered.Count,
                Limit = effectiveLimit,
                Offset = effectiveOffset,
                Items = filtered.Skip(effectiveOffset).Take(effectiveLimit).ToList()
            };
        }

        public async Task<PrometheusAlertStats> GetFiringAlertStatsAsync(
            int? rangeHours = null,
            CancellationToken cancellationToken = default)
        {
            var alerts = await GetFiringAlertsAsync(rangeHours, cancellationToken);

            var stats = new PrometheusAlertStats
            {
                TotalFiring = alerts.Count,
                BySeverity = alerts
                    .GroupBy(a => string.IsNullOrWhiteSpace(a.Severity) ? "unknown" : a.Severity.Trim().ToLowerInvariant())
                    .OrderByDescending(g => g.Count())
                    .ToDictionary(g => g.Key, g => g.Count()),
                ByAlertName = alerts
                    .GroupBy(a => string.IsNullOrWhiteSpace(a.AlertName) ? "unknown" : a.AlertName.Trim())
                    .OrderByDescending(g => g.Count())
                    .Take(10)
                    .ToDictionary(g => g.Key, g => g.Count()),
                ByNamespace = alerts
                    .GroupBy(a => string.IsNullOrWhiteSpace(a.NamespaceName) ? "unknown" : a.NamespaceName.Trim())
                    .OrderByDescending(g => g.Count())
                    .Take(10)
                    .ToDictionary(g => g.Key, g => g.Count()),
                LastUpdatedUtc = AlertTimeZone.EasternNow()
            };

            return stats;
        }

        public async Task<PrometheusSuppression> SuppressAlertAsync(
            SuppressPrometheusAlertRequest request,
            string actor,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(request.AlertName))
                throw new ArgumentException("AlertName is required.");
            if (string.IsNullOrWhiteSpace(request.Reason))
                throw new ArgumentException("Reason is required.");

            var durationHours = request.DurationHours > 0 ? request.DurationHours : 24;
            var startsAt = AlertTimeZone.EasternNowOffset();
            var endsAt = startsAt.AddHours(durationHours);
            var matchers = BuildMatchers(request);

            var payload = new
            {
                matchers = matchers.Select(m => new { name = m.Key, value = m.Value, isRegex = false, isEqual = true }).ToList(),
                startsAt,
                endsAt,
                createdBy = actor,
                comment = request.Reason
            };

            var client = _httpClientFactory.CreateClient();
            using var response = await client.PostAsJsonAsync($"{GetAlertmanagerApiBaseUrl()}/silences", payload, cancellationToken);
            response.EnsureSuccessStatusCode();
            var silenceResponse = await response.Content.ReadFromJsonAsync<SilenceCreateResponse>(SerializerOptions, cancellationToken);
            if (silenceResponse == null || string.IsNullOrWhiteSpace(silenceResponse.SilenceID))
                throw new InvalidOperationException("Alertmanager did not return a silence id.");

            var suppression = new PrometheusSuppression
            {
                SilenceId = silenceResponse.SilenceID,
                Status = "active",
                CreatedBy = actor,
                Comment = request.Reason,
                StartsAt = startsAt.DateTime,
                EndsAt = endsAt.DateTime,
                UpdatedAt = startsAt.DateTime,
                Matchers = matchers
            };

            return suppression;
        }

        public async Task<PrometheusSuppression> EditSuppressionAsync(
            string silenceId,
            EditPrometheusSuppressionRequest request,
            string actor,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(silenceId))
                throw new ArgumentException("silenceId is required.");
            if (string.IsNullOrWhiteSpace(request.Reason))
                throw new ArgumentException("Reason is required.");

            var suppressions = await GetSuppressionsAsync(cancellationToken);
            var existing = suppressions.FirstOrDefault(s => s.SilenceId.Equals(silenceId, StringComparison.OrdinalIgnoreCase));
            if (existing == null)
                throw new InvalidOperationException($"Suppression {silenceId} not found.");

            await UnsuppressAlertAsync(silenceId, actor, $"Edit suppression: {request.Reason}", cancellationToken);

            var suppressRequest = new SuppressPrometheusAlertRequest
            {
                AlertName = existing.Matchers.GetValueOrDefault("alertname") ?? string.Empty,
                NamespaceName = existing.Matchers.GetValueOrDefault("namespace"),
                Severity = existing.Matchers.GetValueOrDefault("severity"),
                PodName = existing.Matchers.GetValueOrDefault("pod"),
                Reason = request.Reason,
                DurationHours = request.DurationHours
            };

            var updated = await SuppressAlertAsync(suppressRequest, actor, cancellationToken);

            return updated;
        }

        public async Task UnsuppressAlertAsync(
            string silenceId,
            string actor,
            string? reason = null,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(silenceId))
                throw new ArgumentException("silenceId is required.");

            var client = _httpClientFactory.CreateClient();
            using var response = await client.DeleteAsync($"{GetAlertmanagerApiBaseUrl()}/silence/{Uri.EscapeDataString(silenceId)}", cancellationToken);
            response.EnsureSuccessStatusCode();

        }

        public async Task<IReadOnlyList<PrometheusSuppression>> GetSuppressionsAsync(CancellationToken cancellationToken = default)
        {
            var client = _httpClientFactory.CreateClient();
            using var response = await client.GetAsync($"{GetAlertmanagerApiBaseUrl()}/silences", cancellationToken);
            response.EnsureSuccessStatusCode();
            var raw = await response.Content.ReadFromJsonAsync<List<AlertmanagerSilenceDto>>(SerializerOptions, cancellationToken)
                ?? new List<AlertmanagerSilenceDto>();

            return raw
                .OrderByDescending(s => s.UpdatedAt ?? DateTime.MinValue)
                .Select(s => new PrometheusSuppression
                {
                    SilenceId = s.Id ?? string.Empty,
                    Status = s.Status?.State ?? "unknown",
                    CreatedBy = s.CreatedBy ?? string.Empty,
                    Comment = s.Comment ?? string.Empty,
                    StartsAt = AlertTimeZone.ConvertFromUtc(s.StartsAt ?? DateTime.MinValue),
                    EndsAt = AlertTimeZone.ConvertFromUtc(s.EndsAt ?? DateTime.MinValue),
                    UpdatedAt = AlertTimeZone.ConvertFromUtc(s.UpdatedAt ?? DateTime.MinValue),
                    Matchers = (s.Matchers ?? new List<AlertmanagerMatcherDto>())
                        .Where(m => !string.IsNullOrWhiteSpace(m.Name))
                        .ToDictionary(m => m.Name!, m => m.Value ?? string.Empty)
                })
                .ToList();
        }

        public async Task<IReadOnlyList<PrometheusAlertRuleProposal>> GetRuleProposalsAsync(CancellationToken cancellationToken = default)
        {
            var configMap = await GetOrCreateProposalConfigMapAsync(cancellationToken);
            var proposals = ReadProposals(configMap);

            return proposals
                .OrderByDescending(p => p.UpdatedAtUtc)
                .ToList();
        }

        public async Task<PrometheusAlertRuleProposal> CreateRuleProposalAsync(
            CreatePrometheusAlertRuleProposalRequest request,
            string createdBy,
            CancellationToken cancellationToken = default)
        {
            var normalized = NormalizeCreateRequest(request);

            var proposal = new PrometheusAlertRuleProposal
            {
                Id = Guid.NewGuid().ToString("N"),
                AlertName = normalized.AlertName,
                Expr = normalized.Expr,
                For = normalized.For,
                Severity = normalized.Severity,
                Summary = normalized.Summary,
                Description = normalized.Description,
                GroupName = normalized.GroupName,
                Status = "Draft",
                CreatedAtUtc = AlertTimeZone.EasternNow(),
                UpdatedAtUtc = AlertTimeZone.EasternNow(),
                CreatedBy = string.IsNullOrWhiteSpace(createdBy) ? "unknown" : createdBy
            };

            var configMap = await GetOrCreateProposalConfigMapAsync(cancellationToken);
            var proposals = ReadProposals(configMap);
            proposals.Add(proposal);

            await SaveProposalsAsync(configMap, proposals, cancellationToken);

            _logger.LogInformation("Created Prometheus alert proposal {AlertName} by {CreatedBy}", proposal.AlertName, proposal.CreatedBy);
            return proposal;
        }

        public async Task<PrometheusAlertRuleProposal?> UpdateRuleProposalAsync(
            string proposalId,
            UpdatePrometheusAlertRuleProposalRequest request,
            string updatedBy,
            CancellationToken cancellationToken = default)
        {
            var normalized = NormalizeUpdateRequest(request);

            var configMap = await GetOrCreateProposalConfigMapAsync(cancellationToken);
            var proposals = ReadProposals(configMap);
            var proposal = proposals.FirstOrDefault(p => p.Id.Equals(proposalId, StringComparison.OrdinalIgnoreCase));

            if (proposal is null)
            {
                return null;
            }

            proposal.AlertName = normalized.AlertName;
            proposal.Expr = normalized.Expr;
            proposal.For = normalized.For;
            proposal.Severity = normalized.Severity;
            proposal.Summary = normalized.Summary;
            proposal.Description = normalized.Description;
            proposal.GroupName = normalized.GroupName;
            proposal.Status = normalized.Status;
            proposal.UpdatedBy = string.IsNullOrWhiteSpace(updatedBy) ? "unknown" : updatedBy;
            proposal.UpdatedAtUtc = AlertTimeZone.EasternNow();

            await SaveProposalsAsync(configMap, proposals, cancellationToken);

            _logger.LogInformation(
                "Updated Prometheus alert proposal {ProposalId} ({AlertName}) by {UpdatedBy}",
                proposal.Id,
                proposal.AlertName,
                proposal.UpdatedBy);

            return proposal;
        }

        public async Task<string> GeneratePrometheusRuleYamlAsync(
            string? groupName,
            string? status,
            CancellationToken cancellationToken = default)
        {
            var configMap = await GetOrCreateProposalConfigMapAsync(cancellationToken);
            var proposals = ReadProposals(configMap);

            var effectiveStatus = string.IsNullOrWhiteSpace(status) ? "Approved" : status.Trim();
            var filtered = proposals
                .Where(p => p.Status.Equals(effectiveStatus, StringComparison.OrdinalIgnoreCase))
                .Where(p => string.IsNullOrWhiteSpace(groupName) ||
                            p.GroupName.Equals(groupName.Trim(), StringComparison.OrdinalIgnoreCase))
                .OrderBy(p => p.GroupName)
                .ThenBy(p => p.AlertName)
                .ToList();

            return BuildPrometheusRuleYaml(filtered);
        }

        public async Task<IReadOnlyList<PrometheusRuleDefinition>> GetRuleDefinitionsAsync(
            CancellationToken cancellationToken = default)
        {
            var list = await _kubernetesClient.CustomObjects.ListClusterCustomObjectAsync(
                PrometheusRuleGroup,
                PrometheusRuleVersion,
                PrometheusRulePlural,
                cancellationToken: cancellationToken);

            var root = JsonSerializer.SerializeToElement(list, SerializerOptions);
            if (!root.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
            {
                return Array.Empty<PrometheusRuleDefinition>();
            }

            var results = new List<PrometheusRuleDefinition>();
            foreach (var item in items.EnumerateArray())
            {
                var meta = item.TryGetProperty("metadata", out var metadata) ? metadata : default;
                var labels = ReadStringMap(meta, "labels");
                var resourceName = meta.TryGetProperty("name", out var nameProp) ? nameProp.GetString() ?? string.Empty : string.Empty;
                var ns = meta.TryGetProperty("namespace", out var nsProp) ? nsProp.GetString() ?? string.Empty : string.Empty;
                var origin = DetermineRuleOrigin(labels, resourceName, ns);

                if (!item.TryGetProperty("spec", out var spec) ||
                    !spec.TryGetProperty("groups", out var groups) ||
                    groups.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var group in groups.EnumerateArray())
                {
                    var groupName = group.TryGetProperty("name", out var groupNameProp)
                        ? groupNameProp.GetString() ?? string.Empty
                        : string.Empty;

                    if (!group.TryGetProperty("rules", out var rules) || rules.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    foreach (var rule in rules.EnumerateArray())
                    {
                        if (!rule.TryGetProperty("alert", out var alertProp)) continue;
                        var alertName = alertProp.GetString() ?? string.Empty;
                        if (string.IsNullOrWhiteSpace(alertName)) continue;

                        var definition = new PrometheusRuleDefinition
                        {
                            AlertName = alertName,
                            Expr = rule.TryGetProperty("expr", out var exprProp) ? exprProp.GetString() ?? string.Empty : string.Empty,
                            For = rule.TryGetProperty("for", out var forProp) ? forProp.GetString() : null,
                            GroupName = groupName,
                            Labels = ReadStringMap(rule, "labels"),
                            Annotations = ReadStringMap(rule, "annotations"),
                            Namespace = ns,
                            ResourceName = resourceName,
                            Origin = origin
                        };

                        results.Add(definition);
                    }
                }
            }

            return results;
        }

        public async Task<PrometheusRuleDefinition?> GetRuleDefinitionAsync(
            string alertName,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(alertName)) return null;
            var rules = await GetRuleDefinitionsAsync(cancellationToken);
            var match = rules
                .Where(r => r.AlertName.Equals(alertName, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(r => r.Origin.Equals("custom", StringComparison.OrdinalIgnoreCase))
                .FirstOrDefault();
            return match;
        }

        public async Task<ApplyPrometheusRuleResponse> ApplyRuleDefinitionAsync(
            ApplyPrometheusRuleRequest request,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(request.AlertName))
                throw new ArgumentException("AlertName is required.");
            if (string.IsNullOrWhiteSpace(request.Expr))
                throw new ArgumentException("Expr is required.");

            var originalAlertName = string.IsNullOrWhiteSpace(request.OriginalAlertName)
                ? request.AlertName
                : request.OriginalAlertName!;

            var allRules = await GetRuleDefinitionsAsync(cancellationToken);
            var existing = allRules.FirstOrDefault(r =>
                r.AlertName.Equals(originalAlertName, StringComparison.OrdinalIgnoreCase));

            var normalizedRequest = NormalizeRuleDefinition(new PrometheusRuleDefinition
            {
                AlertName = request.AlertName.Trim(),
                Expr = request.Expr.Trim(),
                For = string.IsNullOrWhiteSpace(request.For) ? null : request.For.Trim(),
                GroupName = request.GroupName?.Trim()
                    ?? (existing?.GroupName ?? string.Empty),
                Labels = request.Labels ?? new Dictionary<string, string>(),
                Annotations = request.Annotations ?? new Dictionary<string, string>()
            });

            if (existing != null)
            {
                var normalizedExisting = NormalizeRuleDefinition(existing);
                if (AreRulesEquivalent(normalizedExisting, normalizedRequest))
                {
                    return new ApplyPrometheusRuleResponse
                    {
                        Changed = false,
                        Action = "no_change",
                        Result = existing
                    };
                }
            }

            var isOotb = existing != null && existing.Origin.Equals("ootb", StringComparison.OrdinalIgnoreCase);
            PrometheusRuleDefinition result;
            if (isOotb)
            {
                await RemoveRuleFromResourceAsync(existing!, cancellationToken);
                result = await UpsertCustomRuleAsync(
                    normalizedRequest,
                    originalAlertName,
                    cancellationToken);
            }
            else if (existing != null)
            {
                result = await UpsertRuleInResourceAsync(existing, normalizedRequest, originalAlertName, cancellationToken);
            }
            else
            {
                result = await UpsertCustomRuleAsync(
                    normalizedRequest,
                    originalAlertName,
                    cancellationToken);
            }

            return new ApplyPrometheusRuleResponse
            {
                Changed = true,
                Action = isOotb ? "replace" : "update",
                Result = result
            };
        }

        public async Task<IReadOnlyList<AlertGroupDefinition>> GetAlertGroupsAsync(
            CancellationToken cancellationToken = default)
        {
            var managedGroups = await GetAlertmanagerConfigAsync(cancellationToken);
            var generatedGroups = await GetAlertmanagerGroupsFromSecretAsync(cancellationToken);

            return MergeAlertGroups(generatedGroups, managedGroups);
        }

        public async Task<IReadOnlyList<string>> GetAlertGroupRouteKeysAsync(
            CancellationToken cancellationToken = default)
        {
            var bindings = await GetAlertRouteBindingsAsync(cancellationToken);
            return bindings
                .Select(binding => binding.RouteKey)
                .Where(routeKey => !string.IsNullOrWhiteSpace(routeKey))
                .Select(routeKey => routeKey.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(routeKey => routeKey)
                .ToList();
        }

        public async Task<IReadOnlyList<AlertRouteBinding>> GetAlertRouteBindingsAsync(
            CancellationToken cancellationToken = default)
        {
            var generatedGroups = await GetAlertmanagerGroupsFromSecretAsync(cancellationToken);
            var managedGroups = await GetAlertmanagerConfigAsync(cancellationToken);

            var bindings = new Dictionary<string, AlertRouteBinding>(StringComparer.OrdinalIgnoreCase);

            // Start with base routes from generated config.
            foreach (var group in generatedGroups)
            {
                var receiverName = NormalizeAlertGroupName(group.Name);

                var routeKeys = NormalizeRouteKeys(group.RouteKeys, receiverName, useFallbackWhenMissing: false);
                foreach (var routeKey in routeKeys)
                {
                    var key = $"base|{receiverName}|{routeKey}".ToLowerInvariant();
                    bindings[key] = new AlertRouteBinding
                    {
                        Source = "base",
                        Receiver = receiverName,
                        RouteKey = routeKey,
                        Emails = group.Emails
                            .Where(email => !string.IsNullOrWhiteSpace(email))
                            .Select(email => email.Trim())
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .OrderBy(email => email)
                            .ToList()
                    };
                }
            }

            // Add/replace with dashboard override routes from AlertmanagerConfig.
            foreach (var group in managedGroups)
            {
                var receiverName = NormalizeAlertGroupName(group.Name);
                var routeKeys = NormalizeRouteKeys(group.RouteKeys, receiverName, useFallbackWhenMissing: false);
                if (routeKeys.Count == 0)
                {
                    var removedKey = $"override|{receiverName}|(removed)".ToLowerInvariant();
                    bindings[removedKey] = new AlertRouteBinding
                    {
                        Source = "override",
                        Receiver = receiverName,
                        RouteKey = string.Empty,
                        Emails = group.Emails
                            .Where(email => !string.IsNullOrWhiteSpace(email))
                            .Select(email => email.Trim())
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .OrderBy(email => email)
                            .ToList()
                    };
                    continue;
                }

                foreach (var routeKey in routeKeys)
                {
                    var key = $"override|{receiverName}|{routeKey}".ToLowerInvariant();
                    bindings[key] = new AlertRouteBinding
                    {
                        Source = "override",
                        Receiver = receiverName,
                        RouteKey = routeKey,
                        Emails = group.Emails
                            .Where(email => !string.IsNullOrWhiteSpace(email))
                            .Select(email => email.Trim())
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .OrderBy(email => email)
                            .ToList()
                    };
                }
            }

            return bindings.Values
                .OrderBy(binding => binding.Source)
                .ThenBy(binding => binding.RouteKey)
                .ThenBy(binding => binding.Receiver)
                .ToList();
        }

        public async Task<IReadOnlyList<AlertGroupDefinition>> UpsertAlertGroupAsync(
            AlertGroupUpdateRequest request,
            string actor,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                throw new ArgumentException("Group name is required.");

            var normalizedName = NormalizeAlertGroupName(request.Name);
            if (string.IsNullOrWhiteSpace(normalizedName))
                throw new ArgumentException("Group name is required.");

            var groups = (await GetAlertmanagerConfigAsync(cancellationToken)).ToList();
            var existing = groups.FirstOrDefault(g =>
                NormalizeAlertGroupName(g.Name).Equals(normalizedName, StringComparison.OrdinalIgnoreCase));
            if (existing == null)
            {
                groups.Add(new AlertGroupDefinition
                {
                    Name = normalizedName,
                    Emails = request.Emails?.Where(e => !string.IsNullOrWhiteSpace(e)).Select(e => e.Trim()).Distinct().ToList()
                        ?? new List<string>(),
                    RouteKeys = NormalizeRouteKeys(
                        request.RouteKeys,
                        normalizedName,
                        useFallbackWhenMissing: request.RouteKeys is null)
                });
            }
            else
            {
                existing.Name = normalizedName;
                existing.Emails = request.Emails?.Where(e => !string.IsNullOrWhiteSpace(e)).Select(e => e.Trim()).Distinct().ToList()
                    ?? new List<string>();
                existing.RouteKeys = NormalizeRouteKeys(
                    request.RouteKeys,
                    normalizedName,
                    useFallbackWhenMissing: request.RouteKeys is null);
            }

            await SaveAlertmanagerConfigAsync(groups, cancellationToken);
            return await GetAlertGroupsAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<AlertGroupDefinition>> DeleteAlertGroupAsync(
            string groupName,
            string actor,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(groupName))
                throw new ArgumentException("Group name is required.");

            var normalizedName = NormalizeAlertGroupName(groupName);
            if (string.IsNullOrWhiteSpace(normalizedName))
                throw new ArgumentException("Group name is required.");

            var groups = (await GetAlertmanagerConfigAsync(cancellationToken)).ToList();
            groups = groups
                .Where(g => !NormalizeAlertGroupName(g.Name).Equals(normalizedName, StringComparison.OrdinalIgnoreCase))
                .ToList();

            await SaveAlertmanagerConfigAsync(groups, cancellationToken);
            return await GetAlertGroupsAsync(cancellationToken);
        }

        private static IReadOnlyList<AlertGroupDefinition> MergeAlertGroups(
            IReadOnlyList<AlertGroupDefinition> baseGroups,
            IReadOnlyList<AlertGroupDefinition> overrideGroups)
        {
            var merged = new Dictionary<string, AlertGroupDefinition>(StringComparer.OrdinalIgnoreCase);

            foreach (var group in baseGroups)
            {
                var normalizedName = NormalizeAlertGroupName(group.Name);
                if (string.IsNullOrWhiteSpace(normalizedName) ||
                    normalizedName.Equals("null", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                merged[normalizedName] = new AlertGroupDefinition
                {
                    Name = normalizedName,
                    Emails = group.Emails
                        .Where(e => !string.IsNullOrWhiteSpace(e))
                        .Select(e => e.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList(),
                    RouteKeys = NormalizeRouteKeys(group.RouteKeys, normalizedName, useFallbackWhenMissing: false)
                };
            }

            foreach (var group in overrideGroups)
            {
                var normalizedName = NormalizeAlertGroupName(group.Name);
                if (string.IsNullOrWhiteSpace(normalizedName) ||
                    normalizedName.Equals("null", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                merged[normalizedName] = new AlertGroupDefinition
                {
                    Name = normalizedName,
                    Emails = group.Emails
                        .Where(e => !string.IsNullOrWhiteSpace(e))
                        .Select(e => e.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList(),
                    RouteKeys = NormalizeRouteKeys(group.RouteKeys, normalizedName, useFallbackWhenMissing: false)
                };
            }

            return merged.Values
                .OrderBy(g => g.Name)
                .ToList();
        }

        private async Task<V1ConfigMap> GetOrCreateProposalConfigMapAsync(CancellationToken cancellationToken)
        {
            try
            {
                return await _kubernetesClient.CoreV1.ReadNamespacedConfigMapAsync(
                    _options.ProposalConfigMapName,
                    _options.ProposalNamespace,
                    cancellationToken: cancellationToken);
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                _logger.LogInformation(
                    "Creating proposal ConfigMap {ConfigMapName} in namespace {Namespace}",
                    _options.ProposalConfigMapName,
                    _options.ProposalNamespace);

                var configMap = new V1ConfigMap
                {
                    Metadata = new V1ObjectMeta
                    {
                        Name = _options.ProposalConfigMapName,
                        NamespaceProperty = _options.ProposalNamespace,
                        Labels = new Dictionary<string, string>
                        {
                            ["app.kubernetes.io/managed-by"] = "kube-dashboard-api",
                            [_componentLabelKey] = "prometheus-alert-proposals"
                        },
                        Annotations = new Dictionary<string, string>
                        {
                            [_purposeAnnotationKey] = "Stores alert proposals for GitOps review; does not modify ArgoCD-managed PrometheusRule resources."
                        }
                    },
                    Data = new Dictionary<string, string>
                    {
                        [_options.ProposalConfigMapDataKey] = "[]"
                    }
                };

                return await _kubernetesClient.CoreV1.CreateNamespacedConfigMapAsync(
                    configMap,
                    _options.ProposalNamespace,
                    cancellationToken: cancellationToken);
            }
        }

        private List<PrometheusAlertRuleProposal> ReadProposals(V1ConfigMap configMap)
        {
            if (configMap.Data == null ||
                !configMap.Data.TryGetValue(_options.ProposalConfigMapDataKey, out var json) ||
                string.IsNullOrWhiteSpace(json))
            {
                return new List<PrometheusAlertRuleProposal>();
            }

            try
            {
                return JsonSerializer.Deserialize<List<PrometheusAlertRuleProposal>>(json, SerializerOptions)
                    ?? new List<PrometheusAlertRuleProposal>();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse proposal ConfigMap data. Returning empty list.");
                return new List<PrometheusAlertRuleProposal>();
            }
        }

        private async Task SaveProposalsAsync(
            V1ConfigMap configMap,
            List<PrometheusAlertRuleProposal> proposals,
            CancellationToken cancellationToken)
        {
            configMap.Data ??= new Dictionary<string, string>();
            configMap.Data[_options.ProposalConfigMapDataKey] = JsonSerializer.Serialize(proposals);

            await _kubernetesClient.CoreV1.ReplaceNamespacedConfigMapAsync(
                configMap,
                _options.ProposalConfigMapName,
                _options.ProposalNamespace,
                cancellationToken: cancellationToken);
        }

        private static Dictionary<string, string> ReadStringMap(JsonElement element, string propertyName)
        {
            if (!element.TryGetProperty(propertyName, out var map) || map.ValueKind != JsonValueKind.Object)
            {
                return new Dictionary<string, string>();
            }

            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var prop in map.EnumerateObject())
            {
                if (!string.IsNullOrWhiteSpace(prop.Name))
                {
                    result[prop.Name] = prop.Value.GetString() ?? string.Empty;
                }
            }
            return result;
        }

        private string DetermineRuleOrigin(Dictionary<string, string> labels, string resourceName, string namespaceName)
        {
            if (!string.IsNullOrWhiteSpace(resourceName) &&
                resourceName.Equals(_options.CustomRuleName, StringComparison.OrdinalIgnoreCase) &&
                namespaceName.Equals(_options.CustomRuleNamespace, StringComparison.OrdinalIgnoreCase))
            {
                return "custom";
            }

            if (labels.TryGetValue(_dashboardManagedLabelKey, out var value) &&
                value.Equals(DashboardManagedLabelValue, StringComparison.OrdinalIgnoreCase))
            {
                return "custom";
            }

            if (labels.TryGetValue("app.kubernetes.io/managed-by", out var managedBy) &&
                managedBy.Equals("Helm", StringComparison.OrdinalIgnoreCase))
            {
                return "ootb";
            }

            if (labels.ContainsKey("helm.sh/chart") || labels.ContainsKey("app.kubernetes.io/instance"))
            {
                return "ootb";
            }

            if (labels.TryGetValue(_options.CustomRuleSelectorLabelKey, out var selectorValue) &&
                selectorValue.Equals(_options.CustomRuleSelectorLabelValue, StringComparison.OrdinalIgnoreCase))
            {
                return "ootb";
            }

            return "unknown";
        }

        private static PrometheusRuleDefinition NormalizeRuleDefinition(PrometheusRuleDefinition definition)
        {
            return new PrometheusRuleDefinition
            {
                AlertName = definition.AlertName.Trim(),
                Expr = definition.Expr.Trim(),
                For = string.IsNullOrWhiteSpace(definition.For) ? null : definition.For.Trim(),
                GroupName = definition.GroupName.Trim(),
                Labels = (definition.Labels ?? new Dictionary<string, string>())
                    .Where(kv => !string.IsNullOrWhiteSpace(kv.Key))
                    .ToDictionary(kv => kv.Key.Trim(), kv => kv.Value?.Trim() ?? string.Empty, StringComparer.OrdinalIgnoreCase),
                Annotations = (definition.Annotations ?? new Dictionary<string, string>())
                    .Where(kv => !string.IsNullOrWhiteSpace(kv.Key))
                    .ToDictionary(kv => kv.Key.Trim(), kv => kv.Value?.Trim() ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            };
        }

        private static bool AreRulesEquivalent(PrometheusRuleDefinition left, PrometheusRuleDefinition right)
        {
            if (!left.AlertName.Equals(right.AlertName, StringComparison.OrdinalIgnoreCase)) return false;
            if (!left.Expr.Equals(right.Expr, StringComparison.OrdinalIgnoreCase)) return false;
            if (!string.Equals(left.For ?? string.Empty, right.For ?? string.Empty, StringComparison.OrdinalIgnoreCase)) return false;
            if (!left.GroupName.Equals(right.GroupName, StringComparison.OrdinalIgnoreCase)) return false;

            bool CompareMaps(Dictionary<string, string> a, Dictionary<string, string> b)
            {
                if (a.Count != b.Count) return false;
                foreach (var kv in a)
                {
                    if (!b.TryGetValue(kv.Key, out var value)) return false;
                    if (!string.Equals(kv.Value ?? string.Empty, value ?? string.Empty, StringComparison.Ordinal)) return false;
                }
                return true;
            }

            return CompareMaps(left.Labels, right.Labels) && CompareMaps(left.Annotations, right.Annotations);
        }

        private async Task RemoveRuleFromResourceAsync(PrometheusRuleDefinition definition, CancellationToken cancellationToken)
        {
            var resource = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                PrometheusRuleGroup,
                PrometheusRuleVersion,
                definition.Namespace,
                PrometheusRulePlural,
                definition.ResourceName,
                cancellationToken: cancellationToken);

            var node = JsonNode.Parse(JsonSerializer.Serialize(resource, SerializerOptions));
            if (node == null) return;

            var groups = node["spec"]?["groups"]?.AsArray();
            if (groups == null) return;

            foreach (var group in groups.ToList())
            {
                var rules = group?["rules"]?.AsArray();
                if (rules == null) continue;

                for (var i = rules.Count - 1; i >= 0; i--)
                {
                    var ruleAlert = rules[i]?["alert"]?.GetValue<string>() ?? string.Empty;
                    if (ruleAlert.Equals(definition.AlertName, StringComparison.OrdinalIgnoreCase))
                    {
                        rules.RemoveAt(i);
                    }
                }

                if (rules.Count == 0)
                {
                    groups.Remove(group);
                }
            }

            await _kubernetesClient.CustomObjects.ReplaceNamespacedCustomObjectAsync(
                node,
                PrometheusRuleGroup,
                PrometheusRuleVersion,
                definition.Namespace,
                PrometheusRulePlural,
                definition.ResourceName,
                cancellationToken: cancellationToken);
        }

        private async Task<PrometheusRuleDefinition> UpsertCustomRuleAsync(
            PrometheusRuleDefinition requested,
            string originalAlertName,
            CancellationToken cancellationToken)
        {
            var resource = await GetOrCreateCustomRuleResourceAsync(cancellationToken);
            var node = JsonNode.Parse(JsonSerializer.Serialize(resource, SerializerOptions)) ?? new JsonObject();

            var spec = node["spec"] as JsonObject ?? new JsonObject();
            node["spec"] = spec;
            var groups = spec["groups"] as JsonArray ?? new JsonArray();
            spec["groups"] = groups;

            var groupName = string.IsNullOrWhiteSpace(requested.GroupName)
                ? "kube-dashboard-custom-alerts"
                : requested.GroupName;

            JsonObject? targetGroup = null;
            foreach (var groupNode in groups)
            {
                if ((groupNode?["name"]?.GetValue<string>() ?? string.Empty)
                    .Equals(groupName, StringComparison.OrdinalIgnoreCase))
                {
                    targetGroup = groupNode as JsonObject;
                    break;
                }
            }

            if (targetGroup == null)
            {
                targetGroup = new JsonObject
                {
                    ["name"] = groupName,
                    ["rules"] = new JsonArray()
                };
                groups.Add(targetGroup);
            }

            var rules = targetGroup["rules"] as JsonArray ?? new JsonArray();
            targetGroup["rules"] = rules;

            for (var i = rules.Count - 1; i >= 0; i--)
            {
                var ruleAlert = rules[i]?["alert"]?.GetValue<string>() ?? string.Empty;
                if (ruleAlert.Equals(originalAlertName, StringComparison.OrdinalIgnoreCase))
                {
                    rules.RemoveAt(i);
                }
            }

            var ruleNode = new JsonObject
            {
                ["alert"] = requested.AlertName,
                ["expr"] = requested.Expr
            };

            if (!string.IsNullOrWhiteSpace(requested.For))
            {
                ruleNode["for"] = requested.For;
            }

            if (requested.Labels?.Count > 0)
            {
                ruleNode["labels"] = JsonSerializer.SerializeToNode(requested.Labels);
            }

            if (requested.Annotations?.Count > 0)
            {
                ruleNode["annotations"] = JsonSerializer.SerializeToNode(requested.Annotations);
            }

            rules.Add(ruleNode);

            await _kubernetesClient.CustomObjects.ReplaceNamespacedCustomObjectAsync(
                node,
                PrometheusRuleGroup,
                PrometheusRuleVersion,
                _options.CustomRuleNamespace,
                PrometheusRulePlural,
                _options.CustomRuleName,
                cancellationToken: cancellationToken);

            return new PrometheusRuleDefinition
            {
                AlertName = requested.AlertName,
                Expr = requested.Expr,
                For = requested.For,
                GroupName = groupName,
                Labels = requested.Labels ?? new Dictionary<string, string>(),
                Annotations = requested.Annotations ?? new Dictionary<string, string>(),
                Namespace = _options.CustomRuleNamespace,
                ResourceName = _options.CustomRuleName,
                Origin = "custom"
            };
        }

        private async Task<PrometheusRuleDefinition> UpsertRuleInResourceAsync(
            PrometheusRuleDefinition target,
            PrometheusRuleDefinition requested,
            string originalAlertName,
            CancellationToken cancellationToken)
        {
            var resource = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                PrometheusRuleGroup,
                PrometheusRuleVersion,
                target.Namespace,
                PrometheusRulePlural,
                target.ResourceName,
                cancellationToken: cancellationToken);

            var node = JsonNode.Parse(JsonSerializer.Serialize(resource, SerializerOptions)) ?? new JsonObject();
            var spec = node["spec"] as JsonObject ?? new JsonObject();
            node["spec"] = spec;
            var groups = spec["groups"] as JsonArray ?? new JsonArray();
            spec["groups"] = groups;

            var groupName = string.IsNullOrWhiteSpace(requested.GroupName)
                ? target.GroupName
                : requested.GroupName;

            JsonObject? targetGroup = null;
            foreach (var groupNode in groups)
            {
                if ((groupNode?["name"]?.GetValue<string>() ?? string.Empty)
                    .Equals(groupName, StringComparison.OrdinalIgnoreCase))
                {
                    targetGroup = groupNode as JsonObject;
                    break;
                }
            }

            if (targetGroup == null)
            {
                targetGroup = new JsonObject
                {
                    ["name"] = groupName,
                    ["rules"] = new JsonArray()
                };
                groups.Add(targetGroup);
            }

            var rules = targetGroup["rules"] as JsonArray ?? new JsonArray();
            targetGroup["rules"] = rules;

            for (var i = rules.Count - 1; i >= 0; i--)
            {
                var ruleAlert = rules[i]?["alert"]?.GetValue<string>() ?? string.Empty;
                if (ruleAlert.Equals(originalAlertName, StringComparison.OrdinalIgnoreCase))
                {
                    rules.RemoveAt(i);
                }
            }

            var ruleNode = new JsonObject
            {
                ["alert"] = requested.AlertName,
                ["expr"] = requested.Expr
            };

            if (!string.IsNullOrWhiteSpace(requested.For))
            {
                ruleNode["for"] = requested.For;
            }

            if (requested.Labels?.Count > 0)
            {
                ruleNode["labels"] = JsonSerializer.SerializeToNode(requested.Labels);
            }

            if (requested.Annotations?.Count > 0)
            {
                ruleNode["annotations"] = JsonSerializer.SerializeToNode(requested.Annotations);
            }

            rules.Add(ruleNode);

            await _kubernetesClient.CustomObjects.ReplaceNamespacedCustomObjectAsync(
                node,
                PrometheusRuleGroup,
                PrometheusRuleVersion,
                target.Namespace,
                PrometheusRulePlural,
                target.ResourceName,
                cancellationToken: cancellationToken);

            return new PrometheusRuleDefinition
            {
                AlertName = requested.AlertName,
                Expr = requested.Expr,
                For = requested.For,
                GroupName = groupName,
                Labels = requested.Labels ?? new Dictionary<string, string>(),
                Annotations = requested.Annotations ?? new Dictionary<string, string>(),
                Namespace = target.Namespace,
                ResourceName = target.ResourceName,
                Origin = target.Origin
            };
        }

        private async Task<JsonObject> GetOrCreateCustomRuleResourceAsync(CancellationToken cancellationToken)
        {
            try
            {
                var existing = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                    PrometheusRuleGroup,
                    PrometheusRuleVersion,
                    _options.CustomRuleNamespace,
                    PrometheusRulePlural,
                    _options.CustomRuleName,
                    cancellationToken: cancellationToken);

                return JsonNode.Parse(JsonSerializer.Serialize(existing, SerializerOptions))?.AsObject()
                    ?? new JsonObject();
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                var newRule = new JsonObject
                {
                    ["apiVersion"] = $"{PrometheusRuleGroup}/{PrometheusRuleVersion}",
                    ["kind"] = "PrometheusRule",
                    ["metadata"] = new JsonObject
                    {
                        ["name"] = _options.CustomRuleName,
                        ["namespace"] = _options.CustomRuleNamespace,
                        ["labels"] = new JsonObject
                        {
                            [_dashboardManagedLabelKey] = DashboardManagedLabelValue,
                            [_options.CustomRuleSelectorLabelKey] = _options.CustomRuleSelectorLabelValue
                        }
                    },
                    ["spec"] = new JsonObject
                    {
                        ["groups"] = new JsonArray()
                    }
                };

                await _kubernetesClient.CustomObjects.CreateNamespacedCustomObjectAsync(
                    newRule,
                    PrometheusRuleGroup,
                    PrometheusRuleVersion,
                    _options.CustomRuleNamespace,
                    PrometheusRulePlural,
                    cancellationToken: cancellationToken);

                return newRule;
            }
        }

        private async Task<IReadOnlyList<AlertGroupDefinition>> GetAlertmanagerConfigAsync(CancellationToken cancellationToken)
        {
            try
            {
                var resource = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                    AlertmanagerConfigGroup,
                    AlertmanagerConfigVersion,
                    _options.AlertmanagerConfigNamespace,
                    AlertmanagerConfigPlural,
                    _options.AlertmanagerConfigName,
                    cancellationToken: cancellationToken);

                var node = JsonNode.Parse(JsonSerializer.Serialize(resource, SerializerOptions));
                var receiversNode = node?["spec"]?["receivers"]?.AsArray();
                var routeNode = node?["spec"]?["route"]?["routes"]?.AsArray();

                var receiverEmailMap = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
                var receiverRouteKeyMap = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
                if (receiversNode != null)
                {
                    foreach (var receiver in receiversNode)
                    {
                        var name = NormalizeAlertGroupName(receiver?["name"]?.GetValue<string>());
                        if (string.IsNullOrWhiteSpace(name) || name.Equals("null", StringComparison.OrdinalIgnoreCase)) continue;
                        var emails = receiver?["emailConfigs"]?.AsArray()
                            ?.Select(e => e?["to"]?.GetValue<string>())
                            .Where(e => !string.IsNullOrWhiteSpace(e))
                            .Select(e => e!.Trim())
                            .ToList() ?? new List<string>();
                        receiverEmailMap[name] = emails;
                    }
                }

                if (routeNode != null)
                {
                    foreach (var route in routeNode)
                    {
                        var receiver = NormalizeAlertGroupName(route?["receiver"]?.GetValue<string>());
                        if (string.IsNullOrWhiteSpace(receiver)) continue;

                        var routeKeys = ExtractAlertGroupRouteKeysFromJsonNode(route?["matchers"]);
                        if (!receiverRouteKeyMap.TryGetValue(receiver, out var receiverKeys))
                        {
                            receiverKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            receiverRouteKeyMap[receiver] = receiverKeys;
                        }

                        foreach (var routeKey in routeKeys)
                        {
                            receiverKeys.Add(routeKey);
                        }
                    }
                }

                return receiverEmailMap
                    .Select(entry => new AlertGroupDefinition
                    {
                        Name = entry.Key,
                        Emails = entry.Value,
                        RouteKeys = receiverRouteKeyMap.TryGetValue(entry.Key, out var keys)
                            ? keys.OrderBy(key => key).ToList()
                            : new List<string>()
                    })
                    .OrderBy(group => group.Name)
                    .ToList();
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return new List<AlertGroupDefinition>();
            }
        }

        private async Task SaveAlertmanagerConfigAsync(
            IReadOnlyList<AlertGroupDefinition> groups,
            CancellationToken cancellationToken)
        {
            var normalizedGroups = groups
                .Select(group => new AlertGroupDefinition
                {
                    Name = NormalizeAlertGroupName(group.Name),
                    Emails = (group.Emails ?? new List<string>())
                        .Where(e => !string.IsNullOrWhiteSpace(e))
                        .Select(e => e.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList(),
                    RouteKeys = NormalizeRouteKeys(
                        group.RouteKeys,
                        group.Name,
                        useFallbackWhenMissing: false)
                })
                .Where(group => !string.IsNullOrWhiteSpace(group.Name) &&
                                !group.Name.Equals("null", StringComparison.OrdinalIgnoreCase))
                .GroupBy(group => group.Name, StringComparer.OrdinalIgnoreCase)
                .Select(group => new AlertGroupDefinition
                {
                    Name = group.Key,
                    Emails = group
                        .SelectMany(g => g.Emails)
                        .Where(e => !string.IsNullOrWhiteSpace(e))
                        .Select(e => e.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList(),
                    RouteKeys = group
                        .SelectMany(g => NormalizeRouteKeys(g.RouteKeys, g.Name, useFallbackWhenMissing: false))
                        .Where(key => !string.IsNullOrWhiteSpace(key))
                        .Select(key => key.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .OrderBy(key => key)
                        .ToList()
                })
                .OrderBy(group => group.Name)
                .ToList();

            var routes = new JsonArray();
            var receivers = new JsonArray();

            foreach (var group in normalizedGroups)
            {
                var routeKeys = NormalizeRouteKeys(group.RouteKeys, group.Name, useFallbackWhenMissing: false);
                foreach (var routeKey in routeKeys)
                {
                    routes.Add(new JsonObject
                    {
                        ["receiver"] = group.Name,
                        ["matchers"] = new JsonArray
                        {
                            new JsonObject
                            {
                                ["name"] = "alert_group",
                                ["value"] = routeKey,
                                ["matchType"] = "="
                            }
                        }
                    });
                }

                var emailConfigs = new JsonArray();
                foreach (var email in group.Emails.Distinct(StringComparer.OrdinalIgnoreCase))
                {
                    emailConfigs.Add(new JsonObject
                    {
                        ["to"] = email,
                        ["sendResolved"] = true
                    });
                }

                receivers.Add(new JsonObject
                {
                    ["name"] = group.Name,
                    ["emailConfigs"] = emailConfigs
                });
            }

            var route = new JsonObject
            {
                ["receiver"] = normalizedGroups.FirstOrDefault()?.Name ?? "null",
                ["routes"] = routes
            };

            if (normalizedGroups.Count == 0)
            {
                receivers.Add(new JsonObject { ["name"] = "null" });
            }

            var config = new JsonObject
            {
                ["apiVersion"] = $"{AlertmanagerConfigGroup}/{AlertmanagerConfigVersion}",
                ["kind"] = "AlertmanagerConfig",
                ["metadata"] = new JsonObject
                {
                    ["name"] = _options.AlertmanagerConfigName,
                    ["namespace"] = _options.AlertmanagerConfigNamespace,
                    ["labels"] = new JsonObject
                    {
                        [_dashboardManagedLabelKey] = DashboardManagedLabelValue
                    }
                },
                ["spec"] = new JsonObject
                {
                    ["route"] = route,
                    ["receivers"] = receivers
                }
            };

            try
            {
                var existing = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                    AlertmanagerConfigGroup,
                    AlertmanagerConfigVersion,
                    _options.AlertmanagerConfigNamespace,
                    AlertmanagerConfigPlural,
                    _options.AlertmanagerConfigName,
                    cancellationToken: cancellationToken);
                var existingNode = JsonNode.Parse(JsonSerializer.Serialize(existing, SerializerOptions))?.AsObject();
                var resourceVersion = existingNode?["metadata"]?["resourceVersion"]?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(resourceVersion))
                {
                    config["metadata"]!["resourceVersion"] = resourceVersion;
                }

                await _kubernetesClient.CustomObjects.ReplaceNamespacedCustomObjectAsync(
                    config,
                    AlertmanagerConfigGroup,
                    AlertmanagerConfigVersion,
                    _options.AlertmanagerConfigNamespace,
                    AlertmanagerConfigPlural,
                    _options.AlertmanagerConfigName,
                    cancellationToken: cancellationToken);
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                await _kubernetesClient.CustomObjects.CreateNamespacedCustomObjectAsync(
                    config,
                    AlertmanagerConfigGroup,
                    AlertmanagerConfigVersion,
                    _options.AlertmanagerConfigNamespace,
                    AlertmanagerConfigPlural,
                    cancellationToken: cancellationToken);
            }
        }

        private async Task<IReadOnlyList<AlertGroupDefinition>> GetAlertmanagerGroupsFromSecretAsync(
            CancellationToken cancellationToken)
        {
            try
            {
                var secret = await _kubernetesClient.CoreV1.ReadNamespacedSecretAsync(
                    _options.AlertmanagerGeneratedSecretName,
                    _options.AlertmanagerConfigNamespace,
                    cancellationToken: cancellationToken);

                if (secret.Data == null ||
                    !secret.Data.TryGetValue(_options.AlertmanagerGeneratedSecretKey, out var gzBytes))
                {
                    return new List<AlertGroupDefinition>();
                }

                var yaml = DecompressGzipToString(gzBytes);
                if (string.IsNullOrWhiteSpace(yaml))
                {
                    return new List<AlertGroupDefinition>();
                }

                return ParseAlertmanagerYamlGroups(yaml);
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return new List<AlertGroupDefinition>();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse alertmanager generated secret.");
                return new List<AlertGroupDefinition>();
            }
        }

        private static string DecompressGzipToString(byte[] compressedBytes)
        {
            using var input = new MemoryStream(compressedBytes);
            using var gzip = new GZipStream(input, CompressionMode.Decompress);
            using var reader = new StreamReader(gzip, Encoding.UTF8);
            return reader.ReadToEnd();
        }

        private static IReadOnlyList<AlertGroupDefinition> ParseAlertmanagerYamlGroups(string yaml)
        {
            var deserializer = new DeserializerBuilder().Build();
            var root = deserializer.Deserialize<Dictionary<object, object>>(yaml);

            var receiverEmailMap = ExtractReceivers(root)
                .Select(receiver => new AlertGroupDefinition
                {
                    Name = NormalizeAlertGroupName(receiver.Name),
                    Emails = receiver.Emails
                })
                .Where(receiver => !string.IsNullOrWhiteSpace(receiver.Name))
                .GroupBy(receiver => receiver.Name, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    group => group.Key,
                    group => group.SelectMany(g => g.Emails)
                        .Where(e => !string.IsNullOrWhiteSpace(e))
                        .Select(e => e.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList(),
                    StringComparer.OrdinalIgnoreCase);

            var groups = new List<AlertGroupDefinition>();
            foreach (var route in ExtractRoutes(root))
            {
                var receiver = NormalizeAlertGroupName(route.Receiver);
                if (string.IsNullOrWhiteSpace(receiver) || receiver.Equals("null", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                receiverEmailMap.TryGetValue(receiver, out var emails);
                groups.Add(new AlertGroupDefinition
                {
                    Name = receiver,
                    Emails = emails ?? new List<string>(),
                    RouteKeys = route.RouteKeys.Count > 0
                        ? route.RouteKeys
                        : new List<string>()
                });
            }

            return groups
                .GroupBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
                .Select(g => new AlertGroupDefinition
                {
                    Name = g.Key,
                    Emails = g.SelectMany(x => x.Emails).Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
                    RouteKeys = g.SelectMany(x => NormalizeRouteKeys(x.RouteKeys, g.Key, useFallbackWhenMissing: false))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .OrderBy(x => x)
                        .ToList()
                })
                .OrderBy(g => g.Name)
                .ToList();
        }

        private static string NormalizeAlertGroupName(string? name)
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                return string.Empty;
            }

            var trimmed = name.Trim();
            var segments = trimmed.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (segments.Length == 3)
            {
                return segments[2];
            }

            return trimmed;
        }

        private static string BuildAlertGroupMatcherValue(string receiverName)
        {
            var normalized = NormalizeAlertGroupName(receiverName);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return string.Empty;
            }

            const string receiverSuffix = "-alerts-email";
            if (normalized.EndsWith(receiverSuffix, StringComparison.OrdinalIgnoreCase))
            {
                var logicalGroup = normalized[..^receiverSuffix.Length];
                if (!string.IsNullOrWhiteSpace(logicalGroup))
                {
                    return logicalGroup;
                }
            }

            return normalized;
        }

        private static List<string> NormalizeRouteKeys(
            IEnumerable<string>? routeKeys,
            string receiverName,
            bool useFallbackWhenMissing = true)
        {
            if (routeKeys is null)
            {
                if (!useFallbackWhenMissing)
                {
                    return new List<string>();
                }

                var fallbackWhenMissing = BuildAlertGroupMatcherValue(receiverName);
                return string.IsNullOrWhiteSpace(fallbackWhenMissing)
                    ? new List<string>()
                    : new List<string> { fallbackWhenMissing };
            }

            var normalized = routeKeys
                .Where(key => !string.IsNullOrWhiteSpace(key))
                .Select(key => key.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(key => key)
                .ToList();

            if (normalized.Count > 0)
            {
                return normalized;
            }

            if (!useFallbackWhenMissing)
            {
                return new List<string>();
            }

            var fallbackForEmpty = BuildAlertGroupMatcherValue(receiverName);
            return string.IsNullOrWhiteSpace(fallbackForEmpty)
                ? new List<string>()
                : new List<string> { fallbackForEmpty };
        }

        private static List<string> ExtractAlertGroupRouteKeysFromJsonNode(JsonNode? matchersNode)
        {
            if (matchersNode is not JsonArray matchersArray)
            {
                return new List<string>();
            }

            var routeKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var matcher in matchersArray)
            {
                if (matcher == null)
                {
                    continue;
                }

                if (matcher is JsonObject matcherObj)
                {
                    var name = matcherObj["name"]?.GetValue<string>()?.Trim() ?? string.Empty;
                    if (!name.Equals("alert_group", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var value = matcherObj["value"]?.GetValue<string>()?.Trim() ?? string.Empty;
                    if (!string.IsNullOrWhiteSpace(value))
                    {
                        routeKeys.Add(value);
                    }
                    continue;
                }

                if (matcher is JsonValue matcherValue &&
                    matcherValue.TryGetValue<string>(out var matcherText))
                {
                    foreach (var key in ExtractAlertGroupValuesFromMatcherStrings(new[] { matcherText }))
                    {
                        routeKeys.Add(key);
                    }
                }
            }

            return routeKeys.OrderBy(key => key).ToList();
        }

        private static List<string> ExtractAlertGroupValuesFromMatcherStrings(IEnumerable<string> matcherStrings)
        {
            var results = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var matcher in matcherStrings)
            {
                if (string.IsNullOrWhiteSpace(matcher))
                {
                    continue;
                }

                var text = matcher.Trim();
                if (!text.StartsWith("alert_group", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var equalsIndex = text.IndexOf('=');
                if (equalsIndex < 0 || equalsIndex >= text.Length - 1)
                {
                    continue;
                }

                var valuePart = text[(equalsIndex + 1)..].Trim();
                valuePart = valuePart.Trim('"').Trim('\'');
                if (!string.IsNullOrWhiteSpace(valuePart))
                {
                    results.Add(valuePart);
                }
            }

            return results.OrderBy(value => value).ToList();
        }

        private static IEnumerable<(string Name, List<string> Emails)> ExtractReceivers(Dictionary<object, object> root)
        {
            if (!root.TryGetValue("receivers", out var receiversObj) || receiversObj is not IEnumerable<object> receivers)
            {
                return Array.Empty<(string, List<string>)>();
            }

            var result = new List<(string, List<string>)>();
            foreach (var receiverObj in receivers)
            {
                if (receiverObj is not Dictionary<object, object> receiverDict) continue;
                if (!receiverDict.TryGetValue("name", out var nameObj)) continue;
                var name = nameObj?.ToString() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(name)) continue;

                var emails = new List<string>();
                if (receiverDict.TryGetValue("email_configs", out var emailConfigsObj) &&
                    emailConfigsObj is IEnumerable<object> emailConfigs)
                {
                    foreach (var emailConfigObj in emailConfigs)
                    {
                        if (emailConfigObj is not Dictionary<object, object> emailDict) continue;
                        if (emailDict.TryGetValue("to", out var toObj))
                        {
                            var email = toObj?.ToString();
                            if (!string.IsNullOrWhiteSpace(email)) emails.Add(email.Trim());
                        }
                    }
                }

                result.Add((name, emails));
            }

            return result;
        }

        private static IEnumerable<(string? Receiver, List<string> RouteKeys)> ExtractRoutes(Dictionary<object, object> root)
        {
            if (!root.TryGetValue("route", out var routeObj) || routeObj is not Dictionary<object, object> routeDict)
            {
                return Array.Empty<(string?, List<string>)>();
            }

            if (!routeDict.TryGetValue("routes", out var routesObj) || routesObj is not IEnumerable<object> routes)
            {
                return Array.Empty<(string?, List<string>)>();
            }

            var results = new List<(string?, List<string>)>();
            foreach (var routeEntry in routes)
            {
                if (routeEntry is not Dictionary<object, object> routeEntryDict) continue;
                var receiver = routeEntryDict.TryGetValue("receiver", out var receiverObj)
                    ? receiverObj?.ToString()
                    : null;

                var matchers = new List<string>();
                if (routeEntryDict.TryGetValue("matchers", out var matchersObj) &&
                    matchersObj is IEnumerable<object> matchersList)
                {
                    matchers.AddRange(matchersList.Select(m => m?.ToString() ?? string.Empty));
                }

                var routeKeys = ExtractAlertGroupValuesFromMatcherStrings(matchers);
                results.Add((receiver, routeKeys));
            }

            return results;
        }

        private string GetAlertmanagerApiBaseUrl()
        {
            var alertsUrl = _options.AlertmanagerApiUrl.TrimEnd('/');
            var marker = "/api/v2/alerts";
            if (alertsUrl.EndsWith(marker, StringComparison.OrdinalIgnoreCase))
            {
                return alertsUrl[..^marker.Length] + "/api/v2";
            }

            if (alertsUrl.EndsWith("/api/v2", StringComparison.OrdinalIgnoreCase))
            {
                return alertsUrl;
            }

            return alertsUrl + "/api/v2";
        }

        private static Dictionary<string, string> BuildMatchers(SuppressPrometheusAlertRequest request)
        {
            var matchers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["alertname"] = request.AlertName.Trim()
            };

            if (!string.IsNullOrWhiteSpace(request.NamespaceName))
                matchers["namespace"] = request.NamespaceName.Trim();
            if (!string.IsNullOrWhiteSpace(request.Severity))
                matchers["severity"] = request.Severity.Trim();
            if (!string.IsNullOrWhiteSpace(request.PodName))
                matchers["pod"] = request.PodName.Trim();

            return matchers;
        }

        private static CreatePrometheusAlertRuleProposalRequest NormalizeCreateRequest(CreatePrometheusAlertRuleProposalRequest request)
        {
            return new CreatePrometheusAlertRuleProposalRequest
            {
                AlertName = request.AlertName.Trim(),
                Expr = request.Expr.Trim(),
                For = string.IsNullOrWhiteSpace(request.For) ? "5m" : request.For.Trim(),
                Severity = string.IsNullOrWhiteSpace(request.Severity) ? "warning" : request.Severity.Trim().ToLowerInvariant(),
                Summary = request.Summary.Trim(),
                Description = request.Description.Trim(),
                GroupName = string.IsNullOrWhiteSpace(request.GroupName)
                    ? "kube-dashboard-custom-alerts"
                    : request.GroupName.Trim()
            };
        }

        private static UpdatePrometheusAlertRuleProposalRequest NormalizeUpdateRequest(UpdatePrometheusAlertRuleProposalRequest request)
        {
            return new UpdatePrometheusAlertRuleProposalRequest
            {
                AlertName = request.AlertName.Trim(),
                Expr = request.Expr.Trim(),
                For = string.IsNullOrWhiteSpace(request.For) ? "5m" : request.For.Trim(),
                Severity = string.IsNullOrWhiteSpace(request.Severity) ? "warning" : request.Severity.Trim().ToLowerInvariant(),
                Summary = request.Summary.Trim(),
                Description = request.Description.Trim(),
                GroupName = string.IsNullOrWhiteSpace(request.GroupName)
                    ? "kube-dashboard-custom-alerts"
                    : request.GroupName.Trim(),
                Status = NormalizeStatus(request.Status)
            };
        }

        private static string NormalizeStatus(string? status)
        {
            var value = string.IsNullOrWhiteSpace(status) ? "Draft" : status.Trim();
            if (value.Equals("approved", StringComparison.OrdinalIgnoreCase))
            {
                return "Approved";
            }

            if (value.Equals("rejected", StringComparison.OrdinalIgnoreCase))
            {
                return "Rejected";
            }

            return "Draft";
        }

        private static string BuildPrometheusRuleYaml(List<PrometheusAlertRuleProposal> proposals)
        {
            var sb = new StringBuilder();
            sb.AppendLine("apiVersion: monitoring.coreos.com/v1");
            sb.AppendLine("kind: PrometheusRule");
            sb.AppendLine("metadata:");
            sb.AppendLine("  name: kube-dashboard-custom-alerts");
            sb.AppendLine("  labels:");
            sb.AppendLine("    app.kubernetes.io/managed-by: argocd");
            sb.AppendLine("spec:");
            sb.AppendLine("  groups:");

            var grouped = proposals
                .GroupBy(p => p.GroupName)
                .OrderBy(g => g.Key)
                .ToList();

            if (grouped.Count == 0)
            {
                sb.AppendLine("    - name: kube-dashboard-custom-alerts");
                sb.AppendLine("      rules: []");
                return sb.ToString();
            }

            foreach (var group in grouped)
            {
                sb.AppendLine($"    - name: {EscapeYaml(group.Key)}");
                sb.AppendLine("      rules:");

                foreach (var proposal in group)
                {
                    sb.AppendLine($"        - alert: {EscapeYaml(proposal.AlertName)}");
                    sb.AppendLine($"          expr: {EscapeYaml(proposal.Expr)}");
                    sb.AppendLine($"          for: {EscapeYaml(proposal.For)}");
                    sb.AppendLine("          labels:");
                    sb.AppendLine($"            severity: {EscapeYaml(proposal.Severity)}");
                    sb.AppendLine("          annotations:");
                    sb.AppendLine($"            summary: {EscapeYaml(proposal.Summary)}");
                    sb.AppendLine($"            description: {EscapeYaml(proposal.Description)}");
                }
            }

            return sb.ToString();
        }

        private static string EscapeYaml(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "\"\"";
            }

            return $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";
        }

        private int NormalizeRangeHours(int? rangeHours)
        {
            if (rangeHours.HasValue && rangeHours.Value > 0)
            {
                return Math.Min(rangeHours.Value, 24 * 30);
            }

            return _options.FiringAlertWindowHours > 0 ? _options.FiringAlertWindowHours : 168;
        }

        private async Task<IReadOnlyList<PrometheusFiringAlert>> QueryHistoricalAlertsAsync(
            int rangeHours,
            CancellationToken cancellationToken)
        {
            var end = DateTime.UtcNow;
            var start = end.AddHours(-rangeHours);
            var step = BuildRangeStep(rangeHours);

            var result = await _prometheusQueryService.QueryRangeAsync(
                "ALERTS{alertstate=\"firing\"}",
                start,
                end,
                step,
                cancellationToken);

            if (result == null || result.Series.Count == 0)
            {
                return Array.Empty<PrometheusFiringAlert>();
            }

            var byKey = new Dictionary<string, PrometheusFiringAlert>(StringComparer.OrdinalIgnoreCase);

            foreach (var series in result.Series)
            {
                var positivePoints = series.Points
                    .Where(p => p.Value > 0)
                    .OrderBy(p => p.Timestamp)
                    .ToList();

                if (positivePoints.Count == 0)
                {
                    continue;
                }

                var labels = series.Labels;
                var alertName = labels.GetValueOrDefault("alertname") ?? "unknown";
                var severity = labels.GetValueOrDefault("severity") ?? "unknown";
                var namespaceName = labels.GetValueOrDefault("namespace");
                var podName = labels.GetValueOrDefault("pod");

                var first = positivePoints.First().Timestamp;
                var last = positivePoints.Last().Timestamp;
                var key = $"{alertName}|{severity}|{namespaceName}|{podName}";

                if (!byKey.TryGetValue(key, out var existing))
                {
                    var labelCopy = new Dictionary<string, string>(labels);
                    labelCopy.Remove("__name__");
                    labelCopy.Remove("alertstate");

                    byKey[key] = new PrometheusFiringAlert
                    {
                        AlertName = alertName,
                        Severity = severity,
                        State = "firing",
                        NamespaceName = namespaceName,
                        PodName = podName,
                        FirstOccurrenceAt = first,
                        LastOccurrenceAt = last,
                        StartsAt = first,
                        UpdatedAt = last,
                        FiringForSeconds = GetFiringForSeconds(first, end),
                        Labels = labelCopy
                    };
                }
                else
                {
                    if (!existing.FirstOccurrenceAt.HasValue || first < existing.FirstOccurrenceAt.Value)
                    {
                        existing.FirstOccurrenceAt = first;
                        existing.StartsAt = first;
                    }

                    if (!existing.LastOccurrenceAt.HasValue || last > existing.LastOccurrenceAt.Value)
                    {
                        existing.LastOccurrenceAt = last;
                        existing.UpdatedAt = last;
                    }

                    existing.FiringForSeconds = GetFiringForSeconds(existing.FirstOccurrenceAt, end);
                }
            }

            foreach (var alert in byKey.Values)
            {
                alert.FirstOccurrenceAt = AlertTimeZone.ConvertFromUtc(alert.FirstOccurrenceAt ?? DateTime.MinValue);
                alert.LastOccurrenceAt = AlertTimeZone.ConvertFromUtc(alert.LastOccurrenceAt ?? DateTime.MinValue);
                alert.StartsAt = AlertTimeZone.ConvertFromUtc(alert.StartsAt ?? DateTime.MinValue);
                alert.UpdatedAt = AlertTimeZone.ConvertFromUtc(alert.UpdatedAt ?? DateTime.MinValue);
            }

            return byKey.Values
                .OrderByDescending(a => a.LastOccurrenceAt ?? DateTime.MinValue)
                .ToList();
        }

        private static string BuildRangeStep(int rangeHours)
        {
            if (rangeHours <= 24) return "1m";
            if (rangeHours <= 72) return "2m";
            if (rangeHours <= 168) return "5m";
            if (rangeHours <= 336) return "10m";
            return "30m";
        }

        private static long GetFiringForSeconds(DateTime? startsAt, DateTime nowUtc)
        {
            if (!startsAt.HasValue)
            {
                return 0;
            }

            var seconds = (long)(nowUtc - startsAt.Value).TotalSeconds;
            return seconds < 0 ? 0 : seconds;
        }

        private sealed class SilenceCreateResponse
        {
            public string? SilenceID { get; set; }
        }

        private sealed class AlertmanagerSilenceDto
        {
            public string? Id { get; set; }
            public AlertmanagerSilenceStatusDto? Status { get; set; }
            public List<AlertmanagerMatcherDto>? Matchers { get; set; }
            public DateTime? StartsAt { get; set; }
            public DateTime? EndsAt { get; set; }
            public DateTime? UpdatedAt { get; set; }
            public string? CreatedBy { get; set; }
            public string? Comment { get; set; }
        }

        private sealed class AlertmanagerSilenceStatusDto
        {
            public string? State { get; set; }
        }

        private sealed class AlertmanagerMatcherDto
        {
            public string? Name { get; set; }
            public string? Value { get; set; }
        }
    }
}
