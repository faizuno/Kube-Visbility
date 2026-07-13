using System.Security.Claims;

namespace KubeVisibility.Dashboard.Api.Extensions
{
    /// <summary>
    /// Extension methods for authorization checks
    /// </summary>
    public static class AuthorizationExtensions
    {
        /// <summary>
        /// Checks if the user is in any of the configured admin groups
        /// </summary>
        /// <param name="user">The claims principal representing the user</param>
        /// <param name="adminGroups">List of admin group names to check against</param>
        /// <returns>True if user is in any admin group, false otherwise</returns>
        public static bool IsUserInAdminGroup(this ClaimsPrincipal user, List<string> adminGroups)
        {
            if (user == null || !user.Identity?.IsAuthenticated == true)
            {
                return false;
            }

            if (adminGroups == null || !adminGroups.Any())
            {
                return false;
            }

            // Azure AD provides groups in the "groups" claim
            // It can be a single claim with multiple values or multiple claims
            var userGroups = user.FindAll("groups")
                .Select(c => c.Value)
                .ToList();

            // Also check for "role" claim (some tokens use this)
            if (!userGroups.Any())
            {
                userGroups = user.FindAll("role")
                    .Select(c => c.Value)
                    .ToList();
            }

            // Check if user is in any of the configured admin groups (case-insensitive)
            bool isAdmin = userGroups.Any(userGroup =>
                adminGroups.Any(adminGroup =>
                    userGroup.Equals(adminGroup, StringComparison.OrdinalIgnoreCase)));

            return isAdmin;
        }
    }
}

