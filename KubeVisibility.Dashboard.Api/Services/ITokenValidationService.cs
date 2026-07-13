using Microsoft.IdentityModel.Tokens;
using System.Security.Claims;

namespace KubeVisibility.Dashboard.Api.Services
{
    /// <summary>
    /// Service for JWT token validation
    /// </summary>
    public interface ITokenValidationService
    {
        /// <summary>
        /// Gets the token validation parameters from configuration
        /// </summary>
        TokenValidationParameters GetTokenValidationParameters();

        /// <summary>
        /// Validates a JWT token
        /// </summary>
        /// <param name="token">The JWT token to validate</param>
        /// <returns>Tuple containing validation result, error message (if any), and claims principal (if valid)</returns>
        (bool IsValid, string? ErrorMessage, ClaimsPrincipal? Principal) ValidateToken(string token);
    }
}

