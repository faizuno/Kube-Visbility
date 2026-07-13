using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services
{
    /// <summary>
    /// Service interface for interacting with Argo Workflows API.
    /// Follows Interface Segregation Principle (ISP) - focused on Argo Workflows operations only.
    /// </summary>
    public interface IArgoWorkflowsService
    {
        /// <summary>
        /// Submits a CronWorkflow for immediate execution via Argo Workflows API.
        /// </summary>
        /// <param name="namespaceName">The Kubernetes namespace containing the CronWorkflow</param>
        /// <param name="resourceName">The name of the CronWorkflow to submit</param>
        /// <returns>Response containing success status and workflow details</returns>
        Task<SubmitCronWorkflowResponse> SubmitCronWorkflowAsync(string namespaceName, string resourceName);
    }
}

