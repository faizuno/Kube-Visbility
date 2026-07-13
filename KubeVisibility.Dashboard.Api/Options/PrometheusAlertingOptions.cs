namespace KubeVisibility.Dashboard.Api.Options;

/// <summary>
/// Configuration for Prometheus alert management and firing alert retrieval.
/// </summary>
public class PrometheusAlertingOptions
{
    public const string SectionName = "PrometheusAlerting";

    /// <summary>
    /// Alertmanager API endpoint used to fetch currently firing alerts.
    /// </summary>
    public string AlertmanagerApiUrl { get; set; } =
        "http://prometheus-kube-prometheus-alertmanager.monitoring:9093/api/v2/alerts";

    /// <summary>
    /// Namespace used for storing dashboard-managed alert proposals.
    /// Keep this separate from ArgoCD-managed PrometheusRule resources.
    /// </summary>
    public string ProposalNamespace { get; set; } = "app";

    /// <summary>
    /// ConfigMap name used to store alert rule proposals as JSON.
    /// </summary>
    public string ProposalConfigMapName { get; set; } = "kube-dashboard-prometheus-alert-proposals";

    /// <summary>
    /// ConfigMap data key for serialized proposal content.
    /// </summary>
    public string ProposalConfigMapDataKey { get; set; } = "proposals.json";

    /// <summary>
    /// Default time window (in hours) for alert history queries.
    /// Defaults to 1 week.
    /// </summary>
    public int FiringAlertWindowHours { get; set; } = 168;

    /// <summary>
    /// Namespace for dashboard-managed PrometheusRule resources.
    /// </summary>
    public string CustomRuleNamespace { get; set; } = "monitoring";

    /// <summary>
    /// Name for dashboard-managed PrometheusRule resources.
    /// </summary>
    public string CustomRuleName { get; set; } = "kube-dashboard-custom-alerts";

    /// <summary>
    /// Label key used to ensure Prometheus selects custom rules.
    /// </summary>
    public string CustomRuleSelectorLabelKey { get; set; } = "release";

    /// <summary>
    /// Label value used to ensure Prometheus selects custom rules.
    /// </summary>
    public string CustomRuleSelectorLabelValue { get; set; } = "prometheus";

    /// <summary>
    /// AlertmanagerConfig namespace for dashboard-managed groups.
    /// </summary>
    public string AlertmanagerConfigNamespace { get; set; } = "monitoring";

    /// <summary>
    /// AlertmanagerConfig name for dashboard-managed groups.
    /// </summary>
    public string AlertmanagerConfigName { get; set; } = "kube-dashboard-alert-groups";

    /// <summary>
    /// Secret name for helm-rendered Alertmanager config.
    /// </summary>
    public string AlertmanagerGeneratedSecretName { get; set; } =
        "alertmanager-prometheus-kube-prometheus-alertmanager-generated";

    /// <summary>
    /// Secret data key containing gzipped alertmanager yaml.
    /// </summary>
    public string AlertmanagerGeneratedSecretKey { get; set; } = "alertmanager.yaml.gz";
}
