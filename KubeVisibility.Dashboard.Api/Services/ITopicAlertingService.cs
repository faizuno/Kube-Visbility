using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services;

public interface ITopicAlertingService
{
    Task<IReadOnlyList<TopicAlertGroup>> GetGroupsAsync(CancellationToken cancellationToken = default);
    Task<TopicAlertGroup?> GetGroupAsync(string groupId, CancellationToken cancellationToken = default);
    Task<TopicAlertGroup> UpsertGroupAsync(UpsertTopicAlertGroupRequest request, string actor, CancellationToken cancellationToken = default);
    Task<bool> DeleteGroupAsync(string groupId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TopicAlertRule>> GetRulesAsync(CancellationToken cancellationToken = default);
    Task<TopicAlertRule?> GetRuleAsync(string ruleId, CancellationToken cancellationToken = default);
    Task<TopicAlertRule> UpsertRuleAsync(UpsertTopicAlertRuleRequest request, string actor, CancellationToken cancellationToken = default);
    Task<TopicAlertRule?> SetRuleEnabledAsync(string ruleId, bool enabled, string actor, CancellationToken cancellationToken = default);
    Task<bool> DeleteRuleAsync(string ruleId, CancellationToken cancellationToken = default);
}
