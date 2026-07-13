namespace KubeVisibility.Dashboard.Api.Models.Health
{
    // ============================================================
    // Overview and Summary Models
    // ============================================================
    
    public class HealthOverviewResponse
    {
        public double OverallHealthScore { get; set; }
        public ClusterHealthSummary KubernetesHealth { get; set; } = new();
        public KafkaHealthSummary KafkaHealth { get; set; } = new();
        public ApplicationHealthSummary ApplicationHealth { get; set; } = new();
        public DateTime Timestamp { get; set; }
    }

    public class ClusterHealthSummary
    {
        public double HealthScore { get; set; }
        public int TotalNodes { get; set; }
        public int ReadyNodes { get; set; }
        public int NotReadyNodes { get; set; }
        public int UnknownNodes { get; set; }
        public ResourceUtilization ResourceUtilization { get; set; } = new();
    }

    public class KafkaHealthSummary
    {
        public double HealthScore { get; set; }
        public int TotalBrokers { get; set; }
        public int OnlineBrokers { get; set; }
        public int OfflineBrokers { get; set; }
        public int TotalControllers { get; set; }
        public int OnlineControllers { get; set; }
        public int OfflineControllers { get; set; }
        public int ActiveControllers { get; set; }
        public int TotalTopics { get; set; }
        public int TopicsWithIssues { get; set; }
        public long TotalConsumerLag { get; set; }
    }

    public class ApplicationHealthSummary
    {
        public double HealthScore { get; set; }
        public int TotalDeployments { get; set; }
        public int HealthyDeployments { get; set; }
        public int DegradedDeployments { get; set; }
        public int FailedDeployments { get; set; }
        public int TotalPods { get; set; }
        public int RunningPods { get; set; }
        public int PendingPods { get; set; }
        public int FailedPods { get; set; }
        
        // Detailed breakdown by category
        public int TotalServices { get; set; }
        public int HealthyServices { get; set; }
        public int TotalConsumers { get; set; }
        public int HealthyConsumers { get; set; }
        public int StoppedConsumers { get; set; }
        public int TotalJobs { get; set; }
        public int HealthyJobs { get; set; }
        public int PausedJobs { get; set; }
        
        // Aggregated count for UI display
        public int TotalApplications => TotalServices + TotalConsumers + TotalJobs;
        public int HealthyApplications => HealthyServices + HealthyConsumers + HealthyJobs;
    }

    // ============================================================
    // Kubernetes Node Models
    // ============================================================

    public class NodeHealthResponse
    {
        public List<NodeHealth> Nodes { get; set; } = new();
        public NodeHealthSummary Summary { get; set; } = new();
    }

    public class NodeHealth
    {
        public string Name { get; set; } = string.Empty;
        // Canonical readiness used for summary math (Ready, NotReady, Unknown).
        public string Status { get; set; } = string.Empty;
        // Full node state shown in UI (e.g. Ready,SchedulingDisabled).
        public string ExactStatus { get; set; } = string.Empty;
        public bool IsSchedulable { get; set; } = true;
        public List<string> StatusFlags { get; set; } = new();
        public string Type { get; set; } = string.Empty;  // control-plane or custom type from label
        public List<NodeCondition> Conditions { get; set; } = new();
        public NodeMetrics? CurrentMetrics { get; set; }
        public Dictionary<string, string> Labels { get; set; } = new();
        public string KubernetesVersion { get; set; } = string.Empty;
        public string ContainerRuntimeVersion { get; set; } = string.Empty;
        public NodeCapacity Capacity { get; set; } = new();
        public NodeAllocatable Allocatable { get; set; } = new();
        public DateTime? CreationTime { get; set; }
        public int RunningPods { get; set; }
        public int TotalPods { get; set; }
    }

    public class NodeCondition
    {
        public string Type { get; set; } = string.Empty;  // Ready, MemoryPressure, DiskPressure, PIDPressure
        public string Status { get; set; } = string.Empty;  // True, False, Unknown
        public string Reason { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public DateTime? LastTransitionTime { get; set; }
    }

    public class NodeMetrics
    {
        public string CpuUsage { get; set; } = string.Empty;
        public string MemoryUsage { get; set; } = string.Empty;
        public double CpuUsagePercent { get; set; }
        public double MemoryUsagePercent { get; set; }
        public DateTime Timestamp { get; set; }
    }

    public class NodeCapacity
    {
        public string Cpu { get; set; } = string.Empty;
        public string Memory { get; set; } = string.Empty;
        public string Pods { get; set; } = string.Empty;
    }

    /// <summary>
    /// Resources allocatable for pods (capacity minus system/kube-reserved).
    /// </summary>
    public class NodeAllocatable
    {
        public string Cpu { get; set; } = string.Empty;
        public string Memory { get; set; } = string.Empty;
        public string Pods { get; set; } = string.Empty;
    }

    public class NodeHealthSummary
    {
        public int Total { get; set; }
        public int Ready { get; set; }
        public int NotReady { get; set; }
        public int Unknown { get; set; }
        public double AverageCpuUsagePercent { get; set; }
        public double AverageMemoryUsagePercent { get; set; }
    }

    public class NodeMetricsResponse
    {
        public string NodeName { get; set; } = string.Empty;
        public List<NodeMetricsDataPoint> Metrics { get; set; } = new();
    }

    public class NodeMetricsDataPoint
    {
        public DateTime Timestamp { get; set; }
        public double CpuUsagePercent { get; set; }
        public double MemoryUsagePercent { get; set; }
        public string CpuUsage { get; set; } = string.Empty;
        public string MemoryUsage { get; set; } = string.Empty;
    }

    /// <summary>
    /// Current node metrics from Prometheus (node_exporter). Used by nodes monitoring page.
    /// </summary>
    public class NodePrometheusMetricsCurrentResponse
    {
        public List<NodePrometheusMetricCurrent> Nodes { get; set; } = new();
        public DateTime? Timestamp { get; set; }
    }

    public class NodePrometheusMetricCurrent
    {
        public string NodeName { get; set; } = string.Empty;
        public double? CpuUsagePercent { get; set; }
        public double? MemoryUsagePercent { get; set; }
        public double? DiskUsagePercent { get; set; }
    }

    /// <summary>
    /// Time series node metrics from Prometheus for charts.
    /// </summary>
    public class NodePrometheusMetricsTimeSeriesResponse
    {
        public string NodeName { get; set; } = string.Empty;
        public List<MetricSeries> Series { get; set; } = new();
    }

    public class MetricSeries
    {
        public string MetricType { get; set; } = string.Empty; // "Cpu", "Memory", "Disk"
        public List<MetricDataPoint> DataPoints { get; set; } = new();
    }

    public class MetricDataPoint
    {
        public DateTime Timestamp { get; set; }
        public double Value { get; set; }
    }

    // ============================================================
    // Resource Utilization Models
    // ============================================================

    public class ResourceUtilization
    {
        public double CpuUsagePercent { get; set; }
        public double MemoryUsagePercent { get; set; }
        public double DiskUsagePercent { get; set; }
        public string CpuUsed { get; set; } = string.Empty;
        public string CpuTotal { get; set; } = string.Empty;
        public string MemoryUsed { get; set; } = string.Empty;
        public string MemoryTotal { get; set; } = string.Empty;
    }

    public class ResourceSummaryResponse
    {
        public Dictionary<string, NamespaceResourceSummary> Namespaces { get; set; } = new();
        public ResourceSummary ClusterTotal { get; set; } = new();
    }

    public class NamespaceResourceSummary
    {
        public string NamespaceName { get; set; } = string.Empty;
        public ResourceSummary Resources { get; set; } = new();
        public int PodCount { get; set; }
        public int DeploymentCount { get; set; }
    }

    public class ResourceSummary
    {
        public string CpuRequests { get; set; } = string.Empty;
        public string CpuLimits { get; set; } = string.Empty;
        public string MemoryRequests { get; set; } = string.Empty;
        public string MemoryLimits { get; set; } = string.Empty;
    }

    public class ResourceTrendsResponse
    {
        public Dictionary<string, List<ResourceTrendDataPoint>> ResourceTrends { get; set; } = new();
    }

    public class ResourceTrendDataPoint
    {
        public DateTime Timestamp { get; set; }
        public string ResourceName { get; set; } = string.Empty;
        public double CpuUsagePercent { get; set; }
        public double MemoryUsagePercent { get; set; }
    }

    // ============================================================
    // Application Health Models
    // ============================================================

    public class ApplicationHealthResponse
    {
        public Dictionary<string, NamespaceHealthDetail> Namespaces { get; set; } = new();
        public ApplicationHealthSummary Summary { get; set; } = new();
    }

    public class NamespaceHealthDetail
    {
        public string NamespaceName { get; set; } = string.Empty;
        public int TotalDeployments { get; set; }
        public int HealthyDeployments { get; set; }
        public int DegradedDeployments { get; set; }
        public int FailedDeployments { get; set; }
        public int TotalPods { get; set; }
        public int RunningPods { get; set; }
        public int PendingPods { get; set; }
        public int FailedPods { get; set; }
        public List<UnhealthyResource> UnhealthyResources { get; set; } = new();
    }

    public class UnhealthyResource
    {
        public string Name { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string Reason { get; set; } = string.Empty;
        public int ReadyReplicas { get; set; }
        public int DesiredReplicas { get; set; }
    }

    public class NamespaceHealthResponse
    {
        public string NamespaceName { get; set; } = string.Empty;
        public NamespaceHealthDetail Details { get; set; } = new();
        public List<ResourceInfo> Resources { get; set; } = new();
    }

    // ============================================================
    // Kafka Health Models
    // ============================================================

    public class KafkaClusterHealthResponse
    {
        public string ClusterId { get; set; } = string.Empty;
        public int TotalBrokers { get; set; }
        public int OnlineBrokers { get; set; }
        public int OfflineBrokers { get; set; }
        public int TotalControllers { get; set; }
        public int OnlineControllers { get; set; }
        public int OfflineControllers { get; set; }
        public int ActiveControllers { get; set; }
        public double HealthScore { get; set; }
        public List<BrokerHealth> Brokers { get; set; } = new();
        public List<ControllerHealth> Controllers { get; set; } = new();
        public DateTime Timestamp { get; set; }
    }

    public class BrokerHealth
    {
        public int BrokerId { get; set; }
        public string Host { get; set; } = string.Empty;
        public int Port { get; set; }
        public bool IsOnline { get; set; }
        public int PartitionCount { get; set; }
        public int LeaderPartitionCount { get; set; }
        
        // Resource Utilization
        public string? CpuUsage { get; set; }
        public string? CpuLimit { get; set; }
        public string? CpuRequest { get; set; }
        public double? CpuUsagePercent { get; set; }
        public string? MemoryUsage { get; set; }
        public string? MemoryLimit { get; set; }
        public string? MemoryRequest { get; set; }
        public double? MemoryUsagePercent { get; set; }
        public string? PodName { get; set; }
        public string NodeType { get; set; } = "Broker";
    }

    public class ControllerHealth
    {
        public int ControllerId { get; set; }
        public string Host { get; set; } = string.Empty;
        public int Port { get; set; }
        public bool IsOnline { get; set; }
        public bool IsActive { get; set; }
        
        // Resource Utilization
        public string? CpuUsage { get; set; }
        public string? CpuLimit { get; set; }
        public string? CpuRequest { get; set; }
        public double? CpuUsagePercent { get; set; }
        public string? MemoryUsage { get; set; }
        public string? MemoryLimit { get; set; }
        public string? MemoryRequest { get; set; }
        public double? MemoryUsagePercent { get; set; }
        public string? PodName { get; set; }
    }

    public class KafkaBrokerHealthResponse
    {
        public List<BrokerHealth> Brokers { get; set; } = new();
        public int TotalBrokers { get; set; }
        public int OnlineBrokers { get; set; }
        public int OfflineBrokers { get; set; }
    }

    public class TopicHealthSummaryResponse
    {
        public int TotalTopics { get; set; }
        public int HealthyTopics { get; set; }
        public int TopicsWithUnderReplicatedPartitions { get; set; }
        public int TopicsWithLag { get; set; }
        public List<TopicHealth> Topics { get; set; } = new();
    }

    public class TopicHealth
    {
        public string TopicName { get; set; } = string.Empty;
        public int PartitionCount { get; set; }
        public int ReplicationFactor { get; set; }
        public int UnderReplicatedPartitions { get; set; }
        public long TotalMessages { get; set; }
        public long TotalLag { get; set; }
        public int ConsumerGroupCount { get; set; }
        public string HealthStatus { get; set; } = string.Empty;  // Healthy, Warning, Critical
        public bool? HasActiveConsumers { get; set; } // True if topic has active consumers, false if only inactive, null if unknown
    }

    public class ConsumerLagSummaryResponse
    {
        public Dictionary<string, ConsumerGroupHealth> ConsumerGroups { get; set; } = new();
        public long TotalLag { get; set; }
        public int GroupsWithLag { get; set; }
        public DateTime Timestamp { get; set; }
    }

    public class ConsumerGroupHealth
    {
        public string GroupId { get; set; } = string.Empty;
        public string TopicName { get; set; } = string.Empty;
        public long TotalLag { get; set; }
        public int ActiveConsumers { get; set; }
        public List<PartitionLag> PartitionLags { get; set; } = new();
        public string State { get; set; } = string.Empty;  // Stable, Rebalancing, Dead
    }

    public class PartitionLag
    {
        public int PartitionId { get; set; }
        public long CurrentOffset { get; set; }
        public long LogEndOffset { get; set; }
        public long Lag { get; set; }
    }

    // ============================================================
    // Time Series Models
    // ============================================================

    public class TimeSeriesMetricsResponse
    {
        public string MetricType { get; set; } = string.Empty;
        public Dictionary<string, List<TimeSeriesDataPoint>> Series { get; set; } = new();
    }

    public class TimeSeriesDataPoint
    {
        public DateTime Timestamp { get; set; }
        public double Value { get; set; }
        public Dictionary<string, string>? Labels { get; set; }
    }

    // ============================================================
    // Services Health Models
    // ============================================================

    public class ServicesHealthResponse
    {
        public ServicesSummary Summary { get; set; } = new();
        public List<ServiceDetail> Services { get; set; } = new();
    }

    public class ServicesSummary
    {
        public int TotalServices { get; set; }
        public int RunningServices { get; set; }
        public int StoppedServices { get; set; }
        public int FailedServices { get; set; }
        public int DegradedServices { get; set; }
        public double HealthScore { get; set; }
    }

    public class ServiceDetail
    {
        public string Name { get; set; } = string.Empty;
        public string MetadataName { get; set; } = string.Empty;
        public string Namespace { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty; // Deployment, DaemonSet
        public string Status { get; set; } = string.Empty; // Running, Stopped, Failed, Degraded
        public int DesiredReplicas { get; set; }
        public int ReadyReplicas { get; set; }
        public int CurrentReplicas { get; set; }
        public DateTime? LastUpdated { get; set; }
        public int TotalPods { get; set; }
        public int RunningPods { get; set; }
    }

    // ============================================================
    // Consumers Health Models
    // ============================================================

    public class ConsumersHealthResponse
    {
        public ConsumersSummary Summary { get; set; } = new();
        public List<ConsumerDetail> Consumers { get; set; } = new();
    }

    public class ConsumersSummary
    {
        public int TotalConsumers { get; set; }
        public int RunningConsumers { get; set; }
        public int StoppedConsumers { get; set; }
        public int FailedConsumers { get; set; }
        public int DegradedConsumers { get; set; }
        public double HealthScore { get; set; }
    }

    public class ConsumerDetail
    {
        public string Name { get; set; } = string.Empty;
        public string MetadataName { get; set; } = string.Empty;
        public string Namespace { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty; // Deployment
        public string Status { get; set; } = string.Empty; // Running, Stopped, Failed, Degraded
        public bool ConsumerEnabled { get; set; } = true; // ConfigMap flag
        public int DesiredReplicas { get; set; }
        public int ReadyReplicas { get; set; }
        public int CurrentReplicas { get; set; }
        public DateTime? LastUpdated { get; set; }
        public int TotalPods { get; set; }
        public int RunningPods { get; set; }
    }

    // ============================================================
    // Jobs Health Models
    // ============================================================

    public class JobsHealthResponse
    {
        public JobsSummary Summary { get; set; } = new();
        public List<JobDetail> Jobs { get; set; } = new();
    }

    public class JobsSummary
    {
        public int TotalJobs { get; set; }
        public int ScheduledJobs { get; set; }
        public int PausedJobs { get; set; }
        public int FailedJobs { get; set; }
        public int DegradedJobs { get; set; }
        public double HealthScore { get; set; }
    }

    public class JobDetail
    {
        public string Name { get; set; } = string.Empty;
        public string MetadataName { get; set; } = string.Empty;
        public string Namespace { get; set; } = string.Empty;
        public string Type { get; set; } = "CronWorkflow";
        public string Status { get; set; } = string.Empty; // Scheduled, Paused, Failed, Degraded
        public string Schedule { get; set; } = string.Empty; // Cron expression
        public bool Suspended { get; set; }
        public DateTime? LastScheduleTime { get; set; }
        public List<WorkflowRunInfo> RecentRuns { get; set; } = new();
    }

    public class WorkflowRunInfo
    {
        public string Name { get; set; } = string.Empty;
        public string Phase { get; set; } = string.Empty; // Succeeded, Failed, Running, Pending
        public DateTime? StartTime { get; set; }
        public DateTime? FinishTime { get; set; }
    }
}

