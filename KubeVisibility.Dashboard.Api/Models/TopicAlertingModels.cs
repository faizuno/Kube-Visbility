using KubeVisibility.Dashboard.Api.Services.Shared;

namespace KubeVisibility.Dashboard.Api.Models;

public static class TopicAlertingDocTypes
{
    public const string Group = "topic-alert-group";
    public const string Rule = "topic-alert-rule";
}

public class TopicAlertGroup
{
    public string GroupId { get; set; } = Guid.NewGuid().ToString("N");
    public string DocType { get; set; } = TopicAlertingDocTypes.Group;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public IReadOnlyList<string> TopicNames { get; set; } = Array.Empty<string>();
    public DateTime CreatedAtUtc { get; set; } = AlertTimeZone.EasternNow();
    public DateTime UpdatedAtUtc { get; set; } = AlertTimeZone.EasternNow();
    public string CreatedBy { get; set; } = "unknown";
    public string UpdatedBy { get; set; } = "unknown";
}

public class TopicAlertCondition
{
    public string JoinWithPrevious { get; set; } = "AND"; // AND | OR
    public bool Negate { get; set; }
    public string Field { get; set; } = "message"; // message | exception | serviceName | applicationName
    public string Operator { get; set; } = "wildcard"; // contains | equals | startsWith | endsWith | wildcard
    public string Value { get; set; } = string.Empty;
}

public class TopicAlertRule
{
    public string RuleId { get; set; } = Guid.NewGuid().ToString("N");
    public string DocType { get; set; } = TopicAlertingDocTypes.Rule;
    public string Name { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public string TargetType { get; set; } = "topics"; // topics | group
    public IReadOnlyList<string> TopicNames { get; set; } = Array.Empty<string>();
    public string? TopicGroupId { get; set; }
    public IReadOnlyList<string> RecipientEmails { get; set; } = Array.Empty<string>();
    public IReadOnlyList<TopicAlertCondition> Conditions { get; set; } = Array.Empty<TopicAlertCondition>();
    public DateTime CreatedAtUtc { get; set; } = AlertTimeZone.EasternNow();
    public DateTime UpdatedAtUtc { get; set; } = AlertTimeZone.EasternNow();
    public string CreatedBy { get; set; } = "unknown";
    public string UpdatedBy { get; set; } = "unknown";
}

public class UpsertTopicAlertGroupRequest
{
    public string? GroupId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public IReadOnlyList<string> TopicNames { get; set; } = Array.Empty<string>();
}

public class UpsertTopicAlertRuleRequest
{
    public string? RuleId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public string TargetType { get; set; } = "topics";
    public IReadOnlyList<string> TopicNames { get; set; } = Array.Empty<string>();
    public string? TopicGroupId { get; set; }
    public string RecipientEmailsCsv { get; set; } = string.Empty;
    public IReadOnlyList<TopicAlertCondition> Conditions { get; set; } = Array.Empty<TopicAlertCondition>();
}
