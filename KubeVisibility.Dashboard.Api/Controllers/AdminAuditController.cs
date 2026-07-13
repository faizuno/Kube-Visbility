using KubeVisibility.Dashboard.Api.Options;
using KubeVisibility.Dashboard.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/admin-audit")]
    [ApiController]
    [Authorize]
    public class AdminAuditController : ControllerBase
    {
        private readonly IAdminAuditService _adminAuditService;
        private readonly IOptions<AdminAuditOptions> _options;
        private readonly ILogger<AdminAuditController> _logger;

        public AdminAuditController(
            IAdminAuditService adminAuditService,
            IOptions<AdminAuditOptions> options,
            ILogger<AdminAuditController> logger)
        {
            _adminAuditService = adminAuditService;
            _options = options;
            _logger = logger;
        }

        /// <summary>
        /// Gets admin audit events for a time range.
        /// startUtc and endUtc are required and the range enforces a 90-day maximum lookback.
        /// </summary>
        [HttpGet]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> GetAudits(
            [FromQuery] DateTime? startUtc,
            [FromQuery] DateTime? endUtc,
            [FromQuery] int limit = 500,
            [FromQuery] string? user = null,
            [FromQuery] string? actor = null,
            [FromQuery] string? actorEmail = null,
            [FromQuery(Name = "namespace")] string[]? namespaces = null,
            [FromQuery] string[]? namespaceName = null,
            [FromQuery] string? action = null,
            [FromQuery] string? resourceName = null,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var nowUtc = DateTime.UtcNow;
                var maxRangeDays = Math.Max(1, _options.Value.MaxQueryRangeDays);
                var minAllowedStart = nowUtc.AddDays(-maxRangeDays);
                var resolvedNamespaces = ResolveNamespaces(namespaces, namespaceName);

                if (!startUtc.HasValue || !endUtc.HasValue)
                {
                    return BadRequest(new { error = "startUtc and endUtc are required." });
                }

                var effectiveEndUtc = endUtc.Value.ToUniversalTime();
                var effectiveStartUtc = startUtc.Value.ToUniversalTime();

                if (effectiveStartUtc > effectiveEndUtc)
                {
                    return BadRequest(new { error = "startUtc must be less than or equal to endUtc." });
                }

                if (effectiveStartUtc < minAllowedStart)
                {
                    return BadRequest(new
                    {
                        error = $"startUtc cannot be older than {maxRangeDays} days."
                    });
                }

                var events = await _adminAuditService.ReadEventsAsync(
                    effectiveStartUtc,
                    effectiveEndUtc,
                    limit,
                    user,
                    actor,
                    actorEmail,
                    resolvedNamespaces,
                    action,
                    resourceName,
                    cancellationToken);

                return Ok(new
                {
                    startUtc = effectiveStartUtc,
                    endUtc = effectiveEndUtc,
                    filters = new
                    {
                        user,
                        actor,
                        actorEmail,
                        namespaces = resolvedNamespaces,
                        action,
                        resourceName
                    },
                    count = events.Count,
                    items = events
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve admin audit events.");
                return StatusCode(500, new { error = "Failed to retrieve admin audit events", details = ex.Message });
            }
        }

        private static IReadOnlyList<string> ResolveNamespaces(string[]? namespaces, string[]? namespaceNames)
        {
            var combined = new List<string>();
            if (namespaces != null)
            {
                combined.AddRange(namespaces);
            }

            if (namespaceNames != null)
            {
                combined.AddRange(namespaceNames);
            }

            return combined
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
    }
}
