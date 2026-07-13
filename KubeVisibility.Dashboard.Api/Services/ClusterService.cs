using k8s;
using k8s.Models;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Options;
using KubeVisibility.Dashboard.Api.Services.Shared;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class ClusterService : IClusterService
    {
        private readonly IKubernetes _kubernetesClient;
        private readonly IConfiguration _configuration;
        private readonly ILogger<ClusterService> _logger;
        private readonly IMemoryCache _cache;
        private readonly IConsumerService _consumerService;
        private readonly IKubernetesMetricsService _metricsService;
        private readonly List<string> _namespaces;
        private readonly List<string> _environmentVariables;
        private readonly int _cacheDurationSeconds;
        private readonly string _consumersNamespace;

        public ClusterService(
            IKubernetesClientFactory kubernetesClientFactory,
            IConfiguration configuration,
            ILogger<ClusterService> logger,
            IMemoryCache cache,
            IConsumerService consumerService,
            IKubernetesMetricsService metricsService)
        {
            _kubernetesClient = kubernetesClientFactory.CreateClient();
            _configuration = configuration;
            _logger = logger;
            _cache = cache;
            _consumerService = consumerService;
            _metricsService = metricsService;

            // Load configuration
            _namespaces = _configuration.GetSection("KubernetesInfo:Namespaces").Get<List<string>>() ?? new List<string>();
            _environmentVariables = _configuration.GetSection("KubernetesInfo:EnvironmentVariables").Get<List<string>>() ?? new List<string>();
            _cacheDurationSeconds = _configuration.GetValue<int>("KubernetesInfo:CacheDurationSeconds", 30); // Default 30 seconds
            _consumersNamespace = KubernetesInfoConfiguration.GetConsumersNamespace(_configuration);
        }

        public async Task<ClusterInfoResponse> GetClusterInfoAsync()
        {
            const string cacheKey = "kubernetes-cluster-info";

            // Try to get cached data
            return await _cache.GetOrCreateAsync(cacheKey, async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(_cacheDurationSeconds);
                _logger.LogInformation($"Cache miss - fetching fresh data from Kubernetes API (cache duration: {_cacheDurationSeconds}s)");

            var response = new ClusterInfoResponse();

                // Process all namespaces in parallel
                var namespaceTasks = _namespaces.Select(async ns =>
            {
                try
                {
                    _logger.LogInformation($"Querying namespace: {ns}");
                    var resources = new List<ResourceInfo>();

                    var cronWorkflowsTask = GetCronWorkflowsAsync(ns);
                    var consumerFlagsTask = GetNamespaceConsumerFlagsAsync(ns);

                    var consumerFlags = await consumerFlagsTask;
                    // Get all resource types in parallel for this namespace
                    var deploymentsTask = GetDeploymentsAsync(ns, consumerFlags);
                    var daemonSetsTask = GetDaemonSetsAsync(ns, consumerFlags);

                    await Task.WhenAll(deploymentsTask, daemonSetsTask, cronWorkflowsTask);

                    resources.AddRange(await deploymentsTask);
                    resources.AddRange(await daemonSetsTask);
                    resources.AddRange(await cronWorkflowsTask);

                    _logger.LogInformation($"Successfully retrieved {resources.Count} resources from namespace: {ns}");

                    return (Namespace: ns, Info: new NamespaceInfo
                    {
                        Success = true,
                        Resources = resources
                    });
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, $"Error querying namespace: {ns}");
                    return (Namespace: ns, Info: new NamespaceInfo
                    {
                        Success = false,
                        Error = $"Failed to query namespace: {ex.Message}"
                    });
                }
            }).ToList();

                // Wait for all namespace queries to complete
                var results = await Task.WhenAll(namespaceTasks);

                // Populate response
                foreach (var result in results)
                {
                    response.Namespaces[result.Namespace] = result.Info;
                }

                _logger.LogInformation($"Successfully cached cluster info with {response.Namespaces.Count} namespaces");
            return response;
            }) ?? new ClusterInfoResponse();
        }

        public async Task<NamespaceInfo> GetNamespaceInfoAsync(string namespaceName)
        {
            var cacheKey = $"kubernetes-namespace-info-{namespaceName}";

            // Try to get cached data for this specific namespace
            return await _cache.GetOrCreateAsync(cacheKey, async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(_cacheDurationSeconds);
                _logger.LogInformation($"Cache miss for namespace {namespaceName} - fetching fresh data");

                try
                {
                    _logger.LogInformation($"Querying namespace: {namespaceName}");
                    var resources = new List<ResourceInfo>();

                    var cronWorkflowsTask = GetCronWorkflowsAsync(namespaceName);
                    var consumerFlagsTask = GetNamespaceConsumerFlagsAsync(namespaceName);

                    var consumerFlags = await consumerFlagsTask;
                    // Get all resource types in parallel for this namespace
                    var deploymentsTask = GetDeploymentsAsync(namespaceName, consumerFlags);
                    var daemonSetsTask = GetDaemonSetsAsync(namespaceName, consumerFlags);

                    await Task.WhenAll(deploymentsTask, daemonSetsTask, cronWorkflowsTask);

                    resources.AddRange(await deploymentsTask);
                    resources.AddRange(await daemonSetsTask);
                    resources.AddRange(await cronWorkflowsTask);

                    _logger.LogInformation($"Successfully retrieved {resources.Count} resources from namespace: {namespaceName}");

                    return new NamespaceInfo
                    {
                        Success = true,
                        Resources = resources
                    };
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, $"Error querying namespace: {namespaceName}");
                    return new NamespaceInfo
                    {
                        Success = false,
                        Error = $"Failed to query namespace: {ex.Message}"
                    };
                }
            }) ?? new NamespaceInfo { Success = false, Error = "Failed to retrieve namespace info" };
        }

        private async Task<List<ResourceInfo>> GetDeploymentsAsync(string ns, IReadOnlyDictionary<string, bool> consumerFlags)
        {
            var resources = new List<ResourceInfo>();

            try
            {
                _logger.LogInformation($"Fetching deployments from namespace: {ns}");
                var deployments = await _kubernetesClient.AppsV1.ListNamespacedDeploymentAsync(ns);
                _logger.LogInformation($"Found {deployments.Items?.Count ?? 0} deployments in namespace: {ns}");

                // Fetch resources (pods and events will be loaded lazily)
                foreach (var deployment in deployments.Items ?? Enumerable.Empty<V1Deployment>())
                {
                    if (deployment?.Metadata?.Name == null) continue;
                    
                    // Resolve consumer flag from namespace-level snapshot to avoid N per-resource lookups.
                    bool? consumerEnabled = null;
                    if (ns == _consumersNamespace)
                    {
                        consumerEnabled = ResolveConsumerEnabled(deployment.Metadata.Name, consumerFlags);
                    }
                    
                    // Calculate health status, but override to "Stopped" if consumer is disabled
                    var healthStatus = GetDeploymentHealthStatus(deployment.Status?.Replicas ?? 0, deployment.Status?.ReadyReplicas ?? 0, deployment.Spec?.Replicas ?? 0, deployment.Status?.Conditions);
                    if (consumerEnabled == false)
                    {
                        healthStatus = "Stopped";
                    }
                    
                    // Last updated and container extraction are independent and can run together.
                    var lastUpdatedTask = GetDeploymentLastUpdatedTimeAsync(ns, deployment);
                    var containersTask = ExtractContainerInfoAsync(deployment.Spec?.Template?.Spec?.Containers ?? new List<V1Container>(), ns);
                    await Task.WhenAll(lastUpdatedTask, containersTask);

                    var resourceInfo = new ResourceInfo
                    {
                        Name = GetNameFromLabels(deployment.Spec?.Template?.Metadata?.Labels, deployment.Metadata.Name ?? "unknown"),
                        MetadataName = deployment.Metadata.Name ?? "unknown",
                        Type = "Deployment",
                        LastUpdated = await lastUpdatedTask,
                        Containers = await containersTask,
                        CreationTime = deployment.Metadata.CreationTimestamp,
                        DesiredReplicas = deployment.Spec?.Replicas ?? 0,
                        CurrentReplicas = deployment.Status?.Replicas ?? 0,
                        ReadyReplicas = deployment.Status?.ReadyReplicas ?? 0,
                        HealthStatus = healthStatus,
                        Pods = new List<PodInfo>(), // Empty list, will be loaded lazily
                        RecentEvents = new List<EventInfo>(), // Empty list, will be loaded lazily
                        ConsumerEnabled = consumerEnabled
                    };

                    resources.Add(resourceInfo);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Failed to get Deployments in namespace {ns}: {ex.Message}");
                // Don't re-throw - return empty list so other resource types can still be fetched
            }

            return resources;
        }

        private async Task<List<ResourceInfo>> GetDaemonSetsAsync(string ns, IReadOnlyDictionary<string, bool> consumerFlags)
        {
            var resources = new List<ResourceInfo>();

            try
            {
                _logger.LogInformation($"Fetching daemonSets from namespace: {ns}");
                var daemonSets = await _kubernetesClient.AppsV1.ListNamespacedDaemonSetAsync(ns);
                _logger.LogInformation($"Found {daemonSets.Items?.Count ?? 0} daemonSets in namespace: {ns}");

                // Fetch resources (pods and events will be loaded lazily)
                foreach (var daemonSet in daemonSets.Items ?? Enumerable.Empty<V1DaemonSet>())
                {
                    if (daemonSet?.Metadata?.Name == null) continue;
                    
                    // Resolve consumer flag from namespace-level snapshot to avoid N per-resource lookups.
                    bool? consumerEnabled = null;
                    if (ns == _consumersNamespace)
                    {
                        consumerEnabled = ResolveConsumerEnabled(daemonSet.Metadata.Name, consumerFlags);
                    }
                    
                    // Calculate health status, but override to "Stopped" if consumer is disabled
                    var healthStatus = GetHealthStatus(daemonSet.Status?.CurrentNumberScheduled ?? 0, daemonSet.Status?.NumberReady ?? 0, daemonSet.Status?.DesiredNumberScheduled ?? 0);
                    if (consumerEnabled == false)
                    {
                        healthStatus = "Stopped";
                    }
                    
                    // Last updated and container extraction are independent and can run together.
                    var lastUpdatedTask = GetDaemonSetLastUpdatedTimeAsync(ns, daemonSet);
                    var containersTask = ExtractContainerInfoAsync(daemonSet.Spec.Template.Spec.Containers, ns);
                    await Task.WhenAll(lastUpdatedTask, containersTask);

                    var resourceInfo = new ResourceInfo
                    {
                        Name = GetNameFromLabels(daemonSet.Spec.Template.Metadata?.Labels, daemonSet.Metadata.Name),
                        MetadataName = daemonSet.Metadata.Name,
                        Type = "DaemonSet",
                        LastUpdated = await lastUpdatedTask,
                        Containers = await containersTask,
                        CreationTime = daemonSet.Metadata.CreationTimestamp,
                        DesiredReplicas = daemonSet.Status?.DesiredNumberScheduled ?? 0,
                        CurrentReplicas = daemonSet.Status?.CurrentNumberScheduled ?? 0,
                        ReadyReplicas = daemonSet.Status?.NumberReady ?? 0,
                        HealthStatus = healthStatus,
                        Pods = new List<PodInfo>(), // Empty list, will be loaded lazily
                        RecentEvents = new List<EventInfo>(), // Empty list, will be loaded lazily
                        ConsumerEnabled = consumerEnabled
                    };

                    resources.Add(resourceInfo);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Failed to get DaemonSets in namespace {ns}: {ex.Message}");
                // Don't re-throw - return empty list so other resource types can still be fetched
            }

            return resources;
        }

        private static bool ResolveConsumerEnabled(string metadataName, IReadOnlyDictionary<string, bool> consumerFlags)
        {
            return consumerFlags.TryGetValue(metadataName, out var consumerEnabled)
                ? consumerEnabled
                : true;
        }

        private async Task<IReadOnlyDictionary<string, bool>> GetNamespaceConsumerFlagsAsync(string namespaceName)
        {
            if (namespaceName != _consumersNamespace)
            {
                return new Dictionary<string, bool>();
            }

            try
            {
                return await _consumerService.GetAllConsumerControlFlagsAsync(namespaceName);
            }
            catch (Exception ex)
            {
                _logger.LogDebug($"Could not fetch consumer flags for namespace {namespaceName}: {ex.Message}. Defaulting consumers to enabled.");
                return new Dictionary<string, bool>();
            }
        }

        private async Task<List<ResourceInfo>> GetCronWorkflowsAsync(string ns)
        {
            var resources = new List<ResourceInfo>();

            try
            {
                _logger.LogInformation($"Fetching cronWorkflows from namespace: {ns}");
                // CronWorkflow is a CRD from Argo Workflows
                // API Group: argoproj.io/v1alpha1
                // Kind: CronWorkflow
                var cronWorkflows = await _kubernetesClient.CustomObjects.ListNamespacedCustomObjectAsync(
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: ns,
                    plural: "cronworkflows"
                );

                // Parse the response as a generic object
                if (cronWorkflows is JsonElement jsonElement)
                {
                    var items = jsonElement.GetProperty("items");
                    var itemCount = items.GetArrayLength();
                    _logger.LogInformation($"Found {itemCount} cronWorkflows in namespace: {ns}");

                    // Fetch resources (pods and events will be loaded lazily)
                    foreach (var item in items.EnumerateArray())
                    {
                        var metadata = item.GetProperty("metadata");
                        var metadataName = metadata.GetProperty("name").GetString() ?? "unknown";
                        
                        // Get creation timestamp
                        DateTime? creationTimestamp = null;
                        if (metadata.TryGetProperty("creationTimestamp", out var creationTimeElement) && 
                            creationTimeElement.ValueKind == JsonValueKind.String)
                        {
                            DateTime.TryParse(creationTimeElement.GetString(), out var parsedTime);
                            creationTimestamp = parsedTime;
                        }
                        
                        // Try to get labels from spec.workflowSpec.templates[].metadata.labels
                        Dictionary<string, string>? labels = null;
                        try
                        {
                            if (item.TryGetProperty("spec", out var spec) &&
                                spec.TryGetProperty("workflowSpec", out var workflowSpec) &&
                                workflowSpec.TryGetProperty("templates", out var templates) &&
                                templates.ValueKind == JsonValueKind.Array)
                            {
                                // Iterate through templates to find labels (usually in the first template)
                                foreach (var template in templates.EnumerateArray())
                                {
                                    if (template.TryGetProperty("metadata", out var templateMetadata) &&
                                        templateMetadata.TryGetProperty("labels", out var labelsElement))
                                    {
                                        labels = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(labelsElement.GetRawText());
                                        break; // Use the first template with labels
                                    }
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogDebug($"Failed to extract labels from CronWorkflow {metadataName}: {ex.Message}");
                        }

                        // Extract schedule information and CronWorkflow properties
                        string? schedule = null;
                        List<string>? schedules = null;
                        DateTime? lastScheduleTime = null;
                        int? startingDeadlineSeconds = null;
                        string? concurrencyPolicy = null;
                        int? successfulJobsHistoryLimit = null;
                        int? failedJobsHistoryLimit = null;
                        bool? suspend = null;
                        
                        try
                        {
                            if (item.TryGetProperty("spec", out var spec))
                            {
                                // Try to get schedules array first (plural)
                                if (spec.TryGetProperty("schedules", out var schedulesElement) && 
                                    schedulesElement.ValueKind == JsonValueKind.Array)
                                {
                                    schedules = new List<string>();
                                    foreach (var scheduleItem in schedulesElement.EnumerateArray())
                                    {
                                        if (scheduleItem.ValueKind == JsonValueKind.String)
                                        {
                                            var scheduleValue = scheduleItem.GetString();
                                            if (!string.IsNullOrEmpty(scheduleValue))
                                            {
                                                schedules.Add(scheduleValue);
                                            }
                                        }
                                    }
                                    // Set the first schedule as the primary schedule for backward compatibility
                                    schedule = schedules.FirstOrDefault();
                                }
                                // Fallback to singular schedule field
                                else if (spec.TryGetProperty("schedule", out var scheduleElement))
                                {
                                    schedule = scheduleElement.GetString();
                                    if (!string.IsNullOrEmpty(schedule))
                                    {
                                        schedules = new List<string> { schedule };
                                    }
                                }
                                
                                // Extract startingDeadlineSeconds
                                if (spec.TryGetProperty("startingDeadlineSeconds", out var startingDeadlineElement))
                                {
                                    if (startingDeadlineElement.ValueKind == JsonValueKind.Number)
                                    {
                                        startingDeadlineSeconds = startingDeadlineElement.GetInt32();
                                    }
                                }
                                
                                // Extract concurrencyPolicy
                                if (spec.TryGetProperty("concurrencyPolicy", out var concurrencyPolicyElement))
                                {
                                    concurrencyPolicy = concurrencyPolicyElement.GetString();
                                }
                                
                                // Extract successfulJobsHistoryLimit
                                if (spec.TryGetProperty("successfulJobsHistoryLimit", out var successfulLimitElement))
                                {
                                    if (successfulLimitElement.ValueKind == JsonValueKind.Number)
                                    {
                                        successfulJobsHistoryLimit = successfulLimitElement.GetInt32();
                                    }
                                }
                                
                                // Extract failedJobsHistoryLimit
                                if (spec.TryGetProperty("failedJobsHistoryLimit", out var failedLimitElement))
                                {
                                    if (failedLimitElement.ValueKind == JsonValueKind.Number)
                                    {
                                        failedJobsHistoryLimit = failedLimitElement.GetInt32();
                                    }
                                }
                                
                                // Extract suspend
                                if (spec.TryGetProperty("suspend", out var suspendElement))
                                {
                                    if (suspendElement.ValueKind == JsonValueKind.True)
                                    {
                                        suspend = true;
                                    }
                                    else if (suspendElement.ValueKind == JsonValueKind.False)
                                    {
                                        suspend = false;
                                    }
                                }
                            }
                            
                            if (item.TryGetProperty("status", out var status))
                            {
                                if (status.TryGetProperty("lastScheduledTime", out var lastScheduledElement) &&
                                    lastScheduledElement.ValueKind == JsonValueKind.String)
                                {
                                    DateTime.TryParse(lastScheduledElement.GetString(), out var parsedLastScheduled);
                                    lastScheduleTime = parsedLastScheduled;
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogDebug($"Failed to extract schedule from CronWorkflow {metadataName}: {ex.Message}");
                        }
                        
                        // For CronWorkflows, get the most recent pod to determine last run time and status
                        var cronWorkflowLabels = new Dictionary<string, string>
                        {
                            { "workflows.argoproj.io/cron-workflow", metadataName }
                        };
                        
                        // Get the most recent pod's info for CronWorkflow
                        var (mostRecentPodTime, mostRecentPodStatus) = await GetMostRecentPodInfoAsync(ns, cronWorkflowLabels);

                        var resourceInfo = new ResourceInfo
                        {
                            Name = GetNameFromLabels(labels, metadataName),
                            MetadataName = metadataName,
                            Type = "CronWorkflow",
                            LastUpdated = mostRecentPodTime ?? creationTimestamp,
                            Containers = await ExtractContainerInfoFromCronWorkflowAsync(item, ns),
                            CreationTime = creationTimestamp,
                            Schedule = schedule,
                            LastScheduleTime = mostRecentPodTime, // Use most recent pod's creation time as last run time
                            HealthStatus = mostRecentPodStatus ?? "Never Run", // Use pod status or "Never Run"
                            Pods = new List<PodInfo>(), // Empty list, will be loaded lazily
                            RecentEvents = new List<EventInfo>(), // Empty list, will be loaded lazily
                            // CronWorkflow properties
                            Schedules = schedules,
                            StartingDeadlineSeconds = startingDeadlineSeconds,
                            ConcurrencyPolicy = concurrencyPolicy,
                            SuccessfulJobsHistoryLimit = successfulJobsHistoryLimit,
                            FailedJobsHistoryLimit = failedJobsHistoryLimit,
                            Suspend = suspend
                        };

                        resources.Add(resourceInfo);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Failed to get CronWorkflows in namespace {ns}: {ex.Message}");
                // Don't re-throw - return empty list so other resource types can still be fetched
            }

            return resources;
        }

        private async Task<List<ContainerInfo>> ExtractContainerInfoAsync(IList<V1Container> containers, string namespaceName)
        {
            var containerInfoList = new List<ContainerInfo>();

            foreach (var container in containers)
            {
                // Extract from env (individual env vars)
                var envVars = await ExtractEnvironmentVariablesAsync(container.Env, namespaceName);
                
                // Extract from envFrom (bulk import from ConfigMaps/Secrets)
                var envFromVars = await ExtractEnvironmentVariablesFromEnvFromAsync(container.EnvFrom, namespaceName);
                
                // Merge both (envFrom values are overridden by env values if same key exists)
                foreach (var kvp in envFromVars)
                {
                    if (!envVars.ContainsKey(kvp.Key))
                    {
                        envVars[kvp.Key] = kvp.Value;
                    }
                }
                
                _logger.LogDebug($"Container '{container.Name}' has {container.Env?.Count ?? 0} env vars + {container.EnvFrom?.Count ?? 0} envFrom sources, extracted {envVars.Count} total matching configured filter");
                
                var containerInfo = new ContainerInfo
                {
                    Name = container.Name,
                    Image = GetImageName(container.Image),
                    Version = GetImageVersion(container.Image),
                    EnvironmentVariables = envVars,
                    CpuRequest = container.Resources?.Requests?.TryGetValue("cpu", out var cpuReq) == true ? cpuReq.ToString() : string.Empty,
                    CpuLimit = container.Resources?.Limits?.TryGetValue("cpu", out var cpuLim) == true ? cpuLim.ToString() : string.Empty,
                    MemoryRequest = container.Resources?.Requests?.TryGetValue("memory", out var memReq) == true ? memReq.ToString() : string.Empty,
                    MemoryLimit = container.Resources?.Limits?.TryGetValue("memory", out var memLim) == true ? memLim.ToString() : string.Empty,
                    ImagePullPolicy = container.ImagePullPolicy ?? string.Empty
                };

                containerInfoList.Add(containerInfo);
            }

            return containerInfoList;
        }

        private async Task<List<ContainerInfo>> ExtractContainerInfoFromCronWorkflowAsync(JsonElement cronWorkflow, string namespaceName)
        {
            var containerInfoList = new List<ContainerInfo>();

            try
            {
                // Navigate through CronWorkflow spec structure
                // CronWorkflow > spec > workflowSpec > templates > container
                if (cronWorkflow.TryGetProperty("spec", out var spec) &&
                    spec.TryGetProperty("workflowSpec", out var workflowSpec) &&
                    workflowSpec.TryGetProperty("templates", out var templates))
                {
                    foreach (var template in templates.EnumerateArray())
                    {
                        if (template.TryGetProperty("container", out var containerObj))
                        {
                            var containerName = template.TryGetProperty("name", out var nameObj) 
                                ? nameObj.GetString() ?? "unknown" 
                                : "unknown";

                            var image = containerObj.TryGetProperty("image", out var imageObj) 
                                ? imageObj.GetString() ?? "" 
                                : "";

                            var containerInfo = new ContainerInfo
                            {
                                Name = containerName,
                                Image = GetImageName(image),
                                Version = GetImageVersion(image),
                                EnvironmentVariables = await ExtractEnvironmentVariablesFromJsonAsync(containerObj, namespaceName)
                            };

                            containerInfoList.Add(containerInfo);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Failed to extract container info from CronWorkflow: {ex.Message}");
            }

            return containerInfoList;
        }

        private async Task<Dictionary<string, string>> ExtractEnvironmentVariablesFromEnvFromAsync(IList<V1EnvFromSource>? envFromSources, string namespaceName)
        {
            var envDict = new Dictionary<string, string>();

            if (envFromSources == null || !envFromSources.Any())
                return envDict;

            foreach (var envFromSource in envFromSources)
            {
                try
                {
                    // Handle ConfigMapRef
                    if (envFromSource.ConfigMapRef != null)
                    {
                        var configMapName = envFromSource.ConfigMapRef.Name;
                        
                        try
                        {
                            var configMap = await _kubernetesClient.CoreV1.ReadNamespacedConfigMapAsync(configMapName, namespaceName);
                            
                            if (configMap?.Data != null)
                            {
                                foreach (var kvp in configMap.Data)
            {
                // Check if we should include this environment variable
                                    bool shouldInclude = _environmentVariables.Count == 0 || _environmentVariables.Contains(kvp.Key);
                                    
                                    if (shouldInclude)
                                    {
                                        envDict[kvp.Key] = kvp.Value;
                                    }
                                }
                                
                                _logger.LogDebug($"Loaded {envDict.Count} vars from ConfigMap '{configMapName}'");
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning($"Failed to read ConfigMap {configMapName} via envFrom: {ex.Message}");
                        }
                    }
                    // Handle SecretRef
                    else if (envFromSource.SecretRef != null)
                    {
                        var secretName = envFromSource.SecretRef.Name;
                        
                        try
                        {
                            var secret = await _kubernetesClient.CoreV1.ReadNamespacedSecretAsync(secretName, namespaceName);
                            
                            if (secret?.Data != null)
                            {
                                foreach (var kvp in secret.Data)
                                {
                                    // Check if we should include this environment variable
                                    bool shouldInclude = _environmentVariables.Count == 0 || _environmentVariables.Contains(kvp.Key);
                                    
                                    if (shouldInclude)
                                    {
                                        var value = System.Text.Encoding.UTF8.GetString(kvp.Value);
                                        envDict[kvp.Key] = value;
                                    }
                                }
                                
                                _logger.LogDebug($"Loaded {envDict.Count} vars from Secret '{secretName}'");
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning($"Failed to read Secret {secretName} via envFrom: {ex.Message}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning($"Failed to process envFrom source: {ex.Message}");
                }
            }

            return envDict;
        }

        private async Task<Dictionary<string, string>> ExtractEnvironmentVariablesAsync(IList<V1EnvVar>? envVars, string namespaceName)
        {
            var envDict = new Dictionary<string, string>();

            if (envVars == null || !envVars.Any())
                return envDict;

            foreach (var envVar in envVars)
            {
                // Extract ALL env variables (no filtering for individual env vars)
                // Handle direct value
                if (!string.IsNullOrEmpty(envVar.Value))
                {
                    envDict[envVar.Name] = envVar.Value;
                }
                // Handle valueFrom (ConfigMap, Secret, FieldRef, ResourceFieldRef)
                else if (envVar.ValueFrom != null)
                {
                    string value = await ResolveValueFromAsync(envVar.ValueFrom, namespaceName);
                    envDict[envVar.Name] = value;
                }
            }

            return envDict;
        }

        private async Task<string> ResolveValueFromAsync(V1EnvVarSource valueFrom, string namespaceName)
        {
            try
            {
                // Handle ConfigMap reference
                if (valueFrom.ConfigMapKeyRef != null)
                {
                    var configMapName = valueFrom.ConfigMapKeyRef.Name;
                    var key = valueFrom.ConfigMapKeyRef.Key;
                    
                    try
                    {
                        var configMap = await _kubernetesClient.CoreV1.ReadNamespacedConfigMapAsync(configMapName, namespaceName);
                        
                        if (configMap?.Data != null && configMap.Data.TryGetValue(key, out var value))
                        {
                            return value;
                        }
                        
                        return $"[ConfigMap:{configMapName}/{key} - Key not found]";
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning($"Failed to read ConfigMap {configMapName}/{key}: {ex.Message}");
                        return $"[ConfigMap:{configMapName}/{key} - Error: {ex.Message}]";
                    }
                }
                // Handle Secret reference
                else if (valueFrom.SecretKeyRef != null)
                {
                    var secretName = valueFrom.SecretKeyRef.Name;
                    var key = valueFrom.SecretKeyRef.Key;
                    
                    try
                    {
                        var secret = await _kubernetesClient.CoreV1.ReadNamespacedSecretAsync(secretName, namespaceName);
                        
                        if (secret?.Data != null && secret.Data.TryGetValue(key, out var valueBytes))
                        {
                            return System.Text.Encoding.UTF8.GetString(valueBytes);
                        }
                        
                        return $"[Secret:{secretName}/{key} - Key not found]";
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning($"Failed to read Secret {secretName}/{key}: {ex.Message}");
                        return $"[Secret:{secretName}/{key} - Error: {ex.Message}]";
                    }
                }
                // Handle Field reference (pod metadata)
                else if (valueFrom.FieldRef != null)
                {
                    return $"[Field:{valueFrom.FieldRef.FieldPath}]";
                }
                // Handle Resource reference
                else if (valueFrom.ResourceFieldRef != null)
                {
                    return $"[Resource:{valueFrom.ResourceFieldRef.Resource}]";
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Failed to resolve valueFrom: {ex.Message}");
            }
            
            return "[Unable to resolve]";
        }

        private async Task<Dictionary<string, string>> ExtractEnvironmentVariablesFromJsonAsync(JsonElement container, string namespaceName)
        {
            var envDict = new Dictionary<string, string>();

            try
            {
                if (container.TryGetProperty("env", out var envArray))
                {
                    foreach (var envItem in envArray.EnumerateArray())
                    {
                        if (envItem.TryGetProperty("name", out var nameObj))
                        {
                            var name = nameObj.GetString() ?? "";
                            
                            // Extract ALL env variables (no filtering for individual env vars)
                            if (string.IsNullOrEmpty(name))
                                continue;

                            // Handle direct value
                            if (envItem.TryGetProperty("value", out var valueObj) && valueObj.ValueKind == JsonValueKind.String)
                            {
                            var value = valueObj.GetString() ?? "";
                                if (!string.IsNullOrEmpty(value))
                                {
                                    envDict[name] = value;
                                }
                            }
                            // Handle valueFrom
                            else if (envItem.TryGetProperty("valueFrom", out var valueFromObj))
                            {
                                string value = await ResolveValueFromJsonAsync(valueFromObj, namespaceName);
                                envDict[name] = value;
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Failed to extract environment variables from JSON: {ex.Message}");
            }

            return envDict;
        }

        private async Task<string> ResolveValueFromJsonAsync(JsonElement valueFromObj, string namespaceName)
        {
            try
            {
                // Handle ConfigMap reference
                if (valueFromObj.TryGetProperty("configMapKeyRef", out var configMapRef))
                {
                    var cmName = configMapRef.TryGetProperty("name", out var cmNameObj) ? cmNameObj.GetString() : null;
                    var cmKey = configMapRef.TryGetProperty("key", out var cmKeyObj) ? cmKeyObj.GetString() : null;
                    
                    if (!string.IsNullOrEmpty(cmName) && !string.IsNullOrEmpty(cmKey))
                    {
                        try
                        {
                            var configMap = await _kubernetesClient.CoreV1.ReadNamespacedConfigMapAsync(cmName, namespaceName);
                            
                            if (configMap?.Data != null && configMap.Data.TryGetValue(cmKey, out var value))
                            {
                                return value;
                            }
                            
                            return $"[ConfigMap:{cmName}/{cmKey} - Key not found]";
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning($"Failed to read ConfigMap {cmName}/{cmKey}: {ex.Message}");
                            return $"[ConfigMap:{cmName}/{cmKey} - Error: {ex.Message}]";
                        }
                    }
                }
                // Handle Secret reference
                else if (valueFromObj.TryGetProperty("secretKeyRef", out var secretRef))
                {
                    var secretName = secretRef.TryGetProperty("name", out var secretNameObj) ? secretNameObj.GetString() : null;
                    var secretKey = secretRef.TryGetProperty("key", out var secretKeyObj) ? secretKeyObj.GetString() : null;
                    
                    if (!string.IsNullOrEmpty(secretName) && !string.IsNullOrEmpty(secretKey))
                    {
                        try
                        {
                            var secret = await _kubernetesClient.CoreV1.ReadNamespacedSecretAsync(secretName, namespaceName);
                            
                            if (secret?.Data != null && secret.Data.TryGetValue(secretKey, out var valueBytes))
                            {
                                return System.Text.Encoding.UTF8.GetString(valueBytes);
                            }
                            
                            return $"[Secret:{secretName}/{secretKey} - Key not found]";
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning($"Failed to read Secret {secretName}/{secretKey}: {ex.Message}");
                            return $"[Secret:{secretName}/{secretKey} - Error: {ex.Message}]";
                        }
                    }
                }
                // Handle Field reference
                else if (valueFromObj.TryGetProperty("fieldRef", out var fieldRef))
                {
                    var fieldPath = fieldRef.TryGetProperty("fieldPath", out var fieldPathObj) ? fieldPathObj.GetString() : "unknown";
                    return $"[Field:{fieldPath}]";
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Failed to resolve valueFrom from JSON: {ex.Message}");
            }
            
            return "[Unable to resolve]";
        }

        private string GetImageName(string fullImage)
        {
            // Extract image name without tag
            // Example: "registry.example.com/service-api:1.2.3" -> "registry.example.com/service-api"
            if (string.IsNullOrEmpty(fullImage))
                return string.Empty;

            var parts = fullImage.Split(':');
            return parts[0];
        }

        private string GetImageVersion(string fullImage)
        {
            // Extract version/tag from image
            // Example: "registry.example.com/service-api:1.2.3" -> "1.2.3"
            if (string.IsNullOrEmpty(fullImage))
                return string.Empty;

            var parts = fullImage.Split(':');
            return parts.Length > 1 ? parts[1] : "latest";
        }

        private string GetNameFromLabels(IDictionary<string, string>? labels, string defaultName)
        {
            // Try to get the name from the standard Kubernetes label app.kubernetes.io/name
            if (labels != null && labels.TryGetValue("app.kubernetes.io/name", out var labelName) && !string.IsNullOrEmpty(labelName))
            {
                return labelName;
            }

            // Fallback to the default name (metadata.name)
            return defaultName;
        }

        /// <summary>
        /// Gets the last updated time by checking the most recent pod's creation timestamp
        /// </summary>
        private async Task<DateTime?> GetResourceLastUpdatedTimeAsync(string ns, IDictionary<string, string>? matchLabels, DateTime? fallbackCreationTimestamp)
        {
            try
            {
                var labelSelector = matchLabels != null
                    ? string.Join(",", matchLabels.Select(kvp => $"{kvp.Key}={kvp.Value}"))
                    : null;

                if (!string.IsNullOrEmpty(labelSelector))
                {
                    var pods = await _kubernetesClient.CoreV1.ListNamespacedPodAsync(
                        namespaceParameter: ns,
                        labelSelector: labelSelector
                    );

                    // Find the most recently created pod
                    var mostRecentPod = pods.Items
                        .Where(p => p.Metadata?.CreationTimestamp != null)
                        .OrderByDescending(p => p.Metadata.CreationTimestamp)
                        .FirstOrDefault();

                    if (mostRecentPod?.Metadata?.CreationTimestamp != null)
                    {
                        return mostRecentPod.Metadata.CreationTimestamp;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug($"Could not get pod info for label selector: {ex.Message}");
            }

            // Fallback to creation timestamp
            return fallbackCreationTimestamp;
        }

        /// <summary>
        /// Gets the most recent pod's creation time and status for CronWorkflows
        /// </summary>
        private async Task<(DateTime?, string?)> GetMostRecentPodInfoAsync(string ns, IDictionary<string, string>? matchLabels)
        {
            try
            {
                // Extract the CronWorkflow name from labels if available
                string? cronWorkflowName = null;
                if (matchLabels != null && matchLabels.TryGetValue("workflows.argoproj.io/cron-workflow", out var cwName))
                {
                    cronWorkflowName = cwName;
                }

                // Try label selector first (may not work for all CronWorkflows)
                var labelSelector = matchLabels != null
                    ? string.Join(",", matchLabels.Select(kvp => $"{kvp.Key}={kvp.Value}"))
                    : null;

                V1Pod? mostRecentPod = null;

                if (!string.IsNullOrEmpty(labelSelector))
                {
                    var pods = await _kubernetesClient.CoreV1.ListNamespacedPodAsync(
                        namespaceParameter: ns,
                        labelSelector: labelSelector
                    );

                    mostRecentPod = pods.Items
                        .Where(p => p.Metadata?.CreationTimestamp != null)
                        .OrderByDescending(p => p.Metadata.CreationTimestamp)
                        .FirstOrDefault();
                }

                // Fallback: If no pods found and we have a CronWorkflow name, search by name pattern
                if (mostRecentPod == null && !string.IsNullOrEmpty(cronWorkflowName))
                {
                    _logger.LogDebug($"No pods found with label selector for CronWorkflow {cronWorkflowName}, trying name pattern search");
                    
                    // Get all pods in namespace
                    var allPods = await _kubernetesClient.CoreV1.ListNamespacedPodAsync(namespaceParameter: ns);
                    
                    // Filter pods that belong to this CronWorkflow
                    var expectedPrefix = $"{cronWorkflowName}-";
                    var matchingPods = allPods.Items.Where(pod =>
                    {
                        var podName = pod.Metadata?.Name ?? string.Empty;
                        var podLabels = pod.Metadata?.Labels;

                        // Check if pod has the cron-workflow label (most reliable)
                        if (podLabels != null && podLabels.TryGetValue("workflows.argoproj.io/cron-workflow", out var cwLabel) && cwLabel == cronWorkflowName)
                            return true;

                        // Check if pod has workflow label and name matches exact pattern
                        if (podLabels != null && podLabels.ContainsKey("workflows.argoproj.io/workflow"))
                        {
                            // Check if pod name matches pattern: {cronWorkflowName}-{numeric-timestamp}
                            if (podName.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase))
                            {
                                // After the prefix, check if the next part is numeric (timestamp)
                                var remainingPart = podName.Substring(expectedPrefix.Length);
                                if (remainingPart.Length > 0 && long.TryParse(remainingPart, out _))
                                {
                                    return true;
                                }
                            }
                        }

                        // Fallback: Check if pod name matches exact pattern: {cronWorkflowName}-{numeric-timestamp}
                        if (podName.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase))
                        {
                            // After the prefix, check if the remaining part is numeric (timestamp)
                            var remainingPart = podName.Substring(expectedPrefix.Length);
                            if (remainingPart.Length > 0 && long.TryParse(remainingPart, out _))
                            {
                                return true;
                            }
                        }

                        return false;
                    }).ToList();

                    _logger.LogDebug($"Found {matchingPods.Count} pods for CronWorkflow {cronWorkflowName} using name pattern");

                    mostRecentPod = matchingPods
                        .Where(p => p.Metadata?.CreationTimestamp != null)
                        .OrderByDescending(p => p.Metadata.CreationTimestamp)
                        .FirstOrDefault();
                }

                if (mostRecentPod != null)
                {
                    var creationTime = mostRecentPod.Metadata?.CreationTimestamp;
                    var status = mostRecentPod.Status?.Phase ?? "Unknown";
                    
                    _logger.LogDebug($"Most recent pod for CronWorkflow {cronWorkflowName}: {mostRecentPod.Metadata?.Name}, Status: {status}, Created: {creationTime}");
                    
                    return (creationTime, status);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Could not get pod info for CronWorkflow");
            }

            return (null, null);
        }

        /// <summary>
        /// Gets the last updated time for a deployment by checking the most recent pod's creation timestamp
        /// </summary>
        private async Task<DateTime?> GetDeploymentLastUpdatedTimeAsync(string ns, V1Deployment deployment)
        {
            return await GetResourceLastUpdatedTimeAsync(
                ns, 
                deployment.Spec?.Selector?.MatchLabels, 
                deployment.Metadata.CreationTimestamp
            );
        }

        /// <summary>
        /// Gets the last updated time for a DaemonSet by checking the most recent pod's creation timestamp
        /// </summary>
        private async Task<DateTime?> GetDaemonSetLastUpdatedTimeAsync(string ns, V1DaemonSet daemonSet)
        {
            return await GetResourceLastUpdatedTimeAsync(
                ns, 
                daemonSet.Spec?.Selector?.MatchLabels, 
                daemonSet.Metadata.CreationTimestamp
            );
        }

        private DateTime? GetLastUpdatedTime(IList<V1DeploymentCondition>? conditions, DateTime? creationTimestamp)
        {
            // Try to get the most recent condition time (indicates last update)
            if (conditions != null && conditions.Any())
            {
                var latestCondition = conditions
                    .Where(c => c.LastTransitionTime.HasValue)
                    .OrderByDescending(c => c.LastTransitionTime)
                    .FirstOrDefault();

                if (latestCondition?.LastTransitionTime != null)
                {
                    return latestCondition.LastTransitionTime.Value;
                }
            }

            // Fallback to creation timestamp
            return creationTimestamp;
        }

        private DateTime? GetLastUpdatedTime(IList<V1DaemonSetCondition>? conditions, DateTime? creationTimestamp)
        {
            // Try to get the most recent condition time (indicates last update)
            if (conditions != null && conditions.Any())
            {
                var latestCondition = conditions
                    .Where(c => c.LastTransitionTime.HasValue)
                    .OrderByDescending(c => c.LastTransitionTime)
                    .FirstOrDefault();

                if (latestCondition?.LastTransitionTime != null)
                {
                    return latestCondition.LastTransitionTime.Value;
                }
            }

            // Fallback to creation timestamp
            return creationTimestamp;
        }

        /// <summary>
        /// Determines health status for deployments based on replica counts and deployment conditions
        /// </summary>
        private string GetDeploymentHealthStatus(int current, int ready, int desired, IList<V1DeploymentCondition>? conditions)
        {
            // Check deployment conditions first - this catches stalled deployments
            if (conditions != null && conditions.Any())
            {
                // Check for ProgressDeadlineExceeded - this indicates a stalled deployment
                var progressingCondition = conditions.FirstOrDefault(c => c.Type == "Progressing");
                if (progressingCondition != null && 
                    progressingCondition.Status == "False" && 
                    progressingCondition.Reason == "ProgressDeadlineExceeded")
                {
                    return "Failed"; // Deployment is stalled
                }
                
                // Check if deployment is available
                var availableCondition = conditions.FirstOrDefault(c => c.Type == "Available");
                if (availableCondition != null && availableCondition.Status == "False")
                {
                    return "Failed"; // Deployment is not available
                }
                
                // Check for ReplicaFailure condition
                var replicaFailureCondition = conditions.FirstOrDefault(c => c.Type == "ReplicaFailure");
                if (replicaFailureCondition != null && replicaFailureCondition.Status == "True")
                {
                    return "Failed"; // Replica creation failed
                }
            }
            
            // Fall back to replica count logic
            return GetHealthStatus(current, ready, desired);
        }
        
        /// <summary>
        /// Determines health status based on replica counts
        /// </summary>
        private string GetHealthStatus(int current, int ready, int desired)
        {
            if (desired == 0) return "Unknown";
            if (ready == desired) return "Healthy";
            if (ready > 0) return "Degraded";
            return "Failed";
        }

        /// <summary>
        /// Extracts detailed pod information including health status and resource utilization
        /// </summary>
        private PodInfo ExtractPodInfo(V1Pod pod, Dictionary<string, PodMetrics>? podMetricsDict = null)
        {
            var containerStatus = pod.Status?.ContainerStatuses?.FirstOrDefault();
            var podCondition = pod.Status?.Conditions?.FirstOrDefault(c => c.Type == "Ready");
            
            // Determine reason and message for non-ready pods
            string reason = string.Empty;
            string message = string.Empty;
            bool isReady = podCondition?.Status == "True";
            
            if (!isReady && containerStatus != null)
            {
                if (containerStatus.State?.Waiting != null)
                {
                    reason = containerStatus.State.Waiting.Reason ?? string.Empty;
                    message = containerStatus.State.Waiting.Message ?? string.Empty;
                }
                else if (containerStatus.State?.Terminated != null)
                {
                    reason = containerStatus.State.Terminated.Reason ?? string.Empty;
                    message = containerStatus.State.Terminated.Message ?? string.Empty;
                }
            }
            
            var podInfo = new PodInfo
            {
                Name = pod.Metadata.Name,
                Status = pod.Status?.Phase ?? "Unknown",
                StartTime = pod.Status?.StartTime,
                RestartCount = containerStatus?.RestartCount.ToString() ?? "0",
                IsReady = isReady,
                Reason = reason,
                Message = message,
                NodeName = pod.Spec?.NodeName ?? string.Empty
            };

            // Extract resource requests and limits from pod spec
            var containers = pod.Spec?.Containers ?? new List<V1Container>();
            long totalCpuRequest = 0;
            long totalMemoryRequest = 0;
            long totalCpuLimit = 0;
            long totalMemoryLimit = 0;

            foreach (var container in containers)
            {
                // CPU Request
                if (container.Resources?.Requests?.ContainsKey("cpu") == true)
                {
                    var cpuRequestStr = container.Resources.Requests["cpu"].ToString();
                    totalCpuRequest += ParseResourceQuantityToNanocores(cpuRequestStr);
                }
                
                // CPU Limit
                if (container.Resources?.Limits?.ContainsKey("cpu") == true)
                {
                    var cpuLimitStr = container.Resources.Limits["cpu"].ToString();
                    totalCpuLimit += ParseResourceQuantityToNanocores(cpuLimitStr);
                }
                
                // Memory Request
                if (container.Resources?.Requests?.ContainsKey("memory") == true)
                {
                    var memRequestStr = container.Resources.Requests["memory"].ToString();
                    totalMemoryRequest += ParseResourceQuantityToBytes(memRequestStr);
                }
                
                // Memory Limit
                if (container.Resources?.Limits?.ContainsKey("memory") == true)
                {
                    var memLimitStr = container.Resources.Limits["memory"].ToString();
                    totalMemoryLimit += ParseResourceQuantityToBytes(memLimitStr);
                }
            }

            // Set resource requests/limits (format as strings)
            if (totalCpuRequest > 0)
                podInfo.CpuRequest = FormatCpuQuantity(totalCpuRequest);
            if (totalCpuLimit > 0)
                podInfo.CpuLimit = FormatCpuQuantity(totalCpuLimit);
            if (totalMemoryRequest > 0)
                podInfo.MemoryRequest = FormatMemoryQuantity(totalMemoryRequest);
            if (totalMemoryLimit > 0)
                podInfo.MemoryLimit = FormatMemoryQuantity(totalMemoryLimit);

            // Get current usage from metrics
            if (podMetricsDict != null && podMetricsDict.TryGetValue(pod.Metadata.Name, out var metrics))
            {
                var cpuUsageValue = ParseResourceQuantityToNanocores(metrics.CpuUsage);
                podInfo.CpuUsage = cpuUsageValue > 0
                    ? FormatCpuQuantity(cpuUsageValue)
                    : metrics.CpuUsage;
                
                // Format memory usage to MB instead of KB
                if (!string.IsNullOrEmpty(metrics.MemoryUsage))
                {
                    var memUsageBytes = ParseResourceQuantityToBytes(metrics.MemoryUsage);
                    podInfo.MemoryUsage = FormatMemoryQuantity(memUsageBytes);
                }
                else
                {
                    podInfo.MemoryUsage = metrics.MemoryUsage;
                }
                
                // Calculate percentages if limits are available
                if (totalCpuLimit > 0 && !string.IsNullOrEmpty(metrics.CpuUsage))
                {
                    podInfo.CpuUsagePercent = (cpuUsageValue / (double)totalCpuLimit) * 100;
                }
                
                if (totalMemoryLimit > 0 && !string.IsNullOrEmpty(metrics.MemoryUsage))
                {
                    var memUsageValue = ParseResourceQuantityToBytes(metrics.MemoryUsage);
                    podInfo.MemoryUsagePercent = (memUsageValue / (double)totalMemoryLimit) * 100;
                }
            }

            return podInfo;
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

        /// <summary>
        /// Parse Kubernetes CPU resource quantity to nanocores
        /// </summary>
        private long ParseResourceQuantityToNanocores(string quantity)
        {
            if (string.IsNullOrEmpty(quantity))
                return 0;

            try
            {
                quantity = quantity.Trim();
                
                // CPU parsing (convert to nanocores for consistency)
                if (quantity.EndsWith("n", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.TrimEnd('n', 'N'));
                }
                else if (quantity.EndsWith("u", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.TrimEnd('u', 'U')) * 1_000; // microcores to nanocores
                }
                else if (quantity.EndsWith("m", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.TrimEnd('m', 'M')) * 1_000_000; // millicores to nanocores
                }
                else if (double.TryParse(quantity, out var cpuValue))
                {
                    return (long)(cpuValue * 1_000_000_000); // cores to nanocores
                }
                
                return 0;
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>
        /// Parse Kubernetes memory resource quantity to bytes
        /// </summary>
        private long ParseResourceQuantityToBytes(string quantity)
        {
            if (string.IsNullOrEmpty(quantity))
                return 0;

            try
            {
                quantity = quantity.Trim();
                
                // Memory parsing (convert to bytes)
                if (quantity.EndsWith("Ki", StringComparison.OrdinalIgnoreCase))
                {
                    var value = long.Parse(quantity.Replace("Ki", "").Replace("ki", ""));
                    return value * 1024;
                }
                else if (quantity.EndsWith("Mi", StringComparison.OrdinalIgnoreCase))
                {
                    var value = long.Parse(quantity.Replace("Mi", "").Replace("mi", ""));
                    return value * 1024 * 1024;
                }
                else if (quantity.EndsWith("Gi", StringComparison.OrdinalIgnoreCase))
                {
                    var value = long.Parse(quantity.Replace("Gi", "").Replace("gi", ""));
                    return value * 1024L * 1024 * 1024;
                }
                else if (quantity.EndsWith("Ti", StringComparison.OrdinalIgnoreCase))
                {
                    var value = long.Parse(quantity.Replace("Ti", "").Replace("ti", ""));
                    return value * 1024L * 1024 * 1024 * 1024;
                }
                else if (quantity.EndsWith("K", StringComparison.OrdinalIgnoreCase))
                {
                    var value = long.Parse(quantity.TrimEnd('K', 'k'));
                    return value * 1000;
                }
                else if (quantity.EndsWith("M", StringComparison.OrdinalIgnoreCase))
                {
                    var value = long.Parse(quantity.TrimEnd('M', 'm'));
                    return value * 1000 * 1000;
                }
                else if (quantity.EndsWith("G", StringComparison.OrdinalIgnoreCase))
                {
                    var value = long.Parse(quantity.TrimEnd('G', 'g'));
                    return value * 1000L * 1000 * 1000;
                }
                else if (quantity.EndsWith("T", StringComparison.OrdinalIgnoreCase))
                {
                    var value = long.Parse(quantity.TrimEnd('T', 't'));
                    return value * 1000L * 1000 * 1000 * 1000;
                }
                
                // Try parsing as plain number (assumes bytes)
                if (long.TryParse(quantity, out var bytes))
                    return bytes;
                
                return 0;
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>
        /// Format CPU quantity from nanocores to human-readable string
        /// </summary>
        private string FormatCpuQuantity(long nanocores)
        {
            if (nanocores >= 1_000_000_000)
            {
                var cores = nanocores / 1_000_000_000.0;
                return cores % 1 == 0 ? cores.ToString("F0") : cores.ToString("F2");
            }
            else if (nanocores >= 1_000_000)
            {
                return $"{nanocores / 1_000_000.0:F0}m";
            }
            else if (nanocores >= 1_000)
            {
                return $"{nanocores / 1_000.0:F0}m";
            }
            else
            {
                return $"{nanocores}n";
            }
        }

        /// <summary>
        /// Format memory quantity from bytes to human-readable string (minimum unit is MB)
        /// </summary>
        private string FormatMemoryQuantity(long bytes)
        {
            if (bytes >= 1024L * 1024 * 1024 * 1024)
            {
                return $"{bytes / (1024.0 * 1024 * 1024 * 1024):F2}Ti";
            }
            else if (bytes >= 1024 * 1024 * 1024)
            {
                return $"{bytes / (1024.0 * 1024 * 1024):F2}Gi";
            }
            else
            {
                // Always show in MB (MiB) as minimum unit, even for values less than 1 MB
                return $"{bytes / (1024.0 * 1024):F2}Mi";
            }
        }

        // GetPodLogsAsync moved to PodService

        private async Task<List<PodInfo>> GetPodsForResourceAsync(string namespaceName, IDictionary<string, string>? matchLabels)
        {
            var podInfoList = new List<PodInfo>();

            if (matchLabels == null || !matchLabels.Any())
                return podInfoList;

            try
            {
                // Fetch pod metrics for the namespace (optional - continue if it fails)
                Dictionary<string, PodMetrics>? podMetricsDict = null;
                try
                {
                    podMetricsDict = await _metricsService.GetPodMetricsAsync(namespaceName);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, $"Failed to fetch pod metrics for namespace {namespaceName}, continuing without metrics");
                    // Continue without metrics - they'll be null
                }

                // For CronWorkflows, skip the label selector API call and go directly to alternative search
                // because workflow pods typically don't have the cron-workflow label
                if (matchLabels.ContainsKey("workflows.argoproj.io/cron-workflow"))
                {
                    _logger.LogDebug($"Searching for CronWorkflow pods in namespace: {namespaceName}");
                    
                    // Get all pods in the namespace and filter by naming pattern
                    var allPods = await _kubernetesClient.CoreV1.ListNamespacedPodAsync(namespaceName);
                    var cronWorkflowName = matchLabels["workflows.argoproj.io/cron-workflow"];
                    matchLabels.TryGetValue("app.kubernetes.io/name", out var appNameAlias);
                    
                    foreach (var pod in allPods.Items)
                    {
                        // Check if pod has the cron-workflow label OR if pod name matches exact pattern
                        bool matches = false;
                        var podName = pod.Metadata.Name;
                        var expectedPrefix = $"{cronWorkflowName}-";
                        
                        if (pod.Metadata.Labels != null)
                        {
                            // Check for cron-workflow label (most reliable)
                            if (pod.Metadata.Labels.TryGetValue("workflows.argoproj.io/cron-workflow", out var labelValue) &&
                                labelValue == cronWorkflowName)
                            {
                                matches = true;
                            }
                            // Match short custom alias used to comply with label length limits.
                            else if (!string.IsNullOrWhiteSpace(appNameAlias) &&
                                     pod.Metadata.Labels.TryGetValue("app.kubernetes.io/name", out var appLabelValue) &&
                                     string.Equals(appLabelValue, appNameAlias, StringComparison.OrdinalIgnoreCase))
                            {
                                matches = true;
                            }
                            // Also check for workflow label with exact name match
                            else if (pod.Metadata.Labels.ContainsKey("workflows.argoproj.io/workflow"))
                            {
                                // Check if pod name matches pattern: {cronWorkflowName}-{timestamp-or-alphanumeric}
                                // Ensure only one dash after resource name (no repeating dashes)
                                if (podName.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase))
                                {
                                    // After the prefix, check if the remaining part contains no dashes
                                    // (allowing numeric timestamps or alphanumeric values, but no dashes)
                                    var remainingPart = podName.Substring(expectedPrefix.Length);
                                    if (remainingPart.Length > 0 && !remainingPart.Contains('-'))
                                    {
                                        matches = true;
                                    }
                                }
                            }
                        }
                        
                        // Fallback: Check by name pattern (workflow pods named: cronworkflow-name-timestamp)
                        // Ensure exact match: pod name must be {cronWorkflowName}-{timestamp-or-alphanumeric}
                        // with only one dash after the resource name (no repeating dashes)
                        if (!matches && podName.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase))
                        {
                            // After the prefix, check if the remaining part contains no dashes
                            // (allowing numeric timestamps or alphanumeric values, but no dashes)
                            var remainingPart = podName.Substring(expectedPrefix.Length);
                            if (remainingPart.Length > 0 && !remainingPart.Contains('-'))
                            {
                                matches = true;
                            }
                        }
                        
                        if (matches)
                        {
                            var podInfo = ExtractPodInfo(pod, podMetricsDict);
                            podInfoList.Add(podInfo);
                            _logger.LogDebug($"  Added pod: {pod.Metadata.Name} (Status: {podInfo.Status}, StartTime: {podInfo.StartTime})");
                        }
                    }
                    
                    if (podInfoList.Count > 0)
                    {
                        _logger.LogInformation($"Found {podInfoList.Count} pods for CronWorkflow: {cronWorkflowName}");
                    }
                    else
                    {
                        _logger.LogDebug($"No pods found for CronWorkflow: {cronWorkflowName} (this is normal if the job hasn't run recently)");
                    }
                }
                else
                {
                    // For Deployments and DaemonSets, use label selector
                    var labelSelector = string.Join(",", matchLabels.Select(l => $"{l.Key}={l.Value}"));
                    var pods = await _kubernetesClient.CoreV1.ListNamespacedPodAsync(namespaceName, labelSelector: labelSelector);

                    if (pods.Items != null && pods.Items.Any())
                    {
                    foreach (var pod in pods.Items)
                    {
                        var podInfo = ExtractPodInfo(pod, podMetricsDict);
                        podInfoList.Add(podInfo);
                    }

                        _logger.LogDebug($"Found {podInfoList.Count} pods for namespace: {namespaceName} with label selector: {labelSelector}");
                    }
                    else
                    {
                        _logger.LogDebug($"No pods found for namespace: {namespaceName} with label selector: {labelSelector}");
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Failed to get pods for namespace {namespaceName}: {ex.Message}");
            }

            return podInfoList.OrderByDescending(p => p.StartTime).ToList();
        }

        private async Task<List<EventInfo>> GetRecentEventsAsync(string namespaceName, string resourceName, string resourceKind)
        {
            var eventList = new List<EventInfo>();

            try
            {
                // Fetch all events in the namespace
                var events = await _kubernetesClient.CoreV1.ListNamespacedEventAsync(namespaceName);

                if (events.Items != null)
                {
                    // Filter events related to this resource and its pods
                    var relevantEvents = events.Items
                        .Where(e => e.InvolvedObject?.Name != null && 
                               (e.InvolvedObject.Name.Equals(resourceName, StringComparison.OrdinalIgnoreCase) ||
                                e.InvolvedObject.Name.StartsWith(resourceName + "-", StringComparison.OrdinalIgnoreCase)))
                        .OrderByDescending(e => e.LastTimestamp ?? e.FirstTimestamp ?? DateTime.MinValue)
                        .Take(10); // Get the 10 most recent events

                    foreach (var evt in relevantEvents)
                    {
                        eventList.Add(new EventInfo
                        {
                            Type = evt.Type ?? "Normal",
                            Reason = evt.Reason ?? "Unknown",
                            Message = evt.Message ?? "",
                            Timestamp = (evt.LastTimestamp ?? evt.FirstTimestamp ?? DateTime.UtcNow).ToUniversalTime()
                        });
                    }

                    _logger.LogDebug($"Found {eventList.Count} events for resource: {resourceName} in namespace: {namespaceName}");
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"Failed to get events for resource {resourceName} in namespace {namespaceName}: {ex.Message}");
            }

            return eventList;
        }

        public async Task<List<PodInfo>> GetPodsForResourceAsync(string namespaceName, string resourceName, string resourceType)
        {
            try
            {
                _logger.LogInformation($"Fetching pods for {resourceType}/{resourceName} in namespace {namespaceName}");

                IDictionary<string, string>? matchLabels = null;

                // Get label selectors based on resource type
                switch (resourceType.ToLower())
                {
                    case "deployment":
                        var deployment = await _kubernetesClient.AppsV1.ReadNamespacedDeploymentAsync(resourceName, namespaceName);
                        matchLabels = deployment.Spec?.Selector?.MatchLabels;
                        break;

                    case "daemonset":
                        var daemonSet = await _kubernetesClient.AppsV1.ReadNamespacedDaemonSetAsync(resourceName, namespaceName);
                        matchLabels = daemonSet.Spec?.Selector?.MatchLabels;
                        break;

                    case "cronworkflow":
                        // For CronWorkflows, use cron-workflow label and optionally
                        // app.kubernetes.io/name label (short alias for >63-char names).
                        matchLabels = new Dictionary<string, string>
                        {
                            { "workflows.argoproj.io/cron-workflow", resourceName }
                        };

                        try
                        {
                            var cronWorkflow = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                                group: "argoproj.io",
                                version: "v1alpha1",
                                namespaceParameter: namespaceName,
                                plural: "cronworkflows",
                                name: resourceName
                            );

                            if (cronWorkflow is JsonElement cronElement &&
                                cronElement.TryGetProperty("spec", out var spec) &&
                                spec.TryGetProperty("workflowSpec", out var workflowSpec) &&
                                workflowSpec.TryGetProperty("templates", out var templates) &&
                                templates.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var template in templates.EnumerateArray())
                                {
                                    if (template.TryGetProperty("metadata", out var templateMetadata) &&
                                        templateMetadata.TryGetProperty("labels", out var labels) &&
                                        labels.TryGetProperty("app.kubernetes.io/name", out var appNameProp))
                                    {
                                        var appName = appNameProp.GetString();
                                        if (!string.IsNullOrWhiteSpace(appName))
                                        {
                                            matchLabels["app.kubernetes.io/name"] = appName.Trim();
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogDebug(ex, "Unable to extract app label alias for CronWorkflow {CronWorkflow}", resourceName);
                        }
                        break;

                    default:
                        _logger.LogWarning($"Unknown resource type: {resourceType}");
                        return new List<PodInfo>();
                }

                if (matchLabels == null || !matchLabels.Any())
                {
                    _logger.LogWarning($"No label selectors found for {resourceType}/{resourceName}");
                    return new List<PodInfo>();
                }

                // Use existing method to fetch pods
                var pods = await GetPodsForResourceAsync(namespaceName, matchLabels);
                _logger.LogInformation($"Successfully fetched {pods.Count} pods for {resourceType}/{resourceName}");
                
                return pods;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching pods for {resourceType}/{resourceName} in namespace {namespaceName}");
                return new List<PodInfo>();
            }
        }

        public async Task<List<EventInfo>> GetEventsForResourceAsync(string namespaceName, string resourceName, string resourceType)
        {
            try
            {
                _logger.LogInformation($"Fetching events for {resourceType}/{resourceName} in namespace {namespaceName}");
                
                // Use existing method to fetch events
                var events = await GetRecentEventsAsync(namespaceName, resourceName, resourceType);
                _logger.LogInformation($"Successfully fetched {events.Count} events for {resourceType}/{resourceName}");
                
                return events;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching events for {resourceType}/{resourceName} in namespace {namespaceName}");
                return new List<EventInfo>();
            }
        }

        // RestartPodAsync moved to PodService

        /// <summary>
        /// Gets the consumer control flag from the ConfigMap
        /// </summary>
        public async Task<string?> GetConsumerControlFlagAsync(string namespaceName, string deploymentName)
        {
            try
            {
                const string configMapName = "consumer-control-flags";
                string key = $"{deploymentName}-enabled";
                
                _logger.LogInformation($"Fetching consumer control flag for {deploymentName} from ConfigMap {configMapName} in namespace {namespaceName}");
                
                var configMap = await _kubernetesClient.CoreV1.ReadNamespacedConfigMapAsync(configMapName, namespaceName);
                
                if (configMap.Data != null && configMap.Data.ContainsKey(key))
                {
                    var value = configMap.Data[key];
                    _logger.LogInformation($"Consumer control flag for {deploymentName}: {value}");
                    return value;
                }
                
                _logger.LogInformation($"Consumer control flag for {deploymentName} not found in ConfigMap");
                return null;
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                _logger.LogInformation($"ConfigMap consumer-control-flags not found in namespace {namespaceName}");
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error getting consumer control flag for {deploymentName} in namespace {namespaceName}");
                throw;
            }
        }

        /// <summary>
        /// Gets all consumer control flags from the ConfigMap at once
        /// Returns a dictionary where key is deployment name and value is enabled state
        /// Missing entries default to true (enabled)
        /// </summary>
        public async Task<Dictionary<string, bool>> GetAllConsumerControlFlagsAsync(string namespaceName)
        {
            var flags = new Dictionary<string, bool>();
            
            try
            {
                const string configMapName = "consumer-control-flags";
                
                _logger.LogInformation($"Fetching all consumer control flags from ConfigMap {configMapName} in namespace {namespaceName}");
                
                var configMap = await _kubernetesClient.CoreV1.ReadNamespacedConfigMapAsync(configMapName, namespaceName);
                
                if (configMap.Data != null)
                {
                    foreach (var kvp in configMap.Data)
                    {
                        // Keys are in format "{deploymentName}-enabled"
                        if (kvp.Key.EndsWith("-enabled"))
                        {
                            string deploymentName = kvp.Key.Substring(0, kvp.Key.Length - "-enabled".Length);
                            
                            // Parse the value - default to true if parsing fails
                            bool enabled = true;
                            if (bool.TryParse(kvp.Value, out bool parsedValue))
                            {
                                enabled = parsedValue;
                            }
                            
                            flags[deploymentName] = enabled;
                            _logger.LogDebug($"Consumer control flag for {deploymentName}: {enabled}");
                        }
                    }
                }
                
                _logger.LogInformation($"Fetched {flags.Count} consumer control flags from ConfigMap");
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                _logger.LogInformation($"ConfigMap consumer-control-flags not found in namespace {namespaceName}. All consumers default to enabled.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error getting all consumer control flags from namespace {namespaceName}");
                throw;
            }
            
            return flags;
        }

        /// <summary>
        /// Sets the consumer control flag and restarts the deployment
        /// </summary>
        public async Task<bool> SetConsumerControlFlagAsync(string namespaceName, string deploymentName, bool enabled)
        {
            try
            {
                const string configMapName = "consumer-control-flags";
                string key = $"{deploymentName}-enabled";
                string value = enabled.ToString().ToLower();
                
                _logger.LogWarning($"Setting consumer control flag for {deploymentName} to {value} in namespace {namespaceName}");
                
                // Step 1: Update or create ConfigMap
                V1ConfigMap? configMap = null;
                bool configMapExists = false;
                
                try
                {
                    configMap = await _kubernetesClient.CoreV1.ReadNamespacedConfigMapAsync(configMapName, namespaceName);
                    configMapExists = true;
                    _logger.LogInformation($"ConfigMap {configMapName} found, updating existing key");
                }
                catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    _logger.LogInformation($"ConfigMap {configMapName} not found, will create new one");
                }
                
                if (configMapExists && configMap != null)
                {
                    // Update existing ConfigMap
                    if (configMap.Data == null)
                    {
                        configMap.Data = new Dictionary<string, string>();
                    }
                    
                    _logger.LogInformation($"Current ConfigMap data before update: {string.Join(", ", configMap.Data.Select(kvp => $"{kvp.Key}={kvp.Value}"))}");
                    configMap.Data[key] = value;
                    _logger.LogInformation($"Setting {key}={value} in ConfigMap");
                    
                    var updatedConfigMap = await _kubernetesClient.CoreV1.ReplaceNamespacedConfigMapAsync(configMap, configMapName, namespaceName);
                    _logger.LogInformation($"ConfigMap {configMapName} updated successfully. New data: {string.Join(", ", updatedConfigMap.Data.Select(kvp => $"{kvp.Key}={kvp.Value}"))}");
                }
                else
                {
                    // Create new ConfigMap
                    configMap = new V1ConfigMap
                    {
                        Metadata = new V1ObjectMeta
                        {
                            Name = configMapName,
                            NamespaceProperty = namespaceName
                        },
                        Data = new Dictionary<string, string>
                        {
                            { key, value }
                        }
                    };
                    
                    await _kubernetesClient.CoreV1.CreateNamespacedConfigMapAsync(configMap, namespaceName);
                    _logger.LogInformation($"ConfigMap {configMapName} created successfully");
                }
                
                // Step 2: Verify the change was persisted
                _logger.LogInformation($"Verifying ConfigMap changes...");
                var verifyConfigMap = await _kubernetesClient.CoreV1.ReadNamespacedConfigMapAsync(configMapName, namespaceName);
                
                if (verifyConfigMap.Data == null || !verifyConfigMap.Data.ContainsKey(key) || verifyConfigMap.Data[key] != value)
                {
                    _logger.LogError($"ConfigMap verification failed: expected {key}={value}, but value doesn't match");
                    return false;
                }
                
                _logger.LogInformation($"ConfigMap verification successful: {key}={value}");
                
                // Step 3: Only if verification succeeds, restart deployment
                bool restartSuccess = await RestartResourceAsync(namespaceName, deploymentName, "Deployment");
                
                if (restartSuccess)
                {
                    _logger.LogInformation($"Consumer control flag set successfully and deployment restarted for {deploymentName}");
                    return true;
                }
                else
                {
                    _logger.LogError($"Failed to restart deployment {deploymentName}");
                    return false;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error setting consumer control flag for {deploymentName} in namespace {namespaceName}");
                return false;
            }
        }

        /// <summary>
        /// Restarts a resource (Deployment, DaemonSet, or StatefulSet) by updating its restart annotation
        /// </summary>
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
        
        /// <summary>
        /// Updates a CronWorkflow with new properties
        /// </summary>
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
                            _cache.Remove("kubernetes-cluster-info");
                            
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
        
        /// <summary>
        /// Toggles the suspend property of a CronWorkflow
        /// </summary>
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
                            _cache.Remove("kubernetes-cluster-info");
                            
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
        
        /// <summary>
        /// Gets a specific CronWorkflow by name
        /// </summary>
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
                    var metadata = item.GetProperty("metadata");
                    var metadataName = metadata.GetProperty("name").GetString() ?? "unknown";
                    
                    // Get creation timestamp
                    DateTime? creationTimestamp = null;
                    if (metadata.TryGetProperty("creationTimestamp", out var creationTimeElement) && 
                        creationTimeElement.ValueKind == JsonValueKind.String)
                    {
                        DateTime.TryParse(creationTimeElement.GetString(), out var parsedTime);
                        creationTimestamp = parsedTime;
                    }
                    
                    // Extract labels
                    Dictionary<string, string>? labels = null;
                    try
                    {
                        if (item.TryGetProperty("spec", out var spec) &&
                            spec.TryGetProperty("workflowSpec", out var workflowSpec) &&
                            workflowSpec.TryGetProperty("templates", out var templates) &&
                            templates.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var template in templates.EnumerateArray())
                            {
                                if (template.TryGetProperty("metadata", out var templateMetadata) &&
                                    templateMetadata.TryGetProperty("labels", out var labelsElement))
                                {
                                    labels = JsonSerializer.Deserialize<Dictionary<string, string>>(labelsElement.GetRawText());
                                    break;
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug($"Failed to extract labels from CronWorkflow {metadataName}: {ex.Message}");
                    }
                    
                    // Extract schedule information and CronWorkflow properties
                    string? schedule = null;
                    List<string>? schedules = null;
                    DateTime? lastScheduleTime = null;
                    int? startingDeadlineSeconds = null;
                    string? concurrencyPolicy = null;
                    int? successfulJobsHistoryLimit = null;
                    int? failedJobsHistoryLimit = null;
                    bool? suspend = null;
                    
                    try
                    {
                        if (item.TryGetProperty("spec", out var spec))
                        {
                            // Try to get schedules array first (plural)
                            if (spec.TryGetProperty("schedules", out var schedulesElement) && 
                                schedulesElement.ValueKind == JsonValueKind.Array)
                            {
                                schedules = new List<string>();
                                foreach (var scheduleItem in schedulesElement.EnumerateArray())
                                {
                                    if (scheduleItem.ValueKind == JsonValueKind.String)
                                    {
                                        var scheduleValue = scheduleItem.GetString();
                                        if (!string.IsNullOrEmpty(scheduleValue))
                                        {
                                            schedules.Add(scheduleValue);
                                        }
                                    }
                                }
                                schedule = schedules.FirstOrDefault();
                            }
                            else if (spec.TryGetProperty("schedule", out var scheduleElement))
                            {
                                schedule = scheduleElement.GetString();
                                if (!string.IsNullOrEmpty(schedule))
                                {
                                    schedules = new List<string> { schedule };
                                }
                            }
                            
                            // Extract other properties
                            if (spec.TryGetProperty("startingDeadlineSeconds", out var startingDeadlineElement) &&
                                startingDeadlineElement.ValueKind == JsonValueKind.Number)
                            {
                                startingDeadlineSeconds = startingDeadlineElement.GetInt32();
                            }
                            
                            if (spec.TryGetProperty("concurrencyPolicy", out var concurrencyPolicyElement))
                            {
                                concurrencyPolicy = concurrencyPolicyElement.GetString();
                            }
                            
                            if (spec.TryGetProperty("successfulJobsHistoryLimit", out var successfulLimitElement) &&
                                successfulLimitElement.ValueKind == JsonValueKind.Number)
                            {
                                successfulJobsHistoryLimit = successfulLimitElement.GetInt32();
                            }
                            
                            if (spec.TryGetProperty("failedJobsHistoryLimit", out var failedLimitElement) &&
                                failedLimitElement.ValueKind == JsonValueKind.Number)
                            {
                                failedJobsHistoryLimit = failedLimitElement.GetInt32();
                            }
                            
                            if (spec.TryGetProperty("suspend", out var suspendElement))
                            {
                                if (suspendElement.ValueKind == JsonValueKind.True)
                                {
                                    suspend = true;
                                }
                                else if (suspendElement.ValueKind == JsonValueKind.False)
                                {
                                    suspend = false;
                                }
                            }
                        }
                        
                        if (item.TryGetProperty("status", out var status))
                        {
                            if (status.TryGetProperty("lastScheduledTime", out var lastScheduledElement) &&
                                lastScheduledElement.ValueKind == JsonValueKind.String)
                            {
                                DateTime.TryParse(lastScheduledElement.GetString(), out var parsedLastScheduled);
                                lastScheduleTime = parsedLastScheduled;
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug($"Failed to extract properties from CronWorkflow {metadataName}: {ex.Message}");
                    }
                    
                    // Get the most recent pod's info for CronWorkflow
                    var cronWorkflowLabels = new Dictionary<string, string>
                    {
                        { "workflows.argoproj.io/cron-workflow", metadataName }
                    };
                    var (mostRecentPodTime, mostRecentPodStatus) = await GetMostRecentPodInfoAsync(namespaceName, cronWorkflowLabels);
                    
                    var resourceInfo = new ResourceInfo
                    {
                        Name = GetNameFromLabels(labels, metadataName),
                        MetadataName = metadataName,
                        Type = "CronWorkflow",
                        LastUpdated = mostRecentPodTime ?? creationTimestamp,
                        Containers = await ExtractContainerInfoFromCronWorkflowAsync(item, namespaceName),
                        CreationTime = creationTimestamp,
                        Schedule = schedule,
                        LastScheduleTime = mostRecentPodTime,
                        HealthStatus = mostRecentPodStatus ?? "Never Run",
                        Pods = new List<PodInfo>(),
                        RecentEvents = new List<EventInfo>(),
                        // CronWorkflow properties
                        Schedules = schedules,
                        StartingDeadlineSeconds = startingDeadlineSeconds,
                        ConcurrencyPolicy = concurrencyPolicy,
                        SuccessfulJobsHistoryLimit = successfulJobsHistoryLimit,
                        FailedJobsHistoryLimit = failedJobsHistoryLimit,
                        Suspend = suspend
                    };
                    
                    return resourceInfo;
                }
                
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching CronWorkflow {resourceName} in namespace {namespaceName}");
                return null;
            }
        }
        
        /// <summary>
        /// Gets a specific Deployment by name
        /// </summary>
        public async Task<ResourceInfo?> GetDeploymentByNameAsync(string namespaceName, string deploymentName)
        {
            try
            {
                _logger.LogInformation($"Fetching Deployment {deploymentName} in namespace {namespaceName}");
                
                // Get the specific Deployment
                var deployment = await _kubernetesClient.AppsV1.ReadNamespacedDeploymentAsync(deploymentName, namespaceName);
                
                if (deployment != null)
                {
                    // Get the most recent ReplicaSet creation time for accurate LastUpdated
                    var lastUpdated = await GetDeploymentLastUpdatedTimeAsync(namespaceName, deployment);
                    
                    // Check consumer control flag if in consumers namespace
                    bool? consumerEnabled = null;
                    if (namespaceName == _consumersNamespace)
                    {
                        try
                        {
                            var flagValue = await GetConsumerControlFlagAsync(namespaceName, deploymentName);
                            if (flagValue != null && bool.TryParse(flagValue, out bool parsedValue))
                            {
                                consumerEnabled = parsedValue;
                            }
                            else
                            {
                                // Default to true (enabled) if flag is null or invalid
                                consumerEnabled = true;
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogDebug($"Could not fetch consumer control flag for {deploymentName}: {ex.Message}. Defaulting to enabled.");
                            // Default to true (enabled) if flag is not available
                            consumerEnabled = true;
                        }
                    }
                    
                    // Calculate health status, but override to "Stopped" if consumer is disabled
                    var healthStatus = GetDeploymentHealthStatus(deployment.Status?.Replicas ?? 0, deployment.Status?.ReadyReplicas ?? 0, deployment.Spec?.Replicas ?? 0, deployment.Status?.Conditions);
                    if (consumerEnabled == false)
                    {
                        healthStatus = "Stopped";
                    }
                    
                    var resourceInfo = new ResourceInfo
                    {
                        Name = GetNameFromLabels(deployment.Spec?.Template?.Metadata?.Labels, deployment.Metadata.Name ?? "unknown"),
                        MetadataName = deployment.Metadata.Name ?? "unknown",
                        Type = "Deployment",
                        LastUpdated = lastUpdated,
                        Containers = await ExtractContainerInfoAsync(deployment.Spec?.Template?.Spec?.Containers ?? new List<V1Container>(), namespaceName),
                        CreationTime = deployment.Metadata.CreationTimestamp,
                        DesiredReplicas = deployment.Spec?.Replicas ?? 0,
                        CurrentReplicas = deployment.Status?.Replicas ?? 0,
                        ReadyReplicas = deployment.Status?.ReadyReplicas ?? 0,
                        HealthStatus = healthStatus,
                        Pods = new List<PodInfo>(),
                        RecentEvents = new List<EventInfo>(),
                        ConsumerEnabled = consumerEnabled
                    };
                    
                    return resourceInfo;
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

