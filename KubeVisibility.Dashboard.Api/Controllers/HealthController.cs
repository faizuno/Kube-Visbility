using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services;
using KubeVisibility.Dashboard.Api.Services.Kafka;
using KubeVisibility.Dashboard.Api.Models.Health;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/health")]
    [ApiController]
    [Authorize]
    public class HealthController : ControllerBase
    {
        private readonly IHealthService _healthService;
        private readonly IKafkaService _kafkaService;
        private readonly INodeMetricsPrometheusService _nodeMetricsPrometheus;
        private readonly ILogger<HealthController> _logger;

        public HealthController(
            IHealthService healthService,
            IKafkaService kafkaService,
            INodeMetricsPrometheusService nodeMetricsPrometheus,
            ILogger<HealthController> logger)
        {
            _healthService = healthService;
            _kafkaService = kafkaService;
            _nodeMetricsPrometheus = nodeMetricsPrometheus;
            _logger = logger;
        }

        /// <summary>
        /// Gets overall system health overview
        /// </summary>
        [HttpGet("overview")]
        public async Task<IActionResult> GetHealthOverview()
        {
            try
            {
                _logger.LogInformation("Retrieving health overview");
                var overview = await _healthService.GetHealthOverviewAsync();
                return Ok(overview);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving health overview");
                return StatusCode(500, new { error = "Failed to retrieve health overview", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets Kafka health summary
        /// </summary>
        [HttpGet("overview/kafka")]
        public async Task<IActionResult> GetKafkaOverview()
        {
            try
            {
                _logger.LogInformation("Retrieving Kafka health overview");
                var kafkaOverview = await _healthService.GetKafkaHealthSummaryAsync();
                return Ok(kafkaOverview);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving Kafka health overview");
                return StatusCode(500, new { error = "Failed to retrieve Kafka health overview", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets Application health summary
        /// </summary>
        [HttpGet("overview/application")]
        public async Task<IActionResult> GetApplicationOverview()
        {
            try
            {
                _logger.LogInformation("Retrieving Application health overview");
                var applicationOverview = await _healthService.GetApplicationHealthSummaryAsync();
                return Ok(applicationOverview);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving Application health overview");
                return StatusCode(500, new { error = "Failed to retrieve Application health overview", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets Kubernetes node health information
        /// </summary>
        [HttpGet("kubernetes/nodes")]
        public async Task<IActionResult> GetNodeHealth()
        {
            try
            {
                _logger.LogInformation("Retrieving node health");
                var nodeHealth = await _healthService.GetNodeHealthAsync();
                return Ok(nodeHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving node health");
                return StatusCode(500, new { error = "Failed to retrieve node health", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets metrics for a specific node
        /// </summary>
        [HttpGet("kubernetes/nodes/{nodeName}/metrics")]
        public async Task<IActionResult> GetNodeMetrics(
            string nodeName,
            [FromQuery] DateTime? startTime,
            [FromQuery] DateTime? endTime)
        {
            try
            {
                _logger.LogInformation("Retrieving metrics for node: {NodeName}", nodeName);
                var metrics = await _healthService.GetNodeMetricsAsync(nodeName, startTime, endTime);
                return Ok(metrics);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving metrics for node {NodeName}", nodeName);
                return StatusCode(500, new { error = $"Failed to retrieve metrics for node {nodeName}", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets current node metrics from Prometheus (CPU, memory, disk usage percent per node).
        /// Node names are resolved from Prometheus instance/IP to Kubernetes node name when possible.
        /// </summary>
        [HttpGet("kubernetes/nodes/metrics/current")]
        public async Task<IActionResult> GetNodeMetricsCurrentFromPrometheus()
        {
            try
            {
                var result = await _nodeMetricsPrometheus.GetCurrentNodeMetricsAsync();
                var ipToName = await _healthService.GetNodeInternalIpToNameMapAsync();
                foreach (var node in result.Nodes)
                {
                    if (!string.IsNullOrEmpty(node.NodeName) && ipToName.TryGetValue(node.NodeName, out var k8sName))
                        node.NodeName = k8sName;
                }
                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving node metrics from Prometheus");
                return StatusCode(500, new { error = "Failed to retrieve node metrics", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets node metrics time series from Prometheus for charts. Optional nodeName to filter to one node.
        /// </summary>
        [HttpGet("kubernetes/nodes/metrics/series")]
        public async Task<IActionResult> GetNodeMetricsSeriesFromPrometheus(
            [FromQuery] string? nodeName,
            [FromQuery] DateTime? start,
            [FromQuery] DateTime? end,
            [FromQuery] string? step = "60s")
        {
            try
            {
                var endTime = end ?? DateTime.UtcNow;
                var startTime = start ?? endTime.AddHours(-1);
                var series = await _nodeMetricsPrometheus.GetNodeMetricsTimeSeriesAsync(nodeName, startTime, endTime, step ?? "60s");
                var ipToName = await _healthService.GetNodeInternalIpToNameMapAsync();
                foreach (var item in series)
                {
                    if (!string.IsNullOrEmpty(item.NodeName) && ipToName.TryGetValue(item.NodeName, out var k8sName))
                        item.NodeName = k8sName;
                }
                return Ok(series);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving node metrics series from Prometheus");
                return StatusCode(500, new { error = "Failed to retrieve node metrics series", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets application health aggregated by namespace
        /// </summary>
        [HttpGet("applications")]
        public async Task<IActionResult> GetApplicationHealth()
        {
            try
            {
                _logger.LogInformation("Retrieving application health");
                var appHealth = await _healthService.GetApplicationHealthAsync();
                return Ok(appHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving application health");
                return StatusCode(500, new { error = "Failed to retrieve application health", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets health information for a specific namespace
        /// </summary>
        [HttpGet("applications/{namespaceName}")]
        public async Task<IActionResult> GetNamespaceHealth(string namespaceName)
        {
            try
            {
                _logger.LogInformation($"Retrieving health for namespace: {namespaceName}");
                var namespaceHealth = await _healthService.GetNamespaceHealthAsync(namespaceName);
                return Ok(namespaceHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving health for namespace {namespaceName}");
                return StatusCode(500, new { error = $"Failed to retrieve health for namespace {namespaceName}", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets resource summary across namespaces
        /// </summary>
        [HttpGet("kubernetes/resources/summary")]
        public async Task<IActionResult> GetResourceSummary()
        {
            try
            {
                _logger.LogInformation("Retrieving resource summary");
                var summary = await _healthService.GetResourceSummaryAsync();
                return Ok(summary);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving resource summary");
                return StatusCode(500, new { error = "Failed to retrieve resource summary", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets Kafka cluster health
        /// </summary>
        [HttpGet("kafka/cluster")]
        public async Task<IActionResult> GetKafkaClusterHealth()
        {
            try
            {
                _logger.LogInformation("Retrieving Kafka cluster health");
                var clusterHealth = await _kafkaService.GetClusterHealthAsync();
                return Ok(clusterHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving Kafka cluster health");
                return StatusCode(500, new { error = "Failed to retrieve Kafka cluster health", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets Kafka broker health
        /// </summary>
        [HttpGet("kafka/brokers")]
        public async Task<IActionResult> GetBrokerHealth()
        {
            try
            {
                _logger.LogInformation("Retrieving Kafka broker health");
                var brokerHealth = await _kafkaService.GetBrokerHealthAsync();
                return Ok(brokerHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving Kafka broker health");
                return StatusCode(500, new { error = "Failed to retrieve Kafka broker health", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets topic health summary
        /// </summary>
        [HttpGet("kafka/topics/health")]
        public async Task<IActionResult> GetTopicHealthSummary()
        {
            try
            {
                _logger.LogInformation("Retrieving topic health summary");
                var topicHealth = await _kafkaService.GetTopicHealthSummaryAsync();
                return Ok(topicHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving topic health summary");
                return StatusCode(500, new { error = "Failed to retrieve topic health summary", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets consumer lag summary
        /// </summary>
        [HttpGet("kafka/consumers/lag")]
        public async Task<IActionResult> GetConsumerLagSummary([FromQuery] string[] topicNames)
        {
            try
            {
                _logger.LogInformation("Retrieving consumer lag summary");
                var lagSummary = await _kafkaService.GetConsumerLagSummaryAsync(topicNames);
                return Ok(lagSummary);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving consumer lag summary");
                return StatusCode(500, new { error = "Failed to retrieve consumer lag summary", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets health information for services (application namespaces)
        /// </summary>
        [HttpGet("services")]
        public async Task<IActionResult> GetServicesHealth()
        {
            try
            {
                _logger.LogInformation("Retrieving services health");
                var servicesHealth = await _healthService.GetServicesHealthAsync();
                return Ok(servicesHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving services health");
                return StatusCode(500, new { error = "Failed to retrieve services health", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets health information for consumers (configured consumers namespace)
        /// </summary>
        [HttpGet("consumers")]
        public async Task<IActionResult> GetConsumersHealth()
        {
            try
            {
                _logger.LogInformation("Retrieving consumers health");
                var consumersHealth = await _healthService.GetConsumersHealthAsync();
                return Ok(consumersHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving consumers health");
                return StatusCode(500, new { error = "Failed to retrieve consumers health", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets health information for jobs (configured jobs namespace with CronWorkflows)
        /// </summary>
        [HttpGet("jobs")]
        public async Task<IActionResult> GetJobsHealth()
        {
            try
            {
                _logger.LogInformation("Retrieving jobs health");
                var jobsHealth = await _healthService.GetJobsHealthAsync();
                return Ok(jobsHealth);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving jobs health");
                return StatusCode(500, new { error = "Failed to retrieve jobs health", details = ex.Message });
            }
        }
    }
}

