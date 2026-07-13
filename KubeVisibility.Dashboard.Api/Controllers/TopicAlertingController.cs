using System.Security.Claims;
using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KubeVisibility.Dashboard.Api.Controllers;

[Route("api/topic-alerting")]
[ApiController]
[Authorize(Policy = "AdminOnly")]
public class TopicAlertingController : ControllerBase
{
    private readonly ITopicAlertingService _topicAlertingService;
    private readonly ILogger<TopicAlertingController> _logger;

    public TopicAlertingController(
        ITopicAlertingService topicAlertingService,
        ILogger<TopicAlertingController> logger)
    {
        _topicAlertingService = topicAlertingService;
        _logger = logger;
    }

    [HttpGet("groups")]
    public async Task<IActionResult> GetGroups(CancellationToken cancellationToken)
    {
        var groups = await _topicAlertingService.GetGroupsAsync(cancellationToken);
        return Ok(groups);
    }

    [HttpPost("groups")]
    public async Task<IActionResult> CreateGroup(
        [FromBody] UpsertTopicAlertGroupRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            request.GroupId = null;
            var group = await _topicAlertingService.UpsertGroupAsync(request, GetActor(), cancellationToken);
            return Ok(group);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create topic alert group.");
            return StatusCode(500, new { error = "Failed to create topic alert group", details = ex.Message });
        }
    }

    [HttpPut("groups/{groupId}")]
    public async Task<IActionResult> UpdateGroup(
        [FromRoute] string groupId,
        [FromBody] UpsertTopicAlertGroupRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            request.GroupId = groupId;
            var group = await _topicAlertingService.UpsertGroupAsync(request, GetActor(), cancellationToken);
            return Ok(group);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update topic alert group {GroupId}.", groupId);
            return StatusCode(500, new { error = "Failed to update topic alert group", details = ex.Message });
        }
    }

    [HttpDelete("groups/{groupId}")]
    public async Task<IActionResult> DeleteGroup(
        [FromRoute] string groupId,
        CancellationToken cancellationToken)
    {
        try
        {
            var deleted = await _topicAlertingService.DeleteGroupAsync(groupId, cancellationToken);
            if (!deleted)
            {
                return NotFound(new { error = "Group not found" });
            }

            return Ok(new { success = true, groupId });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete topic alert group {GroupId}.", groupId);
            return StatusCode(500, new { error = "Failed to delete topic alert group", details = ex.Message });
        }
    }

    [HttpGet("rules")]
    public async Task<IActionResult> GetRules(CancellationToken cancellationToken)
    {
        var rules = await _topicAlertingService.GetRulesAsync(cancellationToken);
        return Ok(rules);
    }

    [HttpPost("rules")]
    public async Task<IActionResult> CreateRule(
        [FromBody] UpsertTopicAlertRuleRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            request.RuleId = null;
            var rule = await _topicAlertingService.UpsertRuleAsync(request, GetActor(), cancellationToken);
            return Ok(rule);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create topic alert rule.");
            return StatusCode(500, new { error = "Failed to create topic alert rule", details = ex.Message });
        }
    }

    [HttpPut("rules/{ruleId}")]
    public async Task<IActionResult> UpdateRule(
        [FromRoute] string ruleId,
        [FromBody] UpsertTopicAlertRuleRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            request.RuleId = ruleId;
            var rule = await _topicAlertingService.UpsertRuleAsync(request, GetActor(), cancellationToken);
            return Ok(rule);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update topic alert rule {RuleId}.", ruleId);
            return StatusCode(500, new { error = "Failed to update topic alert rule", details = ex.Message });
        }
    }

    [HttpPatch("rules/{ruleId}/enabled")]
    public async Task<IActionResult> SetRuleEnabled(
        [FromRoute] string ruleId,
        [FromQuery] bool enabled,
        CancellationToken cancellationToken)
    {
        try
        {
            var updated = await _topicAlertingService.SetRuleEnabledAsync(ruleId, enabled, GetActor(), cancellationToken);
            if (updated == null)
            {
                return NotFound(new { error = "Rule not found" });
            }

            return Ok(updated);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to toggle topic alert rule {RuleId}.", ruleId);
            return StatusCode(500, new { error = "Failed to toggle topic alert rule", details = ex.Message });
        }
    }

    [HttpDelete("rules/{ruleId}")]
    public async Task<IActionResult> DeleteRule(
        [FromRoute] string ruleId,
        CancellationToken cancellationToken)
    {
        try
        {
            var deleted = await _topicAlertingService.DeleteRuleAsync(ruleId, cancellationToken);
            if (!deleted)
            {
                return NotFound(new { error = "Rule not found" });
            }

            return Ok(new { success = true, ruleId });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete topic alert rule {RuleId}.", ruleId);
            return StatusCode(500, new { error = "Failed to delete topic alert rule", details = ex.Message });
        }
    }

    private string GetActor()
    {
        return User.FindFirstValue("name")
            ?? User.FindFirstValue("preferred_username")
            ?? User.FindFirstValue(ClaimTypes.Name)
            ?? "unknown";
    }
}
