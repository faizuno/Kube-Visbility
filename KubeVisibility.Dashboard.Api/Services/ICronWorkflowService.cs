using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services
{
    public interface ICronWorkflowService
    {
        Task<bool> UpdateCronWorkflowAsync(string namespaceName, string resourceName, UpdateCronWorkflowRequest request);
        Task<bool> UpdateCronWorkflowLogLevelAsync(string namespaceName, string resourceName, string logLevel);
        Task<bool> ToggleCronWorkflowSuspendAsync(string namespaceName, string resourceName, bool suspend);
        Task<ResourceInfo?> GetCronWorkflowByNameAsync(string namespaceName, string resourceName);
    }
}

