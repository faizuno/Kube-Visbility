namespace KubeVisibility.Dashboard.Api.Services
{
    public interface IConsumerService
    {
        Task<string?> GetConsumerControlFlagAsync(string namespaceName, string deploymentName);
        Task<Dictionary<string, bool>> GetAllConsumerControlFlagsAsync(string namespaceName);
        Task<bool> SetConsumerControlFlagAsync(string namespaceName, string deploymentName, bool enabled);
    }
}

