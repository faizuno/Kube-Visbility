using System.Security.Claims;
using KubeVisibility.Dashboard.Api.Models.PrometheusAlerts;
using KubeVisibility.Dashboard.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/prometheus-alerts")]
    [ApiController]
    [Authorize]
    public class PrometheusAlertsController : ControllerBase
    {
        private readonly IPrometheusAlertService _prometheusAlertService;
        private readonly ILogger<PrometheusAlertsController> _logger;

        public PrometheusAlertsController(
            IPrometheusAlertService prometheusAlertService,
            ILogger<PrometheusAlertsController> logger)
        {
            _prometheusAlertService = prometheusAlertService;
            _logger = logger;
        }

        /// <summary>
        /// Gets alerts observed as firing in the requested time range.
        /// </summary>
        [HttpGet("firing")]
        public async Task<IActionResult> GetFiringAlerts(
            [FromQuery] int? rangeHours,
            CancellationToken cancellationToken)
        {
            try
            {
                var alerts = await _prometheusAlertService.GetFiringAlertsAsync(rangeHours, cancellationToken);
                return Ok(alerts);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve firing alerts from Alertmanager.");
                return StatusCode(500, new { error = "Failed to retrieve firing alerts", details = ex.Message });
            }
        }

        /// <summary>
        /// Searches alerts that fired in the requested time range with filters and paging.
        /// </summary>
        [HttpGet("firing/search")]
        public async Task<IActionResult> SearchFiringAlerts(
            [FromQuery] string? severity,
            [FromQuery(Name = "namespace")] string? namespaceName,
            [FromQuery] string? alertName,
            [FromQuery] int? rangeHours,
            [FromQuery] int limit = 50,
            [FromQuery] int offset = 0,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var page = await _prometheusAlertService.SearchFiringAlertsAsync(
                    new PrometheusFiringAlertsQuery
                    {
                        Severity = severity,
                        NamespaceName = namespaceName,
                        AlertName = alertName,
                        RangeHours = rangeHours,
                        Limit = limit,
                        Offset = offset
                    },
                    cancellationToken);

                return Ok(page);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to search firing alerts.");
                return StatusCode(500, new { error = "Failed to search firing alerts", details = ex.Message });
            }
        }

        /// <summary>
        /// Gets aggregate alert stats for the requested time range.
        /// </summary>
        [HttpGet("stats")]
        public async Task<IActionResult> GetFiringAlertStats(
            [FromQuery] int? rangeHours,
            CancellationToken cancellationToken)
        {
            try
            {
                var stats = await _prometheusAlertService.GetFiringAlertStatsAsync(rangeHours, cancellationToken);
                return Ok(stats);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve firing alert stats.");
                return StatusCode(500, new { error = "Failed to retrieve firing alert stats", details = ex.Message });
            }
        }

        [HttpPost("suppress")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> SuppressAlert(
            [FromBody] SuppressPrometheusAlertRequest request,
            CancellationToken cancellationToken)
        {
            try
            {
                var suppression = await _prometheusAlertService.SuppressAlertAsync(request, GetActor(), cancellationToken);
                return Ok(suppression);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to suppress alert {AlertName}.", request.AlertName);
                return StatusCode(500, new { error = "Failed to suppress alert", details = ex.Message });
            }
        }

        [HttpPut("suppress/{silenceId}")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> EditSuppression(
            [FromRoute] string silenceId,
            [FromBody] EditPrometheusSuppressionRequest request,
            CancellationToken cancellationToken)
        {
            try
            {
                var suppression = await _prometheusAlertService.EditSuppressionAsync(silenceId, request, GetActor(), cancellationToken);
                return Ok(suppression);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to edit suppression {SilenceId}.", silenceId);
                return StatusCode(500, new { error = "Failed to edit suppression", details = ex.Message });
            }
        }

        [HttpDelete("suppress/{silenceId}")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> UnsuppressAlert(
            [FromRoute] string silenceId,
            [FromQuery] string? reason,
            CancellationToken cancellationToken)
        {
            try
            {
                await _prometheusAlertService.UnsuppressAlertAsync(silenceId, GetActor(), reason, cancellationToken);
                return Ok(new { success = true, silenceId });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to unsuppress alert {SilenceId}.", silenceId);
                return StatusCode(500, new { error = "Failed to unsuppress alert", details = ex.Message });
            }
        }

        [HttpGet("suppressions")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> GetSuppressions(CancellationToken cancellationToken)
        {
            try
            {
                var suppressions = await _prometheusAlertService.GetSuppressionsAsync(cancellationToken);
                return Ok(suppressions);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve suppressions.");
                return StatusCode(500, new { error = "Failed to retrieve suppressions", details = ex.Message });
            }
        }

        [HttpGet("rules")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> GetRuleDefinitions(CancellationToken cancellationToken)
        {
            try
            {
                var rules = await _prometheusAlertService.GetRuleDefinitionsAsync(cancellationToken);
                return Ok(rules);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve alert rule definitions.");
                return StatusCode(500, new { error = "Failed to retrieve alert rule definitions", details = ex.Message });
            }
        }

        [HttpGet("rules/{alertName}")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> GetRuleDefinition(
            [FromRoute] string alertName,
            CancellationToken cancellationToken)
        {
            try
            {
                var rule = await _prometheusAlertService.GetRuleDefinitionAsync(alertName, cancellationToken);
                if (rule == null) return NotFound(new { error = "Rule not found" });
                return Ok(rule);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve alert rule definition {AlertName}.", alertName);
                return StatusCode(500, new { error = "Failed to retrieve alert rule definition", details = ex.Message });
            }
        }

        [HttpPost("rules/apply")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> ApplyRuleDefinition(
            [FromBody] ApplyPrometheusRuleRequest request,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(request.AlertName) || string.IsNullOrWhiteSpace(request.Expr))
            {
                return BadRequest(new { error = "alertName and expr are required" });
            }

            try
            {
                var result = await _prometheusAlertService.ApplyRuleDefinitionAsync(request, cancellationToken);
                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to apply alert rule definition {AlertName}.", request.AlertName);
                return StatusCode(500, new { error = "Failed to apply alert rule definition", details = ex.Message });
            }
        }

        [HttpGet("alert-groups")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> GetAlertGroups(CancellationToken cancellationToken)
        {
            try
            {
                var groups = await _prometheusAlertService.GetAlertGroupsAsync(cancellationToken);
                return Ok(groups);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve alert groups.");
                return StatusCode(500, new { error = "Failed to retrieve alert groups", details = ex.Message });
            }
        }

        [HttpGet("alert-groups/route-keys")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> GetAlertGroupRouteKeys(CancellationToken cancellationToken)
        {
            try
            {
                var routeKeys = await _prometheusAlertService.GetAlertGroupRouteKeysAsync(cancellationToken);
                return Ok(routeKeys);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve alert group route keys.");
                return StatusCode(500, new { error = "Failed to retrieve alert group route keys", details = ex.Message });
            }
        }

        [HttpGet("alert-bindings")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> GetAlertRouteBindings(CancellationToken cancellationToken)
        {
            try
            {
                var bindings = await _prometheusAlertService.GetAlertRouteBindingsAsync(cancellationToken);
                return Ok(bindings);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve alert route bindings.");
                return StatusCode(500, new { error = "Failed to retrieve alert route bindings", details = ex.Message });
            }
        }

        [HttpPut("alert-groups")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> UpsertAlertGroup(
            [FromBody] AlertGroupUpdateRequest request,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return BadRequest(new { error = "name is required" });
            }

            try
            {
                var groups = await _prometheusAlertService.UpsertAlertGroupAsync(request, GetActor(), cancellationToken);
                return Ok(groups);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to update alert group {Group}.", request.Name);
                return StatusCode(500, new { error = "Failed to update alert group", details = ex.Message });
            }
        }

        [HttpDelete("alert-groups/{groupName}")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> DeleteAlertGroup(
            [FromRoute] string groupName,
            CancellationToken cancellationToken)
        {
            try
            {
                var groups = await _prometheusAlertService.DeleteAlertGroupAsync(groupName, GetActor(), cancellationToken);
                return Ok(groups);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to delete alert group {Group}.", groupName);
                return StatusCode(500, new { error = "Failed to delete alert group", details = ex.Message });
            }
        }

        /// <summary>
        /// Lists dashboard-managed alert rule proposals (GitOps review queue).
        /// </summary>
        [HttpGet("proposals")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> GetRuleProposals(CancellationToken cancellationToken)
        {
            try
            {
                var proposals = await _prometheusAlertService.GetRuleProposalsAsync(cancellationToken);
                return Ok(proposals);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve alert rule proposals.");
                return StatusCode(500, new { error = "Failed to retrieve alert rule proposals", details = ex.Message });
            }
        }

        /// <summary>
        /// Creates a new dashboard-managed alert rule proposal.
        /// This does not modify ArgoCD-managed PrometheusRule resources.
        /// </summary>
        [HttpPost("proposals")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> CreateRuleProposal(
            [FromBody] CreatePrometheusAlertRuleProposalRequest request,
            CancellationToken cancellationToken)
        {
            var validationError = ValidateRequiredFields(request.AlertName, request.Expr);
            if (validationError is not null) return validationError;

            try
            {
                var createdBy = GetActor();
                var proposal = await _prometheusAlertService.CreateRuleProposalAsync(request, createdBy, cancellationToken);
                return Ok(proposal);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create alert rule proposal for {AlertName}.", request.AlertName);
                return StatusCode(500, new { error = "Failed to create alert rule proposal", details = ex.Message });
            }
        }

        /// <summary>
        /// Updates an existing dashboard-managed alert rule proposal.
        /// </summary>
        [HttpPut("proposals/{proposalId}")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> UpdateRuleProposal(
            [FromRoute] string proposalId,
            [FromBody] UpdatePrometheusAlertRuleProposalRequest request,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(proposalId))
            {
                return BadRequest(new { error = "proposalId is required" });
            }

            var validationError = ValidateRequiredFields(request.AlertName, request.Expr);
            if (validationError is not null) return validationError;

            try
            {
                var updated = await _prometheusAlertService.UpdateRuleProposalAsync(
                    proposalId,
                    request,
                    GetActor(),
                    cancellationToken);

                if (updated is null)
                {
                    return NotFound(new { error = $"Proposal {proposalId} not found" });
                }

                return Ok(updated);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to update alert rule proposal {ProposalId}.", proposalId);
                return StatusCode(500, new { error = "Failed to update alert rule proposal", details = ex.Message });
            }
        }

        /// <summary>
        /// Generates PrometheusRule YAML from proposals for GitOps usage.
        /// Default status filter is Approved.
        /// </summary>
        [HttpGet("proposals/export/prometheusrule")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> ExportPrometheusRuleYaml(
            [FromQuery] string? groupName,
            [FromQuery] string? status,
            CancellationToken cancellationToken)
        {
            try
            {
                var yaml = await _prometheusAlertService.GeneratePrometheusRuleYamlAsync(groupName, status, cancellationToken);
                return Content(yaml, "application/yaml");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to export PrometheusRule YAML.");
                return StatusCode(500, new { error = "Failed to export PrometheusRule YAML", details = ex.Message });
            }
        }

        private IActionResult? ValidateRequiredFields(string alertName, string expr)
        {
            if (string.IsNullOrWhiteSpace(alertName))
            {
                return BadRequest(new { error = "alertName is required" });
            }

            if (string.IsNullOrWhiteSpace(expr))
            {
                return BadRequest(new { error = "expr is required" });
            }

            return null;
        }

        private string GetActor()
        {
            return User.FindFirstValue("name")
                ?? User.FindFirstValue("preferred_username")
                ?? User.FindFirstValue(ClaimTypes.Name)
                ?? "unknown";
        }
    }
}
