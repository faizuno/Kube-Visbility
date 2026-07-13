using Microsoft.AspNetCore.Authorization;

namespace KubeVisibility.Dashboard.Api.Authorization
{
    /// <summary>
    /// Requirement for admin group authorization policy
    /// </summary>
    public class AdminGroupRequirement : IAuthorizationRequirement
    {
    }
}

