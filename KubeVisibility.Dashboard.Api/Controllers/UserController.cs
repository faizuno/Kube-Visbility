using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.IdentityModel.Tokens.Jwt;
using KubeVisibility.Dashboard.Api.Options;
using KubeVisibility.Dashboard.Api.Services;
using Microsoft.AspNetCore.Http;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/user")]
    [ApiController]
    [AllowAnonymous]
    public class UserController : ControllerBase
    {
        private readonly IConfiguration _configuration;
        private readonly ILogger<UserController> _logger;
        private readonly ITokenValidationService _tokenValidationService;

        public UserController(
            IConfiguration configuration, 
            ILogger<UserController> logger,
            ITokenValidationService tokenValidationService)
        {
            _configuration = configuration;
            _logger = logger;
            _tokenValidationService = tokenValidationService;
        }

        [HttpGet("info")]
        public IActionResult GetUserInfo()
        {
            // Log all request headers
            var allHeaders = Request.Headers.Select(h => $"{h.Key}: {string.Join(", ", h.Value.ToArray())}");
            _logger.LogInformation("All request headers: {Headers}", string.Join(" | ", allHeaders));
            
            var accessToken = Request.Headers["X-Auth-Request-Access-Token"].FirstOrDefault();
            var groupsHeader = Request.Headers["X-Auth-Request-Groups"].FirstOrDefault();
            var userEmail = Request.Headers["X-Auth-Request-Email"].FirstOrDefault();
            
            if (string.IsNullOrEmpty(accessToken))
            {
                _logger.LogWarning("Access token not found in request headers");
                return Unauthorized(new { error = "Access token is required" });
            }
            
            var validationResult = _tokenValidationService.ValidateToken(accessToken);
            if (!validationResult.IsValid)
            {
                _logger.LogWarning("Token validation failed: {Error}", validationResult.ErrorMessage);
                
                // Clear OAuth2 proxy cookie when token is invalid or expired
                ClearOAuthProxyCookie();
                
                return Unauthorized(new { error = "Invalid or expired token", message = validationResult.ErrorMessage });
            }

            // Parse name claim from access token
            var userName = ExtractNameFromToken(accessToken);
            
            // Log extracted header values for debugging
            _logger.LogInformation("Extracted headers - User: {User}, Email: {Email}, Groups: {Groups}, HasToken: {HasToken}", 
                userName ?? "null", 
                userEmail ?? "null", 
                groupsHeader ?? "null", 
                !string.IsNullOrEmpty(accessToken));
            
            // Parse groups (comma-separated)
            var userGroups = new List<string>();
            if (!string.IsNullOrEmpty(groupsHeader))
            {
                userGroups = groupsHeader.Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(g => g.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }
            
            var adminGroups = KubernetesInfoConfiguration.GetAdminGroups(_configuration);
            
            // Check if user is in any admin group (case-insensitive)
            bool isAdmin = userGroups.Any(userGroup =>
                adminGroups.Any(adminGroup =>
                    userGroup.Equals(adminGroup, StringComparison.OrdinalIgnoreCase)));
            
            // Get namespaces from configuration
            var namespaces = _configuration.GetSection("KubernetesInfo:Namespaces").Get<List<string>>() 
                ?? new List<string>();
            var consumersNamespace = KubernetesInfoConfiguration.GetConsumersNamespace(_configuration);
            var jobsNamespace = KubernetesInfoConfiguration.GetJobsNamespace(_configuration);
            var applicationNamespaces = KubernetesInfoConfiguration.GetApplicationNamespaces(_configuration);

            // Prometheus-backed node metrics (for nodes monitoring page)
            var prometheusEnabled = _configuration.GetValue<bool>("Prometheus:Enabled", false);

            // Get ASPNETCORE_ENVIRONMENT from the API's own environment variable
            var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") 
                ?? _configuration["ASPNETCORE_ENVIRONMENT"] 
                ?? string.Empty;
            
            _logger.LogInformation("User info processed - User: {User}, Groups: [{Groups}], IsAdmin: {IsAdmin}, Namespaces: [{Namespaces}], Environment: {Environment}", 
                userName ?? "null", 
                string.Join(", ", userGroups), 
                isAdmin,
                string.Join(", ", namespaces),
                environment ?? "null");
            
            return Ok(new
            {
                accessToken = accessToken ?? string.Empty,
                isAdmin = isAdmin,
                userName = userName ?? string.Empty,
                userEmail = userEmail ?? string.Empty,
                userGroups = userGroups ?? new List<string>(),
                namespaces = namespaces ?? new List<string>(),
                consumersNamespace,
                jobsNamespace,
                applicationNamespaces,
                adminGroups,
                environment = environment ?? string.Empty,
                prometheusEnabled = prometheusEnabled
            });
        }


        /// <summary>
        /// Extracts the name claim from a JWT access token (after validation)
        /// </summary>
        private string? ExtractNameFromToken(string? token)
        {
            if (string.IsNullOrEmpty(token))
            {
                return null;
            }

            try
            {
                var handler = new JwtSecurityTokenHandler();
                
                // Read the token (already validated, so safe to read)
                var jsonToken = handler.ReadJwtToken(token);
                
                // Try to get the name claim - check common claim names
                if (jsonToken.Claims.FirstOrDefault(c => c.Type == "name")?.Value is { } name && !string.IsNullOrEmpty(name))
                {
                    return name;
                }
                
                // Fallback to preferred_username if name is not available
                if (jsonToken.Claims.FirstOrDefault(c => c.Type == "preferred_username")?.Value is { } preferredUsername && !string.IsNullOrEmpty(preferredUsername))
                {
                    return preferredUsername;
                }
                
                // Fallback to email if neither name nor preferred_username is available
                if (jsonToken.Claims.FirstOrDefault(c => c.Type == "email")?.Value is { } email && !string.IsNullOrEmpty(email))
                {
                    return email;
                }
                
                // Fallback to sub (subject) claim
                if (jsonToken.Claims.FirstOrDefault(c => c.Type == "sub")?.Value is { } sub && !string.IsNullOrEmpty(sub))
                {
                    return sub;
                }
                
                _logger.LogWarning("Could not extract name claim from token. Available claims: {Claims}", 
                    string.Join(", ", jsonToken.Claims.Select(c => c.Type)));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse access token to extract name claim");
            }
            
            return null;
        }

        /// <summary>
        /// Clears the OAuth2 proxy cookie by setting it with an expired date
        /// This works even if the cookie was originally set by OAuth2 proxy
        /// </summary>
        private void ClearOAuthProxyCookie()
        {
            try
            {
                // Get cookie name from configuration, default to common OAuth2 proxy cookie names
                var cookieName = _configuration["Authentication:OAuthProxyCookieName"] ?? "_oauth2_proxy";
                
                // Get cookie path from configuration, default to root path
                var cookiePath = _configuration["Authentication:OAuthProxyCookiePath"] ?? "/";
                
                // Get cookie domain from configuration (optional)
                var cookieDomain = _configuration["Authentication:OAuthProxyCookieDomain"];
                
                // Clear the cookie by setting it with an expired date
                var cookieOptions = new CookieOptions
                {
                    Expires = DateTimeOffset.UtcNow.AddDays(-1), // Expire in the past
                    Path = cookiePath,
                    HttpOnly = true, // Match OAuth2 proxy's HttpOnly setting
                    Secure = Request.Scheme == "https", // Secure in HTTPS
                    SameSite = SameSiteMode.Lax // Common setting for OAuth2 proxy
                };
                
                // Set domain only if configured (OAuth2 proxy may set domain)
                if (!string.IsNullOrEmpty(cookieDomain))
                {
                    cookieOptions.Domain = cookieDomain;
                }
                
                Response.Cookies.Delete(cookieName, cookieOptions);
                
                // Also try to clear with empty value as fallback
                Response.Cookies.Append(cookieName, string.Empty, cookieOptions);
                
                _logger.LogInformation("Cleared OAuth2 proxy cookie: {CookieName}", cookieName);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to clear OAuth2 proxy cookie");
            }
        }
    }
}

