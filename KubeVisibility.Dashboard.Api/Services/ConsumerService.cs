using k8s;
using k8s.Models;
using KubeVisibility.Dashboard.Api.Services.Shared;
using Microsoft.Extensions.Logging;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class ConsumerService : IConsumerService
    {
        private readonly IKubernetes _kubernetesClient;
        private readonly ILogger<ConsumerService> _logger;
        private readonly IResourceService _resourceService;

        public ConsumerService(
            IKubernetesClientFactory kubernetesClientFactory,
            ILogger<ConsumerService> logger,
            IResourceService resourceService)
        {
            _kubernetesClient = kubernetesClientFactory.CreateClient();
            _logger = logger;
            _resourceService = resourceService;
        }

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
                
                if (configMapExists && configMap is not null)
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
                bool restartSuccess = await _resourceService.RestartResourceAsync(namespaceName, deploymentName, "Deployment");
                
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
    }
}

