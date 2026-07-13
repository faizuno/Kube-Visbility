namespace KubeVisibility.Dashboard.Api.Services
{
    public interface IPodService
    {
        Task<string> GetPodLogsAsync(string namespaceName, string resourceName, string resourceType, int tailLines = 500, string? podName = null);
        Task<bool> RestartPodAsync(string namespaceName, string podName);
    }
}

