using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services
{
    public interface IClusterService
    {
        Task<ClusterInfoResponse> GetClusterInfoAsync();
        Task<NamespaceInfo> GetNamespaceInfoAsync(string namespaceName);
        Task<List<PodInfo>> GetPodsForResourceAsync(string namespaceName, string resourceName, string resourceType);
        Task<List<EventInfo>> GetEventsForResourceAsync(string namespaceName, string resourceName, string resourceType);
        Task<ResourceInfo?> GetDeploymentByNameAsync(string namespaceName, string deploymentName);
        Task<ResourceInfo?> GetCronWorkflowByNameAsync(string namespaceName, string resourceName);
    }
}

