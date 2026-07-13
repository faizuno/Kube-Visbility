namespace KubeVisibility.Dashboard.Api.Options;

/// <summary>
/// Kubernetes cluster targeting and namespace role mapping.
/// </summary>
public class KubernetesInfoOptions
{
    public const string SectionName = "KubernetesInfo";

    public List<string> Namespaces { get; set; } = new();

    public List<string> EnvironmentVariables { get; set; } = new();

    public int CacheDurationSeconds { get; set; } = 30;

    public string? KubeConfigPath { get; set; }

    /// <summary>
    /// Namespace that hosts Kafka consumer deployments (consumer control + health).
    /// </summary>
    public string ConsumersNamespace { get; set; } = "app-consumers";

    /// <summary>
    /// Namespace that hosts CronWorkflow / job resources.
    /// </summary>
    public string JobsNamespace { get; set; } = "app-jobs";

    /// <summary>
    /// Namespaces treated as application/services for health aggregation.
    /// </summary>
    public List<string> ApplicationNamespaces { get; set; } = new() { "app", "app-services" };

    /// <summary>
    /// Label/annotation prefix for dashboard-managed Kubernetes objects.
    /// </summary>
    public string ManagedLabelPrefix { get; set; } = "kube-visibility.io";
}

/// <summary>
/// Helpers for reading KubernetesInfo role mapping from configuration.
/// </summary>
public static class KubernetesInfoConfiguration
{
    public const string DefaultConsumersNamespace = "app-consumers";
    public const string DefaultJobsNamespace = "app-jobs";
    public const string DefaultManagedLabelPrefix = "kube-visibility.io";
    public const string DefaultAdminGroup = "Dashboard-Admin";

    public static string GetConsumersNamespace(IConfiguration configuration) =>
        configuration["KubernetesInfo:ConsumersNamespace"] ?? DefaultConsumersNamespace;

    public static string GetJobsNamespace(IConfiguration configuration) =>
        configuration["KubernetesInfo:JobsNamespace"] ?? DefaultJobsNamespace;

    public static IReadOnlyList<string> GetApplicationNamespaces(IConfiguration configuration)
    {
        var list = configuration.GetSection("KubernetesInfo:ApplicationNamespaces").Get<List<string>>();
        if (list is { Count: > 0 })
        {
            return list;
        }

        return new[] { "app", "app-services" };
    }

    public static string GetManagedLabelPrefix(IConfiguration configuration) =>
        configuration["KubernetesInfo:ManagedLabelPrefix"] ?? DefaultManagedLabelPrefix;

    public static List<string> GetAdminGroups(IConfiguration configuration)
    {
        var groups = configuration.GetSection("Authorization:AdminGroups").Get<List<string>>();
        if (groups is { Count: > 0 })
        {
            return groups;
        }

        return new List<string> { DefaultAdminGroup };
    }
}
