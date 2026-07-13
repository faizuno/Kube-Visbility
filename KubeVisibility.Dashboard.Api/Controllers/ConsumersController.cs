using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services;
using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/consumers")]
    [ApiController]
    [Authorize]
    public class ConsumersController : ControllerBase
    {
        private readonly IConsumerService _consumerService;
        private readonly IClusterService _clusterService;
        private readonly ILogger<ConsumersController> _logger;

        public ConsumersController(
            IConsumerService consumerService,
            IClusterService clusterService,
            ILogger<ConsumersController> logger)
        {
            _consumerService = consumerService;
            _clusterService = clusterService;
            _logger = logger;
        }

        [HttpGet("control-flags")]
        public async Task<IActionResult> GetAllConsumerControlFlags([FromQuery] string namespaceName)
        {
            try
            {
                _logger.LogInformation($"Retrieving all consumer control flags for namespace {namespaceName}");
                var flags = await _consumerService.GetAllConsumerControlFlagsAsync(namespaceName);
                return Ok(flags);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving consumer control flags for {namespaceName}");
                return StatusCode(500, new { error = "Failed to retrieve consumer control flags", details = ex.Message });
            }
        }

        [HttpGet("control-flag")]
        public async Task<IActionResult> GetConsumerControlFlag(
            [FromQuery] string namespaceName,
            [FromQuery] string deploymentName)
        {
            try
            {
                _logger.LogInformation($"Retrieving consumer control flag for {deploymentName} in {namespaceName}");
                var flagValue = await _consumerService.GetConsumerControlFlagAsync(namespaceName, deploymentName);
                
                var response = new ConsumerControlFlagResponse
                {
                    Enabled = flagValue != null && bool.TryParse(flagValue, out var enabled) && enabled,
                    Exists = flagValue != null
                };
                
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving consumer control flag for {deploymentName}");
                return StatusCode(500, new { error = "Failed to retrieve consumer control flag", details = ex.Message });
            }
        }

        [HttpPost("toggle")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> ToggleConsumer([FromBody] ToggleConsumerRequest request)
        {
            try
            {
                _logger.LogInformation($"Toggling consumer {request.DeploymentName} to {(request.Enabled ? "enabled" : "disabled")} in namespace {request.NamespaceName}");
                var success = await _consumerService.SetConsumerControlFlagAsync(request.NamespaceName, request.DeploymentName, request.Enabled);
                
                if (success)
                {
                    // Wait a moment for the ConfigMap update and deployment restart to propagate
                    await Task.Delay(1000);
                    
                    // Fetch the updated deployment with the latest consumer control flag status
                    var updatedResource = await _clusterService.GetDeploymentByNameAsync(request.NamespaceName, request.DeploymentName);
                    
                    return Ok(new ToggleConsumerResponse
                    {
                        Success = true,
                        Message = $"Consumer {request.DeploymentName} {(request.Enabled ? "enabled" : "disabled")} successfully",
                        UpdatedResource = updatedResource
                    });
                }
                else
                {
                    return StatusCode(500, new ToggleConsumerResponse
                    {
                        Success = false,
                        Message = "Failed to toggle consumer"
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error toggling consumer {request.DeploymentName}");
                return StatusCode(500, new { error = "Failed to toggle consumer", details = ex.Message });
            }
        }
    }
}

