using Confluent.Kafka;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace KubeVisibility.Dashboard.Api.Services.Kafka
{
    public class KafkaClientFactory : IKafkaClientFactory
    {
        private readonly IConfiguration _configuration;
        private readonly ILogger<KafkaClientFactory> _logger;
        private readonly string _bootstrapServers;
        private readonly ClientConfig _baseConfig;

        public KafkaClientFactory(IConfiguration configuration, ILogger<KafkaClientFactory> logger)
        {
            _configuration = configuration;
            _logger = logger;

            // Get bootstrap servers from environment variable first, then config
            _bootstrapServers = Environment.GetEnvironmentVariable("KAFKA_SERVERS") 
                ?? _configuration["Kafka:BootstrapServers"] 
                ?? throw new InvalidOperationException("Kafka bootstrap servers not configured. Set KAFKA_SERVERS environment variable or Kafka:BootstrapServers in configuration.");

            _logger.LogInformation($"Kafka bootstrap servers: {_bootstrapServers}");

            // Build base configuration
            _baseConfig = new ClientConfig
            {
                BootstrapServers = _bootstrapServers
            };

            // Configure SSL if enabled
            var sslEnabled = _configuration.GetValue<bool>("Kafka:Ssl:Enabled", true);
            if (sslEnabled)
            {
                var caCertPath = _configuration["Kafka:Ssl:CaCertificatePath"] ?? "/app/certs/kafka-ca.crt";
                
                if (File.Exists(caCertPath))
                {
                    _baseConfig.SecurityProtocol = SecurityProtocol.Ssl;
                    _baseConfig.SslCaLocation = caCertPath;
                    _logger.LogInformation($"Kafka SSL enabled with CA certificate at: {caCertPath}");
                }
                else
                {
                    _logger.LogWarning($"Kafka SSL enabled but CA certificate not found at: {caCertPath}. SSL will not be configured.");
                }
            }
            else
            {
                _logger.LogInformation("Kafka SSL is disabled");
            }
        }

        public IAdminClient CreateAdminClient()
        {
            try
            {
                var adminConfig = new AdminClientConfig(_baseConfig);
                var adminClient = new AdminClientBuilder(adminConfig).Build();
                _logger.LogDebug("Kafka AdminClient created successfully");
                return adminClient;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create Kafka AdminClient");
                throw;
            }
        }

        public IConsumer<string, string> CreateConsumer(string? groupId = null, bool optimizeForBulkRead = false)
        {
            try
            {
                var consumerConfig = new ConsumerConfig(_baseConfig)
                {
                    GroupId = groupId ?? $"kafka-dashboard-{Guid.NewGuid()}",
                    AutoOffsetReset = AutoOffsetReset.Earliest,
                    EnableAutoCommit = false,
                    EnablePartitionEof = true
                };

                // Apply bulk read optimizations for streaming search
                if (optimizeForBulkRead)
                {
                    // Fetch settings - optimize for throughput
                    consumerConfig.FetchMinBytes = _configuration.GetValue<int>("Kafka:Consumer:FetchMinBytes", 1024); // Wait for at least 1KB
                    consumerConfig.FetchMaxBytes = _configuration.GetValue<int>("Kafka:Consumer:FetchMaxBytes", 52428800); // 50MB max
                    consumerConfig.MaxPartitionFetchBytes = _configuration.GetValue<int>("Kafka:Consumer:MaxPartitionFetchBytes", 10485760); // 10MB per partition
                    consumerConfig.FetchWaitMaxMs = _configuration.GetValue<int>("Kafka:Consumer:FetchWaitMaxMs", 50); // Don't wait long if min bytes not met
                    
                    // Socket and receive buffer settings
                    consumerConfig.SocketReceiveBufferBytes = _configuration.GetValue<int>("Kafka:Consumer:SocketReceiveBufferBytes", 10485760); // 10MB socket buffer
                    consumerConfig.ReceiveMessageMaxBytes = _configuration.GetValue<int>("Kafka:Consumer:ReceiveMessageMaxBytes", 104857600); // 100MB max message
                    
                    // Disable auto offset storage for better performance
                    consumerConfig.EnableAutoOffsetStore = false;
                    
                    _logger.LogDebug($"Kafka Consumer created with BULK READ optimizations: FetchMinBytes={consumerConfig.FetchMinBytes}, MaxPartitionFetchBytes={consumerConfig.MaxPartitionFetchBytes}");
                }

                var consumer = new ConsumerBuilder<string, string>(consumerConfig).Build();
                _logger.LogDebug($"Kafka Consumer created successfully with GroupId: {consumerConfig.GroupId}");
                return consumer;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create Kafka Consumer");
                throw;
            }
        }

        public IProducer<string, string> CreateProducer()
        {
            try
            {
                var producerConfig = new ProducerConfig(_baseConfig)
                {
                    Acks = Acks.All,
                    EnableIdempotence = true
                };

                var producer = new ProducerBuilder<string, string>(producerConfig).Build();
                _logger.LogDebug("Kafka Producer created successfully");
                return producer;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create Kafka Producer");
                throw;
            }
        }
    }
}

