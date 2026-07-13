namespace KubeVisibility.Dashboard.Api.Options;

/// <summary>
/// Configuration for admin action auditing.
/// </summary>
public class AdminAuditOptions
{
    public const string SectionName = "AdminAudit";

    /// <summary>
    /// Enables or disables admin audit event writing.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Elasticsearch index alias used for audit reads and writes.
    /// </summary>
    public string ElasticIndexAlias { get; set; } = "kube-admin-audit";

    /// <summary>
    /// Truncation limit for captured request bodies.
    /// </summary>
    public int MaxRequestBodyChars { get; set; } = 4000;

    /// <summary>
    /// Default lookback window for querying audit history.
    /// </summary>
    public int DefaultQueryRangeDays { get; set; } = 7;

    /// <summary>
    /// Maximum lookback window allowed for querying audit history.
    /// </summary>
    public int MaxQueryRangeDays { get; set; } = 90;
}
