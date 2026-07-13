using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services;
using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/cronworkflows")]
    [ApiController]
    [Authorize]
    public class CronWorkflowsController : ControllerBase
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

        private readonly ICronWorkflowService _cronWorkflowService;
        private readonly IArgoWorkflowsService _argoWorkflowsService;
        private readonly IClusterService _clusterService;
        private readonly ILogger<CronWorkflowsController> _logger;

        public CronWorkflowsController(
            ICronWorkflowService cronWorkflowService,
            IArgoWorkflowsService argoWorkflowsService,
            IClusterService clusterService,
            ILogger<CronWorkflowsController> logger)
        {
            _cronWorkflowService = cronWorkflowService;
            _argoWorkflowsService = argoWorkflowsService;
            _clusterService = clusterService;
            _logger = logger;
        }

        [HttpPost("update")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> UpdateCronWorkflow([FromBody] UpdateCronWorkflowRequest request)
        {
            try
            {
                _logger.LogInformation($"Updating CronWorkflow {request.ResourceName} in namespace {request.NamespaceName}");
                var success = await _cronWorkflowService.UpdateCronWorkflowAsync(request.NamespaceName, request.ResourceName, request);
                
                if (success)
                {
                    // Wait a moment for the Kubernetes resource update to propagate
                    await Task.Delay(500);
                    
                    // Fetch the updated CronWorkflow with the latest data
                    var updatedResource = await _clusterService.GetCronWorkflowByNameAsync(request.NamespaceName, request.ResourceName);
                    
                    return Ok(new UpdateCronWorkflowResponse
                    {
                        Success = true,
                        Message = $"CronWorkflow {request.ResourceName} updated successfully",
                        UpdatedResource = updatedResource
                    });
                }
                else
                {
                    return StatusCode(500, new UpdateCronWorkflowResponse
                    {
                        Success = false,
                        Message = "Failed to update CronWorkflow"
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error updating CronWorkflow {request.ResourceName}");
                return StatusCode(500, new { error = "Failed to update CronWorkflow", details = ex.Message });
            }
        }

        [HttpPost("toggle-suspend")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> ToggleSuspend([FromBody] ToggleSuspendRequest request)
        {
            try
            {
                _logger.LogInformation($"{(request.Suspend ? "Suspending" : "Resuming")} CronWorkflow {request.ResourceName} in namespace {request.NamespaceName}");
                var success = await _cronWorkflowService.ToggleCronWorkflowSuspendAsync(request.NamespaceName, request.ResourceName, request.Suspend);
                
                if (success)
                {
                    // Wait a moment for the Kubernetes resource update to propagate
                    await Task.Delay(500);
                    
                    // Fetch the updated CronWorkflow with the latest suspend status
                    var updatedResource = await _clusterService.GetCronWorkflowByNameAsync(request.NamespaceName, request.ResourceName);
                    
                    return Ok(new ToggleSuspendResponse
                    {
                        Success = true,
                        Message = $"CronWorkflow {request.ResourceName} {(request.Suspend ? "suspended" : "resumed")} successfully",
                        CurrentSuspendState = request.Suspend,
                        UpdatedResource = updatedResource
                    });
                }
                else
                {
                    return StatusCode(500, new ToggleSuspendResponse
                    {
                        Success = false,
                        Message = "Failed to toggle suspend state"
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error toggling suspend for CronWorkflow {request.ResourceName}");
                return StatusCode(500, new { error = "Failed to toggle suspend state", details = ex.Message });
            }
        }

        [HttpPost("log-level")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> UpdateLogLevel([FromBody] UpdateCronWorkflowLogLevelRequest request)
        {
            try
            {
                var trimmedLevel = request.LogLevel?.Trim();
                if (string.IsNullOrWhiteSpace(trimmedLevel) || !AllowedLogLevels.Contains(trimmedLevel))
                {
                    return BadRequest(new UpdateCronWorkflowLogLevelResponse
                    {
                        Success = false,
                        Message = "Invalid log level. Allowed values: Trace, Debug, Information, Warning, Error, Critical, None."
                    });
                }

                _logger.LogInformation(
                    "Updating CronWorkflow log level for {ResourceName} in namespace {NamespaceName} to {LogLevel}",
                    request.ResourceName,
                    request.NamespaceName,
                    trimmedLevel);

                var success = await _cronWorkflowService.UpdateCronWorkflowLogLevelAsync(
                    request.NamespaceName,
                    request.ResourceName,
                    trimmedLevel);

                if (!success)
                {
                    return StatusCode(500, new UpdateCronWorkflowLogLevelResponse
                    {
                        Success = false,
                        Message = "Failed to update CronWorkflow log level"
                    });
                }

                await Task.Delay(500);
                var updatedResource = await _clusterService.GetCronWorkflowByNameAsync(request.NamespaceName, request.ResourceName);

                return Ok(new UpdateCronWorkflowLogLevelResponse
                {
                    Success = true,
                    Message = $"CronWorkflow {request.ResourceName} log level updated to {trimmedLevel}. Change applies to future runs.",
                    UpdatedResource = updatedResource
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating log level for CronWorkflow {ResourceName}", request.ResourceName);
                return StatusCode(500, new UpdateCronWorkflowLogLevelResponse
                {
                    Success = false,
                    Message = "Failed to update CronWorkflow log level"
                });
            }
        }

        [HttpGet("resource")]
        public async Task<IActionResult> GetCronWorkflow(
            [FromQuery] string namespaceName,
            [FromQuery] string resourceName)
        {
            try
            {
                _logger.LogInformation($"Retrieving CronWorkflow {resourceName} in namespace {namespaceName}");
                var resource = await _clusterService.GetCronWorkflowByNameAsync(namespaceName, resourceName);
                
                if (resource != null)
                {
                    return Ok(resource);
                }
                else
                {
                    return NotFound(new { error = $"CronWorkflow {resourceName} not found in namespace {namespaceName}" });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving CronWorkflow {resourceName}");
                return StatusCode(500, new { error = "Failed to retrieve CronWorkflow", details = ex.Message });
            }
        }

        [HttpPost("submit")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> SubmitCronWorkflow([FromBody] SubmitCronWorkflowRequest request)
        {
            try
            {
                _logger.LogInformation($"Submitting CronWorkflow {request.ResourceName} in namespace {request.NamespaceName}");
                var response = await _argoWorkflowsService.SubmitCronWorkflowAsync(request.NamespaceName, request.ResourceName);
                
                if (response.Success)
                {
                    _logger.LogInformation($"Successfully submitted CronWorkflow {request.ResourceName}");
                    return Ok(response);
                }
                else
                {
                    _logger.LogWarning($"Failed to submit CronWorkflow {request.ResourceName}: {response.Message}");
                    return StatusCode(500, response);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error submitting CronWorkflow {request.ResourceName}");
                return StatusCode(500, new SubmitCronWorkflowResponse 
                { 
                    Success = false, 
                    Message = $"Failed to submit CronWorkflow: {ex.Message}" 
                });
            }
        }
    }
}

