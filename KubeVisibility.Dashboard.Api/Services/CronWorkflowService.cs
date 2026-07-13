using k8s;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Services.Shared;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class CronWorkflowService : ICronWorkflowService
    {
        private readonly IKubernetes _kubernetesClient;
        private readonly ILogger<CronWorkflowService> _logger;
        private readonly IMemoryCache _cache;

        public CronWorkflowService(
            IKubernetesClientFactory kubernetesClientFactory,
            ILogger<CronWorkflowService> logger,
            IMemoryCache cache)
        {
            _kubernetesClient = kubernetesClientFactory.CreateClient();
            _logger = logger;
            _cache = cache;
        }

        public async Task<bool> UpdateCronWorkflowAsync(string namespaceName, string resourceName, UpdateCronWorkflowRequest request)
        {
            try
            {
                _logger.LogInformation($"Updating CronWorkflow {resourceName} in namespace {namespaceName}");
                
                // Get the current CronWorkflow
                var cronWorkflow = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: namespaceName,
                    plural: "cronworkflows",
                    name: resourceName
                );
                
                if (cronWorkflow is JsonElement jsonElement)
                {
                    // Parse to dictionary for easier manipulation
                    var cronWorkflowDict = JsonSerializer.Deserialize<Dictionary<string, object>>(jsonElement.GetRawText());
                    
                    if (cronWorkflowDict != null && cronWorkflowDict.ContainsKey("spec"))
                    {
                        var specDict = JsonSerializer.Deserialize<Dictionary<string, object>>(
                            JsonSerializer.Serialize(cronWorkflowDict["spec"]));
                        
                        if (specDict != null)
                        {
                            // Update schedules
                            if (request.Schedules != null && request.Schedules.Any())
                            {
                                if (request.Schedules.Count == 1)
                                {
                                    // Use singular schedule field if only one schedule
                                    specDict["schedule"] = request.Schedules[0];
                                    specDict.Remove("schedules");
                                }
                                else
                                {
                                    // Use schedules array if multiple
                                    specDict["schedules"] = request.Schedules;
                                    specDict.Remove("schedule");
                                }
                            }
                            
                            // Update other properties
                            specDict["startingDeadlineSeconds"] = request.StartingDeadlineSeconds;
                            specDict["concurrencyPolicy"] = request.ConcurrencyPolicy;
                            specDict["successfulJobsHistoryLimit"] = request.SuccessfulJobsHistoryLimit;
                            specDict["failedJobsHistoryLimit"] = request.FailedJobsHistoryLimit;
                            specDict["suspend"] = request.Suspend;
                            
                            cronWorkflowDict["spec"] = specDict;
                            
                            // Update the CronWorkflow
                            await _kubernetesClient.CustomObjects.ReplaceNamespacedCustomObjectAsync(
                                body: cronWorkflowDict,
                                group: "argoproj.io",
                                version: "v1alpha1",
                                namespaceParameter: namespaceName,
                                plural: "cronworkflows",
                                name: resourceName
                            );
                            
                            _logger.LogInformation($"CronWorkflow {resourceName} updated successfully");
                            
                            // Invalidate cache so next fetch gets fresh data
                            InvalidateClusterCaches(namespaceName);
                            
                            return true;
                        }
                    }
                }
                
                _logger.LogError($"Failed to parse CronWorkflow {resourceName}");
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error updating CronWorkflow {resourceName} in namespace {namespaceName}");
                return false;
            }
        }

        public async Task<bool> UpdateCronWorkflowLogLevelAsync(string namespaceName, string resourceName, string logLevel)
        {
            try
            {
                _logger.LogInformation(
                    "Updating CronWorkflow {ResourceName} in namespace {NamespaceName} with Logging__LogLevel__Default={LogLevel}",
                    resourceName,
                    namespaceName,
                    logLevel);

                var cronWorkflow = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: namespaceName,
                    plural: "cronworkflows",
                    name: resourceName
                );

                if (cronWorkflow is not JsonElement jsonElement)
                {
                    _logger.LogError("Failed to parse CronWorkflow {ResourceName} as JsonElement", resourceName);
                    return false;
                }

                var root = JsonNode.Parse(jsonElement.GetRawText())?.AsObject();
                if (root == null)
                {
                    _logger.LogError("Failed to parse CronWorkflow {ResourceName} JSON root", resourceName);
                    return false;
                }

                var templates = root["spec"]?["workflowSpec"]?["templates"] as JsonArray;
                if (templates == null || templates.Count == 0)
                {
                    _logger.LogWarning("CronWorkflow {ResourceName} has no workflow templates to patch", resourceName);
                    return false;
                }

                var patchedContainers = 0;
                foreach (var templateNode in templates)
                {
                    if (templateNode is not JsonObject template)
                    {
                        continue;
                    }

                    if (template["container"] is JsonObject container)
                    {
                        UpsertEnvVar(container, "Logging__LogLevel__Default", logLevel);
                        patchedContainers++;
                    }

                    if (template["script"] is JsonObject script)
                    {
                        UpsertEnvVar(script, "Logging__LogLevel__Default", logLevel);
                        patchedContainers++;
                    }

                    if (template["containerSet"] is JsonObject containerSet &&
                        containerSet["containers"] is JsonArray containerSetContainers)
                    {
                        foreach (var containerNode in containerSetContainers)
                        {
                            if (containerNode is JsonObject containerSetContainer)
                            {
                                UpsertEnvVar(containerSetContainer, "Logging__LogLevel__Default", logLevel);
                                patchedContainers++;
                            }
                        }
                    }
                }

                if (patchedContainers == 0)
                {
                    _logger.LogWarning("CronWorkflow {ResourceName} has no container/script templates to patch", resourceName);
                    return false;
                }

                await _kubernetesClient.CustomObjects.ReplaceNamespacedCustomObjectAsync(
                    body: root,
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: namespaceName,
                    plural: "cronworkflows",
                    name: resourceName
                );

                _logger.LogInformation(
                    "CronWorkflow {ResourceName} log level updated to {LogLevel} for {PatchedContainers} template containers/scripts",
                    resourceName,
                    logLevel,
                    patchedContainers);

                InvalidateClusterCaches(namespaceName);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Error updating log level for CronWorkflow {ResourceName} in namespace {NamespaceName}",
                    resourceName,
                    namespaceName);
                return false;
            }
        }

        public async Task<bool> ToggleCronWorkflowSuspendAsync(string namespaceName, string resourceName, bool suspend)
        {
            try
            {
                _logger.LogInformation($"{(suspend ? "Suspending" : "Resuming")} CronWorkflow {resourceName} in namespace {namespaceName}");
                
                // Get the current CronWorkflow
                var cronWorkflow = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: namespaceName,
                    plural: "cronworkflows",
                    name: resourceName
                );
                
                if (cronWorkflow is JsonElement jsonElement)
                {
                    // Parse to dictionary for easier manipulation
                    var cronWorkflowDict = JsonSerializer.Deserialize<Dictionary<string, object>>(jsonElement.GetRawText());
                    
                    if (cronWorkflowDict != null && cronWorkflowDict.ContainsKey("spec"))
                    {
                        var specDict = JsonSerializer.Deserialize<Dictionary<string, object>>(
                            JsonSerializer.Serialize(cronWorkflowDict["spec"]));
                        
                        if (specDict != null)
                        {
                            // Update suspend property
                            specDict["suspend"] = suspend;
                            cronWorkflowDict["spec"] = specDict;
                            
                            // Update the CronWorkflow
                            await _kubernetesClient.CustomObjects.ReplaceNamespacedCustomObjectAsync(
                                body: cronWorkflowDict,
                                group: "argoproj.io",
                                version: "v1alpha1",
                                namespaceParameter: namespaceName,
                                plural: "cronworkflows",
                                name: resourceName
                            );
                            
                            _logger.LogInformation($"CronWorkflow {resourceName} {(suspend ? "suspended" : "resumed")} successfully");
                            
                            // Invalidate cache so next fetch gets fresh data
                            InvalidateClusterCaches(namespaceName);
                            
                            return true;
                        }
                    }
                }
                
                _logger.LogError($"Failed to parse CronWorkflow {resourceName}");
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error toggling suspend for CronWorkflow {resourceName} in namespace {namespaceName}");
                return false;
            }
        }

        public async Task<ResourceInfo?> GetCronWorkflowByNameAsync(string namespaceName, string resourceName)
        {
            try
            {
                _logger.LogInformation($"Fetching CronWorkflow {resourceName} in namespace {namespaceName}");
                
                // Get the specific CronWorkflow
                var cronWorkflow = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: namespaceName,
                    plural: "cronworkflows",
                    name: resourceName
                );
                
                if (cronWorkflow is JsonElement item)
                {
                    // Note: This method needs access to helper methods from ClusterService
                    // For now, returning a simplified version - will need to integrate with ClusterService helpers
                    _logger.LogWarning("GetCronWorkflowByNameAsync needs integration with ClusterService helper methods");
                    return null; // TODO: Implement fully with helper methods
                }
                
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching CronWorkflow {resourceName} in namespace {namespaceName}");
                return null;
            }
        }

        private static void UpsertEnvVar(JsonObject target, string envName, string envValue)
        {
            if (target["env"] is not JsonArray envArray)
            {
                envArray = new JsonArray();
                target["env"] = envArray;
            }

            foreach (var envNode in envArray)
            {
                if (envNode is JsonObject envObj &&
                    string.Equals(envObj["name"]?.GetValue<string>(), envName, StringComparison.Ordinal))
                {
                    envObj["value"] = envValue;
                    envObj.Remove("valueFrom");
                    return;
                }
            }

            envArray.Add(new JsonObject
            {
                ["name"] = envName,
                ["value"] = envValue
            });
        }

        private void InvalidateClusterCaches(string namespaceName)
        {
            _cache.Remove("kubernetes-cluster-info");
            _cache.Remove($"kubernetes-namespace-info-{namespaceName}");
        }
    }
}

