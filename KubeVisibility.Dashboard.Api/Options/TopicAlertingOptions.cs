namespace KubeVisibility.Dashboard.Api.Options;

/// <summary>
/// Configuration options for topic error alert rules/groups persistence.
/// </summary>
public class TopicAlertingOptions
{
    public const string SectionName = "TopicAlerting";

    /// <summary>
    /// Elasticsearch index alias used for topic alert groups/rules documents.
    /// </summary>
    public string ElasticIndexAlias { get; set; } = "kube-topic-alert-config";
}
