namespace KubeVisibility.Dashboard.Api.Models.PrometheusAlerts
{
    public class PrometheusFiringAlert
    {
        public string AlertName { get; set; } = string.Empty;
        public string Severity { get; set; } = "unknown";
        public string State { get; set; } = string.Empty;
        public string? NamespaceName { get; set; }
        public string? PodName { get; set; }
        public string? Summary { get; set; }
        public string? Description { get; set; }
        public DateTime? FirstOccurrenceAt { get; set; }
        public DateTime? LastOccurrenceAt { get; set; }
        public DateTime? StartsAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public long FiringForSeconds { get; set; }
        public Dictionary<string, string> Labels { get; set; } = new();
    }

    public class PrometheusFiringAlertsQuery
    {
        public string? Severity { get; set; }
        public string? NamespaceName { get; set; }
        public string? AlertName { get; set; }
        public int? RangeHours { get; set; }
        public int Limit { get; set; } = 50;
        public int Offset { get; set; }
    }

    public class PrometheusFiringAlertsPage
    {
        public int Total { get; set; }
        public int Limit { get; set; }
        public int Offset { get; set; }
        public IReadOnlyList<PrometheusFiringAlert> Items { get; set; } = new List<PrometheusFiringAlert>();
    }

    public class PrometheusAlertStats
    {
        public int TotalFiring { get; set; }
        public Dictionary<string, int> BySeverity { get; set; } = new();
        public Dictionary<string, int> ByAlertName { get; set; } = new();
        public Dictionary<string, int> ByNamespace { get; set; } = new();
        public DateTime LastUpdatedUtc { get; set; }
    }

    public class SuppressPrometheusAlertRequest
    {
        public string AlertName { get; set; } = string.Empty;
        public string? NamespaceName { get; set; }
        public string? Severity { get; set; }
        public string? PodName { get; set; }
        public DateTime? FirstSeenAtUtc { get; set; }
        public DateTime? LastSeenAtUtc { get; set; }
        public string Reason { get; set; } = string.Empty;
        public int DurationHours { get; set; } = 24;
    }

    public class EditPrometheusSuppressionRequest
    {
        public string Reason { get; set; } = string.Empty;
        public int DurationHours { get; set; } = 24;
    }

    public class PrometheusSuppression
    {
        public string SilenceId { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string CreatedBy { get; set; } = string.Empty;
        public string Comment { get; set; } = string.Empty;
        public DateTime StartsAt { get; set; }
        public DateTime EndsAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public Dictionary<string, string> Matchers { get; set; } = new();
    }

    public class PrometheusAlertRuleProposal
    {
        public string Id { get; set; } = string.Empty;
        public string AlertName { get; set; } = string.Empty;
        public string Expr { get; set; } = string.Empty;
        public string For { get; set; } = "5m";
        public string Severity { get; set; } = "warning";
        public string Summary { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string GroupName { get; set; } = "kube-dashboard-custom-alerts";
        public string Status { get; set; } = "Draft";
        public DateTime CreatedAtUtc { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
        public string CreatedBy { get; set; } = string.Empty;
        public string? UpdatedBy { get; set; }
    }

    public class CreatePrometheusAlertRuleProposalRequest
    {
        public string AlertName { get; set; } = string.Empty;
        public string Expr { get; set; } = string.Empty;
        public string For { get; set; } = "5m";
        public string Severity { get; set; } = "warning";
        public string Summary { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string GroupName { get; set; } = "kube-dashboard-custom-alerts";
    }

    public class UpdatePrometheusAlertRuleProposalRequest
    {
        public string AlertName { get; set; } = string.Empty;
        public string Expr { get; set; } = string.Empty;
        public string For { get; set; } = "5m";
        public string Severity { get; set; } = "warning";
        public string Summary { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string GroupName { get; set; } = "kube-dashboard-custom-alerts";
        public string Status { get; set; } = "Draft";
    }

    public class PrometheusRuleDefinition
    {
        public string AlertName { get; set; } = string.Empty;
        public string Expr { get; set; } = string.Empty;
        public string? For { get; set; }
        public string GroupName { get; set; } = string.Empty;
        public Dictionary<string, string> Labels { get; set; } = new();
        public Dictionary<string, string> Annotations { get; set; } = new();
        public string Namespace { get; set; } = string.Empty;
        public string ResourceName { get; set; } = string.Empty;
        public string Origin { get; set; } = "unknown";
    }

    public class ApplyPrometheusRuleRequest
    {
        public string AlertName { get; set; } = string.Empty;
        public string? OriginalAlertName { get; set; }
        public string Expr { get; set; } = string.Empty;
        public string? For { get; set; }
        public string GroupName { get; set; } = string.Empty;
        public Dictionary<string, string> Labels { get; set; } = new();
        public Dictionary<string, string> Annotations { get; set; } = new();
    }

    public class ApplyPrometheusRuleResponse
    {
        public bool Changed { get; set; }
        public string Action { get; set; } = "none";
        public PrometheusRuleDefinition? Result { get; set; }
    }

    public class AlertGroupDefinition
    {
        public string Name { get; set; } = string.Empty;
        public List<string> Emails { get; set; } = new();
        public List<string> RouteKeys { get; set; } = new();
    }

    public class AlertGroupUpdateRequest
    {
        public string Name { get; set; } = string.Empty;
        public List<string> Emails { get; set; } = new();
        public List<string>? RouteKeys { get; set; }
    }

    public class AlertRouteBinding
    {
        public string RouteKey { get; set; } = string.Empty;
        public string Receiver { get; set; } = string.Empty;
        public string Source { get; set; } = "base";
        public List<string> Emails { get; set; } = new();
    }
}
