using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services;
using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/pods")]
    [ApiController]
    [Authorize]
    public class PodsController : ControllerBase
    {
        private readonly IPodService _podService;
        private readonly IClusterService _clusterService;
        private readonly ILogger<PodsController> _logger;

        public PodsController(
            IPodService podService,
            IClusterService clusterService,
            ILogger<PodsController> logger)
        {
            _podService = podService;
            _clusterService = clusterService;
            _logger = logger;
        }

        [HttpGet("logs")]
        public async Task<IActionResult> GetPodLogs(
            [FromQuery] string namespaceName,
            [FromQuery] string resourceName,
            [FromQuery] string resourceType,
            [FromQuery] int tailLines = 500,
            [FromQuery] string? podName = null)
        {
            try
            {
                _logger.LogInformation($"Retrieving logs for {resourceName} in {namespaceName}" +
                    (string.IsNullOrEmpty(podName) ? "" : $" (pod: {podName})"));
                var logs = await _podService.GetPodLogsAsync(namespaceName, resourceName, resourceType, tailLines, podName);
                return Ok(new { logs });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving pod logs");
                return StatusCode(500, new { error = "Failed to retrieve pod logs", details = ex.Message });
            }
        }

        [HttpGet]
        public async Task<IActionResult> GetPodsForResource(
            [FromQuery] string namespaceName,
            [FromQuery] string resourceName,
            [FromQuery] string resourceType)
        {
            try
            {
                _logger.LogInformation($"Retrieving pods for {resourceType}/{resourceName} in {namespaceName}");
                var pods = await _clusterService.GetPodsForResourceAsync(namespaceName, resourceName, resourceType);
                return Ok(pods);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving pods for {resourceType}/{resourceName}");
                return StatusCode(500, new { error = "Failed to retrieve pods", details = ex.Message });
            }
        }

        [HttpPost("restart")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> RestartPod([FromBody] RestartPodRequest request)
        {
            try
            {
                _logger.LogInformation($"Restarting pod {request.PodName} in namespace {request.NamespaceName}");
                var success = await _podService.RestartPodAsync(request.NamespaceName, request.PodName);
                
                if (success)
                {
                    return Ok(new { success = true, message = $"Pod {request.PodName} restarted successfully" });
                }
                else
                {
                    return StatusCode(500, new { success = false, message = "Failed to restart pod" });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error restarting pod {request.PodName}");
                return StatusCode(500, new { error = "Failed to restart pod", details = ex.Message });
            }
        }
    }
}

