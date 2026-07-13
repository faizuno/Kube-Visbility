namespace KubeVisibility.Dashboard.Api.Models
{
    public class ClusterInfoResponse
    {
        public Dictionary<string, NamespaceInfo> Namespaces { get; set; } = new();
    }

    public class NamespaceInfo
    {
        public bool Success { get; set; }
        public List<ResourceInfo>? Resources { get; set; }
        public string? Error { get; set; }
    }

    public class ResourceInfo
    {
        public string Name { get; set; } = string.Empty;
        public string MetadataName { get; set; } = string.Empty; // Actual Kubernetes resource name for API calls
        public string Type { get; set; } = string.Empty;
        public DateTime? LastUpdated { get; set; }
        public List<ContainerInfo> Containers { get; set; } = new();
        public List<PodInfo> Pods { get; set; } = new();
        
        // Health and Replica Information
        public string HealthStatus { get; set; } = "Unknown"; // Healthy, Degraded, Failed, Unknown
        public int DesiredReplicas { get; set; }
        public int CurrentReplicas { get; set; }
        public int ReadyReplicas { get; set; }
        
        // CronWorkflow Schedule Information
        public string? Schedule { get; set; }
        public DateTime? LastScheduleTime { get; set; }
        
        // Resource Age
        public DateTime? CreationTime { get; set; }
        
        // Recent Events
        public List<EventInfo> RecentEvents { get; set; } = new();
        
        // CronWorkflow Properties (Argo Workflows)
        public List<string>? Schedules { get; set; }
        public int? StartingDeadlineSeconds { get; set; }
        public string? ConcurrencyPolicy { get; set; }
        public int? SuccessfulJobsHistoryLimit { get; set; }
        public int? FailedJobsHistoryLimit { get; set; }
        public bool? Suspend { get; set; }
        
        // Consumer Control (ConfigMap flag)
        public bool? ConsumerEnabled { get; set; }
    }

    public class ContainerInfo
    {
        public string Name { get; set; } = string.Empty;
        public string Image { get; set; } = string.Empty;
        public string Version { get; set; } = string.Empty;
        public Dictionary<string, string> EnvironmentVariables { get; set; } = new();
        
        // Resource Limits
        public string CpuRequest { get; set; } = string.Empty;
        public string CpuLimit { get; set; } = string.Empty;
        public string MemoryRequest { get; set; } = string.Empty;
        public string MemoryLimit { get; set; } = string.Empty;
        public string ImagePullPolicy { get; set; } = string.Empty;
    }

    public class PodInfo
    {
        public string Name { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public DateTime? StartTime { get; set; }
        public string? RestartCount { get; set; }
        
        // Pod Health Information
        public bool IsReady { get; set; }
        public string Reason { get; set; } = string.Empty;        // CrashLoopBackOff, ImagePullBackOff, etc.
        public string Message { get; set; } = string.Empty;       // Detailed error message
        public string NodeName { get; set; } = string.Empty;
        
        // Resource Utilization
        public string? CpuUsage { get; set; }           // Current CPU usage (e.g., "100m", "1.5")
        public string? MemoryUsage { get; set; }        // Current memory usage (e.g., "512Mi", "1Gi")
        public string? CpuLimit { get; set; }          // CPU limit from pod spec
        public string? MemoryLimit { get; set; }       // Memory limit from pod spec
        public string? CpuRequest { get; set; }         // CPU request from pod spec
        public string? MemoryRequest { get; set; }      // Memory request from pod spec
        public double? CpuUsagePercent { get; set; }    // CPU usage as percentage of limit
        public double? MemoryUsagePercent { get; set; } // Memory usage as percentage of limit
    }
    
    public class EventInfo
    {
        public string Type { get; set; } = string.Empty;    // Normal, Warning, Error
        public string Reason { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public DateTime Timestamp { get; set; }
    }
    
    // Consumer Control Models
    public class ConsumerControlFlagResponse
    {
        public bool Enabled { get; set; }
        public bool Exists { get; set; }
    }
    
    public class ToggleConsumerRequest
    {
        public string NamespaceName { get; set; } = string.Empty;
        public string DeploymentName { get; set; } = string.Empty;
        public bool Enabled { get; set; }
    }
    
    public class ToggleConsumerResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public ResourceInfo? UpdatedResource { get; set; }
    }
    
    // CronWorkflow Management Models
    public class UpdateCronWorkflowRequest
    {
        public string NamespaceName { get; set; } = string.Empty;
        public string ResourceName { get; set; } = string.Empty;
        public List<string> Schedules { get; set; } = new();
        public int StartingDeadlineSeconds { get; set; }
        public string ConcurrencyPolicy { get; set; } = string.Empty;
        public int SuccessfulJobsHistoryLimit { get; set; }
        public int FailedJobsHistoryLimit { get; set; }
        public bool Suspend { get; set; }
    }
    
    public class UpdateCronWorkflowResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public ResourceInfo? UpdatedResource { get; set; }
    }

    public class UpdateCronWorkflowLogLevelRequest
    {
        public string NamespaceName { get; set; } = string.Empty;
        public string ResourceName { get; set; } = string.Empty;
        public string LogLevel { get; set; } = string.Empty;
    }

    public class UpdateCronWorkflowLogLevelResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public ResourceInfo? UpdatedResource { get; set; }
    }
    
    public class ToggleSuspendRequest
    {
        public string NamespaceName { get; set; } = string.Empty;
        public string ResourceName { get; set; } = string.Empty;
        public bool Suspend { get; set; }
    }
    
    public class ToggleSuspendResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public bool? CurrentSuspendState { get; set; }
        public ResourceInfo? UpdatedResource { get; set; }
    }

    // Request models for controllers
    public class RestartPodRequest
    {
        public string NamespaceName { get; set; } = string.Empty;
        public string PodName { get; set; } = string.Empty;
    }

    public class RestartResourceRequest
    {
        public string NamespaceName { get; set; } = string.Empty;
        public string ResourceName { get; set; } = string.Empty;
        public string ResourceType { get; set; } = string.Empty;
    }

    public class UpdateLogLevelRequest
    {
        public string NamespaceName { get; set; } = string.Empty;
        public string ResourceName { get; set; } = string.Empty;
        public string ResourceType { get; set; } = string.Empty;
        public string LogLevel { get; set; } = string.Empty;
    }

    public class UpdateLogLevelResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
    }
    
    // Argo Workflows Submit Models
    public class SubmitCronWorkflowRequest
    {
        public string NamespaceName { get; set; } = string.Empty;
        public string ResourceName { get; set; } = string.Empty;
    }
    
    public class SubmitCronWorkflowResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public string? WorkflowName { get; set; }
    }
}

