using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services;
using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/clusters")]
    [ApiController]
    [Authorize]
    public class ClustersController : ControllerBase
    {
        private readonly IClusterService _clusterService;
        private readonly ILogger<ClustersController> _logger;

        public ClustersController(IClusterService clusterService, ILogger<ClustersController> logger)
        {
            _clusterService = clusterService;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> GetClusterInfo()
        {
            try
            {
                _logger.LogInformation("Retrieving cluster information");
                var clusterInfo = await _clusterService.GetClusterInfoAsync();
                return Ok(clusterInfo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving cluster information");
                return StatusCode(500, new { error = "Failed to retrieve cluster information", details = ex.Message });
            }
        }

        [HttpGet("{namespaceName}")]
        public async Task<IActionResult> GetNamespaceInfo(string namespaceName)
        {
            try
            {
                _logger.LogInformation($"Retrieving namespace information for: {namespaceName}");
                var namespaceInfo = await _clusterService.GetNamespaceInfoAsync(namespaceName);
                return Ok(namespaceInfo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving namespace information for {namespaceName}");
                return StatusCode(500, new { error = $"Failed to retrieve namespace information for {namespaceName}", details = ex.Message });
            }
        }
    }
}

