using k8s;
using k8s.Models;
using KubeVisibility.Dashboard.Api.Models;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace KubeVisibility.Dashboard.Api.Services.Shared
{
    /// <summary>
    /// Base service containing shared helper methods for Kubernetes operations
    /// </summary>
    public class KubernetesBaseService
    {
        protected readonly IKubernetes KubernetesClient;
        protected readonly IConfiguration Configuration;
        protected readonly ILogger Logger;
        protected readonly IMemoryCache Cache;
        protected readonly List<string> Namespaces;
        protected readonly List<string> EnvironmentVariables;
        protected readonly int CacheDurationSeconds;

        public KubernetesBaseService(
            IKubernetesClientFactory kubernetesClientFactory,
            IConfiguration configuration,
            ILogger logger,
            IMemoryCache cache)
        {
            KubernetesClient = kubernetesClientFactory.CreateClient();
            Configuration = configuration;
            Logger = logger;
            Cache = cache;

            // Load configuration
            Namespaces = Configuration.GetSection("KubernetesInfo:Namespaces").Get<List<string>>() ?? new List<string>();
            EnvironmentVariables = Configuration.GetSection("KubernetesInfo:EnvironmentVariables").Get<List<string>>() ?? new List<string>();
            CacheDurationSeconds = Configuration.GetValue<int>("KubernetesInfo:CacheDurationSeconds", 30);
        }

        // Helper methods will be added here - these are shared across all services
        // Due to the large number of helper methods, they will be implemented in the individual services
        // that need them, or we can create extension methods if needed
    }
}

