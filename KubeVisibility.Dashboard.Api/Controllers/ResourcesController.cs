using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services;
using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/resources")]
    [ApiController]
    [Authorize]
    public class ResourcesController : ControllerBase
    {
        private static readonly HashSet<string> AllowedLogLevels = new(StringComparer.OrdinalIgnoreCase)
        {
            "Trace",
            "Debug",
            "Information",
            "Warning",
            "Error",
            "Critical",
            "None"
        };

        private readonly IResourceService _resourceService;
        private readonly IClusterService _clusterService;
        private readonly ILogger<ResourcesController> _logger;

        public ResourcesController(
            IResourceService resourceService,
            IClusterService clusterService,
            ILogger<ResourcesController> logger)
        {
            _resourceService = resourceService;
            _clusterService = clusterService;
            _logger = logger;
        }

        [HttpGet("events")]
        public async Task<IActionResult> GetEventsForResource(
            [FromQuery] string namespaceName,
            [FromQuery] string resourceName,
            [FromQuery] string resourceType)
        {
            try
            {
                _logger.LogInformation($"Retrieving events for {resourceType}/{resourceName} in {namespaceName}");
                var events = await _clusterService.GetEventsForResourceAsync(namespaceName, resourceName, resourceType);
                return Ok(events);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving events for {resourceType}/{resourceName}");
                return StatusCode(500, new { error = "Failed to retrieve events", details = ex.Message });
            }
        }

        [HttpPost("restart")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> RestartResource([FromBody] RestartResourceRequest request)
        {
            try
            {
                _logger.LogInformation($"Restarting {request.ResourceType} {request.ResourceName} in namespace {request.NamespaceName}");
                var success = await _resourceService.RestartResourceAsync(request.NamespaceName, request.ResourceName, request.ResourceType);
                
                if (success)
                {
                    return Ok(new { success = true, message = $"{request.ResourceType} {request.ResourceName} restarted successfully" });
                }
                else
                {
                    return StatusCode(500, new { success = false, message = $"Failed to restart {request.ResourceType}" });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error restarting {request.ResourceType} {request.ResourceName}");
                return StatusCode(500, new { error = "Failed to restart resource", details = ex.Message });
            }
        }

        [HttpPost("log-level")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> UpdateLogLevel([FromBody] UpdateLogLevelRequest request)
        {
            try
            {
                var trimmedLevel = request.LogLevel?.Trim();
                if (string.IsNullOrWhiteSpace(trimmedLevel) || !AllowedLogLevels.Contains(trimmedLevel))
                {
                    return BadRequest(new UpdateLogLevelResponse
                    {
                        Success = false,
                        Message = "Invalid log level. Allowed values: Trace, Debug, Information, Warning, Error, Critical, None."
                    });
                }

                _logger.LogInformation(
                    "Updating log level for {ResourceType} {ResourceName} in namespace {NamespaceName} to {LogLevel}",
                    request.ResourceType,
                    request.ResourceName,
                    request.NamespaceName,
                    trimmedLevel);

                var success = await _resourceService.UpdateLogLevelAsync(
                    request.NamespaceName,
                    request.ResourceName,
                    request.ResourceType,
                    trimmedLevel);

                if (!success)
                {
                    return StatusCode(500, new UpdateLogLevelResponse
                    {
                        Success = false,
                        Message = $"Failed to update log level for {request.ResourceType} {request.ResourceName}."
                    });
                }

                return Ok(new UpdateLogLevelResponse
                {
                    Success = true,
                    Message = $"Log level updated to {trimmedLevel}. Rollout has been triggered."
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Error updating log level for {ResourceType} {ResourceName}",
                    request.ResourceType,
                    request.ResourceName);
                return StatusCode(500, new UpdateLogLevelResponse
                {
                    Success = false,
                    Message = "Failed to update log level."
                });
            }
        }

        [HttpGet("deployment")]
        public async Task<IActionResult> GetDeployment(
            [FromQuery] string namespaceName,
            [FromQuery] string deploymentName)
        {
            try
            {
                _logger.LogInformation($"Retrieving Deployment {deploymentName} in namespace {namespaceName}");
                var resource = await _clusterService.GetDeploymentByNameAsync(namespaceName, deploymentName);
                
                if (resource != null)
                {
                    return Ok(resource);
                }
                else
                {
                    return NotFound(new { error = $"Deployment {deploymentName} not found in namespace {namespaceName}" });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving Deployment {deploymentName}");
                return StatusCode(500, new { error = "Failed to retrieve deployment", details = ex.Message });
            }
        }
    }
}

