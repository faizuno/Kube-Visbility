using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Models.Kafka;
using KubeVisibility.Dashboard.Api.Models.PrometheusAlerts;
using KubeVisibility.Dashboard.Api.Options;
using KubeVisibility.Dashboard.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;

namespace KubeVisibility.Dashboard.Api.Filters;

/// <summary>
/// Captures audit events for mutating admin-only API actions.
/// </summary>
public sealed class AdminMutationAuditFilter : IAsyncActionFilter
{
    private static readonly HashSet<string> MutatingMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        HttpMethods.Post,
        HttpMethods.Put,
        HttpMethods.Patch,
        HttpMethods.Delete
    };

    private readonly IAdminAuditService _adminAuditService;
    private readonly IClusterService _clusterService;
    private readonly IPrometheusAlertService _prometheusAlertService;
    private readonly ITopicAlertingService _topicAlertingService;
    private readonly IOptions<AdminAuditOptions> _options;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AdminMutationAuditFilter> _logger;

    public AdminMutationAuditFilter(
        IAdminAuditService adminAuditService,
        IClusterService clusterService,
        IPrometheusAlertService prometheusAlertService,
        ITopicAlertingService topicAlertingService,
        IOptions<AdminAuditOptions> options,
        IConfiguration configuration,
        ILogger<AdminMutationAuditFilter> logger)
    {
        _adminAuditService = adminAuditService;
        _clusterService = clusterService;
        _prometheusAlertService = prometheusAlertService;
        _topicAlertingService = topicAlertingService;
        _options = options;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!ShouldAudit(context))
        {
            await next();
            return;
        }

        var preCronWorkflow = await TryGetCronWorkflowBeforeUpdateAsync(context);
        var preSuppressionSnapshot = await TryGetSuppressionBeforePrometheusSuppressMutationAsync(context);
        var preAlertRuleDefinition = await TryGetAlertRuleBeforeApplyAsync(context);
        var preTopicAlertGroup = await TryGetTopicAlertGroupBeforeMutationAsync(context);
        var preTopicAlertRule = await TryGetTopicAlertRuleBeforeMutationAsync(context);
        var requestBody = await ReadRequestBodyAsync(context.HttpContext.Request);
        var executedContext = await next();

        var statusCode = executedContext.HttpContext.Response.StatusCode;
        var success = executedContext.Exception == null && statusCode is >= 200 and < 400;
        var error = executedContext.Exception?.Message;
        var path = executedContext.HttpContext.Request.Path.Value ?? string.Empty;
        var method = executedContext.HttpContext.Request.Method;
        var target = ResolveTarget(context);
        var serviceName = ResolveServiceName(path);
        var eventType = ResolveEventType(
            context,
            path,
            method,
            target.Namespace,
            KubernetesInfoConfiguration.GetConsumersNamespace(_configuration));
        var actionName = ResolveActionName(eventType);
        var actor = ResolveActor(executedContext.HttpContext.User);
        var resourceType = target.ResourceType;
        var resourceName = target.ResourceName;
        var ns = target.Namespace;
        var actionPerformedOn = BuildActionPerformedOn(resourceType, resourceName, ns, serviceName);

        if (eventType == AdminAuditEventType.Requeued)
        {
            var requeue = ResolveRequeueAuditData(context, requestBody);
            resourceType = "topic";
            resourceName = requeue.TopicName;
            actionPerformedOn = requeue.MessageDescription;
        }
        else if (IsCronWorkflowUpdatePath(path))
        {
            var cronUpdateRequest = ResolveCronWorkflowUpdateRequest(context);
            var updatedCronWorkflow = ResolveUpdatedCronWorkflowFromResult(executedContext);
            var changeSummary = BuildCronWorkflowChangeSummary(preCronWorkflow, updatedCronWorkflow, cronUpdateRequest);
            if (string.IsNullOrWhiteSpace(changeSummary) && success)
            {
                // For successful CronWorkflow edits, only audit when there are effective changes.
                return;
            }

            if (!string.IsNullOrWhiteSpace(changeSummary))
            {
                actionPerformedOn = changeSummary;
            }
        }
        else if (IsPrometheusRuleApplyPath(path))
        {
            var ruleApplyRequest = ResolvePrometheusRuleApplyRequest(context);
            var updatedRule = ResolveAppliedPrometheusRuleFromResult(executedContext);

            if (!string.IsNullOrWhiteSpace(ruleApplyRequest?.AlertName))
            {
                resourceType = "alert";
                resourceName = ruleApplyRequest.AlertName.Trim();
            }

            var changeSummary = BuildPrometheusRuleApplyChangeSummary(preAlertRuleDefinition, updatedRule, ruleApplyRequest);
            if (string.IsNullOrWhiteSpace(changeSummary) && success)
            {
                // For successful alert definition edits, only audit when effective fields changed.
                return;
            }

            if (!string.IsNullOrWhiteSpace(changeSummary))
            {
                actionPerformedOn = changeSummary;
            }
        }
        else if (TryBuildPrometheusSuppressAuditActionPerformedOn(context, path, method, preSuppressionSnapshot, out var suppressActionPerformedOn))
        {
            var resolvedResource = ResolvePrometheusSuppressionResource(context, path, method, preSuppressionSnapshot);
            if (!string.IsNullOrWhiteSpace(resolvedResource))
            {
                resourceType = "alert";
                resourceName = resolvedResource;
            }

            // Namespace column should be empty for Prometheus alert mutation audits.
            ns = null;
            actionPerformedOn = suppressActionPerformedOn;
        }
        else if (TryBuildTopicAlertingAuditActionPerformedOn(
            context,
            executedContext,
            path,
            method,
            preTopicAlertGroup,
            preTopicAlertRule,
            out var topicAlertingActionPerformedOn,
            out var topicAlertingResourceType,
            out var topicAlertingResourceName))
        {
            if (!string.IsNullOrWhiteSpace(topicAlertingResourceType))
            {
                resourceType = topicAlertingResourceType;
            }

            if (!string.IsNullOrWhiteSpace(topicAlertingResourceName))
            {
                resourceName = topicAlertingResourceName;
            }

            // Topic alerting rules/groups are global settings, keep namespace blank.
            ns = null;
            actionPerformedOn = topicAlertingActionPerformedOn;
        }

        var auditEvent = new AdminAuditEvent
        {
            TimestampUtc = DateTime.UtcNow,
            EventType = eventType,
            ServiceName = serviceName,
            ActionPerformedOn = actionPerformedOn,
            EventStatus = success ? AdminAuditEventStatus.Success : AdminAuditEventStatus.Failed,
            Action = actionName,
            ResourceType = resourceType,
            ResourceName = resourceName,
            Namespace = ns,
            EventDescription = BuildEventDescription(eventType, actionPerformedOn),
            Actor = actor,
            ActorEmail = ResolveActorEmail(executedContext.HttpContext.User),
            ActorGroups = ResolveActorGroups(executedContext.HttpContext.User),
            HttpMethod = method,
            Path = $"{executedContext.HttpContext.Request.Path}{executedContext.HttpContext.Request.QueryString}",
            EndpointDisplayName = context.ActionDescriptor.DisplayName,
            StatusCode = statusCode,
            Success = success,
            CorrelationId = ResolveCorrelationId(executedContext.HttpContext),
            RequestBody = requestBody,
            Error = error
        };

        try
        {
            await _adminAuditService.WriteEventAsync(auditEvent, executedContext.HttpContext.RequestAborted);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write admin audit event for {Method} {Path}", auditEvent.HttpMethod, auditEvent.Path);
        }
    }

    private bool ShouldAudit(ActionExecutingContext context)
    {
        if (!_options.Value.Enabled)
        {
            return false;
        }

        if (!MutatingMethods.Contains(context.HttpContext.Request.Method))
        {
            return false;
        }

        var authorizeMetadata = context.ActionDescriptor.EndpointMetadata.OfType<AuthorizeAttribute>();
        return authorizeMetadata.Any(a => string.Equals(a.Policy, "AdminOnly", StringComparison.OrdinalIgnoreCase));
    }

    private async Task<string?> ReadRequestBodyAsync(HttpRequest request)
    {
        if (request.ContentType != null &&
            !(request.ContentType.Contains("application/json", StringComparison.OrdinalIgnoreCase) ||
              request.ContentType.Contains("text/", StringComparison.OrdinalIgnoreCase) ||
              request.ContentType.Contains("application/x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase)))
        {
            return $"[content omitted: {request.ContentType}]";
        }

        request.EnableBuffering();

        var maxChars = Math.Max(256, _options.Value.MaxRequestBodyChars);
        var buffer = new char[maxChars + 1];

        using var reader = new StreamReader(request.Body, leaveOpen: true);
        var read = await reader.ReadBlockAsync(buffer, 0, buffer.Length);
        request.Body.Position = 0;

        if (read <= 0)
        {
            return null;
        }

        var value = new string(buffer, 0, Math.Min(read, maxChars));
        return read > maxChars ? $"{value}...[truncated]" : value;
    }

    private static string ResolveActor(ClaimsPrincipal user)
    {
        return user.FindFirstValue("name")
            ?? user.FindFirstValue("preferred_username")
            ?? user.FindFirstValue(ClaimTypes.Name)
            ?? "unknown";
    }

    private static string? ResolveActorEmail(ClaimsPrincipal user)
    {
        return user.FindFirstValue("email")
            ?? user.FindFirstValue(ClaimTypes.Email)
            ?? user.FindFirstValue("preferred_username");
    }

    private static IReadOnlyList<string> ResolveActorGroups(ClaimsPrincipal user)
    {
        var groups = user.FindAll("groups")
            .Select(c => c.Value)
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (groups.Count > 0)
        {
            return groups;
        }

        return user.FindAll("role")
            .Select(c => c.Value)
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string ResolveCorrelationId(HttpContext httpContext)
    {
        var headerCorrelationId = httpContext.Request.Headers["X-Correlation-ID"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(headerCorrelationId))
        {
            return headerCorrelationId!;
        }

        return Activity.Current?.TraceId.ToString() ?? httpContext.TraceIdentifier;
    }

    private static string ResolveActionName(AdminAuditEventType eventType)
    {
        return eventType.ToString().ToLowerInvariant();
    }

    private static (string? ResourceType, string? ResourceName, string? Namespace) ResolveTarget(ActionExecutingContext context)
    {
        string? resourceType = null;
        string? resourceName = null;
        string? ns = null;

        foreach (var arg in context.ActionArguments.Values)
        {
            if (arg == null)
            {
                continue;
            }

            var type = arg.GetType();
            resourceType ??= GetPropertyString(type, arg, "ResourceType");
            resourceName ??= GetPropertyString(type, arg, "ResourceName")
                ?? GetPropertyString(type, arg, "DeploymentName")
                ?? GetPropertyString(type, arg, "PodName")
                ?? GetPropertyString(type, arg, "GroupName")
                ?? GetPropertyString(type, arg, "AlertName")
                ?? GetPropertyString(type, arg, "SilenceId")
                ?? GetPropertyString(type, arg, "ProposalId");
            ns ??= GetPropertyString(type, arg, "NamespaceName")
                ?? GetPropertyString(type, arg, "Namespace");
        }

        if (string.IsNullOrWhiteSpace(resourceName) &&
            context.ActionArguments.TryGetValue("silenceId", out var silenceIdValue) &&
            silenceIdValue is string silenceId)
        {
            resourceName = silenceId;
            resourceType ??= "suppression";
        }

        if (string.IsNullOrWhiteSpace(resourceName) &&
            context.ActionArguments.TryGetValue("groupName", out var groupNameValue) &&
            groupNameValue is string groupName)
        {
            resourceName = groupName;
            resourceType ??= "alert-group";
        }

        if (string.IsNullOrWhiteSpace(resourceName) &&
            context.ActionArguments.TryGetValue("groupId", out var groupIdValue) &&
            groupIdValue is string groupId)
        {
            resourceName = groupId;
            resourceType ??= "topic-alert-group";
        }

        if (string.IsNullOrWhiteSpace(resourceName) &&
            context.ActionArguments.TryGetValue("ruleId", out var ruleIdValue) &&
            ruleIdValue is string ruleId)
        {
            resourceName = ruleId;
            resourceType ??= "topic-alert-rule";
        }

        if (string.IsNullOrWhiteSpace(resourceName) &&
            context.ActionArguments.TryGetValue("proposalId", out var proposalIdValue) &&
            proposalIdValue is string proposalId)
        {
            resourceName = proposalId;
            resourceType ??= "proposal";
        }

        return (resourceType, resourceName, ns);
    }

    private static string? GetPropertyString(Type type, object target, string propertyName)
    {
        var prop = type.GetProperty(propertyName);
        if (prop == null || prop.PropertyType != typeof(string))
        {
            return null;
        }

        var value = prop.GetValue(target) as string;
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static bool TryGetBooleanPropertyFromArgs(ActionExecutingContext context, string propertyName, out bool value)
    {
        foreach (var arg in context.ActionArguments.Values)
        {
            if (arg == null)
            {
                continue;
            }

            var type = arg.GetType();
            var prop = type.GetProperty(propertyName);
            if (prop == null || prop.PropertyType != typeof(bool))
            {
                continue;
            }

            var propValue = prop.GetValue(arg);
            if (propValue is bool boolValue)
            {
                value = boolValue;
                return true;
            }
        }

        value = false;
        return false;
    }

    private static bool IsCronWorkflowUpdatePath(string path)
    {
        return string.Equals(path, "/api/cronworkflows/update", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPrometheusRuleApplyPath(string path)
    {
        return string.Equals(path, "/api/prometheus-alerts/rules/apply", StringComparison.OrdinalIgnoreCase);
    }

    private static UpdateCronWorkflowRequest? ResolveCronWorkflowUpdateRequest(ActionExecutingContext context)
    {
        return context.ActionArguments.Values.OfType<UpdateCronWorkflowRequest>().FirstOrDefault();
    }

    private static ResourceInfo? ResolveUpdatedCronWorkflowFromResult(ActionExecutedContext executedContext)
    {
        if (executedContext.Result is not ObjectResult objectResult || objectResult.Value == null)
        {
            return null;
        }

        if (objectResult.Value is UpdateCronWorkflowResponse typedResponse)
        {
            return typedResponse.UpdatedResource;
        }

        return null;
    }

    private static ApplyPrometheusRuleRequest? ResolvePrometheusRuleApplyRequest(ActionExecutingContext context)
    {
        return context.ActionArguments.Values.OfType<ApplyPrometheusRuleRequest>().FirstOrDefault();
    }

    private static PrometheusRuleDefinition? ResolveAppliedPrometheusRuleFromResult(ActionExecutedContext executedContext)
    {
        if (executedContext.Result is not ObjectResult objectResult || objectResult.Value == null)
        {
            return null;
        }

        if (objectResult.Value is ApplyPrometheusRuleResponse typedResponse)
        {
            return typedResponse.Result;
        }

        return null;
    }

    private async Task<ResourceInfo?> TryGetCronWorkflowBeforeUpdateAsync(ActionExecutingContext context)
    {
        if (!IsCronWorkflowUpdatePath(context.HttpContext.Request.Path.Value ?? string.Empty))
        {
            return null;
        }

        var request = ResolveCronWorkflowUpdateRequest(context);
        if (request == null ||
            string.IsNullOrWhiteSpace(request.NamespaceName) ||
            string.IsNullOrWhiteSpace(request.ResourceName))
        {
            return null;
        }

        try
        {
            return await _clusterService.GetCronWorkflowByNameAsync(request.NamespaceName, request.ResourceName);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to capture pre-update CronWorkflow snapshot for audit.");
            return null;
        }
    }

    private async Task<PrometheusSuppression?> TryGetSuppressionBeforePrometheusSuppressMutationAsync(ActionExecutingContext context)
    {
        var path = context.HttpContext.Request.Path.Value ?? string.Empty;
        var method = context.HttpContext.Request.Method;
        if (!IsPrometheusSuppressEditPath(path, method) && !IsPrometheusUnsuppressPath(path, method))
        {
            return null;
        }

        if (!context.ActionArguments.TryGetValue("silenceId", out var silenceIdValue) ||
            silenceIdValue is not string silenceId ||
            string.IsNullOrWhiteSpace(silenceId))
        {
            return null;
        }

        try
        {
            var suppressions = await _prometheusAlertService.GetSuppressionsAsync(context.HttpContext.RequestAborted);
            return suppressions.FirstOrDefault(s =>
                s.SilenceId.Equals(silenceId.Trim(), StringComparison.OrdinalIgnoreCase));
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to capture suppression snapshot before prometheus suppress mutation for audit.");
            return null;
        }
    }

    private async Task<PrometheusRuleDefinition?> TryGetAlertRuleBeforeApplyAsync(ActionExecutingContext context)
    {
        var path = context.HttpContext.Request.Path.Value ?? string.Empty;
        if (!IsPrometheusRuleApplyPath(path))
        {
            return null;
        }

        var request = ResolvePrometheusRuleApplyRequest(context);
        var targetAlertName = !string.IsNullOrWhiteSpace(request?.OriginalAlertName)
            ? request.OriginalAlertName!.Trim()
            : request?.AlertName?.Trim();
        if (string.IsNullOrWhiteSpace(targetAlertName))
        {
            return null;
        }

        try
        {
            return await _prometheusAlertService.GetRuleDefinitionAsync(targetAlertName, context.HttpContext.RequestAborted);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to capture pre-update alert rule snapshot for audit.");
            return null;
        }
    }

    private async Task<TopicAlertGroup?> TryGetTopicAlertGroupBeforeMutationAsync(ActionExecutingContext context)
    {
        var path = context.HttpContext.Request.Path.Value ?? string.Empty;
        if (!IsTopicAlertGroupMutationPath(path))
        {
            return null;
        }

        if (!context.ActionArguments.TryGetValue("groupId", out var groupIdValue) ||
            groupIdValue is not string groupId ||
            string.IsNullOrWhiteSpace(groupId))
        {
            return null;
        }

        try
        {
            return await _topicAlertingService.GetGroupAsync(groupId.Trim(), context.HttpContext.RequestAborted);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to capture pre-mutation topic alert group snapshot for audit.");
            return null;
        }
    }

    private async Task<TopicAlertRule?> TryGetTopicAlertRuleBeforeMutationAsync(ActionExecutingContext context)
    {
        var path = context.HttpContext.Request.Path.Value ?? string.Empty;
        if (!IsTopicAlertRuleMutationPath(path))
        {
            return null;
        }

        if (!context.ActionArguments.TryGetValue("ruleId", out var ruleIdValue) ||
            ruleIdValue is not string ruleId ||
            string.IsNullOrWhiteSpace(ruleId))
        {
            return null;
        }

        try
        {
            return await _topicAlertingService.GetRuleAsync(ruleId.Trim(), context.HttpContext.RequestAborted);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to capture pre-mutation topic alert rule snapshot for audit.");
            return null;
        }
    }

    private static bool TryBuildTopicAlertingAuditActionPerformedOn(
        ActionExecutingContext context,
        ActionExecutedContext executedContext,
        string path,
        string method,
        TopicAlertGroup? preGroup,
        TopicAlertRule? preRule,
        out string actionPerformedOn,
        out string? resourceType,
        out string? resourceName)
    {
        actionPerformedOn = string.Empty;
        resourceType = null;
        resourceName = null;

        if (IsTopicAlertGroupMutationPath(path))
        {
            resourceType = "topic-alert-group";
            var afterGroup = ResolveTopicAlertGroupFromResult(executedContext);
            var groupName = afterGroup?.Name ?? preGroup?.Name ?? GetGroupNameFromRequest(context) ?? "unknown-group";
            resourceName = afterGroup?.GroupId ?? preGroup?.GroupId ?? GetActionArgumentString(context, "groupId");

            if (method.Equals(HttpMethods.Post, StringComparison.OrdinalIgnoreCase))
            {
                if (afterGroup == null)
                {
                    actionPerformedOn = $"Created topic alert group '{groupName}'.";
                    return true;
                }

                var createdFields = BuildTopicAlertGroupCreateSummary(afterGroup);
                actionPerformedOn = createdFields.Count == 0
                    ? $"Created topic alert group '{groupName}'."
                    : $"Created topic alert group '{groupName}': {string.Join("; ", createdFields)}";
                return true;
            }

            if (method.Equals(HttpMethods.Put, StringComparison.OrdinalIgnoreCase))
            {
                var changes = BuildTopicAlertGroupChangeSummary(preGroup, afterGroup);
                actionPerformedOn = changes.Count == 0
                    ? $"Updated topic alert group '{groupName}' (no effective field changes)."
                    : $"Updated topic alert group '{groupName}': {string.Join("; ", changes)}";
                return true;
            }

            if (method.Equals(HttpMethods.Delete, StringComparison.OrdinalIgnoreCase))
            {
                actionPerformedOn = $"Deleted topic alert group '{groupName}' with {preGroup?.TopicNames.Count ?? 0} topics.";
                return true;
            }
        }

        if (IsTopicAlertRuleMutationPath(path))
        {
            resourceType = "topic-alert-rule";
            var afterRule = ResolveTopicAlertRuleFromResult(executedContext);
            var ruleName = afterRule?.Name ?? preRule?.Name ?? GetRuleNameFromRequest(context) ?? "unknown-rule";
            resourceName = afterRule?.RuleId ?? preRule?.RuleId ?? GetActionArgumentString(context, "ruleId");

            if (method.Equals(HttpMethods.Post, StringComparison.OrdinalIgnoreCase))
            {
                if (afterRule == null)
                {
                    actionPerformedOn = $"Created topic alert rule '{ruleName}'.";
                    return true;
                }

                var createdFields = BuildTopicAlertRuleCreateSummary(afterRule);
                actionPerformedOn = createdFields.Count == 0
                    ? $"Created topic alert rule '{ruleName}'."
                    : $"Created topic alert rule '{ruleName}': {string.Join("; ", createdFields)}";
                return true;
            }

            if (method.Equals(HttpMethods.Put, StringComparison.OrdinalIgnoreCase))
            {
                var changes = BuildTopicAlertRuleChangeSummary(preRule, afterRule);
                actionPerformedOn = changes.Count == 0
                    ? $"Updated topic alert rule '{ruleName}' (no effective field changes)."
                    : $"Updated topic alert rule '{ruleName}': {string.Join("; ", changes)}";
                return true;
            }

            if (method.Equals(HttpMethods.Patch, StringComparison.OrdinalIgnoreCase) &&
                path.EndsWith("/enabled", StringComparison.OrdinalIgnoreCase))
            {
                var beforeEnabled = preRule?.Enabled;
                var afterEnabled = afterRule?.Enabled;
                if (!afterEnabled.HasValue &&
                    context.ActionArguments.TryGetValue("enabled", out var enabledArg) &&
                    enabledArg is bool enabledValue)
                {
                    afterEnabled = enabledValue;
                }

                actionPerformedOn = $"Updated topic alert rule '{ruleName}': enabled {FormatNullableBoolean(beforeEnabled)} -> {FormatNullableBoolean(afterEnabled)}.";
                return true;
            }

            if (method.Equals(HttpMethods.Delete, StringComparison.OrdinalIgnoreCase))
            {
                actionPerformedOn = $"Deleted topic alert rule '{ruleName}'.";
                return true;
            }
        }

        return false;
    }

    private static bool IsTopicAlertGroupMutationPath(string path)
    {
        return path.StartsWith("/api/topic-alerting/groups", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsTopicAlertRuleMutationPath(string path)
    {
        return path.StartsWith("/api/topic-alerting/rules", StringComparison.OrdinalIgnoreCase);
    }

    private static TopicAlertGroup? ResolveTopicAlertGroupFromResult(ActionExecutedContext executedContext)
    {
        if (executedContext.Result is ObjectResult { Value: TopicAlertGroup group })
        {
            return group;
        }

        return null;
    }

    private static TopicAlertRule? ResolveTopicAlertRuleFromResult(ActionExecutedContext executedContext)
    {
        if (executedContext.Result is ObjectResult { Value: TopicAlertRule rule })
        {
            return rule;
        }

        return null;
    }

    private static string? GetGroupNameFromRequest(ActionExecutingContext context)
    {
        var request = context.ActionArguments.Values.OfType<UpsertTopicAlertGroupRequest>().FirstOrDefault();
        return string.IsNullOrWhiteSpace(request?.Name) ? null : request.Name.Trim();
    }

    private static string? GetRuleNameFromRequest(ActionExecutingContext context)
    {
        var request = context.ActionArguments.Values.OfType<UpsertTopicAlertRuleRequest>().FirstOrDefault();
        return string.IsNullOrWhiteSpace(request?.Name) ? null : request.Name.Trim();
    }

    private static List<string> BuildTopicAlertGroupChangeSummary(TopicAlertGroup? before, TopicAlertGroup? after)
    {
        var changes = new List<string>();
        AddChange(changes, "name", before?.Name, after?.Name);
        AddChange(changes, "description", before?.Description, after?.Description, "none");
        AddStringSetChange(changes, "topics", before?.TopicNames, after?.TopicNames);
        return changes;
    }

    private static List<string> BuildTopicAlertGroupCreateSummary(TopicAlertGroup created)
    {
        var fields = new List<string>();
        AddCreatedField(fields, "name", created.Name);
        AddCreatedField(fields, "description", created.Description, "none");
        AddCreatedField(fields, "topics", NormalizeSetForAudit(created.TopicNames), "none");
        return fields;
    }

    private static List<string> BuildTopicAlertRuleChangeSummary(TopicAlertRule? before, TopicAlertRule? after)
    {
        var changes = new List<string>();
        AddChange(changes, "name", before?.Name, after?.Name);
        AddChange(changes, "enabled", before?.Enabled, after?.Enabled);
        AddChange(changes, "targetType", before?.TargetType, after?.TargetType);
        AddStringSetChange(changes, "topics", before?.TopicNames, after?.TopicNames);
        AddChange(changes, "topicGroupId", before?.TopicGroupId, after?.TopicGroupId, "none");
        AddStringSetChange(changes, "recipients", before?.RecipientEmails, after?.RecipientEmails);
        AddChange(changes, "conditions", SerializeConditionsForAudit(before?.Conditions), SerializeConditionsForAudit(after?.Conditions), "none");
        return changes;
    }

    private static List<string> BuildTopicAlertRuleCreateSummary(TopicAlertRule created)
    {
        var fields = new List<string>();
        AddCreatedField(fields, "name", created.Name);
        AddCreatedField(fields, "enabled", created.Enabled);
        AddCreatedField(fields, "targetType", created.TargetType);
        AddCreatedField(fields, "topics", NormalizeSetForAudit(created.TopicNames), "none");
        AddCreatedField(fields, "topicGroupId", created.TopicGroupId, "none");
        AddCreatedField(fields, "recipients", NormalizeSetForAudit(created.RecipientEmails), "none");
        AddCreatedField(fields, "conditions", SerializeConditionsForAudit(created.Conditions), "none");
        return fields;
    }

    private static void AddStringSetChange(
        List<string> changes,
        string field,
        IReadOnlyList<string>? beforeValues,
        IReadOnlyList<string>? afterValues)
    {
        var before = NormalizeSetForAudit(beforeValues);
        var after = NormalizeSetForAudit(afterValues);
        if (string.Equals(before, after, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        changes.Add($"{field}: {before} -> {after}");
    }

    private static void AddCreatedField(List<string> fields, string field, object? value, string fallback = "")
    {
        var rendered = NormalizeChangeValue(value, fallback);
        if (string.IsNullOrWhiteSpace(rendered))
        {
            return;
        }

        fields.Add($"{field}: {rendered}");
    }

    private static string NormalizeSetForAudit(IReadOnlyList<string>? values)
    {
        if (values == null || values.Count == 0)
        {
            return "none";
        }

        return string.Join(", ", values
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(v => v, StringComparer.OrdinalIgnoreCase));
    }

    private static string SerializeConditionsForAudit(IReadOnlyList<TopicAlertCondition>? conditions)
    {
        if (conditions == null || conditions.Count == 0)
        {
            return "none";
        }

        try
        {
            return JsonSerializer.Serialize(conditions);
        }
        catch
        {
            return $"[{conditions.Count} condition(s)]";
        }
    }

    private static string FormatNullableBoolean(bool? value)
    {
        return value.HasValue ? value.Value.ToString().ToLowerInvariant() : "unknown";
    }

    private static bool TryBuildPrometheusSuppressAuditActionPerformedOn(
        ActionExecutingContext context,
        string path,
        string method,
        PrometheusSuppression? preSuppressionSnapshot,
        out string actionPerformedOn)
    {
        actionPerformedOn = string.Empty;

        if (IsPrometheusSuppressCreatePath(path, method))
        {
            var request = context.ActionArguments.Values.OfType<SuppressPrometheusAlertRequest>().FirstOrDefault();
            if (request == null)
            {
                return false;
            }

            var alertName = string.IsNullOrWhiteSpace(request.AlertName) ? "unknown-alert" : request.AlertName.Trim();
            var reason = string.IsNullOrWhiteSpace(request.Reason) ? "no reason provided" : request.Reason.Trim();
            var duration = FormatDuration(request.DurationHours > 0 ? request.DurationHours : 24);
            var namespaceValue = string.IsNullOrWhiteSpace(request.NamespaceName) ? "unknown-namespace" : request.NamespaceName.Trim();
            var resourceOrPod = string.IsNullOrWhiteSpace(request.PodName) ? "unknown-resource" : request.PodName.Trim();
            var firstSeen = FormatDateForAudit(request.FirstSeenAtUtc);
            var lastSeen = FormatDateForAudit(request.LastSeenAtUtc);

            actionPerformedOn = BuildPrometheusSuppressionActionPerformedOn("Suppressed", alertName, namespaceValue, resourceOrPod, firstSeen, lastSeen, reason, duration);
            return true;
        }

        if (IsPrometheusSuppressEditPath(path, method))
        {
            var request = context.ActionArguments.Values.OfType<EditPrometheusSuppressionRequest>().FirstOrDefault();
            if (request == null)
            {
                return false;
            }

            var reason = string.IsNullOrWhiteSpace(request.Reason) ? "no reason provided" : request.Reason.Trim();
            var alertName = ResolveSuppressedAlertName(preSuppressionSnapshot);
            if (string.IsNullOrWhiteSpace(alertName))
            {
                alertName = "unknown-alert";
            }

            var duration = request.DurationHours > 0
                ? FormatDuration(request.DurationHours)
                : ResolveSuppressionDuration(preSuppressionSnapshot);
            var namespaceValue = ResolveSuppressionMatcher(preSuppressionSnapshot, "namespace") ?? "unknown-namespace";
            var resourceOrPod = ResolveSuppressionMatcher(preSuppressionSnapshot, "pod") ?? "unknown-resource";
            var firstSeen = ResolveSuppressionFirstSeenForAudit(preSuppressionSnapshot);
            var lastSeen = ResolveSuppressionLastSeenForAudit(preSuppressionSnapshot);

            actionPerformedOn = BuildPrometheusSuppressionActionPerformedOn("Suppressed", alertName, namespaceValue, resourceOrPod, firstSeen, lastSeen, reason, duration);
            return true;
        }

        if (IsPrometheusUnsuppressPath(path, method))
        {
            var reason = GetActionArgumentString(context, "reason");
            reason = string.IsNullOrWhiteSpace(reason) ? "no reason provided" : reason.Trim();

            var alertName = ResolveSuppressedAlertName(preSuppressionSnapshot);
            if (string.IsNullOrWhiteSpace(alertName))
            {
                alertName = "unknown-alert";
            }

            var duration = ResolveSuppressionDuration(preSuppressionSnapshot);
            var namespaceValue = ResolveSuppressionMatcher(preSuppressionSnapshot, "namespace") ?? "unknown-namespace";
            var resourceOrPod = ResolveSuppressionMatcher(preSuppressionSnapshot, "pod") ?? "unknown-resource";
            var firstSeen = ResolveSuppressionFirstSeenForAudit(preSuppressionSnapshot);
            var lastSeen = ResolveSuppressionLastSeenForAudit(preSuppressionSnapshot);

            actionPerformedOn = BuildPrometheusSuppressionActionPerformedOn("Unsuppressed", alertName, namespaceValue, resourceOrPod, firstSeen, lastSeen, reason, duration, includeDuration: false);
            return true;
        }

        return false;
    }

    private static bool IsPrometheusSuppressCreatePath(string path, string method)
    {
        return string.Equals(path, "/api/prometheus-alerts/suppress", StringComparison.OrdinalIgnoreCase)
            && method.Equals(HttpMethods.Post, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPrometheusUnsuppressPath(string path, string method)
    {
        return path.StartsWith("/api/prometheus-alerts/suppress/", StringComparison.OrdinalIgnoreCase)
            && method.Equals(HttpMethods.Delete, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPrometheusSuppressEditPath(string path, string method)
    {
        return path.StartsWith("/api/prometheus-alerts/suppress/", StringComparison.OrdinalIgnoreCase)
            && method.Equals(HttpMethods.Put, StringComparison.OrdinalIgnoreCase);
    }

    private static string? GetActionArgumentString(ActionExecutingContext context, string key)
    {
        if (!context.ActionArguments.TryGetValue(key, out var value) || value == null)
        {
            return null;
        }

        return value as string;
    }

    private static string ResolveSuppressionDuration(PrometheusSuppression? suppression)
    {
        if (suppression == null)
        {
            return "unknown duration";
        }

        var duration = suppression.EndsAt - suppression.StartsAt;
        if (duration <= TimeSpan.Zero)
        {
            return "unknown duration";
        }

        var roundedHours = Math.Max(1, (int)Math.Round(duration.TotalHours));
        return FormatDuration(roundedHours);
    }

    private static string FormatDuration(int hours)
    {
        return $"{hours}h";
    }

    private static string? ResolveSuppressedAlertName(PrometheusSuppression? suppression)
    {
        if (suppression?.Matchers == null || suppression.Matchers.Count == 0)
        {
            return null;
        }

        foreach (var key in suppression.Matchers.Keys)
        {
            if (!key.Equals("alertname", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var value = suppression.Matchers[key];
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return null;
    }

    private static string? ResolveSuppressionMatcher(PrometheusSuppression? suppression, string matcherName)
    {
        if (suppression?.Matchers == null || suppression.Matchers.Count == 0)
        {
            return null;
        }

        foreach (var pair in suppression.Matchers)
        {
            if (!pair.Key.Equals(matcherName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!string.IsNullOrWhiteSpace(pair.Value))
            {
                return pair.Value.Trim();
            }
        }

        return null;
    }

    private static string? ResolvePrometheusSuppressionResource(
        ActionExecutingContext context,
        string path,
        string method,
        PrometheusSuppression? preSuppressionSnapshot)
    {
        if (IsPrometheusSuppressCreatePath(path, method))
        {
            var request = context.ActionArguments.Values.OfType<SuppressPrometheusAlertRequest>().FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(request?.AlertName))
            {
                return request.AlertName.Trim();
            }

            return "unknown-alert";
        }

        if (IsPrometheusSuppressEditPath(path, method) || IsPrometheusUnsuppressPath(path, method))
        {
            return ResolveSuppressedAlertName(preSuppressionSnapshot) ?? "unknown-alert";
        }

        return null;
    }

    private static string BuildPrometheusSuppressionActionPerformedOn(
        string eventLabel,
        string alertName,
        string namespaceValue,
        string resourceOrPod,
        string firstSeen,
        string lastSeen,
        string reason,
        string duration,
        bool includeDuration = true)
    {
        return includeDuration
            ? $"{eventLabel} alert {alertName} on {namespaceValue} and {resourceOrPod} first seen {firstSeen} and last seen {lastSeen}, reason : {reason}, for {duration}"
            : $"{eventLabel} alert {alertName} on {namespaceValue} and {resourceOrPod} first seen {firstSeen} and last seen {lastSeen}, reason : {reason}";
    }

    private static string ResolveSuppressionFirstSeenForAudit(PrometheusSuppression? suppression)
    {
        if (suppression == null)
        {
            return "unknown";
        }

        return FormatDateForAudit(suppression.StartsAt);
    }

    private static string ResolveSuppressionLastSeenForAudit(PrometheusSuppression? suppression)
    {
        if (suppression == null)
        {
            return "unknown";
        }

        return FormatDateForAudit(suppression.UpdatedAt);
    }

    private static string FormatDateForAudit(DateTime? value)
    {
        return value.HasValue ? value.Value.ToString("MM/dd/yyyy") : "unknown";
    }

    private static string? BuildCronWorkflowChangeSummary(
        ResourceInfo? before,
        ResourceInfo? after,
        UpdateCronWorkflowRequest? requested)
    {
        if (requested == null)
        {
            return null;
        }

        var changes = new List<string>();

        AddChange(changes, "schedules", FormatSchedules(GetSchedules(before)), FormatSchedules(GetEffectiveSchedules(after, requested)), "none");
        AddChange(changes, "startingDeadlineSeconds", before?.StartingDeadlineSeconds, after?.StartingDeadlineSeconds ?? requested.StartingDeadlineSeconds);
        AddChange(changes, "concurrencyPolicy", before?.ConcurrencyPolicy, after?.ConcurrencyPolicy ?? requested.ConcurrencyPolicy, "none");
        AddChange(changes, "successfulJobsHistoryLimit", before?.SuccessfulJobsHistoryLimit, after?.SuccessfulJobsHistoryLimit ?? requested.SuccessfulJobsHistoryLimit);
        AddChange(changes, "failedJobsHistoryLimit", before?.FailedJobsHistoryLimit, after?.FailedJobsHistoryLimit ?? requested.FailedJobsHistoryLimit);
        AddChange(changes, "suspend", before?.Suspend, after?.Suspend ?? requested.Suspend);

        if (changes.Count == 0)
        {
            return null;
        }

        return $"CronWorkflow changes: {string.Join("; ", changes)}";
    }

    private static string? BuildPrometheusRuleApplyChangeSummary(
        PrometheusRuleDefinition? before,
        PrometheusRuleDefinition? after,
        ApplyPrometheusRuleRequest? requested)
    {
        if (requested == null)
        {
            return null;
        }

        var blocks = new List<string>();

        AddPrometheusRuleChangeBlock(blocks, "Expression", before?.Expr, after?.Expr ?? requested.Expr);
        AddPrometheusRuleChangeBlock(blocks, "Duration", before?.For, after?.For ?? requested.For);
        AddPrometheusRuleChangeBlock(blocks, "Severity",
            GetDictionaryValue(before?.Labels, "severity"),
            GetDictionaryValue(after?.Labels, "severity") ?? GetDictionaryValue(requested.Labels, "severity"));
        AddPrometheusRuleChangeBlock(blocks, "Summary",
            GetDictionaryValue(before?.Annotations, "summary"),
            GetDictionaryValue(after?.Annotations, "summary") ?? GetDictionaryValue(requested.Annotations, "summary"));
        AddPrometheusRuleChangeBlock(blocks, "Description",
            GetDictionaryValue(before?.Annotations, "description"),
            GetDictionaryValue(after?.Annotations, "description") ?? GetDictionaryValue(requested.Annotations, "description"));
        AddPrometheusRuleChangeBlock(blocks, "RuleGroup", before?.GroupName, after?.GroupName ?? requested.GroupName);
        AddPrometheusRuleChangeBlock(blocks, "AlertGroup",
            GetDictionaryValue(before?.Labels, "alert_group"),
            GetDictionaryValue(after?.Labels, "alert_group") ?? GetDictionaryValue(requested.Labels, "alert_group"));

        if (blocks.Count == 0)
        {
            return null;
        }

        return string.Join(Environment.NewLine + Environment.NewLine, blocks);
    }

    private static void AddPrometheusRuleChangeBlock(List<string> blocks, string labelName, string? oldValue, string? newValue)
    {
        var oldText = NormalizePrometheusRuleValue(oldValue);
        var newText = NormalizePrometheusRuleValue(newValue);

        if (string.Equals(oldText, newText, StringComparison.Ordinal))
        {
            return;
        }

        blocks.Add($"{labelName}{Environment.NewLine}old value: {oldText}{Environment.NewLine}new value: {newText}");
    }

    private static string NormalizePrometheusRuleValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "not set";
        }

        return value.Trim();
    }

    private static string? GetDictionaryValue(Dictionary<string, string>? values, string key)
    {
        if (values == null || values.Count == 0)
        {
            return null;
        }

        foreach (var pair in values)
        {
            if (pair.Key.Equals(key, StringComparison.OrdinalIgnoreCase))
            {
                return pair.Value;
            }
        }

        return null;
    }

    private static IReadOnlyList<string> GetEffectiveSchedules(ResourceInfo? after, UpdateCronWorkflowRequest request)
    {
        var schedules = GetSchedules(after);
        if (schedules.Count > 0)
        {
            return schedules;
        }

        return request.Schedules;
    }

    private static IReadOnlyList<string> GetSchedules(ResourceInfo? resource)
    {
        if (resource == null)
        {
            return Array.Empty<string>();
        }

        if (resource.Schedules != null && resource.Schedules.Count > 0)
        {
            return resource.Schedules;
        }

        if (!string.IsNullOrWhiteSpace(resource.Schedule))
        {
            return new[] { resource.Schedule };
        }

        return Array.Empty<string>();
    }

    private static string FormatSchedules(IReadOnlyList<string>? schedules)
    {
        if (schedules == null || schedules.Count == 0)
        {
            return "none";
        }

        return string.Join(", ", schedules.Select(value => value.Trim()).Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private static void AddChange(
        List<string> changes,
        string field,
        object? beforeValue,
        object? afterValue,
        string fallback = "")
    {
        var beforeText = NormalizeChangeValue(beforeValue, fallback);
        var afterText = NormalizeChangeValue(afterValue, fallback);

        if (string.Equals(beforeText, afterText, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        changes.Add($"{field}: {beforeText} -> {afterText}");
    }

    private static string NormalizeChangeValue(object? value, string fallback)
    {
        if (value == null)
        {
            return fallback;
        }

        if (value is string text)
        {
            return string.IsNullOrWhiteSpace(text) ? fallback : text.Trim();
        }

        return value.ToString() ?? fallback;
    }

    private static string ResolveServiceName(string path)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length >= 2 && segments[0].Equals("api", StringComparison.OrdinalIgnoreCase))
        {
            return segments[1];
        }

        return "unknown";
    }

    private static AdminAuditEventType ResolveEventType(
        ActionExecutingContext context,
        string path,
        string method,
        string? targetNamespace,
        string consumersNamespace)
    {
        var normalizedPath = path.ToLowerInvariant();

        if (normalizedPath == "/api/pods/restart")
        {
            return AdminAuditEventType.Restarted;
        }

        if (normalizedPath == "/api/resources/restart")
        {
            return AdminAuditEventType.Restarted;
        }

        if (normalizedPath == "/api/resources/log-level")
        {
            return AdminAuditEventType.Updated;
        }

        if (normalizedPath == "/api/consumers/toggle")
        {
            if (TryGetBooleanPropertyFromArgs(context, "Enabled", out var enabled))
            {
                if (!string.IsNullOrWhiteSpace(targetNamespace) &&
                    targetNamespace.Equals(consumersNamespace, StringComparison.OrdinalIgnoreCase))
                {
                    return enabled ? AdminAuditEventType.Started : AdminAuditEventType.Stopped;
                }

                return enabled ? AdminAuditEventType.Enabled : AdminAuditEventType.Disabled;
            }

            return AdminAuditEventType.Updated;
        }

        if (normalizedPath == "/api/cronworkflows/update")
        {
            return AdminAuditEventType.Updated;
        }

        if (normalizedPath == "/api/cronworkflows/toggle-suspend")
        {
            if (TryGetBooleanPropertyFromArgs(context, "Suspend", out var suspend))
            {
                return suspend ? AdminAuditEventType.Paused : AdminAuditEventType.Resumed;
            }

            return AdminAuditEventType.Updated;
        }

        if (normalizedPath == "/api/cronworkflows/submit")
        {
            return AdminAuditEventType.Started;
        }

        if (normalizedPath == "/api/cronworkflows/log-level")
        {
            return AdminAuditEventType.Updated;
        }

        if (normalizedPath == "/api/prometheus-alerts/suppress" && method.Equals(HttpMethods.Post, StringComparison.OrdinalIgnoreCase))
        {
            return AdminAuditEventType.Suppressed;
        }

        if (normalizedPath.StartsWith("/api/prometheus-alerts/suppress/", StringComparison.OrdinalIgnoreCase))
        {
            if (method.Equals(HttpMethods.Put, StringComparison.OrdinalIgnoreCase))
            {
                return AdminAuditEventType.Suppressed;
            }

            if (method.Equals(HttpMethods.Delete, StringComparison.OrdinalIgnoreCase))
            {
                return AdminAuditEventType.Unsuppressed;
            }
        }

        if (normalizedPath == "/api/prometheus-alerts/rules/apply")
        {
            return AdminAuditEventType.Updated;
        }

        if (normalizedPath == "/api/prometheus-alerts/alert-groups")
        {
            return AdminAuditEventType.Updated;
        }

        if (normalizedPath.StartsWith("/api/prometheus-alerts/alert-groups/", StringComparison.OrdinalIgnoreCase) &&
            method.Equals(HttpMethods.Delete, StringComparison.OrdinalIgnoreCase))
        {
            return AdminAuditEventType.Deleted;
        }

        if (normalizedPath == "/api/prometheus-alerts/proposals")
        {
            return AdminAuditEventType.Created;
        }

        if (normalizedPath.StartsWith("/api/prometheus-alerts/proposals/", StringComparison.OrdinalIgnoreCase) &&
            method.Equals(HttpMethods.Put, StringComparison.OrdinalIgnoreCase))
        {
            return AdminAuditEventType.Updated;
        }

        if (normalizedPath == "/api/kafka/messages/requeue")
        {
            return AdminAuditEventType.Requeued;
        }

        var action = context.ActionDescriptor.RouteValues.TryGetValue("action", out var actionName)
            ? actionName ?? "Updated"
            : "Updated";

        return action switch
        {
            var a when a.StartsWith("Restart", StringComparison.OrdinalIgnoreCase) => AdminAuditEventType.Restarted,
            var a when a.StartsWith("Submit", StringComparison.OrdinalIgnoreCase) => AdminAuditEventType.Started,
            var a when a.StartsWith("Create", StringComparison.OrdinalIgnoreCase) => AdminAuditEventType.Created,
            var a when a.StartsWith("Delete", StringComparison.OrdinalIgnoreCase) => AdminAuditEventType.Deleted,
            _ => AdminAuditEventType.Updated
        };
    }

    private static string BuildActionPerformedOn(
        string? resourceType,
        string? resourceName,
        string? ns,
        string serviceName)
    {
        var target = string.IsNullOrWhiteSpace(resourceType)
            ? (!string.IsNullOrWhiteSpace(resourceName) ? resourceName : serviceName)
            : $"{resourceType} {resourceName ?? "resource"}";

        if (!string.IsNullOrWhiteSpace(ns))
        {
            return $"{target} in namespace {ns}";
        }

        return target;
    }

    private static string BuildEventDescription(AdminAuditEventType eventType, string actionPerformedOn)
    {
        return $"{eventType} on {actionPerformedOn}";
    }

    private static (string TopicName, string MessageDescription) ResolveRequeueAuditData(ActionExecutingContext context, string? requestBody)
    {
        var bodyMessageTexts = ExtractRequeueMessageTextsFromRequestBody(requestBody);

        foreach (var arg in context.ActionArguments.Values)
        {
            if (arg is not RequeueRequest request)
            {
                continue;
            }

            var topic = !string.IsNullOrWhiteSpace(request.TargetTopic)
                ? request.TargetTopic.Trim()
                : request.SourceTopic.Trim();
            var enrichedMessages = request.Messages
                .Select(message =>
                {
                    var messageText = message.MessageText;
                    if (string.IsNullOrWhiteSpace(messageText))
                    {
                        bodyMessageTexts.TryGetValue(BuildPartitionOffsetKey(message.Partition, message.Offset), out messageText);
                    }

                    return new MessageReference
                    {
                        Partition = message.Partition,
                        Offset = message.Offset,
                        MessageText = messageText
                    };
                })
                .ToArray();

            var messageDescription = BuildRequeuedMessageDescription(enrichedMessages);

            return (topic, messageDescription);
        }

        return ("unknown-topic", "message");
    }

    private static string BuildRequeuedMessageDescription(IReadOnlyCollection<MessageReference>? messages)
    {
        if (messages == null || messages.Count == 0)
        {
            return "message";
        }

        if (messages.Count == 1)
        {
            var message = messages.First();
            var messageText = GetNormalizedMessageText(message.MessageText);
            if (!string.IsNullOrWhiteSpace(messageText))
            {
                return messageText;
            }

            return $"message {message.Partition}:{message.Offset}";
        }

        var textPreview = messages
            .Select(message => GetNormalizedMessageText(message.MessageText))
            .Where(text => !string.IsNullOrWhiteSpace(text))
            .Take(3)
            .ToArray();

        if (textPreview.Length > 0)
        {
            var renderedPreview = string.Join(" | ", textPreview);
            var previewSuffix = messages.Count > textPreview.Length ? " | ..." : string.Empty;
            return $"{messages.Count} messages ({renderedPreview}{previewSuffix})";
        }

        var preview = string.Join(", ", messages.Take(3).Select(message => $"{message.Partition}:{message.Offset}"));
        var suffix = messages.Count > 3 ? ", ..." : string.Empty;
        return $"{messages.Count} messages ({preview}{suffix})";
    }

    private static string? GetNormalizedMessageText(string? messageText)
    {
        if (string.IsNullOrWhiteSpace(messageText))
        {
            return null;
        }

        return messageText.ReplaceLineEndings(" ").Trim();
    }

    private static Dictionary<string, string> ExtractRequeueMessageTextsFromRequestBody(string? requestBody)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(requestBody) || requestBody.EndsWith("...[truncated]", StringComparison.Ordinal))
        {
            return values;
        }

        try
        {
            using var doc = JsonDocument.Parse(requestBody);
            if (!doc.RootElement.TryGetProperty("messages", out var messages) || messages.ValueKind != JsonValueKind.Array)
            {
                return values;
            }

            foreach (var item in messages.EnumerateArray())
            {
                if (!TryReadInt32(item, "partition", out var partition) ||
                    !TryReadInt64(item, "offset", out var offset))
                {
                    continue;
                }

                if (!item.TryGetProperty("messageText", out var messageTextProperty) ||
                    messageTextProperty.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                var messageText = messageTextProperty.GetString();
                if (string.IsNullOrWhiteSpace(messageText))
                {
                    continue;
                }

                values[BuildPartitionOffsetKey(partition, offset)] = messageText.Trim();
            }
        }
        catch
        {
            // Ignore malformed payloads and use existing fallback behavior.
        }

        return values;
    }

    private static string BuildPartitionOffsetKey(int partition, long offset) => $"{partition}:{offset}";

    private static bool TryReadInt32(JsonElement parent, string propertyName, out int value)
    {
        value = default;
        if (!parent.TryGetProperty(propertyName, out var prop))
        {
            return false;
        }

        if (prop.ValueKind == JsonValueKind.Number)
        {
            return prop.TryGetInt32(out value);
        }

        if (prop.ValueKind == JsonValueKind.String)
        {
            return int.TryParse(prop.GetString(), out value);
        }

        return false;
    }

    private static bool TryReadInt64(JsonElement parent, string propertyName, out long value)
    {
        value = default;
        if (!parent.TryGetProperty(propertyName, out var prop))
        {
            return false;
        }

        if (prop.ValueKind == JsonValueKind.Number)
        {
            return prop.TryGetInt64(out value);
        }

        if (prop.ValueKind == JsonValueKind.String)
        {
            return long.TryParse(prop.GetString(), out value);
        }

        return false;
    }
}
