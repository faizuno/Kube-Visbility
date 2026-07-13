using k8s;
using k8s.Models;
using System.Text.Json;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Models.Health;
using KubeVisibility.Dashboard.Api.Options;
using KubeVisibility.Dashboard.Api.Services.Shared;
using KubeVisibility.Dashboard.Api.Services.Kafka;
using KubeVisibility.Dashboard.Api.Services.Health;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class HealthService : IHealthService
    {
        private readonly IKubernetes _kubernetesClient;
        private readonly IClusterService _clusterService;
        private readonly IKubernetesMetricsService _metricsService;
        private readonly IKafkaService _kafkaService;
        private readonly IConsumerService _consumerService;
        private readonly ILogger<HealthService> _logger;
        private readonly IConfiguration _configuration;

        public HealthService(
            IKubernetesClientFactory kubernetesClientFactory,
            IClusterService clusterService,
            IKubernetesMetricsService metricsService,
            IKafkaService kafkaService,
            IConsumerService consumerService,
            ILogger<HealthService> logger,
            IConfiguration configuration)
        {
            _kubernetesClient = kubernetesClientFactory.CreateClient();
            _clusterService = clusterService;
            _metricsService = metricsService;
            _kafkaService = kafkaService;
            _consumerService = consumerService;
            _logger = logger;
            _configuration = configuration;
        }

        public async Task<HealthOverviewResponse> GetHealthOverviewAsync()
        {
            try
            {
                _logger.LogInformation("Calculating overall health overview");

                var response = new HealthOverviewResponse
                {
                    Timestamp = DateTime.UtcNow
                };

                // Get all health data in parallel
                var nodeHealthTask = GetNodeHealthAsync();
                var appHealthTask = GetApplicationHealthAsync();
                var kafkaHealthTask = GetKafkaHealthSummaryInternalAsync();

                await Task.WhenAll(nodeHealthTask, appHealthTask, kafkaHealthTask);

                var nodeHealth = await nodeHealthTask;
                var appHealth = await appHealthTask;
                var kafkaHealth = await kafkaHealthTask;

                // Populate summaries
                response.KubernetesHealth = new ClusterHealthSummary
                {
                    TotalNodes = nodeHealth.Summary.Total,
                    ReadyNodes = nodeHealth.Summary.Ready,
                    NotReadyNodes = nodeHealth.Summary.NotReady,
                    UnknownNodes = nodeHealth.Summary.Unknown,
                    HealthScore = CalculateClusterHealthScore(nodeHealth.Summary),
                    ResourceUtilization = new ResourceUtilization
                    {
                        CpuUsagePercent = nodeHealth.Summary.AverageCpuUsagePercent,
                        MemoryUsagePercent = nodeHealth.Summary.AverageMemoryUsagePercent
                    }
                };

                response.ApplicationHealth = appHealth.Summary;
                response.KafkaHealth = kafkaHealth;

                // Calculate overall health score
                response.OverallHealthScore = CalculateOverallHealthScore(
                    response.KubernetesHealth,
                    response.ApplicationHealth,
                    response.KafkaHealth
                );

                _logger.LogInformation($"Overall health score: {response.OverallHealthScore}");
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error calculating health overview");
                throw;
            }
        }

        public async Task<NodeHealthResponse> GetNodeHealthAsync()
        {
            try
            {
                _logger.LogInformation("Fetching node health information");

                var nodes = await _kubernetesClient.CoreV1.ListNodeAsync();
                var nodeMetrics = await _metricsService.GetAllNodesMetricsAsync();
                
                // Get all pods to count running pods per node
                var allPods = await _kubernetesClient.CoreV1.ListPodForAllNamespacesAsync();

                var nodeHealthList = new List<NodeHealth>();

                foreach (var node in nodes.Items)
                {
                    var nodeHealth = new NodeHealth
                    {
                        Name = node.Metadata.Name,
                        KubernetesVersion = node.Status.NodeInfo.KubeletVersion,
                        ContainerRuntimeVersion = node.Status.NodeInfo.ContainerRuntimeVersion,
                        CreationTime = node.Metadata.CreationTimestamp,
                        Labels = node.Metadata.Labels != null 
                            ? new Dictionary<string, string>(node.Metadata.Labels) 
                            : new Dictionary<string, string>()
                    };

                    // Determine node type based on labels
                    string nodeType = "Worker"; // Default to Worker
                    if (node.Metadata.Labels != null)
                    {
                        // Check if it's a control-plane node
                        if (node.Metadata.Labels.ContainsKey("node-role.kubernetes.io/control-plane") ||
                            node.Metadata.Labels.ContainsKey("node-role.kubernetes.io/master"))
                        {
                            nodeType = "control-plane";
                        }
                        // Otherwise, check for a custom 'type' label
                        else if (node.Metadata.Labels.TryGetValue("type", out var customType))
                        {
                            nodeType = customType;
                        }
                    }
                    nodeHealth.Type = nodeType;

                    // Get capacity
                    if (node.Status.Capacity != null)
                    {
                        nodeHealth.Capacity = new NodeCapacity
                        {
                            Cpu = node.Status.Capacity.TryGetValue("cpu", out var cpu) ? cpu.ToString() : "0",
                            Memory = node.Status.Capacity.TryGetValue("memory", out var mem) ? mem.ToString() : "0",
                            Pods = node.Status.Capacity.TryGetValue("pods", out var pods) ? pods.ToString() : "0"
                        };
                    }

                    // Get allocatable (resources available for pods)
                    if (node.Status.Allocatable != null)
                    {
                        nodeHealth.Allocatable = new NodeAllocatable
                        {
                            Cpu = node.Status.Allocatable.TryGetValue("cpu", out var allocCpu) ? allocCpu.ToString() : "0",
                            Memory = node.Status.Allocatable.TryGetValue("memory", out var allocMem) ? allocMem.ToString() : "0",
                            Pods = node.Status.Allocatable.TryGetValue("pods", out var allocPods) ? allocPods.ToString() : "0"
                        };
                    }

                    // Count pods on this node
                    var podsOnNode = allPods.Items.Where(p => p.Spec?.NodeName == node.Metadata.Name).ToList();
                    nodeHealth.RunningPods = podsOnNode.Count(p => p.Status?.Phase == "Running");
                    
                    // Set total pods to the node's pod capacity
                    nodeHealth.TotalPods = int.TryParse(nodeHealth.Capacity.Pods, out var podCapacity) ? podCapacity : 0;

                    // Build both canonical readiness and exact display state.
                    nodeHealth.Status = GetCanonicalReadyStatus(node);
                    nodeHealth.IsSchedulable = !(node.Spec?.Unschedulable ?? false);
                    nodeHealth.StatusFlags = GetNodeStatusFlags(node);
                    nodeHealth.ExactStatus = BuildExactStatus(nodeHealth.Status, nodeHealth.StatusFlags);

                    // Get all conditions
                    if (node.Status.Conditions != null)
                    {
                        foreach (var condition in node.Status.Conditions)
                        {
                            nodeHealth.Conditions.Add(new NodeCondition
                            {
                                Type = condition.Type,
                                Status = condition.Status,
                                Reason = condition.Reason ?? string.Empty,
                                Message = condition.Message ?? string.Empty,
                                LastTransitionTime = condition.LastTransitionTime
                            });
                        }
                    }

                    // Get metrics if available
                    var metrics = nodeMetrics.FirstOrDefault(m => m.CpuUsage.Contains(node.Metadata.Name) || 
                                                                   string.Equals(node.Metadata.Name, m.CpuUsage, StringComparison.OrdinalIgnoreCase));
                    
                    // Actually, the metrics don't contain the node name, we need to match by position or get them separately
                    // For now, let's try to find a matching metric
                    var nodeMetric = nodeMetrics.FirstOrDefault();
                    if (nodeMetrics.Count > 0 && nodeMetrics.Count == nodes.Items.Count)
                    {
                        // Assume same order
                        var index = nodes.Items.IndexOf(node);
                        if (index >= 0 && index < nodeMetrics.Count)
                        {
                            nodeMetric = nodeMetrics[index];
                        }
                    }

                    if (nodeMetric != null && nodeHealth.Capacity != null)
                    {
                        nodeHealth.CurrentMetrics = new Models.Health.NodeMetrics
                        {
                            CpuUsage = nodeMetric.CpuUsage,
                            MemoryUsage = nodeMetric.MemoryUsage,
                            CpuUsagePercent = KubernetesMetricsService.CalculateUsagePercent(
                                nodeMetric.CpuUsage, nodeHealth.Capacity.Cpu),
                            MemoryUsagePercent = KubernetesMetricsService.CalculateUsagePercent(
                                nodeMetric.MemoryUsage, nodeHealth.Capacity.Memory),
                            Timestamp = nodeMetric.Timestamp
                        };
                    }

                    nodeHealthList.Add(nodeHealth);
                }

                // Calculate summary
                var summary = new NodeHealthSummary
                {
                    Total = nodeHealthList.Count,
                    Ready = nodeHealthList.Count(n => n.Status == "Ready"),
                    NotReady = nodeHealthList.Count(n => n.Status == "NotReady"),
                    Unknown = nodeHealthList.Count(n => n.Status == "Unknown"),
                    AverageCpuUsagePercent = nodeHealthList
                        .Where(n => n.CurrentMetrics != null)
                        .Average(n => n.CurrentMetrics?.CpuUsagePercent ?? 0),
                    AverageMemoryUsagePercent = nodeHealthList
                        .Where(n => n.CurrentMetrics != null)
                        .Average(n => n.CurrentMetrics?.MemoryUsagePercent ?? 0)
                };

                _logger.LogInformation($"Retrieved health for {nodeHealthList.Count} nodes");
                return new NodeHealthResponse
                {
                    Nodes = nodeHealthList,
                    Summary = summary
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching node health");
                throw;
            }
        }

        public async Task<IReadOnlyDictionary<string, string>> GetNodeInternalIpToNameMapAsync()
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var nodes = await _kubernetesClient.CoreV1.ListNodeAsync();
                foreach (var node in nodes.Items)
                {
                    var name = node.Metadata?.Name;
                    if (string.IsNullOrEmpty(name)) continue;
                    if (node.Status?.Addresses == null) continue;
                    foreach (var addr in node.Status.Addresses)
                    {
                        if (addr?.Type == "InternalIP" && !string.IsNullOrEmpty(addr.Address))
                            map[addr.Address] = name;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to build node IP to name map");
            }
            return map;
        }

        private static string GetCanonicalReadyStatus(V1Node node)
        {
            var readyCondition = node.Status?.Conditions?.FirstOrDefault(c => c.Type == "Ready");
            return readyCondition?.Status == "True"
                ? "Ready"
                : readyCondition?.Status == "False"
                    ? "NotReady"
                    : "Unknown";
        }

        private static List<string> GetNodeStatusFlags(V1Node node)
        {
            var flags = new List<string>();

            if (node.Spec?.Unschedulable == true)
            {
                flags.Add("SchedulingDisabled");
            }

            var conditions = node.Status?.Conditions ?? new List<V1NodeCondition>();
            foreach (var condition in conditions)
            {
                if (string.Equals(condition.Type, "Ready", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (string.Equals(condition.Status, "True", StringComparison.OrdinalIgnoreCase))
                {
                    flags.Add(condition.Type);
                    continue;
                }

                if (string.Equals(condition.Status, "Unknown", StringComparison.OrdinalIgnoreCase))
                {
                    flags.Add($"{condition.Type}Unknown");
                }
            }

            return flags
                .Where(flag => !string.IsNullOrWhiteSpace(flag))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static string BuildExactStatus(string canonicalStatus, List<string>? statusFlags)
        {
            var flags = statusFlags ?? new List<string>();
            if (flags.Count == 0)
            {
                return canonicalStatus;
            }

            return $"{canonicalStatus},{string.Join(",", flags)}";
        }

        public async Task<NodeMetricsResponse> GetNodeMetricsAsync(string nodeName, DateTime? startTime, DateTime? endTime)
        {
            try
            {
                // For now, just return current metrics
                // In a production system, you would query a time-series database
                var currentMetrics = await _metricsService.GetNodeMetricsAsync(nodeName);

                var response = new NodeMetricsResponse
                {
                    NodeName = nodeName,
                    Metrics = new List<NodeMetricsDataPoint>()
                };

                if (currentMetrics != null)
                {
                    response.Metrics.Add(new NodeMetricsDataPoint
                    {
                        Timestamp = currentMetrics.Timestamp,
                        CpuUsage = currentMetrics.CpuUsage,
                        MemoryUsage = currentMetrics.MemoryUsage,
                        CpuUsagePercent = currentMetrics.CpuUsagePercent,
                        MemoryUsagePercent = currentMetrics.MemoryUsagePercent
                    });
                }

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching metrics for node {nodeName}");
                throw;
            }
        }

        public async Task<ApplicationHealthResponse> GetApplicationHealthAsync()
        {
            try
            {
                _logger.LogInformation("Fetching application health information");
                var clusterInfo = await _clusterService.GetClusterInfoAsync();
                return await BuildApplicationHealthResponseAsync(clusterInfo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching application health");
                throw;
            }
        }

        public async Task<NamespaceHealthResponse> GetNamespaceHealthAsync(string namespaceName)
        {
            try
            {
                var clusterInfo = await _clusterService.GetNamespaceInfoAsync(namespaceName);
                
                var detail = new NamespaceHealthDetail
                {
                    NamespaceName = namespaceName
                };

                if (clusterInfo.Success && clusterInfo.Resources != null)
                {
                    foreach (var resource in clusterInfo.Resources)
                    {
                        if (resource.Type == "Deployment" || resource.Type == "DaemonSet")
                        {
                            detail.TotalDeployments++;
                            
                            if (resource.HealthStatus == "Healthy")
                                detail.HealthyDeployments++;
                            else if (resource.HealthStatus == "Degraded")
                                detail.DegradedDeployments++;
                            else
                                detail.FailedDeployments++;
                        }

                        foreach (var pod in resource.Pods)
                        {
                            detail.TotalPods++;
                            
                            if (pod.Status.ToLower() == "running")
                                detail.RunningPods++;
                            else if (pod.Status.ToLower() == "pending")
                                detail.PendingPods++;
                            else
                                detail.FailedPods++;
                        }
                    }
                }

                return new NamespaceHealthResponse
                {
                    NamespaceName = namespaceName,
                    Details = detail,
                    Resources = clusterInfo.Resources ?? new List<ResourceInfo>()
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching health for namespace {namespaceName}");
                throw;
            }
        }

        public async Task<ResourceSummaryResponse> GetResourceSummaryAsync()
        {
            try
            {
                var clusterInfo = await _clusterService.GetClusterInfoAsync();
                var response = new ResourceSummaryResponse();

                foreach (var (namespaceName, namespaceInfo) in clusterInfo.Namespaces)
                {
                    if (!namespaceInfo.Success || namespaceInfo.Resources == null)
                        continue;

                    var namespaceSummary = new NamespaceResourceSummary
                    {
                        NamespaceName = namespaceName,
                        PodCount = namespaceInfo.Resources.Sum(r => r.Pods.Count),
                        DeploymentCount = namespaceInfo.Resources.Count(r => r.Type == "Deployment" || r.Type == "DaemonSet")
                    };

                    response.Namespaces[namespaceName] = namespaceSummary;
                }

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching resource summary");
                throw;
            }
        }

        public async Task<KafkaHealthSummary> GetKafkaHealthSummaryAsync()
        {
            var summary = new KafkaHealthSummary
            {
                TotalTopics = 0,
                HealthScore = 0,
                TotalBrokers = 0,
                OnlineBrokers = 0,
                OfflineBrokers = 0,
                TotalControllers = 0,
                OnlineControllers = 0,
                OfflineControllers = 0,
                ActiveControllers = 0,
                TopicsWithIssues = 0,
                TotalConsumerLag = 0
            };

            try
            {
                _logger.LogInformation("Fetching Kafka health summary");
                
                // For health overview, we only need cluster health (brokers/controllers status)
                // We don't need to connect to Kafka for topics - that would require a Kafka connection
                // Cluster health uses Kubernetes data primarily, with optional Kafka metadata for partition info
                try
                {
                    var clusterHealth = await _kafkaService.GetClusterHealthAsync();
                    summary.HealthScore = clusterHealth.HealthScore;
                    summary.TotalBrokers = clusterHealth.TotalBrokers;
                    summary.OnlineBrokers = clusterHealth.OnlineBrokers;
                    summary.OfflineBrokers = clusterHealth.OfflineBrokers;
                    summary.TotalControllers = clusterHealth.TotalControllers;
                    summary.OnlineControllers = clusterHealth.OnlineControllers;
                    summary.OfflineControllers = clusterHealth.OfflineControllers;
                    summary.ActiveControllers = clusterHealth.ActiveControllers;
                    _logger.LogInformation($"Successfully fetched Kafka cluster health: {clusterHealth.OnlineBrokers}/{clusterHealth.TotalBrokers} brokers, {clusterHealth.OnlineControllers}/{clusterHealth.TotalControllers} controllers online");
                }
                catch (Exception clusterEx)
                {
                    _logger.LogError(clusterEx, "Failed to fetch Kafka cluster health - brokers and controllers will show as 0/0");
                }
                
                // Note: TotalTopics is intentionally left as 0 for health overview
                // Getting topics would require a Kafka connection, which we want to avoid for health checks
                // Topics can be fetched from the dedicated topics endpoint if needed
                
                return summary;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting Kafka health summary");
                return summary;
            }
        }

        public async Task<ApplicationHealthSummary> GetApplicationHealthSummaryAsync()
        {
            try
            {
                _logger.LogInformation("Fetching Application health summary");

                // Fetch shared base data once to avoid duplicate cluster snapshots.
                var clusterInfoTask = _clusterService.GetClusterInfoAsync();
                var consumerNamespace = KubernetesInfoConfiguration.GetConsumersNamespace(_configuration);
                var consumerFlagsTask = _consumerService.GetAllConsumerControlFlagsAsync(consumerNamespace);
                await Task.WhenAll(clusterInfoTask, consumerFlagsTask);

                var clusterInfo = await clusterInfoTask;
                var consumerFlags = await consumerFlagsTask;

                // Build all categories from the same cluster snapshot.
                var appHealthTask = BuildApplicationHealthResponseAsync(clusterInfo);
                var servicesHealthTask = BuildServicesHealthResponseAsync(clusterInfo);
                var consumersHealthTask = BuildConsumersHealthResponseAsync(clusterInfo, consumerFlags);
                var jobsHealthTask = BuildJobsHealthResponseAsync(clusterInfo);

                await Task.WhenAll(appHealthTask, servicesHealthTask, consumersHealthTask, jobsHealthTask);

                var appHealth = await appHealthTask;
                var servicesHealth = await servicesHealthTask;
                var consumersHealth = await consumersHealthTask;
                var jobsHealth = await jobsHealthTask;

                // Exclude intentionally inactive workloads from health percentage denominator.
                // Stopped consumers and paused jobs should not count against application health.
                var activeConsumers = Math.Max(0, consumersHealth.Summary.TotalConsumers - consumersHealth.Summary.StoppedConsumers);
                var activeJobs = Math.Max(0, jobsHealth.Summary.TotalJobs - jobsHealth.Summary.PausedJobs);

                _logger.LogInformation(
                    $"Application health aggregation (active denominator): " +
                    $"Services={servicesHealth.Summary.RunningServices}/{servicesHealth.Summary.TotalServices}, " +
                    $"Consumers={consumersHealth.Summary.RunningConsumers}/{activeConsumers} " +
                    $"(total={consumersHealth.Summary.TotalConsumers}, stopped={consumersHealth.Summary.StoppedConsumers}), " +
                    $"Jobs={jobsHealth.Summary.ScheduledJobs}/{activeJobs} " +
                    $"(total={jobsHealth.Summary.TotalJobs}, paused={jobsHealth.Summary.PausedJobs})"
                );

                // Aggregate the summary with detailed breakdown
                var summary = appHealth.Summary;
                summary.TotalServices = servicesHealth.Summary.TotalServices;
                summary.HealthyServices = servicesHealth.Summary.RunningServices;
                summary.TotalConsumers = consumersHealth.Summary.TotalConsumers;
                summary.HealthyConsumers = consumersHealth.Summary.RunningConsumers;
                summary.StoppedConsumers = consumersHealth.Summary.StoppedConsumers;
                summary.TotalJobs = jobsHealth.Summary.TotalJobs;
                summary.HealthyJobs = jobsHealth.Summary.ScheduledJobs;
                summary.PausedJobs = jobsHealth.Summary.PausedJobs;
                
                // Recalculate health score based on all categories
                summary.HealthScore = CalculateComprehensiveApplicationHealthScore(
                    summary.TotalServices, summary.HealthyServices,
                    activeConsumers, summary.HealthyConsumers,
                    activeJobs, summary.HealthyJobs,
                    summary.TotalDeployments, summary.HealthyDeployments,
                    summary.DegradedDeployments, summary.FailedDeployments
                );

                _logger.LogInformation($"Application health score calculated: {summary.HealthScore}% (Total Apps: {summary.TotalApplications}, Healthy: {summary.HealthyApplications})");

                return summary;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting Application health summary");
                throw;
            }
        }

        private async Task<KafkaHealthSummary> GetKafkaHealthSummaryInternalAsync()
        {
            var summary = new KafkaHealthSummary
            {
                TotalTopics = 0,
                HealthScore = 0,
                TotalBrokers = 0,
                OnlineBrokers = 0,
                OfflineBrokers = 0,
                TotalControllers = 0,
                OnlineControllers = 0,
                OfflineControllers = 0,
                ActiveControllers = 0,
                TopicsWithIssues = 0,
                TotalConsumerLag = 0
            };

            try
            {
                // Try to get topics
                try
                {
                    var topics = await _kafkaService.GetTopicsAsync();
                    summary.TotalTopics = topics.Count;
                }
                catch (Exception topicEx)
                {
                    _logger.LogWarning(topicEx, "Failed to fetch Kafka topics in internal call");
                }
                
                // Try to get cluster health
                try
                {
                    var clusterHealth = await _kafkaService.GetClusterHealthAsync();
                    summary.HealthScore = clusterHealth.HealthScore;
                    summary.TotalBrokers = clusterHealth.TotalBrokers;
                    summary.OnlineBrokers = clusterHealth.OnlineBrokers;
                    summary.OfflineBrokers = clusterHealth.OfflineBrokers;
                    summary.TotalControllers = clusterHealth.TotalControllers;
                    summary.OnlineControllers = clusterHealth.OnlineControllers;
                    summary.OfflineControllers = clusterHealth.OfflineControllers;
                    summary.ActiveControllers = clusterHealth.ActiveControllers;
                }
                catch (Exception clusterEx)
                {
                    _logger.LogError(clusterEx, "Failed to fetch Kafka cluster health in internal call");
                }
                
                return summary;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting Kafka health summary in internal call");
                return summary;
            }
        }

        private double CalculateClusterHealthScore(NodeHealthSummary summary)
        {
            if (summary.Total == 0)
                return 100;

            double score = 100;

            // Deduct points for unhealthy nodes (max 40 points)
            double unhealthyRatio = (summary.NotReady + summary.Unknown) / (double)summary.Total;
            score -= unhealthyRatio * 40;

            // Deduct points for high resource usage (max 30 points each)
            if (summary.AverageCpuUsagePercent > 80)
                score -= ((summary.AverageCpuUsagePercent - 80) / 20) * 30;

            if (summary.AverageMemoryUsagePercent > 80)
                score -= ((summary.AverageMemoryUsagePercent - 80) / 20) * 30;

            return Math.Max(0, Math.Round(score, 2));
        }

        private double CalculateApplicationHealthScore(int total, int healthy, int degraded, int failed, int totalPods, int failedPods)
        {
            if (total == 0)
                return 100;

            double score = 100;

            // Deduct points for failed deployments (max 40 points)
            score -= (failed / (double)total) * 40;

            // Deduct points for degraded deployments (max 30 points)
            score -= (degraded / (double)total) * 30;

            // Deduct points for failed pods (max 30 points)
            if (totalPods > 0)
            {
                score -= (failedPods / (double)totalPods) * 30;
            }

            return Math.Max(0, Math.Round(score, 2));
        }

        private double CalculateComprehensiveApplicationHealthScore(
            int totalServices, int healthyServices,
            int totalConsumers, int healthyConsumers,
            int totalJobs, int healthyJobs,
            int totalDeployments, int healthyDeployments,
            int degradedDeployments, int failedDeployments)
        {
            double score = 100;
            int totalComponents = 0;
            int healthyComponents = 0;

            // Count services
            if (totalServices > 0)
            {
                totalComponents += totalServices;
                healthyComponents += healthyServices;
            }

            // Count consumers
            if (totalConsumers > 0)
            {
                totalComponents += totalConsumers;
                healthyComponents += healthyConsumers;
            }

            // Count jobs
            if (totalJobs > 0)
            {
                totalComponents += totalJobs;
                healthyComponents += healthyJobs;
            }

            // If we have component-level data, use it
            if (totalComponents > 0)
            {
                // Calculate percentage of healthy components
                double healthyRatio = (double)healthyComponents / totalComponents;
                score = healthyRatio * 100;
            }
            // Otherwise fall back to deployment-based calculation
            else if (totalDeployments > 0)
            {
                score = 100;
                score -= (failedDeployments / (double)totalDeployments) * 40;
                score -= (degradedDeployments / (double)totalDeployments) * 30;
            }

            return Math.Max(0, Math.Round(score, 2));
        }

        private double CalculateOverallHealthScore(ClusterHealthSummary cluster, ApplicationHealthSummary app, KafkaHealthSummary kafka)
        {
            // Weighted average: Cluster 40%, Application 40%, Kafka 20%
            return Math.Round(
                (cluster.HealthScore * 0.4) +
                (app.HealthScore * 0.4) +
                (kafka.HealthScore * 0.2),
                2
            );
        }

        #region Services, Consumers, and Jobs Health

        public async Task<ServicesHealthResponse> GetServicesHealthAsync()
        {
            try
            {
                _logger.LogInformation("Fetching services health");
                var clusterInfo = await _clusterService.GetClusterInfoAsync();
                return await BuildServicesHealthResponseAsync(clusterInfo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching services health");
                throw;
            }
        }

        public async Task<ConsumersHealthResponse> GetConsumersHealthAsync()
        {
            try
            {
                _logger.LogInformation("Fetching consumers health");
                var consumerNamespace = KubernetesInfoConfiguration.GetConsumersNamespace(_configuration);
                var clusterInfoTask = _clusterService.GetClusterInfoAsync();
                var consumerFlagsTask = _consumerService.GetAllConsumerControlFlagsAsync(consumerNamespace);
                await Task.WhenAll(clusterInfoTask, consumerFlagsTask);

                return await BuildConsumersHealthResponseAsync(await clusterInfoTask, await consumerFlagsTask);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching consumers health");
                throw;
            }
        }

        public async Task<JobsHealthResponse> GetJobsHealthAsync()
        {
            try
            {
                _logger.LogInformation("Fetching jobs health");
                var clusterInfo = await _clusterService.GetClusterInfoAsync();
                return await BuildJobsHealthResponseAsync(clusterInfo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching jobs health");
                throw;
            }
        }

        private Task<ApplicationHealthResponse> BuildApplicationHealthResponseAsync(ClusterInfoResponse clusterInfo)
        {
            var response = new ApplicationHealthResponse();

            var totalDeployments = 0;
            var healthyDeployments = 0;
            var degradedDeployments = 0;
            var failedDeployments = 0;
            var totalPods = 0;
            var runningPods = 0;
            var pendingPods = 0;
            var failedPods = 0;

            foreach (var (namespaceName, namespaceInfo) in clusterInfo.Namespaces)
            {
                if (!namespaceInfo.Success || namespaceInfo.Resources == null)
                {
                    continue;
                }

                var namespaceDetail = new NamespaceHealthDetail
                {
                    NamespaceName = namespaceName
                };

                foreach (var resource in namespaceInfo.Resources)
                {
                    if (resource.Type == "Deployment" || resource.Type == "DaemonSet")
                    {
                        namespaceDetail.TotalDeployments++;
                        totalDeployments++;

                        if (resource.HealthStatus == "Healthy")
                        {
                            namespaceDetail.HealthyDeployments++;
                            healthyDeployments++;
                        }
                        else if (resource.HealthStatus == "Degraded")
                        {
                            namespaceDetail.DegradedDeployments++;
                            degradedDeployments++;
                            namespaceDetail.UnhealthyResources.Add(new UnhealthyResource
                            {
                                Name = resource.Name,
                                Type = resource.Type,
                                Status = resource.HealthStatus,
                                Reason = "Degraded replicas",
                                ReadyReplicas = resource.ReadyReplicas,
                                DesiredReplicas = resource.DesiredReplicas
                            });
                        }
                        else
                        {
                            namespaceDetail.FailedDeployments++;
                            failedDeployments++;
                            namespaceDetail.UnhealthyResources.Add(new UnhealthyResource
                            {
                                Name = resource.Name,
                                Type = resource.Type,
                                Status = resource.HealthStatus,
                                Reason = "Failed or Unknown",
                                ReadyReplicas = resource.ReadyReplicas,
                                DesiredReplicas = resource.DesiredReplicas
                            });
                        }
                    }

                    foreach (var pod in resource.Pods ?? Enumerable.Empty<PodInfo>())
                    {
                        namespaceDetail.TotalPods++;
                        totalPods++;

                        var podStatus = pod.Status?.ToLowerInvariant() ?? string.Empty;
                        if (podStatus == "running")
                        {
                            namespaceDetail.RunningPods++;
                            runningPods++;
                        }
                        else if (podStatus == "pending")
                        {
                            namespaceDetail.PendingPods++;
                            pendingPods++;
                        }
                        else if (podStatus.Contains("fail") || podStatus.Contains("error"))
                        {
                            namespaceDetail.FailedPods++;
                            failedPods++;
                        }
                    }
                }

                response.Namespaces[namespaceName] = namespaceDetail;
            }

            response.Summary = new ApplicationHealthSummary
            {
                TotalDeployments = totalDeployments,
                HealthyDeployments = healthyDeployments,
                DegradedDeployments = degradedDeployments,
                FailedDeployments = failedDeployments,
                TotalPods = totalPods,
                RunningPods = runningPods,
                PendingPods = pendingPods,
                FailedPods = failedPods,
                HealthScore = CalculateApplicationHealthScore(
                    totalDeployments,
                    healthyDeployments,
                    degradedDeployments,
                    failedDeployments,
                    totalPods,
                    failedPods)
            };

            _logger.LogInformation("Application health: {Healthy}/{Total} healthy deployments", healthyDeployments, totalDeployments);
            return Task.FromResult(response);
        }

        private Task<ServicesHealthResponse> BuildServicesHealthResponseAsync(ClusterInfoResponse clusterInfo)
        {
            var response = new ServicesHealthResponse();
            var serviceNamespaces = KubernetesInfoConfiguration.GetApplicationNamespaces(_configuration);

            foreach (var ns in serviceNamespaces)
            {
                if (!clusterInfo.Namespaces.TryGetValue(ns, out var namespaceInfo) ||
                    !namespaceInfo.Success ||
                    namespaceInfo.Resources == null)
                {
                    continue;
                }

                foreach (var resource in namespaceInfo.Resources)
                {
                    if (resource.Type != "Deployment" && resource.Type != "DaemonSet")
                    {
                        continue;
                    }

                    var status = HealthStatusCalculator.GetDeploymentStatus(
                        resource.DesiredReplicas,
                        resource.ReadyReplicas,
                        resource.CurrentReplicas
                    );

                    response.Services.Add(new ServiceDetail
                    {
                        Name = resource.Name,
                        MetadataName = resource.MetadataName,
                        Namespace = ns,
                        Type = resource.Type,
                        DesiredReplicas = resource.DesiredReplicas,
                        ReadyReplicas = resource.ReadyReplicas,
                        CurrentReplicas = resource.CurrentReplicas,
                        LastUpdated = resource.LastUpdated,
                        TotalPods = resource.Pods?.Count ?? 0,
                        RunningPods = resource.Pods?.Count(p => p.Status?.ToLower() == "running") ?? 0,
                        Status = status
                    });
                }
            }

            response.Summary = new ServicesSummary
            {
                TotalServices = response.Services.Count,
                RunningServices = response.Services.Count(s => s.Status == "Running"),
                StoppedServices = response.Services.Count(s => s.Status == "Stopped"),
                FailedServices = response.Services.Count(s => s.Status == "Failed"),
                DegradedServices = response.Services.Count(s => s.Status == "Degraded"),
                HealthScore = HealthStatusCalculator.CalculateHealthScore(
                    response.Services.Count,
                    response.Services.Count(s => s.Status == "Running"),
                    response.Services.Count(s => s.Status == "Degraded"),
                    response.Services.Count(s => s.Status == "Failed")
                )
            };

            _logger.LogInformation("Services health: {Running}/{Total} running", response.Summary.RunningServices, response.Summary.TotalServices);
            return Task.FromResult(response);
        }

        private Task<ConsumersHealthResponse> BuildConsumersHealthResponseAsync(
            ClusterInfoResponse clusterInfo,
            Dictionary<string, bool> consumerFlags)
        {
            var consumerNamespace = KubernetesInfoConfiguration.GetConsumersNamespace(_configuration);
            var response = new ConsumersHealthResponse();

            if (clusterInfo.Namespaces.TryGetValue(consumerNamespace, out var namespaceInfo) &&
                namespaceInfo.Success &&
                namespaceInfo.Resources != null)
            {
                foreach (var resource in namespaceInfo.Resources)
                {
                    if (resource.Type != "Deployment" && resource.Type != "DaemonSet")
                    {
                        continue;
                    }

                    var consumerEnabled = true;
                    if (consumerFlags.ContainsKey(resource.MetadataName))
                    {
                        consumerEnabled = consumerFlags[resource.MetadataName];
                    }

                    var status = HealthStatusCalculator.GetConsumerStatus(
                        consumerEnabled,
                        resource.DesiredReplicas,
                        resource.ReadyReplicas,
                        resource.CurrentReplicas
                    );

                    response.Consumers.Add(new ConsumerDetail
                    {
                        Name = resource.Name,
                        MetadataName = resource.MetadataName,
                        Namespace = consumerNamespace,
                        Type = resource.Type,
                        DesiredReplicas = resource.DesiredReplicas,
                        ReadyReplicas = resource.ReadyReplicas,
                        CurrentReplicas = resource.CurrentReplicas,
                        LastUpdated = resource.LastUpdated,
                        TotalPods = resource.Pods?.Count ?? 0,
                        RunningPods = resource.Pods?.Count(p => p.Status?.ToLower() == "running") ?? 0,
                        Status = status,
                        ConsumerEnabled = consumerEnabled
                    });
                }
            }

            response.Summary = new ConsumersSummary
            {
                TotalConsumers = response.Consumers.Count,
                RunningConsumers = response.Consumers.Count(c => c.Status == "Running"),
                StoppedConsumers = response.Consumers.Count(c => c.Status == "Stopped"),
                FailedConsumers = response.Consumers.Count(c => c.Status == "Failed"),
                DegradedConsumers = response.Consumers.Count(c => c.Status == "Degraded"),
                HealthScore = HealthStatusCalculator.CalculateHealthScore(
                    response.Consumers.Count,
                    response.Consumers.Count(c => c.Status == "Running"),
                    response.Consumers.Count(c => c.Status == "Degraded"),
                    response.Consumers.Count(c => c.Status == "Failed")
                )
            };

            _logger.LogInformation("Consumers health: {Running}/{Total} running", response.Summary.RunningConsumers, response.Summary.TotalConsumers);
            return Task.FromResult(response);
        }

        private async Task<JobsHealthResponse> BuildJobsHealthResponseAsync(ClusterInfoResponse clusterInfo)
        {
            var response = new JobsHealthResponse();
            var jobsNamespace = KubernetesInfoConfiguration.GetJobsNamespace(_configuration);

            if (clusterInfo.Namespaces.TryGetValue(jobsNamespace, out var namespaceInfo) &&
                namespaceInfo.Success &&
                namespaceInfo.Resources != null)
            {
                var recentRunsByCronWorkflow = await GetRecentWorkflowRunsByCronWorkflowAsync(jobsNamespace);
                response.Jobs = namespaceInfo.Resources
                    .Where(r => r.Type == "CronWorkflow")
                    .Select(resource => BuildJobDetail(resource, jobsNamespace, recentRunsByCronWorkflow))
                    .ToList();
            }

            response.Summary = new JobsSummary
            {
                TotalJobs = response.Jobs.Count,
                ScheduledJobs = response.Jobs.Count(j => j.Status == "Scheduled"),
                PausedJobs = response.Jobs.Count(j => j.Status == "Paused"),
                FailedJobs = response.Jobs.Count(j => j.Status == "Failed"),
                DegradedJobs = response.Jobs.Count(j => j.Status == "Degraded"),
                HealthScore = HealthStatusCalculator.CalculateHealthScore(
                    response.Jobs.Count,
                    response.Jobs.Count(j => j.Status == "Scheduled"),
                    response.Jobs.Count(j => j.Status == "Degraded"),
                    response.Jobs.Count(j => j.Status == "Failed" || j.Status == "Paused")
                )
            };

            _logger.LogInformation("Jobs health: {Scheduled}/{Total} scheduled", response.Summary.ScheduledJobs, response.Summary.TotalJobs);
            return response;
        }

        private JobDetail BuildJobDetail(
            ResourceInfo resource,
            string namespaceName,
            IReadOnlyDictionary<string, List<WorkflowRunInfo>> recentRunsByCronWorkflow)
        {
            var job = new JobDetail
            {
                Name = resource.Name,
                MetadataName = resource.MetadataName,
                Namespace = namespaceName,
                Type = "CronWorkflow"
            };

            if (recentRunsByCronWorkflow.TryGetValue(resource.MetadataName, out var recentRuns))
            {
                job.RecentRuns = recentRuns;
            }
            else
            {
                job.RecentRuns = new List<WorkflowRunInfo>();
            }

            // Reuse CronWorkflow metadata already fetched in cluster snapshot.
            job.Schedule = resource.Schedule ?? string.Empty;
            job.Suspended = resource.Suspend ?? false;
            job.LastScheduleTime = resource.LastScheduleTime;

            // Determine status based on suspended flag and recent runs.
            job.Status = HealthStatusCalculator.GetJobStatus(job.Suspended, job.RecentRuns);
            return job;
        }

        private async Task<Dictionary<string, List<WorkflowRunInfo>>> GetRecentWorkflowRunsByCronWorkflowAsync(string namespaceName)
        {
            try
            {
                var workflows = await _kubernetesClient.CustomObjects.ListNamespacedCustomObjectAsync(
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: namespaceName,
                    plural: "workflows"
                );
                
                var runsByCronWorkflow = new Dictionary<string, List<WorkflowRunInfo>>(StringComparer.OrdinalIgnoreCase);
                
                if (workflows is JsonElement jsonElement && jsonElement.TryGetProperty("items", out var items))
                {
                    foreach (var item in items.EnumerateArray())
                    {
                        if (!item.TryGetProperty("metadata", out var metadata) ||
                            !metadata.TryGetProperty("labels", out var labels) ||
                            !labels.TryGetProperty("workflows.argoproj.io/cron-workflow", out var cronWorkflowLabel))
                        {
                            continue;
                        }

                        var cronWorkflowName = cronWorkflowLabel.GetString();
                        if (string.IsNullOrWhiteSpace(cronWorkflowName))
                        {
                            continue;
                        }

                        var run = new WorkflowRunInfo
                        {
                            Name = metadata.TryGetProperty("name", out var name)
                                ? name.GetString() ?? string.Empty
                                : string.Empty
                        };
                        
                        if (item.TryGetProperty("status", out var status))
                        {
                            if (status.TryGetProperty("phase", out var phase))
                            {
                                run.Phase = phase.GetString() ?? "Unknown";
                            }

                            if (status.TryGetProperty("startedAt", out var startedAt) &&
                                DateTime.TryParse(startedAt.GetString(), out var startTime))
                            {
                                run.StartTime = startTime;
                            }

                            if (status.TryGetProperty("finishedAt", out var finishedAt) &&
                                DateTime.TryParse(finishedAt.GetString(), out var finishTime))
                            {
                                run.FinishTime = finishTime;
                            }
                        }
                        
                        if (!runsByCronWorkflow.TryGetValue(cronWorkflowName, out var runs))
                        {
                            runs = new List<WorkflowRunInfo>();
                            runsByCronWorkflow[cronWorkflowName] = runs;
                        }
                        
                        runs.Add(run);
                    }
                }
                
                foreach (var cronWorkflowName in runsByCronWorkflow.Keys.ToList())
                {
                    runsByCronWorkflow[cronWorkflowName] = runsByCronWorkflow[cronWorkflowName]
                        .OrderByDescending(r => r.StartTime)
                        .Take(5)
                        .ToList();
                }

                return runsByCronWorkflow;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching workflow runs for namespace {Namespace}", namespaceName);
                return new Dictionary<string, List<WorkflowRunInfo>>(StringComparer.OrdinalIgnoreCase);
            }
        }

        #endregion
    }
}

