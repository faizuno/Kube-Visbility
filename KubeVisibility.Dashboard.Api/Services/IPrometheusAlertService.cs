using KubeVisibility.Dashboard.Api.Models.PrometheusAlerts;

namespace KubeVisibility.Dashboard.Api.Services
{
    public interface IPrometheusAlertService
    {
        Task<IReadOnlyList<PrometheusFiringAlert>> GetFiringAlertsAsync(
            int? rangeHours = null,
            CancellationToken cancellationToken = default);
        Task<PrometheusFiringAlertsPage> SearchFiringAlertsAsync(
            PrometheusFiringAlertsQuery query,
            CancellationToken cancellationToken = default);
        Task<PrometheusAlertStats> GetFiringAlertStatsAsync(
            int? rangeHours = null,
            CancellationToken cancellationToken = default);

        Task<PrometheusSuppression> SuppressAlertAsync(
            SuppressPrometheusAlertRequest request,
            string actor,
            CancellationToken cancellationToken = default);

        Task<PrometheusSuppression> EditSuppressionAsync(
            string silenceId,
            EditPrometheusSuppressionRequest request,
            string actor,
            CancellationToken cancellationToken = default);

        Task UnsuppressAlertAsync(
            string silenceId,
            string actor,
            string? reason = null,
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<PrometheusSuppression>> GetSuppressionsAsync(CancellationToken cancellationToken = default);

        Task<IReadOnlyList<PrometheusAlertRuleProposal>> GetRuleProposalsAsync(CancellationToken cancellationToken = default);

        Task<PrometheusAlertRuleProposal> CreateRuleProposalAsync(
            CreatePrometheusAlertRuleProposalRequest request,
            string createdBy,
            CancellationToken cancellationToken = default);

        Task<PrometheusAlertRuleProposal?> UpdateRuleProposalAsync(
            string proposalId,
            UpdatePrometheusAlertRuleProposalRequest request,
            string updatedBy,
            CancellationToken cancellationToken = default);

        Task<string> GeneratePrometheusRuleYamlAsync(
            string? groupName,
            string? status,
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<PrometheusRuleDefinition>> GetRuleDefinitionsAsync(
            CancellationToken cancellationToken = default);

        Task<PrometheusRuleDefinition?> GetRuleDefinitionAsync(
            string alertName,
            CancellationToken cancellationToken = default);

        Task<ApplyPrometheusRuleResponse> ApplyRuleDefinitionAsync(
            ApplyPrometheusRuleRequest request,
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<AlertGroupDefinition>> GetAlertGroupsAsync(
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<string>> GetAlertGroupRouteKeysAsync(
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<AlertRouteBinding>> GetAlertRouteBindingsAsync(
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<AlertGroupDefinition>> UpsertAlertGroupAsync(
            AlertGroupUpdateRequest request,
            string actor,
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<AlertGroupDefinition>> DeleteAlertGroupAsync(
            string groupName,
            string actor,
            CancellationToken cancellationToken = default);
    }
}
