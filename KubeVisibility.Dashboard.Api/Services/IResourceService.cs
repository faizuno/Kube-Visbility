using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services
{
    public interface IResourceService
    {
        Task<bool> RestartResourceAsync(string namespaceName, string resourceName, string resourceType);
        Task<bool> UpdateLogLevelAsync(string namespaceName, string resourceName, string resourceType, string logLevel);
        Task<ResourceInfo?> GetDeploymentByNameAsync(string namespaceName, string deploymentName);
    }
}

