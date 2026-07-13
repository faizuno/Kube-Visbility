using Microsoft.IdentityModel.Tokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace KubeVisibility.Dashboard.Api.Services
{
    /// <summary>
    /// Service for JWT token validation using configuration-based validation parameters
    /// </summary>
    public class TokenValidationService : ITokenValidationService
    {
        private readonly IConfiguration _configuration;
        private readonly ILogger<TokenValidationService> _logger;
        private ConfigurationManager<OpenIdConnectConfiguration>? _configurationManager;
        private readonly object _configManagerLock = new object();
        private TokenValidationParameters? _baseValidationParameters;

        public TokenValidationService(IConfiguration configuration, ILogger<TokenValidationService> logger)
        {
            _configuration = configuration;
            _logger = logger;
        }

        /// <summary>
        /// Gets the token validation parameters from configuration
        /// Uses ConfigurationManager which automatically refreshes signing keys based on cache-control headers
        /// </summary>
        public TokenValidationParameters GetTokenValidationParameters()
        {
            // Build base validation parameters (these don't change often, so we can cache them)
            if (_baseValidationParameters == null)
            {
                var validAudiences = _configuration.GetSection("Authentication:ValidAudiences").Get<string[]>();
                var validIssuers = _configuration.GetSection("Authentication:ValidIssuers").Get<string[]>();
                var validateIssuerSigningKey = _configuration.GetValue<bool>("Authentication:ValidateIssuerSigningKey", true);
                var requireSignedTokens = _configuration.GetValue<bool>("Authentication:RequireSignedTokens", true);
                var metadataAddress = _configuration["Authentication:MetadataAddress"];
                var authority = _configuration["Authentication:Authority"];

                // For backward compatibility with Azure AD configuration
                if (string.IsNullOrEmpty(metadataAddress) && !string.IsNullOrEmpty(authority))
                {
                    var tenantId = _configuration["Authentication:TenantId"];
                    var metadataEndpoint = _configuration["Authentication:MetadataEndpoint"];

                    if (!string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(metadataEndpoint))
                    {
                        authority = $"{authority}{tenantId}/";
                        metadataAddress = $"{metadataEndpoint}{tenantId}/.well-known/openid-configuration";
                    }
                }

                // Build valid issuers list
                var issuersList = new List<string>();

                // Add explicitly configured issuers (for Dex)
                if (validIssuers != null && validIssuers.Length > 0)
                {
                    issuersList.AddRange(validIssuers);
                }

                // Add authority-based issuer (for Azure AD backward compatibility)
                if (!string.IsNullOrEmpty(authority) && !issuersList.Contains(authority))
                {
                    issuersList.Add(authority);
                }

                _baseValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = issuersList.Count > 0,
                    ValidIssuers = issuersList.Count > 0 ? issuersList.ToArray() : null,
                    ValidateAudience = validAudiences != null && validAudiences.Length > 0,
                    ValidAudiences = validAudiences,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = validateIssuerSigningKey,
                    RequireSignedTokens = requireSignedTokens,
                    ClockSkew = TimeSpan.FromMinutes(5) // Allow 5 minutes clock skew
                };
            }

            // Get fresh signing keys from ConfigurationManager (handles automatic refresh)
            // Create a new instance with the same base parameters but fresh signing keys
            var validationParameters = new TokenValidationParameters
            {
                ValidateIssuer = _baseValidationParameters.ValidateIssuer,
                ValidIssuers = _baseValidationParameters.ValidIssuers,
                ValidateAudience = _baseValidationParameters.ValidateAudience,
                ValidAudiences = _baseValidationParameters.ValidAudiences,
                ValidateLifetime = _baseValidationParameters.ValidateLifetime,
                ValidateIssuerSigningKey = _baseValidationParameters.ValidateIssuerSigningKey,
                RequireSignedTokens = _baseValidationParameters.RequireSignedTokens,
                ClockSkew = _baseValidationParameters.ClockSkew
            };
            
            // Initialize ConfigurationManager if not already done
            if (_configurationManager == null)
            {
                lock (_configManagerLock)
                {
                    if (_configurationManager == null)
                    {
                        var metadataAddress = _configuration["Authentication:MetadataAddress"];
                        var authority = _configuration["Authentication:Authority"];

                        // For backward compatibility with Azure AD configuration
                        if (string.IsNullOrEmpty(metadataAddress) && !string.IsNullOrEmpty(authority))
                        {
                            var tenantId = _configuration["Authentication:TenantId"];
                            var metadataEndpoint = _configuration["Authentication:MetadataEndpoint"];

                            if (!string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(metadataEndpoint))
                            {
                                metadataAddress = $"{metadataEndpoint}{tenantId}/.well-known/openid-configuration";
                            }
                        }

                        if (string.IsNullOrEmpty(metadataAddress) && !string.IsNullOrEmpty(authority))
                        {
                            metadataAddress = $"{authority.TrimEnd('/')}/.well-known/openid-configuration";
                        }

                        if (!string.IsNullOrEmpty(metadataAddress))
                        {
                            try
                            {
                                var documentRetriever = new HttpDocumentRetriever
                                {
                                    RequireHttps = _configuration.GetValue<bool>("Authentication:RequireHttpsMetadata", true)
                                };

                                _configurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
                                    metadataAddress,
                                    new OpenIdConnectConfigurationRetriever(),
                                    documentRetriever);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogError(ex, "Failed to initialize ConfigurationManager for metadata address: {MetadataAddress}", metadataAddress);
                            }
                        }
                    }
                }
            }

            // Get fresh signing keys - ConfigurationManager handles caching and automatic refresh
            if (_configurationManager != null)
            {
                try
                {
                    // GetConfigurationAsync automatically refreshes based on cache-control headers
                    var openIdConfig = _configurationManager.GetConfigurationAsync().GetAwaiter().GetResult();
                    validationParameters.IssuerSigningKeys = openIdConfig.SigningKeys;
                    
                    if (openIdConfig.SigningKeys != null && openIdConfig.SigningKeys.Any())
                    {
                        _logger.LogDebug("Loaded {KeyCount} signing keys from OIDC metadata", openIdConfig.SigningKeys.Count());
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to fetch signing keys from ConfigurationManager");
                }
            }

            return validationParameters;
        }

        /// <summary>
        /// Validates a JWT token using the configured validation parameters
        /// If signature validation fails, attempts to refresh keys and retry once
        /// </summary>
        public (bool IsValid, string? ErrorMessage, ClaimsPrincipal? Principal) ValidateToken(string token)
        {
            try
            {
                var handler = new JwtSecurityTokenHandler();
                var validationParameters = GetTokenValidationParameters();

                // Validate the token
                var principal = handler.ValidateToken(token, validationParameters, out SecurityToken validatedToken);

                return (true, null, principal);
            }
            catch (SecurityTokenExpiredException ex)
            {
                _logger.LogWarning(ex, "Token has expired");
                return (false, "Token has expired", null);
            }
            catch (SecurityTokenSignatureKeyNotFoundException ex)
            {
                _logger.LogWarning(ex, "Token signing key not found. Attempting to refresh signing keys and retry...");
                return RetryWithRefreshedKeys(token, $"Token validation failed: {ex.Message}");
            }
            catch (SecurityTokenInvalidSignatureException ex)
            {
                _logger.LogWarning(ex, "Token signature is invalid. Attempting to refresh signing keys and retry...");
                return RetryWithRefreshedKeys(token, "Token signature is invalid");
            }
            catch (SecurityTokenInvalidIssuerException ex)
            {
                _logger.LogWarning(ex, "Token issuer is invalid");
                return (false, "Token issuer is invalid", null);
            }
            catch (SecurityTokenInvalidAudienceException ex)
            {
                _logger.LogWarning(ex, "Token audience is invalid");
                return (false, "Token audience is invalid", null);
            }
            catch (SecurityTokenException ex)
            {
                _logger.LogWarning(ex, "Token validation failed: {Error}", ex.Message);
                return (false, $"Token validation failed: {ex.Message}", null);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error during token validation");
                return (false, "Token validation error", null);
            }
        }

        /// <summary>
        /// Retries token validation after forcing a refresh of signing keys
        /// </summary>
        private (bool IsValid, string? ErrorMessage, ClaimsPrincipal? Principal) RetryWithRefreshedKeys(string token, string defaultErrorMessage)
        {
            if (_configurationManager == null)
            {
                return (false, defaultErrorMessage, null);
            }

            try
            {
                // Request a fresh configuration (bypasses cache)
                _configurationManager.RequestRefresh();
                
                // Force refresh by getting a new configuration (this will fetch fresh keys)
                var refreshTask = _configurationManager.GetConfigurationAsync();
                
                try
                {
                    // Wait up to 5 seconds for refresh to complete
                    if (!refreshTask.Wait(TimeSpan.FromSeconds(5)))
                    {
                        _logger.LogWarning("Failed to refresh signing keys within timeout");
                        return (false, defaultErrorMessage, null);
                    }
                }
                catch (AggregateException aggEx)
                {
                    // Unwrap the actual exception
                    var innerEx = aggEx.InnerException ?? aggEx;
                    _logger.LogWarning(innerEx, "Error while refreshing signing keys");
                    return (false, defaultErrorMessage, null);
                }
                
                // Verify the task completed successfully
                if (refreshTask.IsFaulted || refreshTask.IsCanceled)
                {
                    _logger.LogWarning("Signing keys refresh task failed or was canceled");
                    return (false, defaultErrorMessage, null);
                }
                
                // Get fresh validation parameters with updated keys
                var refreshedValidationParameters = GetTokenValidationParameters();
                
                // Retry validation with fresh keys
                var handler = new JwtSecurityTokenHandler();
                var principal = handler.ValidateToken(token, refreshedValidationParameters, out SecurityToken validatedToken);
                
                _logger.LogInformation("Token validation succeeded after refreshing signing keys");
                return (true, null, principal);
            }
            catch (Exception retryEx)
            {
                _logger.LogWarning(retryEx, "Token validation failed even after refreshing keys");
                return (false, defaultErrorMessage, null);
            }
        }
    }
}

