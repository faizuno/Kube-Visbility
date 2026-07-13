using k8s;
using k8s.Models;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Services.Shared;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class ResourceService : IResourceService
    {
        private readonly IKubernetes _kubernetesClient;
        private readonly ILogger<ResourceService> _logger;
        private readonly IMemoryCache _cache;

        public ResourceService(
            IKubernetesClientFactory kubernetesClientFactory,
            IMemoryCache cache,
            ILogger<ResourceService> logger)
        {
            _kubernetesClient = kubernetesClientFactory.CreateClient();
            _cache = cache;
            _logger = logger;
        }

        public async Task<bool> RestartResourceAsync(string namespaceName, string resourceName, string resourceType)
        {
            try
            {
                _logger.LogWarning($"{resourceType} restart requested: {resourceName} in namespace {namespaceName}");
                
                var restartAnnotation = DateTime.UtcNow.ToString("o");
                
                switch (resourceType)
                {
                    case "Deployment":
                        var deployment = await _kubernetesClient.AppsV1.ReadNamespacedDeploymentAsync(resourceName, namespaceName);
                        
                        if (deployment.Spec?.Template?.Metadata?.Annotations == null)
                        {
                            if (deployment.Spec?.Template?.Metadata == null)
                            {
                                if (deployment.Spec?.Template != null)
                                {
                                    deployment.Spec.Template.Metadata = new V1ObjectMeta();
                                }
                            }
                            if (deployment.Spec?.Template?.Metadata != null)
                            {
                                deployment.Spec.Template.Metadata.Annotations = new Dictionary<string, string>();
                            }
                        }
                        
                        if (deployment.Spec?.Template?.Metadata?.Annotations != null)
                        {
                            deployment.Spec.Template.Metadata.Annotations["kubectl.kubernetes.io/restartedAt"] = restartAnnotation;
                        }
                        
                        await _kubernetesClient.AppsV1.ReplaceNamespacedDeploymentAsync(deployment, resourceName, namespaceName);
                        break;
                        
                    case "DaemonSet":
                        var daemonSet = await _kubernetesClient.AppsV1.ReadNamespacedDaemonSetAsync(resourceName, namespaceName);
                        
                        if (daemonSet.Spec?.Template?.Metadata?.Annotations == null)
                        {
                            if (daemonSet.Spec?.Template?.Metadata == null)
                            {
                                if (daemonSet.Spec?.Template != null)
                                {
                                    daemonSet.Spec.Template.Metadata = new V1ObjectMeta();
                                }
                            }
                            if (daemonSet.Spec?.Template?.Metadata != null)
                            {
                                daemonSet.Spec.Template.Metadata.Annotations = new Dictionary<string, string>();
                            }
                        }
                        
                        if (daemonSet.Spec?.Template?.Metadata?.Annotations != null)
                        {
                            daemonSet.Spec.Template.Metadata.Annotations["kubectl.kubernetes.io/restartedAt"] = restartAnnotation;
                        }
                        
                        await _kubernetesClient.AppsV1.ReplaceNamespacedDaemonSetAsync(daemonSet, resourceName, namespaceName);
                        break;
                        
                    case "StatefulSet":
                        var statefulSet = await _kubernetesClient.AppsV1.ReadNamespacedStatefulSetAsync(resourceName, namespaceName);
                        
                        if (statefulSet.Spec?.Template?.Metadata?.Annotations == null)
                        {
                            if (statefulSet.Spec?.Template?.Metadata == null)
                            {
                                if (statefulSet.Spec?.Template != null)
                                {
                                    statefulSet.Spec.Template.Metadata = new V1ObjectMeta();
                                }
                            }
                            if (statefulSet.Spec?.Template?.Metadata != null)
                            {
                                statefulSet.Spec.Template.Metadata.Annotations = new Dictionary<string, string>();
                            }
                        }
                        
                        if (statefulSet.Spec?.Template?.Metadata?.Annotations != null)
                        {
                            statefulSet.Spec.Template.Metadata.Annotations["kubectl.kubernetes.io/restartedAt"] = restartAnnotation;
                        }
                        
                        await _kubernetesClient.AppsV1.ReplaceNamespacedStatefulSetAsync(statefulSet, resourceName, namespaceName);
                        break;
                        
                    default:
                        _logger.LogError($"Unsupported resource type for restart: {resourceType}");
                        return false;
                }
                
                _logger.LogInformation($"{resourceType} {resourceName} in namespace {namespaceName} restarted successfully");
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error restarting {resourceType} {resourceName} in namespace {namespaceName}");
                return false;
            }
        }

        public async Task<bool> UpdateLogLevelAsync(string namespaceName, string resourceName, string resourceType, string logLevel)
        {
            try
            {
                _logger.LogWarning(
                    "Updating Logging__LogLevel__Default for {ResourceType}/{ResourceName} in namespace {NamespaceName} to {LogLevel}",
                    resourceType,
                    resourceName,
                    namespaceName,
                    logLevel);

                var normalizedType = resourceType?.Trim();
                switch (normalizedType)
                {
                    case "Deployment":
                    {
                        var deployment = await _kubernetesClient.AppsV1.ReadNamespacedDeploymentAsync(resourceName, namespaceName);
                        var containers = deployment.Spec?.Template?.Spec?.Containers;
                        if (containers == null || containers.Count == 0)
                        {
                            _logger.LogError("Deployment {ResourceName} has no containers to update", resourceName);
                            return false;
                        }

                        foreach (var container in containers)
                        {
                            UpsertEnvVar(container, "Logging__LogLevel__Default", logLevel);
                        }

                        await _kubernetesClient.AppsV1.ReplaceNamespacedDeploymentAsync(deployment, resourceName, namespaceName);
                        break;
                    }
                    case "DaemonSet":
                    {
                        var daemonSet = await _kubernetesClient.AppsV1.ReadNamespacedDaemonSetAsync(resourceName, namespaceName);
                        var containers = daemonSet.Spec?.Template?.Spec?.Containers;
                        if (containers == null || containers.Count == 0)
                        {
                            _logger.LogError("DaemonSet {ResourceName} has no containers to update", resourceName);
                            return false;
                        }

                        foreach (var container in containers)
                        {
                            UpsertEnvVar(container, "Logging__LogLevel__Default", logLevel);
                        }

                        await _kubernetesClient.AppsV1.ReplaceNamespacedDaemonSetAsync(daemonSet, resourceName, namespaceName);
                        break;
                    }
                    case "StatefulSet":
                    {
                        var statefulSet = await _kubernetesClient.AppsV1.ReadNamespacedStatefulSetAsync(resourceName, namespaceName);
                        var containers = statefulSet.Spec?.Template?.Spec?.Containers;
                        if (containers == null || containers.Count == 0)
                        {
                            _logger.LogError("StatefulSet {ResourceName} has no containers to update", resourceName);
                            return false;
                        }

                        foreach (var container in containers)
                        {
                            UpsertEnvVar(container, "Logging__LogLevel__Default", logLevel);
                        }

                        await _kubernetesClient.AppsV1.ReplaceNamespacedStatefulSetAsync(statefulSet, resourceName, namespaceName);
                        break;
                    }
                    default:
                        _logger.LogError("Unsupported resource type for log level update: {ResourceType}", normalizedType);
                        return false;
                }

                _logger.LogInformation(
                    "Log level updated for {ResourceType}/{ResourceName} in namespace {NamespaceName} to {LogLevel}",
                    resourceType,
                    resourceName,
                    namespaceName,
                    logLevel);
                InvalidateClusterCaches(namespaceName);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Error updating log level for {ResourceType} {ResourceName} in namespace {NamespaceName}",
                    resourceType,
                    resourceName,
                    namespaceName);
                return false;
            }
        }

        private static void UpsertEnvVar(V1Container container, string name, string value)
        {
            container.Env ??= new List<V1EnvVar>();

            var existing = container.Env.FirstOrDefault(env =>
                string.Equals(env.Name, name, StringComparison.Ordinal));

            if (existing != null)
            {
                existing.Value = value;
                existing.ValueFrom = null;
                return;
            }

            container.Env.Add(new V1EnvVar
            {
                Name = name,
                Value = value
            });
        }

        private void InvalidateClusterCaches(string namespaceName)
        {
            _cache.Remove("kubernetes-cluster-info");
            _cache.Remove($"kubernetes-namespace-info-{namespaceName}");

            _logger.LogDebug(
                "Invalidated cluster caches after mutation for namespace {NamespaceName}",
                namespaceName);
        }

        public async Task<ResourceInfo?> GetDeploymentByNameAsync(string namespaceName, string deploymentName)
        {
            try
            {
                _logger.LogInformation($"Fetching Deployment {deploymentName} in namespace {namespaceName}");
                
                // Get the specific Deployment
                var deployment = await _kubernetesClient.AppsV1.ReadNamespacedDeploymentAsync(deploymentName, namespaceName);
                
                if (deployment != null)
                {
                    // Note: This method needs access to helper methods from ClusterService
                    // For now, returning a simplified version - will need to integrate with ClusterService helpers
                    // This is a placeholder that will need the full implementation with all helper methods
                    _logger.LogWarning("GetDeploymentByNameAsync needs integration with ClusterService helper methods");
                    return null; // TODO: Implement fully with helper methods
                }
                
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching Deployment {deploymentName} in namespace {namespaceName}");
                return null;
            }
        }
    }
}

