using System.Text;
using System.Text.Json;
using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services
{
    /// <summary>
    /// Service for interacting with Argo Workflows API.
    /// Follows Single Responsibility Principle (SRP) - handles only Argo Workflows API communication.
    /// Follows Dependency Inversion Principle (DIP) - depends on abstractions (IHttpClientFactory, IConfiguration).
    /// </summary>
    public class ArgoWorkflowsService : IArgoWorkflowsService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<ArgoWorkflowsService> _logger;
        private readonly string _argoWorkflowsBaseUrl;
        private readonly string? _bearerToken;
        private readonly string _serviceAccountTokenPath;

        public ArgoWorkflowsService(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            ILogger<ArgoWorkflowsService> logger)
        {
            _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
            _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));

            // Load Argo Workflows base URL from configuration
            _argoWorkflowsBaseUrl = _configuration["ArgoWorkflows:ApiBaseUrl"] 
                ?? throw new InvalidOperationException("ArgoWorkflows:ApiBaseUrl configuration is required");

            // Load Bearer token from configuration (for local development)
            _bearerToken = _configuration["ArgoWorkflows:BearerToken"];

            // Load service account token path (for Kubernetes deployment)
            _serviceAccountTokenPath = _configuration["ArgoWorkflows:ServiceAccountTokenPath"] 
                ?? "/var/run/secrets/kubernetes.io/serviceaccount/token";

            if (!string.IsNullOrWhiteSpace(_bearerToken))
            {
                _logger.LogInformation("Using Bearer token from configuration for Argo Workflows API");
            }
            else
            {
                _logger.LogInformation(
                    "No Bearer token in configuration. Will attempt to read from service account token path: {Path}",
                    _serviceAccountTokenPath);
            }
        }

        /// <summary>
        /// Loads the Bearer token for authentication.
        /// Priority: 1) Configuration token, 2) Service account token file
        /// </summary>
        /// <returns>Bearer token or null if not available</returns>
        private string? LoadBearerToken()
        {
            // Priority 1: Use token from configuration if available (for local development)
            if (!string.IsNullOrWhiteSpace(_bearerToken))
            {
                _logger.LogDebug("Using Bearer token from configuration");
                return _bearerToken;
            }

            // Priority 2: Read from Kubernetes service account token file
            try
            {
                if (File.Exists(_serviceAccountTokenPath))
                {
                    var token = File.ReadAllText(_serviceAccountTokenPath).Trim();
                    if (!string.IsNullOrWhiteSpace(token))
                    {
                        _logger.LogDebug("Successfully loaded Bearer token from service account path: {Path}", 
                            _serviceAccountTokenPath);
                        return token;
                    }
                    else
                    {
                        _logger.LogWarning("Service account token file exists but is empty: {Path}", 
                            _serviceAccountTokenPath);
                    }
                }
                else
                {
                    _logger.LogWarning("Service account token file not found: {Path}", _serviceAccountTokenPath);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to read service account token from: {Path}", _serviceAccountTokenPath);
            }

            return null;
        }

        /// <inheritdoc />
        public async Task<SubmitCronWorkflowResponse> SubmitCronWorkflowAsync(string namespaceName, string resourceName)
        {
            if (string.IsNullOrWhiteSpace(namespaceName))
            {
                throw new ArgumentException("Namespace name cannot be null or empty", nameof(namespaceName));
            }

            if (string.IsNullOrWhiteSpace(resourceName))
            {
                throw new ArgumentException("Resource name cannot be null or empty", nameof(resourceName));
            }

            try
            {
                _logger.LogInformation(
                    "Submitting CronWorkflow '{ResourceName}' in namespace '{Namespace}' via Argo Workflows API",
                    resourceName, namespaceName);

                // Load Bearer token
                var token = LoadBearerToken();
                if (string.IsNullOrWhiteSpace(token))
                {
                    _logger.LogError("No Bearer token available for Argo Workflows API authentication");
                    return new SubmitCronWorkflowResponse
                    {
                        Success = false,
                        Message = "Authentication failed: No Bearer token available"
                    };
                }

                // Create HTTP client
                var httpClient = _httpClientFactory.CreateClient();
                
                // Add Bearer token authentication
                httpClient.DefaultRequestHeaders.Authorization = 
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
                
                // Build the submit endpoint URL
                var submitUrl = $"{_argoWorkflowsBaseUrl}/api/v1/workflows/{namespaceName}/submit";
                
                // Create the payload matching Argo Workflows API specification
                var payload = new
                {
                    @namespace = namespaceName,
                    resourceKind = "cronwf",
                    resourceName = resourceName
                };
                
                // Serialize payload to JSON
                var jsonPayload = JsonSerializer.Serialize(payload, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                });
                
                var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");
                
                _logger.LogDebug(
                    "Sending POST request to {Url} with payload: {Payload}",
                    submitUrl, jsonPayload);

                // Send POST request to Argo Workflows API
                var response = await httpClient.PostAsync(submitUrl, content);
                var responseContent = await response.Content.ReadAsStringAsync();
                
                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation(
                        "Successfully submitted CronWorkflow '{ResourceName}' in namespace '{Namespace}'",
                        resourceName, namespaceName);
                    
                    // Parse response to extract workflow name if available
                    string? workflowName = null;
                    try
                    {
                        var responseJson = JsonSerializer.Deserialize<JsonElement>(responseContent);
                        if (responseJson.TryGetProperty("metadata", out var metadata) &&
                            metadata.TryGetProperty("name", out var name))
                        {
                            workflowName = name.GetString();
                            _logger.LogInformation("Created workflow: {WorkflowName}", workflowName);
                        }
                    }
                    catch (JsonException ex)
                    {
                        _logger.LogWarning(ex, "Failed to parse workflow name from response");
                        // Continue without workflow name
                    }
                    
                    return new SubmitCronWorkflowResponse
                    {
                        Success = true,
                        Message = $"CronWorkflow '{resourceName}' submitted successfully",
                        WorkflowName = workflowName
                    };
                }
                else
                {
                    _logger.LogError(
                        "Failed to submit CronWorkflow '{ResourceName}'. Status: {StatusCode}, Response: {Response}",
                        resourceName, response.StatusCode, responseContent);
                    
                    return new SubmitCronWorkflowResponse
                    {
                        Success = false,
                        Message = $"Failed to submit workflow: {response.StatusCode} - {responseContent}"
                    };
                }
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(
                    ex,
                    "HTTP request error while submitting CronWorkflow '{ResourceName}' in namespace '{Namespace}'",
                    resourceName, namespaceName);
                
                return new SubmitCronWorkflowResponse
                {
                    Success = false,
                    Message = $"HTTP request error: {ex.Message}"
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Unexpected error while submitting CronWorkflow '{ResourceName}' in namespace '{Namespace}'",
                    resourceName, namespaceName);
                
                return new SubmitCronWorkflowResponse
                {
                    Success = false,
                    Message = $"Error submitting workflow: {ex.Message}"
                };
            }
        }
    }
}

