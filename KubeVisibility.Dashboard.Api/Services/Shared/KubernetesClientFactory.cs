using k8s;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace KubeVisibility.Dashboard.Api.Services.Shared
{
    public class KubernetesClientFactory : IKubernetesClientFactory
    {
        private readonly IConfiguration _configuration;
        private readonly ILogger<KubernetesClientFactory> _logger;

        public KubernetesClientFactory(IConfiguration configuration, ILogger<KubernetesClientFactory> logger)
        {
            _configuration = configuration;
            _logger = logger;
        }

        public IKubernetes CreateClient()
        {
            try
            {
                // Try in-cluster config first (for production)
                try
                {
                    var config = KubernetesClientConfiguration.InClusterConfig();
                    var client = new Kubernetes(config);
                    _logger.LogInformation("Kubernetes client initialized with in-cluster configuration");
                    return client;
                }
                catch
                {
                    // If in-cluster fails, try kubeconfig file (for local development)
                    var kubeConfigPath = _configuration["KubernetesInfo:KubeConfigPath"];
                    
                    if (!string.IsNullOrEmpty(kubeConfigPath) && File.Exists(kubeConfigPath))
                    {
                        _logger.LogInformation($"Using kubeconfig file: {kubeConfigPath}");
                        var config = KubernetesClientConfiguration.BuildConfigFromConfigFile(kubeConfigPath);
                        var client = new Kubernetes(config);
                        _logger.LogInformation("Kubernetes client initialized with kubeconfig file");
                        return client;
                    }
                    else
                    {
                        // Fall back to default config
                        _logger.LogWarning("No kubeconfig file configured. Attempting to use default config.");
                        var config = KubernetesClientConfiguration.BuildDefaultConfig();
                        var client = new Kubernetes(config);
                        _logger.LogInformation("Kubernetes client initialized with default configuration");
                        return client;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to initialize Kubernetes client");
                throw;
            }
        }
    }
}

