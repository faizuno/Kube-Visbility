using k8s;
using k8s.Models;
using KubeVisibility.Dashboard.Api.Services.Shared;
using Microsoft.Extensions.Logging;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class PodService : IPodService
    {
        private readonly IKubernetes _kubernetesClient;
        private readonly ILogger<PodService> _logger;

        public PodService(
            IKubernetesClientFactory kubernetesClientFactory,
            ILogger<PodService> logger)
        {
            _kubernetesClient = kubernetesClientFactory.CreateClient();
            _logger = logger;
        }

        public async Task<string> GetPodLogsAsync(string namespaceName, string resourceName, string resourceType, int tailLines = 500, string? podName = null)
        {
            try
            {
                V1Pod? pod = null;

                // If podName is provided, fetch that specific pod directly
                if (!string.IsNullOrEmpty(podName))
                {
                    try
                    {
                        pod = await _kubernetesClient.CoreV1.ReadNamespacedPodAsync(podName, namespaceName);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning($"Failed to read pod {podName}: {ex.Message}");
                        return $"ERROR: Pod '{podName}' not found - {ex.Message}";
                    }
                }
                else
                {
                    // Find pods based on resource type and name
                    string labelSelector = "";
                    
                    if (resourceType == "Deployment")
                    {
                        var deployment = await _kubernetesClient.AppsV1.ReadNamespacedDeploymentAsync(resourceName, namespaceName);
                        var labels = deployment.Spec.Selector.MatchLabels;
                        labelSelector = string.Join(",", labels.Select(l => $"{l.Key}={l.Value}"));
                    }
                    else if (resourceType == "DaemonSet")
                    {
                        var daemonSet = await _kubernetesClient.AppsV1.ReadNamespacedDaemonSetAsync(resourceName, namespaceName);
                        var labels = daemonSet.Spec.Selector.MatchLabels;
                        labelSelector = string.Join(",", labels.Select(l => $"{l.Key}={l.Value}"));
                    }
                    else if (resourceType == "CronWorkflow")
                    {
                        // For CronWorkflows, find the most recent workflow pods
                        labelSelector = $"workflows.argoproj.io/cron-workflow={resourceName}";
                    }

                    if (string.IsNullOrEmpty(labelSelector))
                    {
                        return "ERROR: No label selector found for this resource type.";
                    }

                    // Get pods matching the label selector
                    var pods = await _kubernetesClient.CoreV1.ListNamespacedPodAsync(
                        namespaceName,
                        labelSelector: labelSelector
                    );

                    if (pods.Items == null || !pods.Items.Any())
                    {
                        return "No pods found for this resource.";
                    }

                    // Get logs from the most recent pod
                    pod = pods.Items
                        .OrderByDescending(p => p.Status?.StartTime ?? DateTime.MinValue)
                        .FirstOrDefault();

                    if (pod == null)
                    {
                        return "No active pods found.";
                    }
                }

                // Get logs from the main container (skip wait/init containers for Argo Workflows)
                var containerName = GetMainContainerName(pod);
                if (string.IsNullOrEmpty(containerName))
                {
                    return "No containers found in pod.";
                }

                _logger.LogInformation($"Fetching logs from container '{containerName}' in pod '{pod.Metadata.Name}'");

                try
                {
                    var logStream = await _kubernetesClient.CoreV1.ReadNamespacedPodLogAsync(
                        pod.Metadata.Name,
                        namespaceName,
                        container: containerName,
                        tailLines: tailLines
                    );

                    using (var reader = new StreamReader(logStream))
                    {
                        var logs = await reader.ReadToEndAsync();
                        return string.IsNullOrEmpty(logs) ? "No logs available." : logs;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning($"Failed to read logs for pod {pod.Metadata.Name}: {ex.Message}");
                    return $"ERROR: Unable to read logs - {ex.Message}";
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error getting pod logs for {resourceName} in {namespaceName}");
                return $"ERROR: {ex.Message}";
            }
        }

        public async Task<bool> RestartPodAsync(string namespaceName, string podName)
        {
            try
            {
                _logger.LogWarning($"Pod restart requested: {podName} in namespace {namespaceName}");
                
                // Delete the pod - Kubernetes will automatically recreate it if it's part of a deployment/daemonset
                await _kubernetesClient.CoreV1.DeleteNamespacedPodAsync(podName, namespaceName);
                
                _logger.LogInformation($"Pod {podName} in namespace {namespaceName} deleted successfully. It will be recreated automatically.");
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error restarting pod {podName} in namespace {namespaceName}");
                return false;
            }
        }

        /// <summary>
        /// Gets the main container name from a pod, skipping sidecar containers like "wait" (Argo Workflows)
        /// </summary>
        private string? GetMainContainerName(V1Pod pod)
        {
            if (pod.Spec?.Containers == null || !pod.Spec.Containers.Any())
            {
                return null;
            }

            // List of container names to skip (typically sidecars or utility containers)
            var skipContainerNames = new[] { "wait", "init", "istio-proxy", "istio-init" };

            // Try to find a container that's not in the skip list
            var mainContainer = pod.Spec.Containers
                .FirstOrDefault(c => !skipContainerNames.Contains(c.Name, StringComparer.OrdinalIgnoreCase));

            // If all containers are in skip list, return the first one anyway
            return mainContainer?.Name ?? pod.Spec.Containers.FirstOrDefault()?.Name;
        }
    }
}

