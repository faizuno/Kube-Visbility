using k8s;
using k8s.Models;
using KubeVisibility.Dashboard.Api.Models.Health;
using KubeVisibility.Dashboard.Api.Services.Shared;
using System.Text.Json;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class KubernetesMetricsService : IKubernetesMetricsService
    {
        private readonly IKubernetes _kubernetesClient;
        private readonly ILogger<KubernetesMetricsService> _logger;

        public KubernetesMetricsService(
            IKubernetesClientFactory kubernetesClientFactory,
            ILogger<KubernetesMetricsService> logger)
        {
            _kubernetesClient = kubernetesClientFactory.CreateClient();
            _logger = logger;
        }

        public async Task<List<Models.Health.NodeMetrics>> GetAllNodesMetricsAsync()
        {
            try
            {
                _logger.LogInformation("Fetching metrics for all nodes from Metrics Server API");

                var nodeMetricsList = new List<Models.Health.NodeMetrics>();

                // Call the Metrics Server API using ListClusterCustomObjectAsync
                var response = await _kubernetesClient.CustomObjects.ListClusterCustomObjectAsync(
                    group: "metrics.k8s.io",
                    version: "v1beta1",
                    plural: "nodes"
                );

                var body = response?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(body))
                {
                    _logger.LogWarning("Empty response from Metrics Server API");
                    return nodeMetricsList;
                }
                
                var metricsData = JsonSerializer.Deserialize<JsonElement>(body);

                if (metricsData.TryGetProperty("items", out var items))
                {
                    foreach (var item in items.EnumerateArray())
                    {
                        var nodeMetrics = ParseNodeMetrics(item);
                        if (nodeMetrics != null)
                        {
                            nodeMetricsList.Add(nodeMetrics);
                        }
                    }
                }

                _logger.LogInformation($"Successfully retrieved metrics for {nodeMetricsList.Count} nodes");
                return nodeMetricsList;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving node metrics from Metrics Server");
                // Return empty list instead of throwing - metrics server might not be installed
                return new List<Models.Health.NodeMetrics>();
            }
        }

        public async Task<Models.Health.NodeMetrics?> GetNodeMetricsAsync(string nodeName)
        {
            try
            {
                _logger.LogInformation($"Fetching metrics for node: {nodeName}");

                var response = await _kubernetesClient.CustomObjects.GetClusterCustomObjectAsync(
                    group: "metrics.k8s.io",
                    version: "v1beta1",
                    plural: "nodes",
                    name: nodeName
                );

                var body = response?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(body))
                {
                    _logger.LogWarning($"Empty response from Metrics Server API for node {nodeName}");
                    return null;
                }
                
                var metricsData = JsonSerializer.Deserialize<JsonElement>(body);

                return ParseNodeMetrics(metricsData);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving metrics for node {nodeName}");
                return null;
            }
        }

        public async Task<Dictionary<string, PodMetrics>> GetPodMetricsAsync(string namespaceName)
        {
            try
            {
                _logger.LogInformation($"Fetching pod metrics for namespace: {namespaceName}");

                var podMetricsDict = new Dictionary<string, PodMetrics>();

                var response = await _kubernetesClient.CustomObjects.ListNamespacedCustomObjectAsync(
                    group: "metrics.k8s.io",
                    version: "v1beta1",
                    namespaceParameter: namespaceName,
                    plural: "pods"
                );

                var body = response?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(body))
                {
                    _logger.LogWarning($"Empty response from Metrics Server API for namespace {namespaceName}");
                    return podMetricsDict;
                }
                
                var metricsData = JsonSerializer.Deserialize<JsonElement>(body);

                if (metricsData.TryGetProperty("items", out var items))
                {
                    foreach (var item in items.EnumerateArray())
                    {
                        var podMetrics = ParsePodMetrics(item, namespaceName);
                        if (podMetrics != null)
                        {
                            podMetricsDict[podMetrics.PodName] = podMetrics;
                        }
                    }
                }

                _logger.LogInformation($"Successfully retrieved metrics for {podMetricsDict.Count} pods in namespace {namespaceName}");
                return podMetricsDict;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving pod metrics for namespace {namespaceName}");
                return new Dictionary<string, PodMetrics>();
            }
        }

        public async Task<PodMetrics?> GetPodMetricsByNameAsync(string namespaceName, string podName)
        {
            try
            {
                _logger.LogInformation($"Fetching metrics for pod: {podName} in namespace: {namespaceName}");

                var response = await _kubernetesClient.CustomObjects.GetNamespacedCustomObjectAsync(
                    group: "metrics.k8s.io",
                    version: "v1beta1",
                    namespaceParameter: namespaceName,
                    plural: "pods",
                    name: podName
                );

                var body = response?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(body))
                {
                    _logger.LogWarning($"Empty response from Metrics Server API for pod {podName}");
                    return null;
                }
                
                var metricsData = JsonSerializer.Deserialize<JsonElement>(body);

                return ParsePodMetrics(metricsData, namespaceName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving metrics for pod {podName}");
                return null;
            }
        }

        private Models.Health.NodeMetrics? ParseNodeMetrics(JsonElement metricsData)
        {
            try
            {
                if (!metricsData.TryGetProperty("metadata", out var metadata) ||
                    !metadata.TryGetProperty("name", out var nameElement))
                {
                    return null;
                }

                var nodeName = nameElement.GetString() ?? string.Empty;

                if (!metricsData.TryGetProperty("usage", out var usage))
                {
                    return null;
                }

                var cpuUsage = usage.TryGetProperty("cpu", out var cpuElement) ? cpuElement.GetString() ?? "0" : "0";
                var memoryUsage = usage.TryGetProperty("memory", out var memElement) ? memElement.GetString() ?? "0" : "0";

                // Get timestamp
                var timestamp = DateTime.UtcNow;
                if (metricsData.TryGetProperty("timestamp", out var tsElement))
                {
                    var tsString = tsElement.GetString();
                    if (!string.IsNullOrEmpty(tsString) && DateTime.TryParse(tsString, out var parsedTimestamp))
                    {
                        timestamp = parsedTimestamp;
                    }
                }

                // Parse CPU and Memory to get percentages
                // This requires knowing node capacity - we'll calculate it when we combine with node data
                return new Models.Health.NodeMetrics
                {
                    CpuUsage = cpuUsage,
                    MemoryUsage = memoryUsage,
                    CpuUsagePercent = 0, // Will be calculated later with capacity data
                    MemoryUsagePercent = 0, // Will be calculated later with capacity data
                    Timestamp = timestamp
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error parsing node metrics");
                return null;
            }
        }

        private PodMetrics? ParsePodMetrics(JsonElement metricsData, string namespaceName)
        {
            try
            {
                if (!metricsData.TryGetProperty("metadata", out var metadata) ||
                    !metadata.TryGetProperty("name", out var nameElement))
                {
                    return null;
                }

                var podName = nameElement.GetString() ?? string.Empty;

                // Get timestamp
                var timestamp = DateTime.UtcNow;
                if (metricsData.TryGetProperty("timestamp", out var tsElement))
                {
                    var tsString = tsElement.GetString();
                    if (!string.IsNullOrEmpty(tsString) && DateTime.TryParse(tsString, out var parsedTimestamp))
                    {
                        timestamp = parsedTimestamp;
                    }
                }

                // Aggregate container metrics
                var totalCpu = 0.0;
                var totalMemory = 0.0;

                if (metricsData.TryGetProperty("containers", out var containers))
                {
                    foreach (var container in containers.EnumerateArray())
                    {
                        if (container.TryGetProperty("usage", out var usage))
                        {
                            if (usage.TryGetProperty("cpu", out var cpuElement))
                            {
                                var cpuStr = cpuElement.GetString() ?? "0";
                                totalCpu += ParseResourceQuantity(cpuStr);
                            }

                            if (usage.TryGetProperty("memory", out var memElement))
                            {
                                var memStr = memElement.GetString() ?? "0";
                                totalMemory += ParseResourceQuantity(memStr);
                            }
                        }
                    }
                }

                return new PodMetrics
                {
                    PodName = podName,
                    NamespaceName = namespaceName,
                    CpuUsage = $"{totalCpu}n",
                    MemoryUsage = $"{totalMemory}Ki",
                    Timestamp = timestamp
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error parsing pod metrics");
                return null;
            }
        }

        /// <summary>
        /// Parse Kubernetes resource quantity (e.g., "100m", "1Gi", "500Ki", "2000n")
        /// </summary>
        private double ParseResourceQuantity(string quantity)
        {
            if (string.IsNullOrEmpty(quantity))
                return 0;

            try
            {
                // Handle CPU units: n (nanocores), u (microcores), m (millicores)
                if (quantity.EndsWith("n"))
                {
                    return double.Parse(quantity.TrimEnd('n'));
                }
                else if (quantity.EndsWith("u"))
                {
                    return double.Parse(quantity.TrimEnd('u')) * 1000;
                }
                else if (quantity.EndsWith("m"))
                {
                    return double.Parse(quantity.TrimEnd('m')) * 1000000;
                }
                // Handle memory units: Ki, Mi, Gi, Ti
                else if (quantity.EndsWith("Ki"))
                {
                    return double.Parse(quantity.Replace("Ki", ""));
                }
                else if (quantity.EndsWith("Mi"))
                {
                    return double.Parse(quantity.Replace("Mi", "")) * 1024;
                }
                else if (quantity.EndsWith("Gi"))
                {
                    return double.Parse(quantity.Replace("Gi", "")) * 1024 * 1024;
                }
                else if (quantity.EndsWith("Ti"))
                {
                    return double.Parse(quantity.Replace("Ti", "")) * 1024 * 1024 * 1024;
                }
                // Plain number
                else
                {
                    return double.Parse(quantity);
                }
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>
        /// Calculate percentage based on usage and capacity
        /// Handles unit conversion between usage (nanocores) and capacity (cores)
        /// </summary>
        public static double CalculateUsagePercent(string usage, string capacity)
        {
            try
            {
                if (string.IsNullOrEmpty(usage) || string.IsNullOrEmpty(capacity))
                    return 0;

                var usageValue = ParseQuantityToDouble(usage);
                var capacityValue = ParseQuantityToDouble(capacity);

                if (capacityValue == 0)
                    return 0;

                // Check if we need to normalize units
                // If usage is in nanocores (ends with 'n') and capacity is plain number (cores),
                // we need to convert capacity to nanocores
                bool usageIsNanocores = usage.EndsWith("n", StringComparison.OrdinalIgnoreCase);
                bool capacityIsPlainNumber = !capacity.EndsWith("n", StringComparison.OrdinalIgnoreCase) &&
                                            !capacity.EndsWith("u", StringComparison.OrdinalIgnoreCase) &&
                                            !capacity.EndsWith("m", StringComparison.OrdinalIgnoreCase) &&
                                            !capacity.Contains("Ki") && !capacity.Contains("Mi") && 
                                            !capacity.Contains("Gi") && !capacity.Contains("Ti");

                // If usage is in nanocores and capacity is in cores, convert capacity to nanocores
                if (usageIsNanocores && capacityIsPlainNumber)
                {
                    // Capacity is in cores, convert to nanocores (1 core = 1,000,000,000 nanocores)
                    capacityValue = capacityValue * 1_000_000_000;
                }
                // If usage is in millicores (ends with 'm') and capacity is plain number, convert capacity to millicores
                else if (usage.EndsWith("m", StringComparison.OrdinalIgnoreCase) && capacityIsPlainNumber)
                {
                    // Capacity is in cores, convert to millicores (1 core = 1,000 millicores)
                    capacityValue = capacityValue * 1_000;
                }

                return Math.Round((usageValue / capacityValue) * 100, 2);
            }
            catch
            {
                return 0;
            }
        }

        private static double ParseQuantityToDouble(string quantity)
        {
            if (string.IsNullOrEmpty(quantity))
                return 0;

            try
            {
                // Handle CPU units
                if (quantity.EndsWith("n"))
                {
                    return double.Parse(quantity.TrimEnd('n'));
                }
                else if (quantity.EndsWith("u"))
                {
                    return double.Parse(quantity.TrimEnd('u')) * 1000;
                }
                else if (quantity.EndsWith("m"))
                {
                    return double.Parse(quantity.TrimEnd('m')) * 1000000;
                }
                // Handle memory units
                else if (quantity.EndsWith("Ki"))
                {
                    return double.Parse(quantity.Replace("Ki", ""));
                }
                else if (quantity.EndsWith("Mi"))
                {
                    return double.Parse(quantity.Replace("Mi", "")) * 1024;
                }
                else if (quantity.EndsWith("Gi"))
                {
                    return double.Parse(quantity.Replace("Gi", "")) * 1024 * 1024;
                }
                else if (quantity.EndsWith("Ti"))
                {
                    return double.Parse(quantity.Replace("Ti", "")) * 1024 * 1024 * 1024;
                }
                // Plain number (assume cores for CPU, bytes for memory)
                else
                {
                    return double.Parse(quantity);
                }
            }
            catch
            {
                return 0;
            }
        }
    }
}

