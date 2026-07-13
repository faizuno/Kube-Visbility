using Microsoft.AspNetCore.Authorization;
using KubeVisibility.Dashboard.Api.Extensions;
using KubeVisibility.Dashboard.Api.Options;

namespace KubeVisibility.Dashboard.Api.Authorization
{
    /// <summary>
    /// Authorization handler for admin group requirement
    /// </summary>
    public class AdminGroupHandler : AuthorizationHandler<AdminGroupRequirement>
    {
        private readonly IConfiguration _configuration;
        private readonly ILogger<AdminGroupHandler> _logger;

        public AdminGroupHandler(IConfiguration configuration, ILogger<AdminGroupHandler> logger)
        {
            _configuration = configuration;
            _logger = logger;
        }

        protected override Task HandleRequirementAsync(
            AuthorizationHandlerContext context,
            AdminGroupRequirement requirement)
        {
            var adminGroups = KubernetesInfoConfiguration.GetAdminGroups(_configuration);

            // Check if user is in any admin group
            if (context.User.IsUserInAdminGroup(adminGroups))
            {
                _logger.LogDebug($"User {context.User.Identity?.Name} is authorized as admin. Groups: {string.Join(", ", adminGroups)}");
                context.Succeed(requirement);
            }
            else
            {
                var userGroups = context.User.FindAll("groups")
                    .Select(c => c.Value)
                    .ToList();
                
                if (!userGroups.Any())
                {
                    userGroups = context.User.FindAll("role")
                        .Select(c => c.Value)
                        .ToList();
                }

                _logger.LogWarning($"User {context.User.Identity?.Name} is not authorized as admin. User groups: {string.Join(", ", userGroups)}. Required groups: {string.Join(", ", adminGroups)}");
            }

            return Task.CompletedTask;
        }
    }
}

