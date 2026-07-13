using KubeVisibility.Dashboard.Api.Options;
using KubeVisibility.Dashboard.Api.Services;
using KubeVisibility.Dashboard.Api.Services.Shared;
using KubeVisibility.Dashboard.Api.Services.Kafka;
using KubeVisibility.Dashboard.Api.Extensions;
using KubeVisibility.Dashboard.Api.Authorization;
using KubeVisibility.Dashboard.Api.Filters;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.OpenApi;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

// Configure forwarded headers for reverse proxy/load balancer support
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    // Trust all proxies (for Kubernetes/Docker environments)
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});


var enablePIILogging = builder.Configuration.GetValue<bool>("Authentication:EnablePIILogging");
Microsoft.IdentityModel.Logging.IdentityModelEventSource.ShowPII = enablePIILogging;

builder.Services.AddControllers(options =>
{
    options.Filters.Add<AdminMutationAuditFilter>();
});

// Configure authentication using extension methods
// JWT Bearer for API access (Azure AD)
builder.Services.AddAuthenticationServices(builder.Configuration);

// Configure authorization policies
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy =>
    {
        policy.Requirements.Add(new AdminGroupRequirement());
    });
});

// Register authorization handlers
builder.Services.AddSingleton<IAuthorizationHandler, AdminGroupHandler>();

builder.Services.AddCors();
builder.Services.AddHttpContextAccessor();
builder.Services.Configure<AdminAuditOptions>(builder.Configuration.GetSection(AdminAuditOptions.SectionName));
builder.Services.Configure<TopicAlertingOptions>(builder.Configuration.GetSection(TopicAlertingOptions.SectionName));
builder.Services.Configure<KubernetesInfoOptions>(builder.Configuration.GetSection(KubernetesInfoOptions.SectionName));
builder.Services.AddSingleton<IAdminAuditService, ElasticAdminAuditService>();
builder.Services.AddScoped<ITopicAlertingService, ElasticTopicAlertingService>();
builder.Services.AddScoped<AdminMutationAuditFilter>();

// Add health checks
builder.Services.AddHealthChecks();

// Add memory cache for Kubernetes services
builder.Services.AddMemoryCache();

// Register HttpClientFactory for dependency injection (required for ArgoWorkflowsService)
builder.Services.AddHttpClient();

// Register named HttpClient for Elasticsearch with SSL validation disabled
builder.Services.AddHttpClient("Elasticsearch", client =>
{
    // Client configuration can be done here if needed
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true
});

// Register Kubernetes Client Factory
builder.Services.AddSingleton<IKubernetesClientFactory, KubernetesClientFactory>();

// Register Kubernetes Services
builder.Services.AddSingleton<IClusterService, ClusterService>();
builder.Services.AddSingleton<IPodService, PodService>();
builder.Services.AddSingleton<IResourceService, ResourceService>();
builder.Services.AddSingleton<IConsumerService, ConsumerService>();
builder.Services.AddSingleton<ICronWorkflowService, CronWorkflowService>();

// Register Health Monitoring Services
builder.Services.AddSingleton<IKubernetesMetricsService, KubernetesMetricsService>();
builder.Services.AddScoped<IHealthService, HealthService>();

// Register Argo Workflows Service
builder.Services.AddSingleton<IArgoWorkflowsService, ArgoWorkflowsService>();

// Register Kafka Services
builder.Services.AddSingleton<IKafkaClientFactory, KafkaClientFactory>();
builder.Services.AddScoped<IConsumerGroupOffsetCacheService, ConsumerGroupOffsetCacheService>();
builder.Services.AddSingleton<IKafkaService>(sp =>
{
    var clientFactory = sp.GetRequiredService<IKafkaClientFactory>();
    var configuration = sp.GetRequiredService<IConfiguration>();
    var logger = sp.GetRequiredService<ILogger<KafkaService>>();
    var httpContextAccessor = sp.GetRequiredService<IHttpContextAccessor>();
    var metricsService = sp.GetService<IKubernetesMetricsService>();
    var kubernetesClientFactory = sp.GetService<IKubernetesClientFactory>();
    return new KafkaService(clientFactory, configuration, logger, httpContextAccessor, metricsService, kubernetesClientFactory);
});

// Register Elasticsearch Service
builder.Services.AddSingleton<IElasticsearchService, ElasticsearchService>();

// Prometheus (node metrics)
builder.Services.Configure<PrometheusOptions>(builder.Configuration.GetSection(PrometheusOptions.SectionName));
builder.Services.AddHttpClient(PrometheusQueryService.HttpClientName, (sp, client) =>
{
    var opt = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<PrometheusOptions>>().Value;
    client.Timeout = TimeSpan.FromSeconds(opt.TimeoutSeconds > 0 ? opt.TimeoutSeconds : 10);
});
builder.Services.AddSingleton<IPrometheusQueryService, PrometheusQueryService>();
builder.Services.AddSingleton<INodeMetricsPrometheusService, NodeMetricsPrometheusService>();
builder.Services.Configure<PrometheusAlertingOptions>(builder.Configuration.GetSection(PrometheusAlertingOptions.SectionName));
builder.Services.AddScoped<IPrometheusAlertService, PrometheusAlertService>();

builder.Services.AddMvc();

builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "Kube Visibility Dashboard API", Version = "v1" });
    
    // Add JWT Bearer security definition
    options.AddSecurityDefinition("bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        Description = "JWT Authorization header using the Bearer scheme. Enter your token in the text input below."
    });
});
// Temporarily disabled due to .NET 10 compatibility issue
// builder.Services.AddOpenTelemetryLogging("KubeVisibility.Dashboard.Api");

var app = builder.Build();
// Apply forwarded headers middleware FIRST (before any other middleware)
app.UseForwardedHeaders();

app.UseHttpsRedirection();

app.UseRouting();

// CORS must be configured BEFORE Authentication/Authorization
if (app.Environment.IsDevelopment())
{
    app.UseCors(options =>
        options.WithOrigins(
            "http://localhost:4200",  // Angular dev server
            "https://localhost:4200", // HTTPS Angular dev server
            "http://localhost:5259",  // API (for Swagger)
            "https://localhost:5259"  // HTTPS API
        )
        .AllowAnyMethod()
        .AllowAnyHeader()
        .AllowCredentials() // Required for EventSource with withCredentials: true
        .WithExposedHeaders("*")); // Expose all headers for SSE
}

app.UseAuthentication();
app.UseAuthorization();


// Configure Swagger middleware - must be after routing but before MapControllers
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "Kube Visibility Dashboard API v1");
        options.RoutePrefix = "swagger";
    });
}

app.MapHealthChecks("/health");
app.MapControllers();

app.Run();
