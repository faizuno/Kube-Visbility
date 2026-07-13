using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using System.IdentityModel.Tokens.Jwt;
using KubeVisibility.Dashboard.Api.Services;

namespace KubeVisibility.Dashboard.Api.Extensions
{
    public static class AuthenticationExtensions
    {
        /// <summary>
        /// Adds JWT Bearer authentication for API access (supports Azure AD and Dex)
        /// Uses TokenValidationService for consistent validation logic
        /// </summary>
        public static IServiceCollection AddAuthenticationServices(this IServiceCollection services, IConfiguration configuration)
        {
            // Register token validation service
            services.AddSingleton<ITokenValidationService, TokenValidationService>();
            
            return AddAuthenticationServicesInternal(services, configuration);
        }

        /// <summary>
        /// Internal method to configure JWT Bearer authentication
        /// </summary>
        private static IServiceCollection AddAuthenticationServicesInternal(this IServiceCollection services, IConfiguration configuration)
        {
            var schemeName = configuration["Authentication:SchemeName"] ?? JwtBearerDefaults.AuthenticationScheme;
            var useSecurityTokenValidators = configuration.GetValue<bool>("Authentication:UseSecurityTokenValidators");
            var validateIssuerSigningKey = configuration.GetValue<bool>("Authentication:ValidateIssuerSigningKey");
            var saveToken = configuration.GetValue<bool>("Authentication:SaveToken");
            var requireHttpsMetadata = configuration.GetValue<bool>("Authentication:RequireHttpsMetadata");
            
            // Get metadata endpoint - can be direct (Dex) or constructed (Azure AD)
            var metadataAddress = configuration["Authentication:MetadataAddress"];
            var authority = configuration["Authentication:Authority"];
            
            // For backward compatibility with Azure AD configuration
            if (string.IsNullOrEmpty(metadataAddress) && !string.IsNullOrEmpty(authority))
            {
                var tenantId = configuration["Authentication:TenantId"];
                var metadataEndpoint = configuration["Authentication:MetadataEndpoint"];
                
                if (!string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(metadataEndpoint))
                {
                    authority = $"{authority}{tenantId}/";
                    metadataAddress = $"{metadataEndpoint}{tenantId}/.well-known/openid-configuration";
                }
            }
            
            // Clear default claim type mappings
            JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();
            
            services.AddAuthentication(options =>
                {
                    // Default to JWT Bearer for API access
                    options.DefaultScheme = schemeName;
                    options.DefaultChallengeScheme = schemeName;
                })
                // JWT Bearer authentication for API access
                .AddJwtBearer(schemeName, options =>
                {
                    // Set authority and metadata address
                    if (!string.IsNullOrEmpty(authority))
                    {
                        options.Authority = authority;
                    }
                    
                    if (!string.IsNullOrEmpty(metadataAddress))
                    {
                        options.MetadataAddress = metadataAddress;
                    }
                    
                    options.UseSecurityTokenValidators = useSecurityTokenValidators;
                    options.SaveToken = saveToken;
                    options.RequireHttpsMetadata = requireHttpsMetadata;
                    
                    // Configure validation parameters using TokenValidationService
                    // This ensures consistent validation logic across the application
                    options.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
                    {
                        // Base parameters will be set by PostConfigure using TokenValidationService
                        // We set a minimal set here, and PostConfigure will override with the full set
                    };
                    
                    options.Events = new JwtBearerEvents
                    {
                        // Allow tokens from query parameters for EventSource/SSE compatibility
                        OnMessageReceived = context =>
                        {
                            var accessToken = context.Request.Query["access_token"];
                            
                            // If the token is in the query parameter, use it
                            if (!string.IsNullOrEmpty(accessToken))
                            {
                                context.Token = accessToken;
                            }
                            
                            return Task.CompletedTask;
                        },
                        OnAuthenticationFailed = context =>
                        {
                            var logger = context.HttpContext.RequestServices.GetRequiredService<ILogger<Program>>();
                            logger.LogWarning("JWT Bearer authentication failed: {Error}", context.Exception.Message);
                            return Task.CompletedTask;
                        }
                    };
                });
            
            // Post-configure JWT Bearer options to use TokenValidationService
            // This runs after the service provider is available, allowing us to resolve TokenValidationService
            services.AddSingleton<IPostConfigureOptions<JwtBearerOptions>>(serviceProvider =>
            {
                var tokenValidationService = serviceProvider.GetRequiredService<ITokenValidationService>();
                return new JwtBearerPostConfigureOptions(tokenValidationService, validateIssuerSigningKey);
            });
                
            return services;
        }

        /// <summary>
        /// Post-configures JWT Bearer options using TokenValidationService
        /// This ensures the JWT Bearer middleware uses the same validation logic as manual token validation
        /// </summary>
        private class JwtBearerPostConfigureOptions : IPostConfigureOptions<JwtBearerOptions>
        {
            private readonly ITokenValidationService _tokenValidationService;
            private readonly bool _validateIssuerSigningKey;

            public JwtBearerPostConfigureOptions(ITokenValidationService tokenValidationService, bool validateIssuerSigningKey)
            {
                _tokenValidationService = tokenValidationService;
                _validateIssuerSigningKey = validateIssuerSigningKey;
            }

            public void PostConfigure(string? name, JwtBearerOptions options)
            {
                // Get validation parameters from TokenValidationService
                // This ensures consistent validation logic (issuers, audiences, etc.) across the application
                var validationParameters = _tokenValidationService.GetTokenValidationParameters();
                
                // Copy validation parameters to JWT Bearer options
                // Note: We don't copy IssuerSigningKeys - let JWT Bearer middleware handle key fetching/refresh
                // via its own ConfigurationManager, which works well with MetadataAddress/Authority
                options.TokenValidationParameters.ValidateIssuer = validationParameters.ValidateIssuer;
                options.TokenValidationParameters.ValidIssuers = validationParameters.ValidIssuers;
                options.TokenValidationParameters.ValidateAudience = validationParameters.ValidateAudience;
                options.TokenValidationParameters.ValidAudiences = validationParameters.ValidAudiences;
                options.TokenValidationParameters.ValidateLifetime = validationParameters.ValidateLifetime;
                options.TokenValidationParameters.ValidateIssuerSigningKey = validationParameters.ValidateIssuerSigningKey;
                options.TokenValidationParameters.RequireSignedTokens = validationParameters.RequireSignedTokens;
                options.TokenValidationParameters.ClockSkew = validationParameters.ClockSkew;
                
                // Handle signature validator for cases where signing key validation is disabled
                if (!_validateIssuerSigningKey)
                {
                    options.TokenValidationParameters.SignatureValidator = (token, parameters) =>
                    {
                        var jwt = new JwtSecurityToken(token);
                        return jwt;
                    };
                }
            }
        }
    }
}

