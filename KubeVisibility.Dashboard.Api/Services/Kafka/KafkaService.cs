using KubeVisibility.Dashboard.Api.Models.Kafka;
using KubeVisibility.Dashboard.Api.Models.Health;
using Confluent.Kafka;
using Confluent.Kafka.Admin;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Http;
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Threading;
using System.Net.Http;
using System.Globalization;
using k8s;
using k8s.Models;
using KubeVisibility.Dashboard.Api.Services.Shared;

namespace KubeVisibility.Dashboard.Api.Services.Kafka
{
    public class KafkaService : IKafkaService
    {
        private readonly IKafkaClientFactory _clientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<KafkaService> _logger;
        private readonly IKubernetesMetricsService? _metricsService;
        private readonly IKubernetes? _kubernetesClient;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly int _maxMessagesPerSearch;
        private readonly int _defaultTimeoutSeconds;
        private readonly int _maxDaysBack;
        private readonly int _maxRangeDays;
        private readonly int _defaultRangeDays;

        public KafkaService(
            IKafkaClientFactory clientFactory,
            IConfiguration configuration,
            ILogger<KafkaService> logger,
            IHttpContextAccessor httpContextAccessor,
            IKubernetesMetricsService? metricsService = null,
            IKubernetesClientFactory? kubernetesClientFactory = null)
        {
            _clientFactory = clientFactory;
            _configuration = configuration;
            _logger = logger;
            _httpContextAccessor = httpContextAccessor ?? throw new ArgumentNullException(nameof(httpContextAccessor));
            _metricsService = metricsService;
            if (kubernetesClientFactory != null)
            {
                _kubernetesClient = kubernetesClientFactory.CreateClient();
            }
            _maxMessagesPerSearch = _configuration.GetValue<int>("Kafka:Consumer:MaxMessagesPerSearch", 1000);
            _defaultTimeoutSeconds = _configuration.GetValue<int>("Kafka:Consumer:DefaultTimeoutSeconds", 30);
            _maxDaysBack = _configuration.GetValue<int>("Kafka:Consumer:MaxDaysBack", 60);
            _maxRangeDays = _configuration.GetValue<int>("Kafka:Consumer:MaxRangeDays", 7);
            _defaultRangeDays = _configuration.GetValue<int>("Kafka:Consumer:DefaultRangeDays", 1);
        }

        public async Task<List<TopicInfo>> GetTopicsAsync()
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            
            try
            {
                // Wrap GetMetadata in a timeout to prevent hanging if brokers are down
                Metadata? metadata = null;
                try
                {
                    var metadataTask = Task.Run(() => adminClient.GetMetadata(TimeSpan.FromSeconds(_defaultTimeoutSeconds)));
                    metadata = await metadataTask.WaitAsync(TimeSpan.FromSeconds(_defaultTimeoutSeconds + 2));
                }
                catch (KafkaException ex)
                {
                    _logger.LogWarning(ex, "Kafka broker transport failure while retrieving topics. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (TimeoutException)
                {
                    _logger.LogWarning("GetMetadata timed out while retrieving topics. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to get metadata while retrieving topics. Kafka brokers may be down.");
                    metadata = null;
                }

                if (metadata == null || metadata.Topics == null)
                {
                    _logger.LogWarning("Metadata or topics is null");
                    return new List<TopicInfo>();
                }

                var topics = new List<TopicInfo>();

                foreach (var topic in metadata.Topics)
                {
                    if (topic.Topic == "__consumer_offsets" || topic.Topic.StartsWith("__"))
                        continue;

                    topics.Add(new TopicInfo
                    {
                        Name = topic.Topic,
                        PartitionCount = topic.Partitions.Count,
                        ReplicationFactor = topic.Partitions.Count > 0
                            ? (short)topic.Partitions[0].Replicas.Count()
                            : (short)0
                    });
                }

                _logger.LogInformation($"Retrieved {topics.Count} topics");
                return topics.OrderBy(t => t.Name).ToList();
            }
            catch (InvalidOperationException)
            {
                // Re-throw connection errors as-is
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving topics");
                throw;
            }
        }

        public async Task<TopicInfo?> GetTopicInfoAsync(string topicName)
        {
            using var adminClient = _clientFactory.CreateAdminClient();

            try
            {
                // Wrap GetMetadata in a timeout to prevent hanging if brokers are down
                Metadata? metadata = null;
                try
                {
                    var metadataTask = Task.Run(() => adminClient.GetMetadata(TimeSpan.FromSeconds(_defaultTimeoutSeconds)));
                    metadata = await metadataTask.WaitAsync(TimeSpan.FromSeconds(_defaultTimeoutSeconds + 2));
                }
                catch (KafkaException ex)
                {
                    _logger.LogWarning(ex, $"Kafka broker transport failure while retrieving topic info for {topicName}. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (TimeoutException)
                {
                    _logger.LogWarning($"GetMetadata timed out while retrieving topic info for {topicName}. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, $"Failed to get metadata while retrieving topic info for {topicName}. Kafka brokers may be down.");
                    metadata = null;
                }

                if (metadata == null || metadata.Topics == null)
                {
                    _logger.LogWarning($"Metadata or topics is null for topic {topicName}");
                    return null;
                }

                var topic = metadata.Topics.FirstOrDefault(t => t.Topic == topicName);

                if (topic == null)
                {
                    _logger.LogWarning($"Topic not found: {topicName}");
                    return null;
                }

                var topicInfo = new TopicInfo
                {
                    Name = topic.Topic,
                    PartitionCount = topic.Partitions.Count,
                    ReplicationFactor = topic.Partitions.Count > 0
                        ? (short)topic.Partitions[0].Replicas.Count()
                        : (short)0
                };

                // Get topic configs
                try
                {
                    var configResource = new ConfigResource
                    {
                        Type = ResourceType.Topic,
                        Name = topicName
                    };

                    var describeResult = await adminClient.DescribeConfigsAsync(
                        new[] { configResource },
                        new DescribeConfigsOptions { RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds) }
                    );

                    var result = describeResult.FirstOrDefault(r => r.ConfigResource.Name == topicName && r.ConfigResource.Type == ResourceType.Topic);
                    if (result != null)
                    {
                        // Access config entries - the API structure may vary by version
                        var entries = result.Entries;
                        if (entries != null)
                        {
                            foreach (var entry in entries)
                            {
                                topicInfo.Configs[entry.Key] = entry.Value?.Value ?? string.Empty;
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, $"Failed to retrieve configs for topic {topicName}");
                }

                return topicInfo;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving topic info for {topicName}");
                throw;
            }
        }

        public async Task<MessageSearchResponse> SearchMessagesAsync(MessageSearchRequest request)
        {
            // Validate time range
            if (request.TimeRange != null)
            {
                var now = DateTime.UtcNow;
                var requestedMaxRangeDays = request.TimeRange.MaxRangeDays;
                
                // Use configured maxRangeDays, but don't allow request to exceed it
                var effectiveMaxRangeDays = Math.Min(requestedMaxRangeDays, _maxRangeDays);

                if (request.TimeRange.StartTime > now || request.TimeRange.EndTime > now)
                {
                    throw new ArgumentException("Time range cannot be in the future");
                }

                if ((now - request.TimeRange.StartTime).TotalDays > _maxDaysBack)
                {
                    throw new ArgumentException($"Time range cannot go back more than {_maxDaysBack} days");
                }

                if ((request.TimeRange.EndTime - request.TimeRange.StartTime).TotalDays > effectiveMaxRangeDays)
                {
                    throw new ArgumentException($"Time range cannot exceed {effectiveMaxRangeDays} days");
                }

                if (request.TimeRange.StartTime >= request.TimeRange.EndTime)
                {
                    throw new ArgumentException("Start time must be before end time");
                }
            }

            var timeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds);
            var messages = new ConcurrentBag<KafkaMessage>();
            var messageCount = 0;
            var maxMessages = request.PageSize + 1; // Get one extra to determine if there are more results
            var maxDegreeOfParallelism = _configuration.GetValue<int>("Kafka:Consumer:MaxDegreeOfParallelism", 5);
            
            // Decode continuation token if present
            SearchCursor? startCursor = null;
            if (!string.IsNullOrEmpty(request.ContinuationToken))
            {
                startCursor = SearchCursor.Decode(request.ContinuationToken);
                if (startCursor == null)
                {
                    throw new ArgumentException("Invalid continuation token");
                }
            }

            try
            {
                // Get topic metadata
                using var adminClient = _clientFactory.CreateAdminClient();
                var metadata = adminClient.GetMetadata(request.Topic, timeout);
                var topicMetadata = metadata.Topics.FirstOrDefault(t => t.Topic == request.Topic);

                if (topicMetadata == null)
                {
                    throw new ArgumentException($"Topic not found: {request.Topic}");
                }

                var partitionsToSearch = request.Partition.HasValue
                    ? new[] { request.Partition.Value }
                    : topicMetadata.Partitions.Select(p => p.PartitionId).ToArray();

                // Parallel partition processing with early termination
                var parallelOptions = new ParallelOptions
                {
                    MaxDegreeOfParallelism = maxDegreeOfParallelism
                };

                var partitionPositions = new ConcurrentDictionary<int, long>();

                await Parallel.ForEachAsync(partitionsToSearch, parallelOptions, async (partitionId, cancellationToken) =>
                {
                    // Early termination if we have enough messages
                    if (Interlocked.CompareExchange(ref messageCount, 0, 0) >= maxMessages)
                        return;

                    try
                    {
                        using var consumer = _clientFactory.CreateConsumer();
                        var partition = new TopicPartition(request.Topic, partitionId);
                        
                        // Get partition offsets first
                        var watermarkOffsets = consumer.QueryWatermarkOffsets(partition, timeout);
                        var lowOffset = watermarkOffsets.Low;
                        var highOffset = watermarkOffsets.High;

                        if (lowOffset == highOffset)
                            return;

                        // Determine start offset
                        long startOffset = lowOffset;
                        
                        // Use cursor position if available
                        if (startCursor != null)
                        {
                            var cursorPosition = startCursor.Positions.FirstOrDefault(p => p.Partition == partitionId);
                            if (cursorPosition != null)
                            {
                                startOffset = cursorPosition.Offset + 1; // Start from next message after cursor
                            }
                        }
                        else if (request.TimeRange != null)
                        {
                            // If time range is specified, find offset by timestamp
                            startOffset = await FindOffsetByTimestampAsync(consumer, partition, request.TimeRange.StartTime, lowOffset, highOffset, timeout);
                        }

                        if (startOffset >= highOffset)
                            return;

                        // Assign the partition AFTER determining the offset
                        consumer.Assign(new[] { new TopicPartitionOffset(partition, startOffset) });

                        var endTime = request.TimeRange?.EndTime ?? DateTime.UtcNow.AddDays(1);
                        long lastReadOffset = startOffset - 1;

                        while (Interlocked.CompareExchange(ref messageCount, 0, 0) < maxMessages)
                        {
                            var result = consumer.Consume(timeout);
                            
                            if (result == null || result.IsPartitionEOF)
                                break;

                            lastReadOffset = result.Offset;

                            // Check time range
                            if (request.TimeRange != null && result.Message.Timestamp.UtcDateTime > endTime)
                                break;

                            // Apply filters
                            if (MatchesFilters(result.Message, request))
                            {
                                var kafkaMessage = BuildProjectedMessage(result, request.Projection);
                                messages.Add(kafkaMessage);
                                Interlocked.Increment(ref messageCount);
                            }

                            // Stop if we've read past the end time
                            if (request.TimeRange != null && result.Message.Timestamp.UtcDateTime > endTime)
                                break;
                        }

                        // Track last read position for this partition
                        partitionPositions[partitionId] = lastReadOffset;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, $"Error searching partition {partitionId} of topic {request.Topic}");
                    }
                });

                // Sort and paginate messages
                var sortedMessages = messages.OrderBy(m => m.Timestamp).ThenBy(m => m.Partition).ThenBy(m => m.Offset).ToList();
                
                // Check if there are more messages
                var hasMore = sortedMessages.Count > request.PageSize;
                
                // Take only the requested page size
                var paginatedMessages = sortedMessages.Take(request.PageSize).ToList();
                
                // Create continuation token for next page
                string? continuationToken = null;
                if (hasMore && paginatedMessages.Count > 0)
                {
                    var lastMessage = paginatedMessages.Last();
                    var cursor = new SearchCursor
                    {
                        LastTimestamp = lastMessage.Timestamp,
                        Positions = partitionPositions.Select(kvp => new SearchPosition 
                        { 
                            Partition = kvp.Key, 
                            Offset = kvp.Value 
                        }).ToList()
                    };
                    continuationToken = cursor.Encode();
                }

                return new MessageSearchResponse
                {
                    Messages = paginatedMessages,
                    TotalCount = paginatedMessages.Count,
                    HasMore = hasMore,
                    PageNumber = request.PageNumber, // Kept for backward compatibility
                    PageSize = request.PageSize,
                    ContinuationToken = continuationToken,
                    PreviousToken = request.ContinuationToken
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error searching messages in topic {request.Topic}");
                throw;
            }
        }

        public async Task<KafkaMessage?> GetMessageByOffsetAsync(string topic, int partition, long offset)
        {
            var timeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds);

            try
            {
                using var consumer = _clientFactory.CreateConsumer();
                var topicPartition = new TopicPartition(topic, partition);

                // Get watermark offsets to validate the requested offset
                var watermarkOffsets = consumer.QueryWatermarkOffsets(topicPartition, timeout);

                if (offset < watermarkOffsets.Low || offset >= watermarkOffsets.High)
                {
                    _logger.LogWarning($"Offset {offset} is out of range for topic {topic}, partition {partition}. Valid range: [{watermarkOffsets.Low}, {watermarkOffsets.High})");
                    return null;
                }

                // Assign to the specific partition at the specific offset
                consumer.Assign(new[] { new TopicPartitionOffset(topicPartition, offset) });

                // Consume the message
                var result = consumer.Consume(timeout);

                if (result == null || result.IsPartitionEOF)
                {
                    _logger.LogWarning($"Message not found at offset {offset} for topic {topic}, partition {partition}");
                    return null;
                }

                // Verify we got the correct offset
                if (result.Offset != offset)
                {
                    _logger.LogWarning($"Retrieved message at offset {result.Offset} instead of requested offset {offset}");
                    return null;
                }

                // Build the Kafka message
                var kafkaMessage = new KafkaMessage
                {
                    Key = result.Message.Key,
                    Value = result.Message.Value,
                    Partition = result.Partition,
                    Offset = result.Offset,
                    Timestamp = result.Message.Timestamp.UtcDateTime,
                    TimestampType = result.Message.Timestamp.Type.ToString(),
                    Headers = result.Message.Headers?.ToDictionary(
                        h => h.Key,
                        h => System.Text.Encoding.UTF8.GetString(h.GetValueBytes())
                    ) ?? new Dictionary<string, string>()
                };

                _logger.LogInformation($"Successfully retrieved message from topic {topic}, partition {partition}, offset {offset}");
                return kafkaMessage;
            }
            catch (ConsumeException ex)
            {
                _logger.LogError(ex, $"Kafka consume error while fetching message from topic {topic}, partition {partition}, offset {offset}");
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving message from topic {topic}, partition {partition}, offset {offset}");
                throw;
            }
        }

        public async Task<int> GetMessageCountAsync(MessageSearchRequest request)
        {
            var timeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds);
            var totalCount = 0;
            var maxDegreeOfParallelism = _configuration.GetValue<int>("Kafka:Consumer:MaxDegreeOfParallelism", 5);
            
            try
            {
                // Get topic metadata
                using var adminClient = _clientFactory.CreateAdminClient();
                var metadata = adminClient.GetMetadata(request.Topic, timeout);
                var topicMetadata = metadata.Topics.FirstOrDefault(t => t.Topic == request.Topic);

                if (topicMetadata == null)
                {
                    throw new ArgumentException($"Topic not found: {request.Topic}");
                }

                var partitionsToSearch = request.Partition.HasValue
                    ? new[] { request.Partition.Value }
                    : topicMetadata.Partitions.Select(p => p.PartitionId).ToArray();

                // Parallel partition counting
                var parallelOptions = new ParallelOptions
                {
                    MaxDegreeOfParallelism = maxDegreeOfParallelism
                };

                var partitionCounts = new ConcurrentBag<int>();

                await Parallel.ForEachAsync(partitionsToSearch, parallelOptions, async (partitionId, cancellationToken) =>
                {
                    try
                    {
                        using var consumer = _clientFactory.CreateConsumer();
                        var partition = new TopicPartition(request.Topic, partitionId);
                        
                        var watermarkOffsets = consumer.QueryWatermarkOffsets(partition, timeout);
                        var lowOffset = watermarkOffsets.Low;
                        var highOffset = watermarkOffsets.High;

                        if (lowOffset == highOffset)
                            return;

                        // Determine start offset based on time range
                        long startOffset = lowOffset;
                        if (request.TimeRange != null)
                        {
                            startOffset = await FindOffsetByTimestampAsync(consumer, partition, request.TimeRange.StartTime, lowOffset, highOffset, timeout);
                        }

                        if (startOffset >= highOffset)
                            return;

                        consumer.Assign(new[] { new TopicPartitionOffset(partition, startOffset) });

                        var endTime = request.TimeRange?.EndTime ?? DateTime.UtcNow.AddDays(1);
                        int partitionCount = 0;

                        // Count messages without storing them
                        while (true)
                        {
                            var consumeResult = consumer.Consume(timeout);
                            
                            if (consumeResult == null || consumeResult.IsPartitionEOF)
                                break;

                            var messageTime = consumeResult.Message.Timestamp.UtcDateTime;
                            
                            // Check if we've passed the end time
                            if (messageTime > endTime)
                                break;

                            // Check if message matches filters
                            if (MatchesFilters(consumeResult.Message, request))
                            {
                                partitionCount++;
                            }

                            // Stop if we've reached the end of the partition
                            if (consumeResult.Offset >= highOffset - 1)
                                break;
                        }

                        partitionCounts.Add(partitionCount);
                        consumer.Close();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, $"Error counting partition {partitionId} of topic {request.Topic}");
                    }
                });

                totalCount = partitionCounts.Sum();
                return totalCount;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error counting messages for topic {request.Topic}");
                throw;
            }
        }

        // Thread-safe state holder for streaming search - follows Single Responsibility Principle
        private class StreamSearchState
        {
            private long _totalMessagesFound = 0;
            private long _totalBytes = 0;
            private int _partitionsScanned = 0;
            private long _totalMessagesProcessed = 0;

            public long TotalMessagesFound => _totalMessagesFound;
            public long TotalBytes => _totalBytes;
            public int PartitionsScanned => _partitionsScanned;
            public long TotalMessagesProcessed => _totalMessagesProcessed;

            public void AddMessageBytes(long bytes)
            {
                Interlocked.Add(ref _totalBytes, bytes);
            }

            public void IncrementMessageCount()
            {
                Interlocked.Increment(ref _totalMessagesFound);
            }

            public void IncrementPartitionsScanned()
            {
                Interlocked.Increment(ref _partitionsScanned);
            }

            public void IncrementMessagesProcessed()
            {
                Interlocked.Increment(ref _totalMessagesProcessed);
            }
        }

        public async Task SearchMessagesStreamAsync(
            MessageSearchRequest request, 
            IProgressReporter progressReporter,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrEmpty(request.Topic))
            {
                throw new ArgumentException("Topic is required");
            }

            var timeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds);
            var state = new StreamSearchState();
            var maxDegreeOfParallelism = _configuration.GetValue<int>("Kafka:Consumer:MaxDegreeOfParallelism", 5);
            var batchSize = _configuration.GetValue<int>("Kafka:Consumer:StreamBatchSize", 50);
            var progressReportInterval = TimeSpan.FromMilliseconds(_configuration.GetValue<int>("Kafka:Consumer:ProgressReportIntervalMs", 400));
            var consumeTimeout = TimeSpan.FromMilliseconds(_configuration.GetValue<int>("Kafka:Consumer:ConsumeTimeoutMs", 500));

            try
            {
                // Get topic metadata
                _logger.LogInformation($"Fetching metadata for topic: {request.Topic}");
                using var adminClient = _clientFactory.CreateAdminClient();
                var metadata = adminClient.GetMetadata(request.Topic, timeout);
                var topicMetadata = metadata.Topics.FirstOrDefault(t => t.Topic == request.Topic);

                if (topicMetadata == null)
                {
                    _logger.LogWarning($"Topic not found: {request.Topic}");
                    await progressReporter.ReportProgressAsync(new SearchProgress
                    {
                        Status = "error",
                        Error = $"Topic not found: {request.Topic}"
                    });
                    return;
                }

                var partitionsToSearch = request.Partition.HasValue
                    ? new[] { request.Partition.Value }
                    : topicMetadata.Partitions.Select(p => p.PartitionId).ToArray();

                var totalPartitions = partitionsToSearch.Length;
                _logger.LogInformation($"Starting streaming search for topic {request.Topic} with {totalPartitions} partition(s), key filter: {request.Key}");

                // Send initial progress with total partition count
                await progressReporter.ReportProgressAsync(new SearchProgress
                {
                    Status = "searching",
                    PartitionsScanned = 0,
                    TotalPartitions = totalPartitions,
                    TotalMessagesFound = 0,
                    TotalBytes = 0
                });

                // Process partitions in parallel with progress reporting
                await Parallel.ForEachAsync(
                    partitionsToSearch,
                    new ParallelOptions
                    {
                        MaxDegreeOfParallelism = maxDegreeOfParallelism,
                        CancellationToken = cancellationToken
                    },
                    async (partitionId, ct) =>
                    {
                        await ProcessPartitionWithProgressAsync(
                            request,
                            partitionId,
                            progressReporter,
                            state,
                            batchSize,
                            timeout,
                            totalPartitions,
                            progressReportInterval,
                            consumeTimeout,
                            ct);
                    });

                // Send completion notification
                await progressReporter.ReportProgressAsync(new SearchProgress
                {
                    Status = "complete",
                    PartitionsScanned = state.PartitionsScanned,
                    TotalPartitions = totalPartitions,
                    TotalMessagesFound = state.TotalMessagesFound,
                    TotalBytes = state.TotalBytes
                });
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation($"Search stream cancelled for topic {request.Topic}");
                await progressReporter.ReportProgressAsync(new SearchProgress
                {
                    Status = "error",
                    Error = "Search cancelled by user",
                    PartitionsScanned = state.PartitionsScanned,
                    TotalMessagesFound = state.TotalMessagesFound
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error in streaming search for topic {request.Topic}");
                await progressReporter.ReportProgressAsync(new SearchProgress
                {
                    Status = "error",
                    Error = ex.Message,
                    PartitionsScanned = state.PartitionsScanned,
                    TotalMessagesFound = state.TotalMessagesFound
                });
            }
        }

        private async Task ProcessPartitionWithProgressAsync(
            MessageSearchRequest request,
            int partitionId,
            IProgressReporter progressReporter,
            StreamSearchState state,
            int batchSize, // Keep for backward compatibility but not used
            TimeSpan timeout,
            int totalPartitions,
            TimeSpan progressReportInterval,
            TimeSpan consumeTimeout,
            CancellationToken cancellationToken)
        {
            try
            {
                // No batching - send messages immediately as found
                // Use optimized consumer for bulk reads
                using var consumer = _clientFactory.CreateConsumer(optimizeForBulkRead: true);
                var partition = new TopicPartition(request.Topic, partitionId);
                
                // Time-based progress tracking
                var lastProgressReport = DateTime.UtcNow;

                var watermarkOffsets = consumer.QueryWatermarkOffsets(partition, timeout);
                var lowOffset = watermarkOffsets.Low;
                var highOffset = watermarkOffsets.High;

                if (lowOffset == highOffset)
                {
                    state.IncrementPartitionsScanned();
                    await progressReporter.ReportProgressAsync(new SearchProgress
                    {
                        Status = "searching",
                        PartitionId = partitionId,
                        PartitionsScanned = state.PartitionsScanned,
                        TotalPartitions = totalPartitions,
                        TotalMessagesFound = state.TotalMessagesFound,
                        TotalBytes = state.TotalBytes
                    });
                    return;
                }

                // Determine start offset
                long startOffset = lowOffset;
                if (request.TimeRange != null)
                {
                    startOffset = await FindOffsetByTimestampAsync(
                        consumer, 
                        partition, 
                        request.TimeRange.StartTime, 
                        lowOffset, 
                        highOffset, 
                        timeout);
                }

                if (startOffset >= highOffset)
                {
                    state.IncrementPartitionsScanned();
                    await progressReporter.ReportProgressAsync(new SearchProgress
                    {
                        Status = "searching",
                        PartitionId = partitionId,
                        PartitionsScanned = state.PartitionsScanned,
                        TotalPartitions = totalPartitions,
                        TotalMessagesFound = state.TotalMessagesFound,
                        TotalBytes = state.TotalBytes
                    });
                    return;
                }

                consumer.Assign(new[] { new TopicPartitionOffset(partition, startOffset) });
                var endTime = request.TimeRange?.EndTime ?? DateTime.UtcNow.AddDays(1);

                while (!cancellationToken.IsCancellationRequested)
                {
                    var result = consumer.Consume(consumeTimeout);

                    if (result != null && !result.IsPartitionEOF)
                    {
                        // Track ALL messages processed and their bytes (not just matches)
                        state.IncrementMessagesProcessed();
                        var messageBytes = (result.Message.Value?.Length ?? 0) + (result.Message.Key?.Length ?? 0);
                        state.AddMessageBytes(messageBytes);

                        // Check time range
                        if (result.Message.Timestamp.UtcDateTime > endTime)
                            break;

                        if (request.TimeRange != null && result.Message.Timestamp.UtcDateTime < request.TimeRange.StartTime)
                        {
                            // Still check for time-based progress even if skipping message
                            var skipCheckTime = DateTime.UtcNow - lastProgressReport;
                            if (skipCheckTime >= progressReportInterval)
                            {
                                await progressReporter.ReportProgressAsync(new SearchProgress
                                {
                                    Status = "searching",
                                    Messages = new List<KafkaMessage>(),
                                    PartitionId = partitionId,
                                    PartitionsScanned = state.PartitionsScanned,
                                    TotalPartitions = totalPartitions,
                                    TotalMessagesFound = state.TotalMessagesFound,
                                    TotalBytes = state.TotalBytes
                                });
                                lastProgressReport = DateTime.UtcNow;
                            }
                            continue;
                        }

                        // Apply filters
                        if (MatchesFilters(result.Message, request))
                        {
                            var kafkaMessage = BuildProjectedMessage(result, request.Projection);
                            state.IncrementMessageCount();

                            // Send message immediately (no batching for real-time display)
                            await progressReporter.ReportProgressAsync(new SearchProgress
                            {
                                Status = "searching",
                                Messages = new List<KafkaMessage> { kafkaMessage }, // Single message
                                PartitionId = partitionId,
                                PartitionsScanned = state.PartitionsScanned,
                                TotalPartitions = totalPartitions,
                                TotalMessagesFound = state.TotalMessagesFound,
                                TotalBytes = state.TotalBytes
                            });
                            lastProgressReport = DateTime.UtcNow; // Reset timer

                            // Optional: limit total messages (can be configured)
                            var maxMessages = request.PageSize > 0 ? request.PageSize * 10 : int.MaxValue;
                            if (state.TotalMessagesFound >= maxMessages)
                                break;
                        }
                    }
                    else if (result != null && result.IsPartitionEOF)
                    {
                        // Reached end of partition
                        break;
                    }
                    
                    // Time-based progress update (every 400ms) - runs even when no messages or timeout
                    var timeSinceLastReport = DateTime.UtcNow - lastProgressReport;
                    if (timeSinceLastReport >= progressReportInterval)
                    {
                        // Send progress update (no messages, just stats)
                        await progressReporter.ReportProgressAsync(new SearchProgress
                        {
                            Status = "searching",
                            Messages = new List<KafkaMessage>(), // No messages in time-based updates
                            PartitionId = partitionId,
                            PartitionsScanned = state.PartitionsScanned,
                            TotalPartitions = totalPartitions,
                            TotalMessagesFound = state.TotalMessagesFound,
                            TotalBytes = state.TotalBytes
                        });
                        
                        lastProgressReport = DateTime.UtcNow;
                    }
                }

                // Mark partition as complete (no remaining messages to send - sent immediately)
                state.IncrementPartitionsScanned();
                await progressReporter.ReportProgressAsync(new SearchProgress
                {
                    Status = "searching",
                    PartitionId = partitionId,
                    PartitionsScanned = state.PartitionsScanned,
                    TotalPartitions = totalPartitions,
                    TotalMessagesFound = state.TotalMessagesFound,
                    TotalBytes = state.TotalBytes
                });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Error processing partition {partitionId} of topic {request.Topic}");
                await progressReporter.ReportProgressAsync(new SearchProgress
                {
                    Status = "error",
                    PartitionId = partitionId,
                    Error = $"Partition {partitionId}: {ex.Message}",
                    PartitionsScanned = state.PartitionsScanned,
                    TotalPartitions = totalPartitions,
                    TotalMessagesFound = state.TotalMessagesFound,
                    TotalBytes = state.TotalBytes
                });
            }
        }

        public async Task<RequeueResponse> RequeueMessagesAsync(RequeueRequest request)
        {
            var response = new RequeueResponse();
            using var consumer = _clientFactory.CreateConsumer();
            using var producer = _clientFactory.CreateProducer();

            try
            {
                foreach (var messageRef in request.Messages)
                {
                    try
                    {
                        var partition = new TopicPartition(request.SourceTopic, messageRef.Partition);
                        var topicPartitionOffset = new TopicPartitionOffset(partition, messageRef.Offset);
                        consumer.Assign(new[] { topicPartitionOffset });

                        var result = consumer.Consume(TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                        if (result == null || result.IsPartitionEOF)
                        {
                            response.FailedCount++;
                            response.Errors.Add($"Message not found at partition {messageRef.Partition}, offset {messageRef.Offset}");
                            continue;
                        }

                        // Build message headers
                        var headers = new Headers();
                        if (request.PreserveHeaders && result.Message.Headers != null)
                        {
                            foreach (var header in result.Message.Headers)
                            {
                                headers.Add(header.Key, header.GetValueBytes());
                            }
                        }

                        // Add requeue metadata if requested
                        if (request.AddRequeueMetadata)
                        {
                            headers.Add("x-requeue-timestamp", System.Text.Encoding.UTF8.GetBytes(DateTime.UtcNow.ToString("O")));
                            headers.Add("x-original-topic", System.Text.Encoding.UTF8.GetBytes(request.SourceTopic));
                            headers.Add("x-original-partition", System.Text.Encoding.UTF8.GetBytes(messageRef.Partition.ToString()));
                            headers.Add("x-original-offset", System.Text.Encoding.UTF8.GetBytes(messageRef.Offset.ToString()));
                        }

                        // Produce to target topic
                        var targetPartition = new TopicPartition(request.TargetTopic, Partition.Any);
                        var deliveryResult = await producer.ProduceAsync(targetPartition, new Message<string, string>
                        {
                            Key = result.Message.Key,
                            Value = result.Message.Value,
                            Headers = headers
                        });

                        response.RequeuedCount++;
                        _logger.LogInformation($"Requeued message from {request.SourceTopic}[{messageRef.Partition}:{messageRef.Offset}] to {request.TargetTopic}[{deliveryResult.Partition}:{deliveryResult.Offset}]");
                    }
                    catch (Exception ex)
                    {
                        response.FailedCount++;
                        response.Errors.Add($"Error requeuing message at partition {messageRef.Partition}, offset {messageRef.Offset}: {ex.Message}");
                        _logger.LogError(ex, $"Error requeuing message at partition {messageRef.Partition}, offset {messageRef.Offset}");
                    }
                }

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during requeue operation");
                throw;
            }
        }

        public async Task<ConsumerGroupResponse> GetConsumerGroupsAsync(string? topicName = null)
        {
            try
            {
                var groups = await FetchConsumerGroupOffsetsSnapshotAsync(topicName);

                return new ConsumerGroupResponse
                {
                    Groups = groups,
                    Topic = topicName
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving consumer groups");
                throw;
            }
        }

        public async Task<ConsumerGroupTopicAssociationsResponse> GetConsumerGroupTopicAssociationsAsync(string? topicName = null)
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            try
            {
                // Get cached consumer group offsets to check for inactive groups
                ConsumerGroupOffsetCache? offsetCache = null;
                try
                {
                    var offsetCacheService = _httpContextAccessor.HttpContext?.RequestServices
                        .GetRequiredService<IConsumerGroupOffsetCacheService>();
                    
                    if (offsetCacheService != null)
                    {
                        if (topicName != null)
                        {
                            offsetCache = await offsetCacheService.GetOrFetchConsumerGroupOffsetsForTopicAsync(topicName);
                        }
                        else
                        {
                            offsetCache = await offsetCacheService.GetOrFetchAllConsumerGroupOffsetsAsync();
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to fetch consumer group offsets for checking inactive groups, continuing without inactive group detection");
                }

                var snapshot = await FetchConsumerGroupOffsetsSnapshotAsync(topicName);
                
                if (snapshot.Count == 0)
                {
                    return new ConsumerGroupTopicAssociationsResponse
                    {
                        Associations = new List<ConsumerGroupTopicAssociation>(),
                        Topic = topicName
                    };
                }

                // Get unique group IDs
                var groupIds = snapshot
                    .Select(g => g.GroupId)
                    .Distinct()
                    .ToList();

                // Get consumer group descriptions to check active consumption status
                var describeResult = await adminClient.DescribeConsumerGroupsAsync(
                    groupIds,
                    new DescribeConsumerGroupsOptions
                    {
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                    }
                );

                // Group snapshot by GroupId and Topic
                var groupedSnapshot = snapshot
                    .GroupBy(g => new { g.GroupId, g.Topic })
                    .ToList();

                var associations = new List<ConsumerGroupTopicAssociation>();
                var topicsWithInactiveGroups = new HashSet<string>(); // Track topics with inactive groups

                // Process each group-topic combination
                foreach (var grouping in groupedSnapshot)
                {
                    var groupId = grouping.Key.GroupId;
                    var topic = grouping.Key.Topic;
                    
                    var groupDescription = describeResult.ConsumerGroupDescriptions
                        .FirstOrDefault(d => d.GroupId == groupId);

                    int activeConsumerCount = 0;
                    string state = "UNKNOWN";
                    bool isConsumingFromTopic = false;

                    if (groupDescription != null)
                    {
                        activeConsumerCount = groupDescription.Members?.Count ?? 0;
                        state = groupDescription.State.ToString();

                        // Check if any member is assigned to partitions from this topic
                        // This is the most accurate way to determine if the group is consuming from this topic
                        if (groupDescription.Members != null && activeConsumerCount > 0)
                        {
                            isConsumingFromTopic = groupDescription.Members
                                .Any(member => member.Assignment != null && 
                                              member.Assignment.TopicPartitions != null &&
                                              member.Assignment.TopicPartitions.Any(tp => tp.Topic.Equals(topic, StringComparison.OrdinalIgnoreCase)));
                        }
                    }

                    // Only include consumer groups that are actively consuming from this topic
                    // Check if members are actually assigned to partitions from this topic
                    bool isActivelyConsuming = activeConsumerCount > 0 && 
                                               state.Equals("Stable", StringComparison.OrdinalIgnoreCase) &&
                                               isConsumingFromTopic;

                    if (isActivelyConsuming)
                    {
                        associations.Add(new ConsumerGroupTopicAssociation
                        {
                            GroupId = groupId,
                            Topic = topic,
                            TotalLag = grouping.Sum(p => p.Lag),
                            HasActiveConsumers = true,
                            Partitions = grouping
                                .OrderBy(p => p.Partition)
                                .Select(p => new ConsumerGroupPartitionAssociation
                                {
                                    Partition = p.Partition,
                                    CurrentOffset = p.CurrentOffset,
                                    LogEndOffset = p.LogEndOffset,
                                    Lag = p.Lag
                                })
                                .ToList()
                        });
                    }
                    else
                    {
                        // Check if this group has offsets for this topic (inactive but has consumed before)
                        // Use the cache service logic: check if there are partitions with offset > 0
                        if (offsetCache != null)
                        {
                            var groupOffsetInfo = offsetCache.ConsumerGroups
                                .FirstOrDefault(g => g.GroupId == groupId);
                            
                            if (groupOffsetInfo != null)
                            {
                                var topicOffsetInfo = groupOffsetInfo.Topics
                                    .FirstOrDefault(t => t.TopicName.Equals(topic, StringComparison.OrdinalIgnoreCase));
                                
                                if (topicOffsetInfo != null)
                                {
                                    // Check if any partition has offset > 0 (using the cache service logic)
                                    int count = 0;
                                    foreach (var partition in topicOffsetInfo.Partitions)
                                    {
                                        if (partition.LastCommittedOffset > 0)
                                        {
                                            count++;
                                        }
                                    }
                                    
                                    if (count > 0)
                                    {
                                        // This topic has inactive consumers (has offsets but no active consumers)
                                        topicsWithInactiveGroups.Add(topic);
                                    }
                                }
                            }
                        }
                    }
                }

                // For topics with no active consumers but with inactive groups, add a marker association
                // This helps the frontend distinguish between "no lag" and "not active"
                var topicsWithActiveConsumers = new HashSet<string>(associations.Select(a => a.Topic));
                foreach (var topic in topicsWithInactiveGroups)
                {
                    if (!topicsWithActiveConsumers.Contains(topic))
                    {
                        // Add a marker to indicate this topic has consumer groups but no active consumers
                        associations.Add(new ConsumerGroupTopicAssociation
                        {
                            GroupId = "", // Empty to indicate this is a marker
                            Topic = topic,
                            TotalLag = 0,
                            HasActiveConsumers = false,
                            Partitions = new List<ConsumerGroupPartitionAssociation>()
                        });
                    }
                }

                return new ConsumerGroupTopicAssociationsResponse
                {
                    Associations = associations.OrderBy(a => a.GroupId).ThenBy(a => a.Topic).ToList(),
                    Topic = topicName
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving consumer group topic associations");
                throw;
            }
        }

        public async Task<ConsumerGroupSummariesResponse> GetConsumerGroupSummariesAsync()
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            var summaries = new List<ConsumerGroupSummary>();

            try
            {
                _logger.LogInformation("Starting to retrieve consumer groups list");
                var startTime = DateTime.UtcNow;

                // List all consumer groups - this is the fastest operation available
                var listGroupsResult = await adminClient.ListConsumerGroupsAsync(
                    new ListConsumerGroupsOptions
                    {
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                    }
                );

                var elapsed = (DateTime.UtcNow - startTime).TotalMilliseconds;
                _logger.LogInformation($"ListConsumerGroupsAsync completed in {elapsed}ms");

                var allGroupIds = listGroupsResult.Valid.Select(g => g.GroupId).ToList();

                if (allGroupIds.Count == 0)
                {
                    _logger.LogInformation("No consumer groups found");
                    return new ConsumerGroupSummariesResponse { Summaries = summaries };
                }

                // Just return group IDs - minimal data, no expensive operations
                summaries = allGroupIds
                    .Select(groupId => new ConsumerGroupSummary
                    {
                        GroupId = groupId,
                        ActiveConsumerCount = 0,
                        TotalLag = 0
                    })
                    .OrderBy(s => s.GroupId)
                    .ToList();

                var totalElapsed = (DateTime.UtcNow - startTime).TotalMilliseconds;
                _logger.LogInformation($"Retrieved {summaries.Count} consumer groups in {totalElapsed}ms");
                
                return new ConsumerGroupSummariesResponse
                {
                    Summaries = summaries
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving consumer groups");
                throw;
            }
        }

        public async Task<ConsumerGroupDetailsResponse> GetConsumerGroupDetailsAsync(string topicName)
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            using var consumer = _clientFactory.CreateConsumer();
            var details = new List<ConsumerGroupDetail>();

            try
            {
                _logger.LogInformation($"Retrieving consumer group details for topic: {topicName}");

                // Get cached consumer group offsets for this topic (optimized - fetches once per request)
                // Access the scoped service from the current HTTP request scope
                var offsetCacheService = _httpContextAccessor.HttpContext?.RequestServices
                    .GetRequiredService<IConsumerGroupOffsetCacheService>();
                
                if (offsetCacheService == null)
                {
                    throw new InvalidOperationException("Cannot access IConsumerGroupOffsetCacheService - not in HTTP request context");
                }
                
                var offsetCache = await offsetCacheService.GetOrFetchConsumerGroupOffsetsForTopicAsync(topicName);

                // Get groups that have consumed from this topic
                var groupsForTopic = offsetCache.ConsumerGroups
                    .Where(g => g.Topics.Any(t => t.TopicName.Equals(topicName, StringComparison.OrdinalIgnoreCase)))
                    .ToList();

                if (groupsForTopic.Count == 0)
                {
                    _logger.LogInformation($"No consumer groups found with offsets for topic {topicName}");
                    return new ConsumerGroupDetailsResponse { Groups = details, Topic = topicName };
                }

                var groupIds = groupsForTopic.Select(g => g.GroupId).ToList();

                // Get consumer group descriptions to get member count, coordinator, state, and assignments
                var describeResult = await adminClient.DescribeConsumerGroupsAsync(
                    groupIds,
                    new DescribeConsumerGroupsOptions
                    {
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                    }
                );

                // Get topic metadata to know all partitions
                // Wrap GetMetadata in a timeout to prevent hanging if brokers are down
                Metadata? metadata = null;
                try
                {
                    var metadataTask = Task.Run(() => adminClient.GetMetadata(topicName, TimeSpan.FromSeconds(_defaultTimeoutSeconds)));
                    metadata = await metadataTask.WaitAsync(TimeSpan.FromSeconds(_defaultTimeoutSeconds + 2));
                }
                catch (KafkaException ex)
                {
                    _logger.LogWarning(ex, $"Kafka broker transport failure while retrieving consumer group details for topic {topicName}. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (TimeoutException)
                {
                    _logger.LogWarning($"GetMetadata timed out while retrieving consumer group details for topic {topicName}. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, $"Failed to get metadata while retrieving consumer group details for topic {topicName}. Kafka brokers may be down.");
                    metadata = null;
                }

                if (metadata == null || metadata.Topics == null)
                {
                    _logger.LogWarning($"Metadata or topics is null for topic {topicName}");
                    return new ConsumerGroupDetailsResponse { Groups = details, Topic = topicName };
                }

                var topicMetadata = metadata.Topics.FirstOrDefault(t => t.Topic == topicName);
                if (topicMetadata == null)
                {
                    _logger.LogWarning($"Topic {topicName} not found");
                    return new ConsumerGroupDetailsResponse { Groups = details, Topic = topicName };
                }

                // Build watermark cache for all partitions of this topic
                var watermarkCache = new Dictionary<int, long>();
                var partitions = topicMetadata.Partitions.Select(p => new TopicPartition(topicName, p.PartitionId)).ToList();
                var watermarkTasks = partitions.Select(tp =>
                    Task.Run(async () =>
                    {
                        try
                        {
                            var watermarks = consumer.QueryWatermarkOffsets(tp, TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                            lock (watermarkCache)
                            {
                                watermarkCache[tp.Partition] = watermarks.High;
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, $"Failed to get watermark for {tp.Topic}:{tp.Partition}");
                        }
                    })
                ).ToList();
                await Task.WhenAll(watermarkTasks);

                // Process each group that has offsets for this topic (both active and inactive)
                foreach (var groupOffsetInfo in groupsForTopic)
                {
                    var groupId = groupOffsetInfo.GroupId;
                    var groupDescription = describeResult.ConsumerGroupDescriptions
                        .FirstOrDefault(d => d.GroupId == groupId);

                    int activeConsumerCount = groupDescription?.Members?.Count ?? 0;
                    int coordinator = groupDescription?.Coordinator?.Id ?? 0;
                    string state = groupDescription?.State.ToString() ?? "UNKNOWN";

                    // Get topic offset info for this topic
                    var topicOffsetInfo = groupOffsetInfo.Topics
                        .FirstOrDefault(t => t.TopicName.Equals(topicName, StringComparison.OrdinalIgnoreCase));

                    if (topicOffsetInfo == null)
                    {
                        continue;
                    }

                    // Build consumer member info (only if group has active consumers)
                    var consumers = new List<ConsumerMember>();
                        var topics = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                    if (groupDescription != null && groupDescription.Members != null && activeConsumerCount > 0 && state.Equals("STABLE", StringComparison.OrdinalIgnoreCase))
                        {
                        // Group has active consumers - show member details
                        var memberPartitionMap = new Dictionary<string, List<int>>();

                            foreach (var member in groupDescription.Members)
                            {
                            if (member.Assignment == null || member.Assignment.TopicPartitions == null)
                                {
                                continue;
                            }

                            // Add all topics this member is consuming from
                                    foreach (var tp in member.Assignment.TopicPartitions)
                                    {
                                        topics.Add(tp.Topic);
                                    }

                            // Get partitions assigned to this member for the target topic
                            var topicPartitions = member.Assignment.TopicPartitions
                                .Where(tp => tp.Topic.Equals(topicName, StringComparison.OrdinalIgnoreCase))
                                .Select(tp => tp.Partition.Value)
                                .ToList();

                            if (topicPartitions.Count > 0)
                            {
                                memberPartitionMap[member.ConsumerId] = topicPartitions;
                                }
                            }

                        // Build consumer member info with partition assignments
                        foreach (var member in groupDescription.Members)
                        {
                            if (!memberPartitionMap.TryGetValue(member.ConsumerId, out var memberPartitions))
                            {
                                continue;
                            }

                            var consumerPartitions = new List<ConsumerPartitionAssignment>();
                            foreach (var partitionId in memberPartitions)
                            {
                                if (watermarkCache.TryGetValue(partitionId, out var logEndOffset))
                                {
                                    // Get committed offset from cache
                                    var partitionOffset = topicOffsetInfo.Partitions
                                        .FirstOrDefault(p => p.PartitionId == partitionId);
                                    var currentOffset = partitionOffset?.LastCommittedOffset ?? -1;

                                    // Handle invalid offsets and calculate lag correctly
                                    long validCurrentOffset = currentOffset < 0 ? 0 : currentOffset;
                                    long lag = 0;
                                    
                                    if (logEndOffset > 0 && logEndOffset > validCurrentOffset)
                                    {
                                        lag = logEndOffset - validCurrentOffset;
                                    }

                                    consumerPartitions.Add(new ConsumerPartitionAssignment
                                    {
                                        Topic = topicName,
                                        Partition = partitionId,
                                        CurrentOffset = validCurrentOffset,
                                        LogEndOffset = logEndOffset,
                                        Lag = lag
                                    });
                                }
                            }

                            if (consumerPartitions.Count > 0)
                            {
                                consumers.Add(new ConsumerMember
                                {
                                    MemberId = member.ConsumerId,
                                    ClientId = member.ClientId,
                                    Host = member.Host,
                                    AssignedPartitions = consumerPartitions
                                });
                            }
                        }
                    }
                    else
                    {
                        // Group has no active consumers - still show lag from committed offsets
                        // For inactive groups, add the topic to the topics list
                        topics.Add(topicName);
                    }

                    // Calculate total lag from all partitions with offsets (for both active and inactive groups)
                    long totalLag = 0;
                    foreach (var partitionOffset in topicOffsetInfo.Partitions)
                    {
                        if (watermarkCache.TryGetValue(partitionOffset.PartitionId, out var logEndOffset))
                        {
                            var currentOffset = partitionOffset.LastCommittedOffset;
                            long validCurrentOffset = currentOffset < 0 ? 0 : currentOffset;
                            
                            if (logEndOffset > 0 && logEndOffset > validCurrentOffset)
                            {
                                totalLag += logEndOffset - validCurrentOffset;
                            }
                        }
                    }

                    // Include all groups (both active and inactive) that have offsets for this topic
                        details.Add(new ConsumerGroupDetail
                        {
                            GroupId = groupId,
                            ActiveConsumerCount = activeConsumerCount,
                            TotalLag = totalLag,
                            Coordinator = coordinator,
                            State = state,
                        Topics = topics.Count > 0 ? topics.ToList() : new List<string> { topicName },
                        Consumers = consumers
                        });
                }

                _logger.LogInformation($"Retrieved {details.Count} consumer groups for topic {topicName}");
                return new ConsumerGroupDetailsResponse
                {
                    Groups = details.OrderBy(d => d.GroupId).ToList(),
                    Topic = topicName
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving consumer group details for topic {topicName}");
                throw;
            }
        }

        public async Task<ConsumerGroupDetailsResponse> GetAllConsumerGroupDetailsAsync()
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            var details = new List<ConsumerGroupDetail>();

            try
            {
                _logger.LogInformation("Retrieving all consumer group details with assignments for frontend filtering");

                // List all consumer groups
                var listGroupsResult = await adminClient.ListConsumerGroupsAsync(
                    new ListConsumerGroupsOptions
                    {
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                    }
                );

                var allGroupIds = listGroupsResult.Valid.Select(g => g.GroupId).ToList();

                if (allGroupIds.Count == 0)
                {
                    _logger.LogInformation("No consumer groups found");
                    return new ConsumerGroupDetailsResponse { Groups = details };
                }

                // Get consumer group descriptions to get member count, coordinator, state, and assignments
                // This includes all groups - frontend will filter by topic
                var describeResult = await adminClient.DescribeConsumerGroupsAsync(
                    allGroupIds,
                    new DescribeConsumerGroupsOptions
                    {
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                    }
                );

                // Process each group - return ALL groups with their assignments for frontend filtering
                foreach (var groupId in allGroupIds)
                {
                    var groupDescription = describeResult.ConsumerGroupDescriptions
                        .FirstOrDefault(d => d.GroupId == groupId);

                    int activeConsumerCount = 0;
                    int coordinator = 0;
                    string state = "UNKNOWN";
                    var topics = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                    if (groupDescription != null)
                    {
                        activeConsumerCount = groupDescription.Members?.Count ?? 0;
                        coordinator = groupDescription.Coordinator?.Id ?? 0;
                        state = groupDescription.State.ToString();

                        // Extract all topics from partition assignments
                        if (groupDescription.Members != null && activeConsumerCount > 0)
                        {
                            foreach (var member in groupDescription.Members)
                            {
                                if (member.Assignment != null && member.Assignment.TopicPartitions != null)
                                {
                                    foreach (var tp in member.Assignment.TopicPartitions)
                                    {
                                        topics.Add(tp.Topic);
                                    }
                                }
                            }
                        }
                    }

                    // Return ALL groups (not just actively consuming) - frontend will filter
                    // TotalLag is set to 0 here - use GetConsumerGroupDetailsByIdAsync for lag details
                    details.Add(new ConsumerGroupDetail
                    {
                        GroupId = groupId,
                        ActiveConsumerCount = activeConsumerCount,
                        TotalLag = 0, // Lag calculation deferred to detail view endpoint
                        Coordinator = coordinator,
                        State = state,
                        Topics = topics.ToList()
                    });
                }

                _logger.LogInformation($"Retrieved {details.Count} consumer group details (all groups for frontend filtering)");
                return new ConsumerGroupDetailsResponse
                {
                    Groups = details.OrderBy(d => d.GroupId).ToList()
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving all consumer group details");
                throw;
            }
        }

        public async Task<ConsumerGroupDetailsResponse> GetConsumerGroupDetailsByIdAsync(string groupId)
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            using var consumer = _clientFactory.CreateConsumer();
            var details = new List<ConsumerGroupDetail>();

            try
            {
                _logger.LogInformation($"Retrieving consumer group details for group ID: {groupId}");

                // Get consumer group description
                var describeResult = await adminClient.DescribeConsumerGroupsAsync(
                    new[] { groupId },
                    new DescribeConsumerGroupsOptions
                    {
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                    }
                );

                var groupDescription = describeResult.ConsumerGroupDescriptions
                    .FirstOrDefault(d => d.GroupId == groupId);

                if (groupDescription == null)
                {
                    _logger.LogWarning($"Consumer group {groupId} not found");
                    return new ConsumerGroupDetailsResponse { Groups = details };
                }

                int activeConsumerCount = groupDescription.Members?.Count ?? 0;
                int coordinator = groupDescription.Coordinator?.Id ?? 0;
                string state = groupDescription.State.ToString();

                // Exclude EMPTY groups
                if (state.Equals("EMPTY", StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogDebug($"Excluding EMPTY consumer group: {groupId}");
                    return new ConsumerGroupDetailsResponse { Groups = details };
                }

                // Only process groups that have active consumers and are STABLE
                if (activeConsumerCount == 0 || !state.Equals("STABLE", StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogDebug($"Consumer group {groupId} is not active (State: {state}, Members: {activeConsumerCount})");
                    return new ConsumerGroupDetailsResponse { Groups = details };
                }

                if (groupDescription.Members == null || groupDescription.Members.Count == 0)
                {
                    return new ConsumerGroupDetailsResponse { Groups = details };
                }

                // Collect all topics and partitions from member assignments
                var topics = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var allAssignedPartitions = new Dictionary<string, HashSet<int>>(); // topic -> set of partition IDs
                var memberPartitionMap = new Dictionary<string, Dictionary<string, List<int>>>(); // consumerId -> topic -> list of partition IDs

                // First pass: collect all assigned partitions and build member-to-partition mapping
                    foreach (var member in groupDescription.Members)
                    {
                    if (member.Assignment == null || member.Assignment.TopicPartitions == null)
                        {
                        continue;
                    }

                    var consumerId = member.ConsumerId;
                    if (!memberPartitionMap.ContainsKey(consumerId))
                    {
                        memberPartitionMap[consumerId] = new Dictionary<string, List<int>>();
                    }

                            foreach (var tp in member.Assignment.TopicPartitions)
                            {
                                topics.Add(tp.Topic);
                        
                        if (!allAssignedPartitions.TryGetValue(tp.Topic, out var partitionSet))
                                {
                            partitionSet = new HashSet<int>();
                            allAssignedPartitions[tp.Topic] = partitionSet;
                                }
                        partitionSet.Add(tp.Partition.Value);

                        if (!memberPartitionMap[consumerId].TryGetValue(tp.Topic, out var memberPartitions))
                        {
                            memberPartitions = new List<int>();
                            memberPartitionMap[consumerId][tp.Topic] = memberPartitions;
                        }
                        memberPartitions.Add(tp.Partition.Value);
                    }
                }

                if (topics.Count == 0 || allAssignedPartitions.Count == 0)
                {
                    return new ConsumerGroupDetailsResponse { Groups = details };
                }
                                
                // Build watermark cache for all assigned partitions across all topics
                                var watermarkCache = new Dictionary<string, Dictionary<int, long>>();
                var allPartitionsToQuery = allAssignedPartitions
                    .SelectMany(kvp => kvp.Value.Select(p => new TopicPartition(kvp.Key, p)))
                    .ToList();

                var watermarkTasks = allPartitionsToQuery.Select(tp =>
                                    Task.Run(async () =>
                                    {
                                        try
                                        {
                                            var watermarks = consumer.QueryWatermarkOffsets(tp, TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                                            lock (watermarkCache)
                                            {
                                                if (!watermarkCache.TryGetValue(tp.Topic, out var partitionCache))
                                                {
                                                    partitionCache = new Dictionary<int, long>();
                                                    watermarkCache[tp.Topic] = partitionCache;
                                                }
                                                partitionCache[tp.Partition] = watermarks.High;
                                            }
                                        }
                                        catch (Exception ex)
                                        {
                                            _logger.LogWarning(ex, $"Failed to get watermark for {tp.Topic}:{tp.Partition}");
                                        }
                                    })
                                ).ToList();
                                await Task.WhenAll(watermarkTasks);

                // Get all offsets for this group in one call (for all assigned partitions across all topics)
                var groupSpec = new ConsumerGroupTopicPartitions(groupId, allPartitionsToQuery);
                                var offsetsResult = await adminClient.ListConsumerGroupOffsetsAsync(
                                    new[] { groupSpec },
                                    new ListConsumerGroupOffsetsOptions { RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds) }
                                );

                // Build offset map: (topic, partition) -> current offset
                var offsetMap = new Dictionary<(string Topic, int Partition), long>();
                if (offsetsResult.Count > 0 && offsetsResult[0].Partitions != null)
                                {
                    _logger.LogDebug($"Retrieved {offsetsResult[0].Partitions.Count} offset entries for group {groupId}");
                    foreach (var topicPartitionOffset in offsetsResult[0].Partitions)
                                    {
                                        var partitionId = topicPartitionOffset.Partition.Value;
                        var offset = topicPartitionOffset.Offset;
                        offsetMap[(topicPartitionOffset.Topic, partitionId)] = offset;
                        _logger.LogDebug($"Group {groupId} topic {topicPartitionOffset.Topic} partition {partitionId}: offset={offset}");
                    }
                }
                else
                {
                    _logger.LogWarning($"No offset results returned for group {groupId}");
                }

                // Build consumer member info with partition assignments
                var consumers = new List<ConsumerMember>();
                foreach (var member in groupDescription.Members)
                {
                    var consumerId = member.ConsumerId;
                    if (!memberPartitionMap.TryGetValue(consumerId, out var consumerTopics))
                    {
                        continue;
                    }

                    var consumerPartitions = new List<ConsumerPartitionAssignment>();
                    foreach (var topicPartition in consumerTopics)
                    {
                        var topicName = topicPartition.Key;
                        foreach (var partitionId in topicPartition.Value)
                        {
                                        if (watermarkCache.TryGetValue(topicName, out var partitionCache) &&
                                            partitionCache.TryGetValue(partitionId, out var logEndOffset))
                                        {
                                // Get the committed offset for this partition
                                // If not found in map, it means no offset has been committed yet
                                if (!offsetMap.TryGetValue((topicName, partitionId), out var currentOffset))
                                {
                                    _logger.LogDebug($"No committed offset found for group {groupId} topic {topicName} partition {partitionId}, treating as uncommitted");
                                    currentOffset = -1; // Mark as uncommitted
                                }

                                // Handle invalid offsets and calculate lag correctly
                                // If logEndOffset is 0, there are no messages, so lag is 0
                                // If currentOffset is negative, it means no offset committed yet, treat as 0
                                long validCurrentOffset = currentOffset < 0 ? 0 : currentOffset;
                                long lag = 0;
                                
                                if (logEndOffset > 0 && logEndOffset > validCurrentOffset)
                                {
                                    lag = logEndOffset - validCurrentOffset;
                                }

                                _logger.LogDebug($"Topic {topicName} Partition {partitionId}: currentOffset={currentOffset}, validCurrentOffset={validCurrentOffset}, logEndOffset={logEndOffset}, lag={lag}");

                                consumerPartitions.Add(new ConsumerPartitionAssignment
                                {
                                    Topic = topicName,
                                    Partition = partitionId,
                                    CurrentOffset = validCurrentOffset, // Normalize invalid offsets to 0 for display
                                    LogEndOffset = logEndOffset,
                                    Lag = lag
                                });
                                    }
                                }
                            }

                    if (consumerPartitions.Count > 0)
                        {
                        consumers.Add(new ConsumerMember
                        {
                            MemberId = consumerId,
                            ClientId = member.ClientId,
                            Host = member.Host,
                            AssignedPartitions = consumerPartitions
                        });
                    }
                }

                // Calculate total lag only for assigned partitions
                long totalLag = consumers
                    .SelectMany(c => c.AssignedPartitions)
                    .Sum(p => p.Lag);

                details.Add(new ConsumerGroupDetail
                {
                    GroupId = groupId,
                    ActiveConsumerCount = activeConsumerCount,
                    TotalLag = totalLag,
                    Coordinator = coordinator,
                    State = state,
                    Topics = topics.ToList(),
                    Consumers = consumers
                });

                _logger.LogInformation($"Retrieved details for consumer group {groupId} with {consumers.Count} consumers and total lag {totalLag}");
                return new ConsumerGroupDetailsResponse
                {
                    Groups = details
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving consumer group details for group ID {groupId}");
                throw;
            }
        }

        private async Task<List<ConsumerGroupInfo>> FetchConsumerGroupOffsetsSnapshotAsync(string? topicName)
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            using var consumer = _clientFactory.CreateConsumer();
            var groups = new List<ConsumerGroupInfo>();

            // List all consumer groups
            var listGroupsResult = await adminClient.ListConsumerGroupsAsync(
                new ListConsumerGroupsOptions
                {
                    RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                }
            );

            var allGroupIds = listGroupsResult.Valid.Select(g => g.GroupId).ToList();

            if (allGroupIds.Count == 0)
            {
                _logger.LogInformation("No consumer groups found");
                return groups;
            }

            // If topicName is specified, only get partitions for that topic
            // Otherwise, we'll query all topics (less efficient but needed for "all topics" view)
            List<TopicPartition> partitionsToQuery;
            if (topicName != null)
            {
                // Get partitions only for the specified topic
                var metadata = adminClient.GetMetadata(topicName, TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                var topicMetadata = metadata.Topics.FirstOrDefault(t => t.Topic == topicName);
                if (topicMetadata == null)
                {
                    return groups;
                }
                partitionsToQuery = topicMetadata.Partitions
                    .Select(p => new TopicPartition(topicName, p.PartitionId))
                    .ToList();
            }
            else
            {
                // Get all topic partitions (for "all topics" view)
                // Wrap GetMetadata in a timeout to prevent hanging if brokers are down
                Metadata? metadata = null;
                try
                {
                    var metadataTask = Task.Run(() => adminClient.GetMetadata(TimeSpan.FromSeconds(_defaultTimeoutSeconds)));
                    metadata = await metadataTask.WaitAsync(TimeSpan.FromSeconds(_defaultTimeoutSeconds + 2));
                }
                catch (KafkaException ex)
                {
                    _logger.LogWarning(ex, "Kafka broker transport failure while retrieving consumer groups. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (TimeoutException)
                {
                    _logger.LogWarning("GetMetadata timed out while retrieving consumer groups. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to get metadata while retrieving consumer groups. Kafka brokers may be down.");
                    metadata = null;
                }

                if (metadata == null || metadata.Topics == null)
                {
                    _logger.LogWarning("Metadata or topics is null while retrieving consumer groups");
                    return groups;
                }

                partitionsToQuery = metadata.Topics
                    .Where(t => !t.Topic.StartsWith("__"))
                    .SelectMany(t => t.Partitions.Select(p => new TopicPartition(t.Topic, p.PartitionId)))
                    .ToList();
            }

            if (partitionsToQuery.Count == 0)
            {
                return groups;
            }

            // Build watermark cache for all partitions we'll query (batch query for efficiency)
            var watermarkCache = new Dictionary<string, Dictionary<int, long>>();
            var watermarkTasks = partitionsToQuery
                .GroupBy(tp => tp.Topic)
                .SelectMany(g => g.Select(tp =>
                    Task.Run(async () =>
                    {
                        try
                        {
                            var watermarks = consumer.QueryWatermarkOffsets(tp, TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                            lock (watermarkCache)
                            {
                                if (!watermarkCache.TryGetValue(tp.Topic, out var partitionCache))
                                {
                                    partitionCache = new Dictionary<int, long>();
                                    watermarkCache[tp.Topic] = partitionCache;
                                }
                                partitionCache[tp.Partition] = watermarks.High;
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, $"Failed to get watermark for {tp.Topic}:{tp.Partition}");
                        }
                    })
                ))
                .ToList();
            await Task.WhenAll(watermarkTasks);

            // Process consumer groups in parallel batches
            var semaphore = new SemaphoreSlim(10); // Limit concurrent operations
            var tasks = allGroupIds.Select(groupId =>
                GetConsumerGroupOffsetsForPartitionsAsync(
                    adminClient,
                    groupId,
                    partitionsToQuery,
                    topicName,
                    watermarkCache,
                    semaphore
                )
            ).ToList();

            var results = await Task.WhenAll(tasks);
            foreach (var result in results)
            {
                // Only add groups that have offsets for the specified topic (if topic filter is applied)
                if (result.Count > 0)
                {
                    // If topicName is specified, ensure all results are for that topic
                    if (topicName != null)
                    {
                        var filteredResult = result.Where(g => g.Topic == topicName).ToList();
                        if (filteredResult.Count > 0)
                        {
                            groups.AddRange(filteredResult);
                        }
                    }
                    else
                    {
                        // No topic filter - include all results
                        groups.AddRange(result);
                    }
                }
            }

            return groups;
        }

        private async Task<List<ConsumerGroupInfo>> GetConsumerGroupOffsetsForPartitionsAsync(
            IAdminClient adminClient,
            string groupId,
            List<TopicPartition> partitions,
            string? filterTopicName,
            Dictionary<string, Dictionary<int, long>> watermarkCache,
            SemaphoreSlim semaphore)
        {
            await semaphore.WaitAsync();
            try
            {
                var groupInfoList = new List<ConsumerGroupInfo>();

                // Get consumer group offsets for the specified partitions
                // Note: The API may return offsets for all partitions the group has, not just the ones we specify
                // So we need to filter the results by the partitions we're interested in
                var groupSpec = new ConsumerGroupTopicPartitions(groupId, partitions);

                var offsetsResult = await adminClient.ListConsumerGroupOffsetsAsync(
                    new[] { groupSpec },
                    new ListConsumerGroupOffsetsOptions { RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds) }
                );

                // Create a set of partitions we're interested in for quick lookup
                var partitionsSet = new HashSet<(string Topic, int Partition)>(
                    partitions.Select(p => (p.Topic, p.Partition.Value))
                );

                // Process results and filter to only include partitions we queried for
                foreach (var result in offsetsResult)
                {
                    foreach (var topicPartitionOffset in result.Partitions)
                    {
                        var topicName = topicPartitionOffset.Topic;
                        var partitionId = topicPartitionOffset.Partition.Value; // Convert Partition to int

                        // STRICT FILTER 1: If topic filter is specified, must match exactly (check this first for performance)
                        if (filterTopicName != null && topicName != filterTopicName)
                        {
                            continue; // Skip immediately if topic doesn't match
                        }

                        // STRICT FILTER 2: Only include partitions we actually queried for
                        if (!partitionsSet.Contains((topicName, partitionId)))
                        {
                            continue; // Skip if partition wasn't in our query list
                        }

                        // Get cached log end offset
                        if (!watermarkCache.TryGetValue(topicName, out var partitionCache) ||
                            !partitionCache.TryGetValue(partitionId, out var logEndOffset))
                        {
                            // Should not happen if cache was built correctly, but handle gracefully
                            _logger.LogWarning($"Watermark cache miss for {topicName}:{partitionId}");
                            continue;
                        }

                        // Final check: if topic filter is specified, double-check (defensive programming)
                        if (filterTopicName != null && topicName != filterTopicName)
                        {
                            continue;
                        }

                        var currentOffset = topicPartitionOffset.Offset;
                        
                        // Handle invalid offsets and calculate lag correctly
                        // If logEndOffset is 0, there are no messages, so lag is 0
                        // If currentOffset is negative, it means no offset committed yet, treat as 0
                        long validCurrentOffset = currentOffset < 0 ? 0 : currentOffset;
                        long lag = 0;
                        
                        if (logEndOffset > 0 && logEndOffset > validCurrentOffset)
                        {
                            lag = logEndOffset - validCurrentOffset;
                        }

                        groupInfoList.Add(new ConsumerGroupInfo
                        {
                            GroupId = groupId,
                            Topic = topicName,
                            Partition = partitionId,
                            CurrentOffset = validCurrentOffset, // Normalize invalid offsets to 0 for display
                            LogEndOffset = logEndOffset,
                            Lag = lag
                        });
                    }
                }

                // Final check: If topic filter is specified and we have no results for that topic, return empty
                if (filterTopicName != null && groupInfoList.Count > 0)
                {
                    var hasResultsForTopic = groupInfoList.Any(g => g.Topic == filterTopicName);
                    if (!hasResultsForTopic)
                    {
                        _logger.LogDebug($"Consumer group {groupId} has no offsets for topic {filterTopicName}");
                        return new List<ConsumerGroupInfo>();
                    }
                }

                return groupInfoList;
            }
            catch (Exception ex)
            {
                // If group has no offsets for these partitions, that's fine - just return empty list
                _logger.LogDebug(ex, $"No offsets found for consumer group {groupId} on specified partitions");
                return new List<ConsumerGroupInfo>();
            }
            finally
            {
                semaphore.Release();
            }
        }

        public async Task<ConsumerGroupDetailResponse> GetConsumerGroupInfoAsync(string groupId, string topic)
        {
            var partitions = await GetConsumerGroupDetailsAsync(groupId, topic);
            var totalLag = partitions.Sum(p => p.Lag);

            return new ConsumerGroupDetailResponse
            {
                GroupId = groupId,
                Topic = topic,
                Partitions = partitions,
                TotalLag = totalLag
            };
        }

        private async Task<List<ConsumerGroupInfo>> GetConsumerGroupOffsetsAsync(
            IAdminClient adminClient,
            IConsumer<string, string> consumer,
            string groupId,
            List<TopicMetadata> topics,
            string? filterTopicName)
        {
            var groupInfoList = new List<ConsumerGroupInfo>();

            try
            {
                // Build list of topic partitions for this group
                var partitions = new List<TopicPartition>();
                foreach (var topic in topics)
                {
                    if (filterTopicName != null && topic.Topic != filterTopicName)
                        continue;

                    foreach (var partition in topic.Partitions)
                    {
                        partitions.Add(new TopicPartition(topic.Topic, partition.PartitionId));
                    }
                }

                if (partitions.Count == 0)
                    return groupInfoList;

                // Get consumer group offsets - constructor takes groupId and partitions list
                var groupSpec = new ConsumerGroupTopicPartitions(groupId, partitions);

                var offsetsResult = await adminClient.ListConsumerGroupOffsetsAsync(
                    new[] { groupSpec },
                    new ListConsumerGroupOffsetsOptions { RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds) }
                );

                // offsetsResult is a list of ListConsumerGroupOffsetsResult
                foreach (var result in offsetsResult)
                {
                    // result.Partitions contains the offsets for the partitions
                    foreach (var topicPartitionOffset in result.Partitions)
                    {
                        var topicName = topicPartitionOffset.Topic;
                        var partitionId = topicPartitionOffset.Partition;

                        // Get log end offset for this partition
                        var partition = new TopicPartition(topicName, partitionId);
                        var watermarks = consumer.QueryWatermarkOffsets(partition, TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                        var logEndOffset = watermarks.High;
                        var currentOffset = topicPartitionOffset.Offset;
                        
                        // Handle invalid offsets and calculate lag correctly
                        // If logEndOffset is 0, there are no messages, so lag is 0
                        // If currentOffset is negative, it means no offset committed yet, treat as 0
                        long validCurrentOffset = currentOffset < 0 ? 0 : currentOffset;
                        long lag = 0;
                        
                        if (logEndOffset > 0 && logEndOffset > validCurrentOffset)
                        {
                            lag = logEndOffset - validCurrentOffset;
                        }

                        groupInfoList.Add(new ConsumerGroupInfo
                        {
                            GroupId = groupId,
                            Topic = topicName,
                            Partition = partitionId,
                            CurrentOffset = validCurrentOffset, // Normalize invalid offsets to 0 for display
                            LogEndOffset = logEndOffset,
                            Lag = lag
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Failed to get consumer group offsets for {groupId}");
            }

            return groupInfoList;
        }

        private async Task<List<ConsumerGroupInfo>> GetConsumerGroupDetailsAsync(string groupId, string topic)
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            using var consumer = _clientFactory.CreateConsumer();
            var groupInfoList = new List<ConsumerGroupInfo>();

            try
            {
                var metadata = adminClient.GetMetadata(TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                var topicMetadata = metadata.Topics.FirstOrDefault(t => t.Topic == topic);

                if (topicMetadata == null)
                    return groupInfoList;

                // Get consumer group offsets - constructor takes groupId and partitions list
                var partitions = topicMetadata.Partitions.Select(p => new TopicPartition(topic, p.PartitionId)).ToList();
                var groupSpec = new ConsumerGroupTopicPartitions(groupId, partitions);

                var offsetsResult = await adminClient.ListConsumerGroupOffsetsAsync(
                    new[] { groupSpec },
                    new ListConsumerGroupOffsetsOptions { RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds) }
                );

                // offsetsResult is a list of ListConsumerGroupOffsetsResult
                foreach (var result in offsetsResult)
                {
                    // result.Partitions contains the offsets for the partitions
                    foreach (var topicPartitionOffset in result.Partitions)
                    {
                        var partitionId = topicPartitionOffset.Partition;

                        // Get log end offset for this partition
                        var partition = new TopicPartition(topic, partitionId);
                        var watermarks = consumer.QueryWatermarkOffsets(partition, TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                        var logEndOffset = watermarks.High;
                        var currentOffset = topicPartitionOffset.Offset;
                        
                        // Handle invalid offsets and calculate lag correctly
                        // If logEndOffset is 0, there are no messages, so lag is 0
                        // If currentOffset is negative, it means no offset committed yet, treat as 0
                        long validCurrentOffset = currentOffset < 0 ? 0 : currentOffset;
                        long lag = 0;
                        
                        if (logEndOffset > 0 && logEndOffset > validCurrentOffset)
                        {
                            lag = logEndOffset - validCurrentOffset;
                        }

                        groupInfoList.Add(new ConsumerGroupInfo
                        {
                            GroupId = groupId,
                            Topic = topic,
                            Partition = partitionId,
                            CurrentOffset = validCurrentOffset, // Normalize invalid offsets to 0 for display
                            LogEndOffset = logEndOffset,
                            Lag = lag
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Failed to get consumer group details for {groupId} on topic {topic}");
            }

            return groupInfoList;
        }

        private KafkaMessage BuildProjectedMessage(ConsumeResult<string, string> result, ProjectionOptions? projection)
        {
            projection ??= new ProjectionOptions { Fields = ProjectionFields.All };
            
            var message = new KafkaMessage();
            bool isTruncated = false;

            // Key
            if (projection.Fields.HasFlag(ProjectionFields.Key))
            {
                message.Key = result.Message.Key;
            }

            // Value
            if (projection.Fields.HasFlag(ProjectionFields.Value))
            {
                var value = result.Message.Value ?? string.Empty;
                if (projection.MaxValueLength.HasValue && value.Length > projection.MaxValueLength.Value)
                {
                    message.Value = value.Substring(0, projection.MaxValueLength.Value);
                    isTruncated = true;
                }
                else
                {
                    message.Value = value;
                }
            }

            // Headers
            if (projection.Fields.HasFlag(ProjectionFields.Headers) && result.Message.Headers != null)
            {
                foreach (var header in result.Message.Headers)
                {
                    message.Headers[header.Key] = System.Text.Encoding.UTF8.GetString(header.GetValueBytes());
                }
            }

            // Metadata (always include for tracking purposes)
            if (projection.Fields.HasFlag(ProjectionFields.Metadata))
            {
                message.Partition = result.Partition;
                message.Offset = result.Offset;
                message.Timestamp = result.Message.Timestamp.UtcDateTime;
                message.TimestampType = result.Message.Timestamp.Type.ToString();
            }

            message.IsTruncated = isTruncated;
            return message;
        }

        private bool MatchesFilters(Message<string, string> message, MessageSearchRequest request)
        {
            // Use advanced filters if provided
            if (request.Filters != null && request.Filters.Count > 0)
            {
                return MatchesAdvancedFilters(message, request.Filters, request.FilterOperator);
            }

            // Fall back to legacy filters for backward compatibility
            // Key filter - search in both message key AND value
            if (!string.IsNullOrEmpty(request.Key))
            {
                bool keyMatches = message.Key?.Contains(request.Key, StringComparison.OrdinalIgnoreCase) ?? false;
                bool valueMatches = message.Value?.Contains(request.Key, StringComparison.OrdinalIgnoreCase) ?? false;
                
                if (!keyMatches && !valueMatches)
                    return false;
            }

            // Value filter
            if (!string.IsNullOrEmpty(request.Value) && message.Value != null)
            {
                if (!message.Value.Contains(request.Value, StringComparison.OrdinalIgnoreCase))
                    return false;
            }

            // Headers filter
            if (request.Headers != null && request.Headers.Count > 0 && message.Headers != null)
            {
                foreach (var filterHeader in request.Headers)
                {
                    var header = message.Headers.FirstOrDefault(h => h.Key == filterHeader.Key);
                    if (header == null)
                        return false;

                    var headerValue = System.Text.Encoding.UTF8.GetString(header.GetValueBytes());
                    if (!headerValue.Contains(filterHeader.Value, StringComparison.OrdinalIgnoreCase))
                        return false;
                }
            }

            return true;
        }

        private bool MatchesAdvancedFilters(Message<string, string> message, List<SearchFilter> filters, FilterOperator filterOperator)
        {
            if (filterOperator == FilterOperator.And)
            {
                return filters.All(filter => MatchesSingleFilter(message, filter));
            }
            else // FilterOperator.Or
            {
                return filters.Any(filter => MatchesSingleFilter(message, filter));
            }
        }

        private bool MatchesSingleFilter(Message<string, string> message, SearchFilter filter)
        {
            try
            {
                string? fieldValue = ExtractFieldValue(message, filter.Field);
                
                if (fieldValue == null)
                {
                    return filter.Negate; // If field doesn't exist, match only if negated
                }

                bool matches = filter.Mode switch
                {
                    FilterMode.Exact => fieldValue.Equals(filter.Value, StringComparison.Ordinal),
                    FilterMode.Substring => fieldValue.Contains(filter.Value, StringComparison.OrdinalIgnoreCase),
                    FilterMode.Regex => MatchesRegex(fieldValue, filter.Value),
                    FilterMode.JsonPath => MatchesJsonPath(fieldValue, filter.Value),
                    _ => false
                };

                return filter.Negate ? !matches : matches;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Error applying filter to field {filter.Field}");
                return false;
            }
        }

        private string? ExtractFieldValue(Message<string, string> message, string field)
        {
            if (field.Equals("key", StringComparison.OrdinalIgnoreCase))
            {
                return message.Key;
            }
            else if (field.Equals("value", StringComparison.OrdinalIgnoreCase))
            {
                return message.Value;
            }
            else if (field.StartsWith("header:", StringComparison.OrdinalIgnoreCase))
            {
                var headerName = field.Substring(7);
                var header = message.Headers?.FirstOrDefault(h => h.Key.Equals(headerName, StringComparison.OrdinalIgnoreCase));
                if (header != null)
                {
                    return System.Text.Encoding.UTF8.GetString(header.GetValueBytes());
                }
            }

            return null;
        }

        private bool MatchesRegex(string fieldValue, string pattern)
        {
            try
            {
                var regex = new Regex(pattern, RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(100));
                return regex.IsMatch(fieldValue);
            }
            catch (RegexMatchTimeoutException)
            {
                _logger.LogWarning($"Regex timeout for pattern: {pattern}");
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Invalid regex pattern: {pattern}");
                return false;
            }
        }

        private bool MatchesJsonPath(string fieldValue, string jsonPathQuery)
        {
            try
            {
                // Parse the JSON value
                using var doc = JsonDocument.Parse(fieldValue);
                
                // Simple JSON path implementation - supports basic paths like "$.user.name" or "user.name"
                var path = jsonPathQuery.TrimStart('$', '.');
                var parts = path.Split('.');
                
                JsonElement current = doc.RootElement;
                
                foreach (var part in parts)
                {
                    if (current.ValueKind == JsonValueKind.Object && current.TryGetProperty(part, out var property))
                    {
                        current = property;
                    }
                    else
                    {
                        return false;
                    }
                }
                
                // If we reached here, the path exists
                return true;
            }
            catch (JsonException)
            {
                // Not valid JSON or path not found
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Error evaluating JSON path: {jsonPathQuery}");
                return false;
            }
        }

        private async Task<long> FindOffsetByTimestampAsync(
            IConsumer<string, string> consumer,
            TopicPartition partition,
            DateTime targetTime,
            long lowOffset,
            long highOffset,
            TimeSpan timeout)
        {
            // Use Kafka's built-in OffsetsForTimes to find offset by timestamp
            try
            {
                var targetTimestamp = new Timestamp(targetTime, TimestampType.CreateTime);
                var topicPartitionTimestamp = new TopicPartitionTimestamp(partition, targetTimestamp);
                
                var offsets = consumer.OffsetsForTimes(new[] { topicPartitionTimestamp }, timeout);
                
                if (offsets != null && offsets.Count > 0)
                {
                    var result = offsets[0];
                    if (result.Offset.Value >= 0)
                    {
                        return result.Offset.Value;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Failed to use OffsetsForTimes for partition {partition.Partition}, falling back to binary search");
            }

            // Fallback to binary search if OffsetsForTimes fails or returns invalid offset
            return await BinarySearchOffsetByTimestampAsync(consumer, partition, targetTime, lowOffset, highOffset, timeout);
        }

        private async Task<long> BinarySearchOffsetByTimestampAsync(
            IConsumer<string, string> consumer,
            TopicPartition partition,
            DateTime targetTime,
            long low,
            long high,
            TimeSpan timeout)
        {
            // Binary search with actual message consumption
            const int maxIterations = 20; // Prevent infinite loops
            int iterations = 0;

            while (low < high && iterations < maxIterations)
            {
                iterations++;
                long mid = low + (high - low) / 2;

                try
                {
                    // Assign and seek in one operation
                    consumer.Assign(new[] { new TopicPartitionOffset(partition, mid) });
                    var result = consumer.Consume(TimeSpan.FromSeconds(5)); // Shorter timeout for binary search

                    if (result == null || result.IsPartitionEOF)
                    {
                        high = mid - 1;
                        continue;
                    }

                    var messageTime = result.Message.Timestamp.UtcDateTime;

                    if (messageTime < targetTime)
                    {
                        low = mid + 1;
                    }
                    else if (messageTime > targetTime)
                    {
                        high = mid - 1;
                    }
                    else
                    {
                        return mid;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, $"Error during binary search at offset {mid} for partition {partition.Partition}");
                    // If we can't read at mid, try moving towards low
                    high = mid - 1;
                }
            }

            return low;
        }

        public async Task<TopicPartitionsResponse> GetTopicPartitionsAsync(string topicName)
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            using var consumer = _clientFactory.CreateConsumer();

            try
            {
                var metadata = adminClient.GetMetadata(TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                var topic = metadata.Topics.FirstOrDefault(t => t.Topic == topicName);

                if (topic == null)
                {
                    _logger.LogWarning($"Topic not found: {topicName}");
                    throw new ArgumentException($"Topic not found: {topicName}");
                }

                var partitions = new List<PartitionInfo>();
                long totalMessageCount = 0;
                int underReplicatedPartitions = 0;
                int totalInSyncReplicas = 0;

                // Get topic configs for overview
                var cleanupPolicy = "delete";
                var segmentSize = "0";
                try
                {
                    var configResource = new ConfigResource
                    {
                        Type = ResourceType.Topic,
                        Name = topicName
                    };

                    var describeResult = await adminClient.DescribeConfigsAsync(
                        new[] { configResource },
                        new DescribeConfigsOptions { RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds) }
                    );

                    var result = describeResult.FirstOrDefault(r => r.ConfigResource.Name == topicName && r.ConfigResource.Type == ResourceType.Topic);
                    if (result != null && result.Entries != null)
                    {
                        if (result.Entries.TryGetValue("cleanup.policy", out var cleanupPolicyEntry))
                        {
                            cleanupPolicy = cleanupPolicyEntry?.Value ?? "delete";
                        }
                        if (result.Entries.TryGetValue("segment.bytes", out var segmentSizeEntry))
                        {
                            segmentSize = segmentSizeEntry?.Value ?? "0";
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, $"Failed to retrieve configs for topic {topicName}");
                }

                foreach (var partitionMetadata in topic.Partitions)
                {
                    var partition = new TopicPartition(topicName, partitionMetadata.PartitionId);
                    
                    long firstOffset = 0;
                    long nextOffset = 0;
                    long messageCount = 0;

                    try
                    {
                        // Get watermark offsets (first and next offset)
                        var watermarks = consumer.QueryWatermarkOffsets(partition, TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                        firstOffset = watermarks.Low;
                        nextOffset = watermarks.High;
                        messageCount = nextOffset - firstOffset;
                    }
                    catch (KafkaException ex)
                    {
                        // Handle cases where partition might not exist or is in an invalid state
                        _logger.LogWarning(ex, $"Failed to query watermark offsets for partition {partitionMetadata.PartitionId} of topic {topicName}. Error: {ex.Message}");
                        // Continue with default values (0 offsets)
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, $"Unexpected error querying watermark offsets for partition {partitionMetadata.PartitionId} of topic {topicName}");
                        // Continue with default values (0 offsets)
                    }

                    // Check if partition is under-replicated
                    // Note: ISR information is not directly available in PartitionMetadata
                    // Using Replicas as ISR fallback (in a healthy cluster, all replicas are in-sync)
                    var replicaCount = partitionMetadata.Replicas?.Count() ?? 0;
                    var isrCount = replicaCount; // Assume all replicas are in-sync (fallback)
                    // In a real scenario, you'd need to use AdminClient.DescribeTopicsAsync to get ISR info
                    totalInSyncReplicas += isrCount;
                    totalMessageCount += messageCount;

                    var partitionInfo = new PartitionInfo
                    {
                        PartitionId = partitionMetadata.PartitionId,
                        Replicas = partitionMetadata.Replicas?.ToList() ?? new List<int>(),
                        Leader = partitionMetadata.Leader,
                        Isr = partitionMetadata.Replicas?.ToList() ?? new List<int>(), // Using Replicas as ISR fallback
                        FirstOffset = firstOffset,
                        NextOffset = nextOffset,
                        MessageCount = messageCount
                    };

                    partitions.Add(partitionInfo);
                }

                var replicationFactor = topic.Partitions.Count > 0 
                    ? (short)(topic.Partitions[0].Replicas?.Count() ?? 0) 
                    : (short)0;

                var overview = new TopicOverview
                {
                    Partitions = topic.Partitions.Count,
                    ReplicationFactor = replicationFactor,
                    UnderReplicatedPartitions = underReplicatedPartitions,
                    InSyncReplicas = replicationFactor, // Average ISR per partition
                    TotalInSyncReplicas = totalInSyncReplicas,
                    Type = "topic", // Could be enhanced to detect compacted topics
                    SegmentSize = segmentSize,
                    SegmentCount = 0, // Not easily available without additional queries
                    CleanupPolicy = cleanupPolicy,
                    MessageCount = totalMessageCount
                };

                return new TopicPartitionsResponse
                {
                    TopicName = topicName,
                    Partitions = partitions.OrderBy(p => p.PartitionId).ToList(),
                    Overview = overview
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving partition details for topic {topicName}");
                throw;
            }
        }

        // ============================================================
        // Health Monitoring Methods
        // ============================================================

        /// <summary>
        /// Builds the list of namespaces to check for Kafka resources
        /// </summary>
        private HashSet<string> GetKafkaNamespaces()
        {
            var configuredNamespaces = _configuration.GetSection("KubernetesInfo:Namespaces").Get<List<string>>() ?? new List<string>();
            var kafkaNamespace = _configuration.GetValue<string>("Kafka:Namespace");
            var kafkaNamespaces = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            
            // Add configured namespaces first
            foreach (var ns in configuredNamespaces)
            {
                kafkaNamespaces.Add(ns);
            }
            
            // Add Kafka-specific namespace if configured
            if (!string.IsNullOrEmpty(kafkaNamespace))
            {
                kafkaNamespaces.Add(kafkaNamespace);
            }
            
            // Add common fallback namespaces
            kafkaNamespaces.Add("kafka");
            kafkaNamespaces.Add("default");

            return kafkaNamespaces;
        }

        /// <summary>
        /// Fetches desired broker and controller replicas and their nodeIds from Strimzi KafkaNodePool resources
        /// Optimized: Queries namespaces in parallel
        /// </summary>
        private async Task<(int DesiredBrokers, int DesiredControllers, List<int> BrokerNodeIds, List<int> ControllerNodeIds)> FetchDesiredReplicasFromStrimziAsync()
        {
            int desiredBrokers = 0;
            int desiredControllers = 0;
            var brokerNodeIds = new List<int>();
            var controllerNodeIds = new List<int>();

            if (_kubernetesClient == null)
            {
                _logger.LogWarning("Kubernetes client not available, cannot fetch desired replicas from Strimzi");
                return (desiredBrokers, desiredControllers, brokerNodeIds, controllerNodeIds);
            }

            try
            {
                var kafkaNamespaces = GetKafkaNamespaces();

                // Query all namespaces in parallel for better performance
                var namespaceTasks = kafkaNamespaces.Select(async ns =>
                {
                    try
                    {
                        var nodePools = await _kubernetesClient.CustomObjects.ListNamespacedCustomObjectAsync(
                            group: "kafka.strimzi.io",
                            version: "v1beta2",
                            namespaceParameter: ns,
                            plural: "kafkanodepools"
                        );

                        var result = (Brokers: 0, Controllers: 0, BrokerNodeIds: new List<int>(), ControllerNodeIds: new List<int>());

                        if (nodePools is JsonElement jsonElement && jsonElement.TryGetProperty("items", out var items))
                        {
                            foreach (var item in items.EnumerateArray())
                            {
                                if (item.TryGetProperty("spec", out var spec))
                                {
                                    // Check roles to determine if it's a broker or controller
                                    var roles = new List<string>();
                                    if (spec.TryGetProperty("roles", out var rolesElement) && rolesElement.ValueKind == JsonValueKind.Array)
                                    {
                                        foreach (var role in rolesElement.EnumerateArray())
                                        {
                                            if (role.ValueKind == JsonValueKind.String)
                                            {
                                                roles.Add(role.GetString() ?? "");
                                            }
                                        }
                                    }

                                    // Get replicas count
                                    if (spec.TryGetProperty("replicas", out var replicasElement))
                                    {
                                        var replicas = replicasElement.GetInt32();
                                        
                                        // Get nodeIds from status if available
                                        var nodeIds = new List<int>();
                                        if (item.TryGetProperty("status", out var status) && 
                                            status.TryGetProperty("nodeIds", out var nodeIdsElement) && 
                                            nodeIdsElement.ValueKind == JsonValueKind.Array)
                                        {
                                            foreach (var nodeId in nodeIdsElement.EnumerateArray())
                                            {
                                                if (nodeId.ValueKind == JsonValueKind.Number && nodeId.TryGetInt32(out var id))
                                                {
                                                    nodeIds.Add(id);
                                                }
                                            }
                                        }
                                        
                                        if (roles.Contains("broker"))
                                        {
                                            result.Brokers = replicas;
                                            result.BrokerNodeIds = nodeIds;
                                            _logger.LogInformation($"Found KafkaNodePool for brokers in namespace '{ns}': {replicas} desired replicas, nodeIds: [{string.Join(", ", nodeIds)}]");
                                        }
                                        else if (roles.Contains("controller"))
                                        {
                                            result.Controllers = replicas;
                                            result.ControllerNodeIds = nodeIds;
                                            _logger.LogInformation($"Found KafkaNodePool for controllers in namespace '{ns}': {replicas} desired replicas, nodeIds: [{string.Join(", ", nodeIds)}]");
                                        }
                                    }
                                }
                            }
                        }

                        return result;
                    }
                    catch (Exception nsEx)
                    {
                        _logger.LogDebug(nsEx, $"Failed to query namespace '{ns}' for KafkaNodePool resources");
                        return (Brokers: 0, Controllers: 0, BrokerNodeIds: new List<int>(), ControllerNodeIds: new List<int>());
                    }
                }).ToList();

                var results = await Task.WhenAll(namespaceTasks);

                // Take the first non-zero value for each (most likely the correct namespace)
                foreach (var result in results)
                {
                    if (result.Brokers > 0 && desiredBrokers == 0)
                    {
                        desiredBrokers = result.Brokers;
                        brokerNodeIds = result.BrokerNodeIds;
                    }
                    if (result.Controllers > 0 && desiredControllers == 0)
                    {
                        desiredControllers = result.Controllers;
                        controllerNodeIds = result.ControllerNodeIds;
                    }
                    
                    // Early exit if we found both
                    if (desiredBrokers > 0 && desiredControllers > 0)
                    {
                        break;
                    }
                }

                if (desiredBrokers == 0 && desiredControllers == 0)
                {
                    _logger.LogWarning("Could not find KafkaNodePool resources in any namespace. Falling back to pod-based counting.");
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch desired replicas from Strimzi KafkaNodePool, will fall back to pod-based counting");
            }

            return (desiredBrokers, desiredControllers, brokerNodeIds, controllerNodeIds);
        }

        /// <summary>
        /// Fetches actual running broker and controller pods from Kubernetes
        /// A pod is considered "ready" if it's in Running phase AND all containers are ready
        /// Optimized: Fetches broker and controller pods in parallel, and queries namespaces in parallel
        /// </summary>
        private async Task<(List<V1Pod> BrokerPods, List<V1Pod> ControllerPods, int ReadyBrokers, int ReadyControllers)> FetchActualPodsFromKubernetesAsync()
        {
            var brokerPods = new List<V1Pod>();
            var controllerPods = new List<V1Pod>();
            int readyBrokers = 0;
            int readyControllers = 0;

            if (_kubernetesClient == null)
            {
                return (brokerPods, controllerPods, readyBrokers, readyControllers);
            }

            try
            {
                var kafkaNamespaces = GetKafkaNamespaces();
                var brokerLabelSelector = "strimzi.io/pool-name=broker";
                var controllerLabelSelector = "strimzi.io/pool-name=controller";

                // Query all namespaces in parallel, and fetch broker/controller pods in parallel for each namespace
                var namespaceTasks = kafkaNamespaces.Select(async ns =>
                {
                    try
                    {
                        // Fetch broker and controller pods in parallel for this namespace
                        var brokerPodsTask = _kubernetesClient.CoreV1.ListNamespacedPodAsync(
                            ns, 
                            labelSelector: brokerLabelSelector
                        );
                        var controllerPodsTask = _kubernetesClient.CoreV1.ListNamespacedPodAsync(
                            ns, 
                            labelSelector: controllerLabelSelector
                        );

                        await Task.WhenAll(brokerPodsTask, controllerPodsTask);

                        var brokerPodsResult = await brokerPodsTask;
                        var controllerPodsResult = await controllerPodsTask;

                        var result = (
                            BrokerPods: new List<V1Pod>(),
                            ControllerPods: new List<V1Pod>(),
                            ReadyBrokers: 0,
                            ReadyControllers: 0
                        );

                        if (brokerPodsResult.Items != null && brokerPodsResult.Items.Any())
                        {
                            result.BrokerPods.AddRange(brokerPodsResult.Items);
                            // Check if pod is ready: Running phase AND all containers ready
                            result.ReadyBrokers = brokerPodsResult.Items.Count(p => 
                                p.Status?.Phase == "Running" && 
                                p.Status?.ContainerStatuses != null &&
                                p.Status.ContainerStatuses.All(c => c.Ready == true));
                            _logger.LogInformation($"Found {brokerPodsResult.Items.Count} broker pod(s) in namespace '{ns}', {result.ReadyBrokers} ready");
                        }

                        if (controllerPodsResult.Items != null && controllerPodsResult.Items.Any())
                        {
                            result.ControllerPods.AddRange(controllerPodsResult.Items);
                            // Check if pod is ready: Running phase AND all containers ready
                            result.ReadyControllers = controllerPodsResult.Items.Count(p => 
                                p.Status?.Phase == "Running" && 
                                p.Status?.ContainerStatuses != null &&
                                p.Status.ContainerStatuses.All(c => c.Ready == true));
                            _logger.LogInformation($"Found {controllerPodsResult.Items.Count} controller pod(s) in namespace '{ns}', {result.ReadyControllers} ready");
                        }

                        return result;
                    }
                    catch (Exception nsEx)
                    {
                        _logger.LogDebug(nsEx, $"Failed to query namespace '{ns}' for pods");
                        return (
                            BrokerPods: new List<V1Pod>(),
                            ControllerPods: new List<V1Pod>(),
                            ReadyBrokers: 0,
                            ReadyControllers: 0
                        );
                    }
                }).ToList();

                var results = await Task.WhenAll(namespaceTasks);

                // Aggregate results from all namespaces (take first non-empty result)
                foreach (var result in results)
                {
                    if (result.BrokerPods.Any() && !brokerPods.Any())
                    {
                        brokerPods.AddRange(result.BrokerPods);
                        readyBrokers = result.ReadyBrokers;
                    }
                    if (result.ControllerPods.Any() && !controllerPods.Any())
                    {
                        controllerPods.AddRange(result.ControllerPods);
                        readyControllers = result.ReadyControllers;
                    }

                    // Early exit if we found both
                    if (brokerPods.Any() && controllerPods.Any())
                    {
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch actual pods from Kubernetes");
            }

            return (brokerPods, controllerPods, readyBrokers, readyControllers);
        }

        public async Task<KafkaClusterHealthResponse> GetClusterHealthAsync()
        {
            try
            {
                _logger.LogInformation("Fetching Kafka cluster health");

                // Fetch desired state, actual pods, and Kafka metadata in parallel for better performance
                var desiredStateTask = FetchDesiredReplicasFromStrimziAsync();
                var actualPodsTask = FetchActualPodsFromKubernetesAsync();
                
                // Get metadata from Kafka for broker details (partition info, etc.)
                // Use a shorter timeout (3 seconds) for health checks to avoid hanging when brokers are down
                // Note: This is done in parallel with Kubernetes queries
                const int healthCheckTimeoutSeconds = 3;
                Metadata? metadata = null;
                var metadataTask = Task.Run(() =>
                {
                    try
                    {
                        using var adminClient = _clientFactory.CreateAdminClient();
                        // Use shorter timeout for health checks
                        return adminClient.GetMetadata(TimeSpan.FromSeconds(healthCheckTimeoutSeconds));
                    }
                    catch (KafkaException ex)
                    {
                        _logger.LogWarning(ex, "Kafka broker transport failure during health check (brokers may be down). Continuing with Kubernetes-only data.");
                        return null;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to fetch Kafka metadata for health check (brokers may be down). Continuing with Kubernetes-only data.");
                        return null;
                    }
                });

                // Wait for all tasks, but don't fail if metadata times out
                await Task.WhenAll(desiredStateTask, actualPodsTask, metadataTask);

                var (desiredBrokers, desiredControllers, brokerNodeIds, controllerNodeIds) = await desiredStateTask;
                var (brokerPods, controllerPods, readyBrokers, readyControllers) = await actualPodsTask;
                
                // Get metadata with timeout handling - if it fails, we'll continue without partition info
                try
                {
                    metadata = await metadataTask.WaitAsync(TimeSpan.FromSeconds(healthCheckTimeoutSeconds + 1));
                }
                catch (KafkaException ex)
                {
                    _logger.LogWarning(ex, "Kafka broker transport failure during health check. Continuing with Kubernetes-only data.");
                    metadata = null;
                }
                catch (TimeoutException)
                {
                    _logger.LogWarning("Kafka metadata fetch timed out after {TimeoutSeconds} seconds. Continuing health check without partition information.", healthCheckTimeoutSeconds);
                    metadata = null;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to fetch Kafka metadata for health check. Continuing with Kubernetes-only data.");
                    metadata = null;
                }

                // If we couldn't get desired state from Strimzi, use pod count as fallback
                var totalBrokers = desiredBrokers > 0 ? desiredBrokers : brokerPods.Count;
                var totalControllers = desiredControllers > 0 ? desiredControllers : controllerPods.Count;

                var brokers = new List<BrokerHealth>();

                // Create a map of online broker IDs from Kubernetes pods (source of truth for online status)
                var onlineBrokerIds = new HashSet<int>();
                foreach (var pod in brokerPods)
                {
                    var brokerId = ExtractBrokerIdFromPod(pod);
                    if (brokerId >= 0)
                    {
                        // Check if pod is actually ready (Running phase AND all containers ready)
                        var isReady = pod.Status?.Phase == "Running" &&
                                     pod.Status?.ContainerStatuses != null &&
                                     pod.Status.ContainerStatuses.All(c => c.Ready == true);
                        if (isReady)
                        {
                            onlineBrokerIds.Add(brokerId);
                        }
                    }
                }

                // Process all desired brokers - use pod status for online/offline, metadata only for partition info
                // Use actual nodeIds from KafkaNodePool if available, otherwise fall back to sequential IDs
                var brokerIdsToProcess = brokerNodeIds.Count > 0 ? brokerNodeIds : Enumerable.Range(0, totalBrokers).ToList();
                
                foreach (var brokerId in brokerIdsToProcess)
                {
                    // Determine online status from Kubernetes pods (not metadata)
                    var isOnline = onlineBrokerIds.Contains(brokerId);

                    // Get broker info from metadata (for host/port and partition info only)
                    // If metadata is null (brokers down), we'll use pod info for host/port
                    var metadataBroker = metadata?.Brokers?.FirstOrDefault(b => b.BrokerId == brokerId);
                    
                    // Get host/port from pod if metadata is unavailable
                    string host = metadataBroker?.Host ?? "Unknown";
                    int port = metadataBroker?.Port ?? 0;
                    if (string.IsNullOrEmpty(host) || host == "Unknown")
                    {
                        var pod = brokerPods.FirstOrDefault(p => ExtractBrokerIdFromPod(p) == brokerId);
                        if (pod != null)
                        {
                            host = pod.Status?.PodIP ?? pod.Metadata?.Name ?? "Unknown";
                            // Try to get port from pod service or use default
                            port = 9092; // Default Kafka broker port
                        }
                    }

                    // Count partitions where this broker is a leader (from metadata, if available)
                    var leaderPartitionCount = 0;
                    var partitionCount = 0;
                    if (metadata != null && metadata.Topics != null)
                    {
                        leaderPartitionCount = metadata.Topics
                            .SelectMany(t => t.Partitions)
                            .Count(p => p.Leader == brokerId);

                        partitionCount = metadata.Topics
                            .SelectMany(t => t.Partitions)
                            .Count(p => p.Replicas.Contains(brokerId));
                    }

                    brokers.Add(new BrokerHealth
                    {
                        BrokerId = brokerId,
                        Host = host,
                        Port = port,
                        IsOnline = isOnline, // Based on pod status, not metadata
                        PartitionCount = partitionCount,
                        LeaderPartitionCount = leaderPartitionCount,
                        NodeType = "Broker"
                    });
                }

                // Also add any brokers from metadata that aren't in our desired range (shouldn't happen, but handle it)
                if (metadata != null && metadata.Brokers != null && metadata.Topics != null)
                {
                    foreach (var broker in metadata.Brokers)
                    {
                        if (broker.BrokerId >= totalBrokers)
                        {
                            var leaderPartitionCount = metadata.Topics
                                .SelectMany(t => t.Partitions)
                                .Count(p => p.Leader == broker.BrokerId);

                            var partitionCount = metadata.Topics
                                .SelectMany(t => t.Partitions)
                                .Count(p => p.Replicas.Contains(broker.BrokerId));

                            brokers.Add(new BrokerHealth
                            {
                                BrokerId = broker.BrokerId,
                                Host = broker.Host,
                                Port = broker.Port,
                                IsOnline = false, // Not in desired set, mark as offline
                                PartitionCount = partitionCount,
                                LeaderPartitionCount = leaderPartitionCount,
                                NodeType = "Broker"
                            });
                        }
                    }
                }

                // Fetch broker resource metrics if available
                await FetchBrokerResourceMetricsAsync(brokers);

                // Fetch controllers from Kubernetes (KRaft mode)
                var controllers = new List<ControllerHealth>();
                var onlineControllers = 0;
                var activeControllers = 0;
                
                // Create a map of existing controllers from Kubernetes
                var existingControllersMap = new Dictionary<int, ControllerHealth>();
                
                if (_kubernetesClient != null)
                {
                    try
                    {
                        var controllerData = await FetchControllersFromKubernetesAsync();
                        // Map existing controllers by ID for quick lookup
                        foreach (var controller in controllerData.Controllers)
                        {
                            existingControllersMap[controller.ControllerId] = controller;
                        }
                        // Use desired controllers if available, otherwise use fetched count
                        if (desiredControllers > 0)
                        {
                            // Update online count from actual pods (more accurate)
                            onlineControllers = readyControllers > 0 ? readyControllers : controllerData.OnlineControllers;
                        }
                        else
                        {
                            onlineControllers = controllerData.OnlineControllers;
                        }
                        activeControllers = controllerData.ActiveControllers;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to fetch Kafka controllers from Kubernetes, continuing without controller data");
                        // Use ready controllers from pod fetch if available
                        if (readyControllers > 0)
                        {
                            onlineControllers = readyControllers;
                        }
                    }
                }

                // Ensure all desired controllers are included (even if offline)
                // Use actual nodeIds from KafkaNodePool if available, otherwise fall back to sequential IDs
                var controllerIdsToCheck = controllerNodeIds.Count > 0 ? controllerNodeIds : Enumerable.Range(0, totalControllers).ToList();
                
                foreach (var controllerId in controllerIdsToCheck)
                {
                    if (existingControllersMap.TryGetValue(controllerId, out var existingController))
                    {
                        controllers.Add(existingController);
                    }
                    else
                    {
                        // Add offline controller entry
                        controllers.Add(new ControllerHealth
                        {
                            ControllerId = controllerId,
                            Host = "Unknown",
                            Port = 0,
                            IsOnline = false,
                            IsActive = false
                        });
                    }
                }

                // Count actual online controllers from the final controllers list (source of truth)
                onlineControllers = controllers.Count(c => c.IsOnline);
                activeControllers = controllers.Count(c => c.IsActive);

                // Use ready brokers from pod fetch (Kubernetes is source of truth for online status)
                // Never fall back to metadata for online status - metadata may be stale/cached
                var onlineBrokers = readyBrokers; // Always use pod status
                var offlineBrokers = totalBrokers - onlineBrokers;
                var offlineControllers = totalControllers - onlineControllers;
                
                // Calculate health score based on desired vs actual
                var totalNodes = totalBrokers + totalControllers;
                var onlineNodes = onlineBrokers + onlineControllers;
                var healthScore = totalNodes > 0 ? (double)onlineNodes / totalNodes * 100 : 100;
                
                // Warn if more than one active controller (split-brain scenario)
                if (activeControllers > 1)
                {
                    _logger.LogWarning($"Multiple active controllers detected ({activeControllers}). This may indicate a split-brain scenario.");
                }

                _logger.LogInformation($"Kafka cluster health: {onlineBrokers}/{totalBrokers} brokers (desired: {desiredBrokers}), {onlineControllers}/{totalControllers} controllers (desired: {desiredControllers}) online");

                return new KafkaClusterHealthResponse
                {
                    ClusterId = metadata?.OriginatingBrokerId.ToString() ?? string.Empty,
                    TotalBrokers = totalBrokers,
                    OnlineBrokers = onlineBrokers,
                    OfflineBrokers = offlineBrokers,
                    TotalControllers = totalControllers,
                    OnlineControllers = onlineControllers,
                    OfflineControllers = offlineControllers,
                    ActiveControllers = activeControllers,
                    HealthScore = Math.Round(healthScore, 2),
                    Brokers = brokers,
                    Controllers = controllers,
                    Timestamp = DateTime.UtcNow
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching Kafka cluster health");
                throw;
            }
        }

        public async Task<KafkaBrokerHealthResponse> GetBrokerHealthAsync()
        {
            try
            {
                var clusterHealth = await GetClusterHealthAsync();

                return new KafkaBrokerHealthResponse
                {
                    Brokers = clusterHealth.Brokers,
                    TotalBrokers = clusterHealth.TotalBrokers,
                    OnlineBrokers = clusterHealth.OnlineBrokers,
                    OfflineBrokers = clusterHealth.OfflineBrokers
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching broker health");
                throw;
            }
        }

        public async Task<TopicHealthSummaryResponse> GetTopicHealthSummaryAsync()
        {
            try
            {
                _logger.LogInformation("Fetching topic health summary (optimized with cache service)");

                // Get cached consumer group offsets for all topics (optimized - fetches once per request)
                var offsetCacheService = _httpContextAccessor.HttpContext?.RequestServices
                    .GetRequiredService<IConsumerGroupOffsetCacheService>();
                
                ConsumerGroupOffsetCache? offsetCache = null;
                if (offsetCacheService != null)
                {
                    try
                    {
                        offsetCache = await offsetCacheService.GetOrFetchAllConsumerGroupOffsetsAsync();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to fetch consumer group offsets for topics health, continuing without lag data");
                    }
                }

                var topics = await GetTopicsAsync();
                using var adminClient = _clientFactory.CreateAdminClient();
                
                // Get active consumer status once for all groups (optimized - single call instead of inside GetConsumerGroupTopicAssociationsAsync)
                Dictionary<string, (bool hasActiveConsumers, int activeConsumerCount, string state)>? groupActiveStatus = null;
                DescribeConsumerGroupsResult? describeResult = null;
                if (offsetCache != null && offsetCache.ConsumerGroups.Count > 0)
                {
                    try
                    {
                        var groupIds = offsetCache.ConsumerGroups
                            .Select(g => g.GroupId)
                            .Distinct()
                            .ToList();
                        
                        describeResult = await adminClient.DescribeConsumerGroupsAsync(
                            groupIds,
                            new DescribeConsumerGroupsOptions
                            {
                                RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                            }
                        );

                        groupActiveStatus = describeResult.ConsumerGroupDescriptions
                            .ToDictionary(
                                d => d.GroupId,
                                d => {
                                    var activeCount = d.Members?.Count ?? 0;
                                    var isStable = d.State.ToString().Equals("Stable", StringComparison.OrdinalIgnoreCase);
                                    return (
                                        hasActiveConsumers: activeCount > 0 && isStable,
                                        activeConsumerCount: activeCount,
                                        state: d.State.ToString()
                                    );
                                }
                            );
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to get consumer group active status, continuing without active consumer detection");
                    }
                }

                var topicHealthList = new List<TopicHealth>();
                var healthyTopics = 0;
                var topicsWithUnderReplicated = 0;
                var topicsWithLag = 0;

                // Process topics in parallel batches for partitions
                var semaphore = new SemaphoreSlim(10); // Limit concurrent partition queries
                var topicTasks = topics.Select(async topic =>
                {
                    await semaphore.WaitAsync();
                    try
                    {
                        var partitionsResponse = await GetTopicPartitionsAsync(topic.Name);
                        var underReplicatedPartitions = partitionsResponse.Overview.UnderReplicatedPartitions;
                        var messageCount = partitionsResponse.Overview.MessageCount;

                        // Calculate consumer lag directly from offsetCache + partition data (optimized - no need for GetConsumerGroupTopicAssociationsAsync)
                        long totalLag = 0;
                        int consumerGroupCount = 0;
                        bool hasActiveConsumers = false;
                        bool hasInactiveGroups = false;

                        if (offsetCache != null)
                        {
                            // Build partition lookup: partitionId -> NextOffset (log end offset)
                            var partitionOffsets = partitionsResponse.Partitions
                                .ToDictionary(p => p.PartitionId, p => p.NextOffset);

                            // Find all consumer groups that have offsets for this topic
                            var topicGroups = offsetCache.ConsumerGroups
                                .Where(g => g.Topics.Any(t => t.TopicName.Equals(topic.Name, StringComparison.OrdinalIgnoreCase)))
                                .ToList();

                            var activeGroupIds = new HashSet<string>();

                            foreach (var group in topicGroups)
                            {
                                var topicOffsetInfo = group.Topics
                                    .FirstOrDefault(t => t.TopicName.Equals(topic.Name, StringComparison.OrdinalIgnoreCase));
                                
                                if (topicOffsetInfo == null) continue;

                                // Check if group has active consumers consuming from this topic
                                bool isActive = false;
                                if (groupActiveStatus != null && 
                                    groupActiveStatus.TryGetValue(group.GroupId, out var status) &&
                                    status.hasActiveConsumers)
                                {
                                    // Check if any member is assigned to partitions from this topic
                                    if (describeResult != null)
                                    {
                                        var groupDesc = describeResult.ConsumerGroupDescriptions
                                            .FirstOrDefault(d => d.GroupId == group.GroupId);
                                        
                                        if (groupDesc?.Members != null)
                                        {
                                            isActive = groupDesc.Members
                                                .Any(member => member.Assignment != null && 
                                                              member.Assignment.TopicPartitions != null &&
                                                              member.Assignment.TopicPartitions.Any(tp => 
                                                                  tp.Topic.Equals(topic.Name, StringComparison.OrdinalIgnoreCase)));
                                        }
                                    }
                                }

                                // Calculate lag for this group-topic combination
                                long groupLag = 0;
                                foreach (var partition in topicOffsetInfo.Partitions)
                                {
                                    if (partitionOffsets.TryGetValue(partition.PartitionId, out var logEndOffset))
                                    {
                                        long validCurrentOffset = partition.LastCommittedOffset < 0 ? 0 : partition.LastCommittedOffset;
                                        long lag = 0;
                                        
                                        if (logEndOffset > 0 && logEndOffset > validCurrentOffset)
                                        {
                                            lag = logEndOffset - validCurrentOffset;
                                        }
                                        
                                        groupLag += lag;
                                    }
                                }

                                // Only count lag from active consumers
                                if (isActive)
                                {
                                    totalLag += groupLag;
                                    activeGroupIds.Add(group.GroupId);
                                    hasActiveConsumers = true;
                                }
                                else if (topicOffsetInfo.Partitions.Any(p => p.LastCommittedOffset > 0))
                                {
                                    // Group has offsets but no active consumers
                                    hasInactiveGroups = true;
                                }
                            }

                            consumerGroupCount = activeGroupIds.Count;
                            
                            // Set hasActiveConsumers flag
                            if (!hasActiveConsumers && hasInactiveGroups)
                            {
                                hasActiveConsumers = false; // Explicitly no active consumers
                            }
                        }

                        var hasLag = totalLag > 1000; // Consider lag significant if > 1000 messages
                        if (hasLag)
                        {
                            Interlocked.Increment(ref topicsWithLag);
                        }

                        if (underReplicatedPartitions > 0)
                        {
                            Interlocked.Increment(ref topicsWithUnderReplicated);
                        }

                        var healthStatus = underReplicatedPartitions > 0 ? "Critical" :
                                          hasLag ? "Warning" : "Healthy";

                        if (healthStatus == "Healthy")
                        {
                            Interlocked.Increment(ref healthyTopics);
                        }

                        return new TopicHealth
                        {
                            TopicName = topic.Name,
                            PartitionCount = topic.PartitionCount,
                            ReplicationFactor = topic.ReplicationFactor,
                            UnderReplicatedPartitions = underReplicatedPartitions,
                            TotalMessages = messageCount,
                            TotalLag = totalLag,
                            ConsumerGroupCount = consumerGroupCount,
                            HealthStatus = healthStatus,
                            HasActiveConsumers = hasActiveConsumers ? true : 
                                                (hasInactiveGroups ? false : (bool?)null)
                        };
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, $"Error getting health for topic {topic.Name}");
                        
                        return new TopicHealth
                        {
                            TopicName = topic.Name,
                            PartitionCount = topic.PartitionCount,
                            ReplicationFactor = topic.ReplicationFactor,
                            HealthStatus = "Unknown"
                        };
                    }
                    finally
                    {
                        semaphore.Release();
                    }
                });

                topicHealthList = (await Task.WhenAll(topicTasks)).ToList();

                _logger.LogInformation($"Topic health: {healthyTopics}/{topics.Count} healthy");

                return new TopicHealthSummaryResponse
                {
                    TotalTopics = topics.Count,
                    HealthyTopics = healthyTopics,
                    TopicsWithUnderReplicatedPartitions = topicsWithUnderReplicated,
                    TopicsWithLag = topicsWithLag,
                    Topics = topicHealthList
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching topic health summary");
                throw;
            }
        }

        public async Task<ConsumerLagSummaryResponse> GetConsumerLagSummaryAsync(string[]? topicNames = null)
        {
            try
            {
                _logger.LogInformation("Fetching consumer lag summary");

                ConsumerGroupTopicAssociationsResponse consumerAssociations;
                
                if (topicNames != null && topicNames.Length > 0)
                {
                    // Get consumer associations for specific topics
                    var allAssociations = new List<ConsumerGroupTopicAssociation>();
                    
                    foreach (var topicName in topicNames)
                    {
                        try
                        {
                            var associations = await GetConsumerGroupTopicAssociationsAsync(topicName);
                            allAssociations.AddRange(associations.Associations);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, $"Error getting consumer associations for topic {topicName}");
                        }
                    }

                    consumerAssociations = new ConsumerGroupTopicAssociationsResponse
                    {
                        Associations = allAssociations
                    };
                }
                else
                {
                    // Get all consumer associations
                    consumerAssociations = await GetConsumerGroupTopicAssociationsAsync();
                }

                var consumerGroupHealthDict = new Dictionary<string, ConsumerGroupHealth>();
                long totalLag = 0;
                var groupsWithLag = 0;

                foreach (var association in consumerAssociations.Associations)
                {
                    var groupLag = association.TotalLag;
                    totalLag += groupLag;

                    if (groupLag > 0)
                    {
                        groupsWithLag++;
                    }

                    var key = $"{association.GroupId}_{association.Topic}";
                    consumerGroupHealthDict[key] = new ConsumerGroupHealth
                    {
                        GroupId = association.GroupId,
                        TopicName = association.Topic,
                        TotalLag = groupLag,
                        ActiveConsumers = 0, // Not available in association data
                        PartitionLags = association.Partitions.Select(p => new PartitionLag
                        {
                            PartitionId = p.Partition,
                            CurrentOffset = p.CurrentOffset,
                            LogEndOffset = p.LogEndOffset,
                            Lag = p.Lag
                        }).ToList(),
                        State = "Unknown" // Not available in association data
                    };
                }

                _logger.LogInformation($"Consumer lag: {groupsWithLag} groups with lag, total lag: {totalLag}");

                return new ConsumerLagSummaryResponse
                {
                    ConsumerGroups = consumerGroupHealthDict,
                    TotalLag = totalLag,
                    GroupsWithLag = groupsWithLag,
                    Timestamp = DateTime.UtcNow
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching consumer lag summary");
                throw;
            }
        }

        // ============================================================
        // Resource Metrics Helper Methods
        // ============================================================

        private async Task FetchBrokerResourceMetricsAsync(List<BrokerHealth> brokers)
        {
            if (_metricsService == null || _kubernetesClient == null)
                return;

            try
            {
                // Build list of namespaces to check
                var configuredNamespaces = _configuration.GetSection("KubernetesInfo:Namespaces").Get<List<string>>() ?? new List<string>();
                var kafkaNamespace = _configuration.GetValue<string>("Kafka:Namespace");
                var kafkaNamespaces = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                
                // Add configured namespaces first
                foreach (var ns in configuredNamespaces)
                {
                    kafkaNamespaces.Add(ns);
                }
                
                // Add Kafka-specific namespace if configured
                if (!string.IsNullOrEmpty(kafkaNamespace))
                {
                    kafkaNamespaces.Add(kafkaNamespace);
                }
                
                // Add common fallback namespaces
                kafkaNamespaces.Add("kafka");
                kafkaNamespaces.Add("default");
                
                // Use Strimzi label selector
                var brokerLabelSelector = "strimzi.io/pool-name=broker";
                
                _logger.LogInformation($"Searching for Kafka brokers using label selector: {brokerLabelSelector} in {kafkaNamespaces.Count} namespaces");
                
                // Find all broker pods using the label selector
                Dictionary<string, (V1Pod Pod, PodMetrics? Metrics)> brokerPods = new();
                
                foreach (var ns in kafkaNamespaces)
                {
                    try
                    {
                        _logger.LogDebug($"Checking namespace '{ns}' for broker pods");
                        var pods = await _kubernetesClient.CoreV1.ListNamespacedPodAsync(
                            ns, 
                            labelSelector: brokerLabelSelector
                        );
                        
                        if (pods.Items != null && pods.Items.Any())
                        {
                            _logger.LogInformation($"Found {pods.Items.Count} broker pod(s) in namespace '{ns}'");
                            
                            // Get pod metrics for this namespace
                            Dictionary<string, PodMetrics>? podMetrics = null;
                            try
                            {
                                podMetrics = await _metricsService.GetPodMetricsAsync(ns);
                            }
                            catch
                            {
                                // Continue without metrics
                            }
                            
                            foreach (var pod in pods.Items)
                            {
                                var podName = pod.Metadata?.Name ?? "";
                                if (!string.IsNullOrEmpty(podName))
                                {
                                    PodMetrics? metrics = null;
                                    if (podMetrics != null)
                                    {
                                        podMetrics.TryGetValue(podName, out metrics);
                                    }
                                    brokerPods[podName] = (pod, metrics);
                                }
                            }
                            
                            break; // Found brokers, exit namespace loop
                        }
                    }
                    catch (Exception nsEx)
                    {
                        _logger.LogDebug(nsEx, $"Failed to query namespace '{ns}' for broker pods, trying next namespace");
                        // Try next namespace
                    }
                }
                
                if (brokerPods.Count == 0)
                {
                    _logger.LogWarning($"No Kafka broker pods found using label selector '{brokerLabelSelector}' in any of the checked namespaces");
                    return;
                }

                // Match broker pods to broker IDs and update broker health
                foreach (var broker in brokers)
                {
                    V1Pod? matchedPod = null;
                    PodMetrics? brokerMetrics = null;
                    string? foundPodName = null;
                    
                    // Try to match by broker ID from pod labels or name
                    foreach (var (podName, (pod, metrics)) in brokerPods)
                    {
                        // Try to get broker ID from pod labels
                        var podBrokerId = -1;
                        if (pod.Metadata?.Labels != null)
                        {
                            // Check for strimzi.io/broker-id label
                            if (pod.Metadata.Labels.TryGetValue("strimzi.io/broker-id", out var brokerIdLabel) &&
                                int.TryParse(brokerIdLabel, out var parsedId))
                            {
                                podBrokerId = parsedId;
                            }
                            // Also try extracting from pod name as fallback
                            else
                            {
                                var nameMatch = Regex.Match(podName, @"(\d+)$");
                                if (nameMatch.Success && int.TryParse(nameMatch.Value, out var nameId))
                                {
                                    podBrokerId = nameId;
                                }
                            }
                        }
                        else
                        {
                            // Fallback: extract from pod name
                            var nameMatch = Regex.Match(podName, @"(\d+)$");
                            if (nameMatch.Success && int.TryParse(nameMatch.Value, out var nameId))
                            {
                                podBrokerId = nameId;
                            }
                        }
                        
                        // Match by broker ID
                        if (podBrokerId == broker.BrokerId)
                        {
                            matchedPod = pod;
                            brokerMetrics = metrics;
                            foundPodName = podName;
                            break;
                        }
                    }
                    
                    if (matchedPod != null && !string.IsNullOrEmpty(foundPodName))
                    {
                        broker.PodName = foundPodName;
                        
                        long memUsageBytes = 0;
                        if (brokerMetrics != null)
                        {
                            // Format CPU usage
                            broker.CpuUsage = brokerMetrics.CpuUsage;
                            
                            // Format memory usage to MB
                            memUsageBytes = ParseMemoryQuantity(brokerMetrics.MemoryUsage);
                            broker.MemoryUsage = FormatMemoryToMB(memUsageBytes);
                        }
                        
                        // Get pod resource limits/requests
                        var containers = matchedPod.Spec?.Containers ?? new List<V1Container>();
                        long totalCpuLimit = 0;
                        long totalCpuRequest = 0;
                        long totalMemoryLimit = 0;
                        long totalMemoryRequest = 0;
                        
                        foreach (var container in containers)
                        {
                            // CPU Limit
                            if (container.Resources?.Limits?.ContainsKey("cpu") == true)
                            {
                                var cpuLimitStr = container.Resources.Limits["cpu"].ToString();
                                totalCpuLimit += ParseCpuQuantity(cpuLimitStr);
                            }
                            // CPU Request
                            if (container.Resources?.Requests?.ContainsKey("cpu") == true)
                            {
                                var cpuRequestStr = container.Resources.Requests["cpu"].ToString();
                                totalCpuRequest += ParseCpuQuantity(cpuRequestStr);
                            }
                            // Memory Limit
                            if (container.Resources?.Limits?.ContainsKey("memory") == true)
                            {
                                var memLimitStr = container.Resources.Limits["memory"].ToString();
                                totalMemoryLimit += ParseMemoryQuantity(memLimitStr);
                            }
                            // Memory Request
                            if (container.Resources?.Requests?.ContainsKey("memory") == true)
                            {
                                var memRequestStr = container.Resources.Requests["memory"].ToString();
                                totalMemoryRequest += ParseMemoryQuantity(memRequestStr);
                            }
                        }
                        
                        // Format and set CPU values
                        if (totalCpuLimit > 0)
                        {
                            broker.CpuLimit = FormatCpuQuantity(totalCpuLimit);
                            if (brokerMetrics != null && !string.IsNullOrEmpty(brokerMetrics.CpuUsage))
                            {
                                var cpuUsageValue = ParseCpuQuantity(brokerMetrics.CpuUsage);
                                broker.CpuUsagePercent = (cpuUsageValue / (double)totalCpuLimit) * 100;
                            }
                        }
                        if (totalCpuRequest > 0)
                        {
                            broker.CpuRequest = FormatCpuQuantity(totalCpuRequest);
                        }
                        
                        // Format and set Memory values
                        if (totalMemoryLimit > 0)
                        {
                            broker.MemoryLimit = FormatMemoryToMB(totalMemoryLimit);
                            if (brokerMetrics != null && memUsageBytes > 0)
                            {
                                broker.MemoryUsagePercent = (memUsageBytes / (double)totalMemoryLimit) * 100;
                            }
                        }
                        if (totalMemoryRequest > 0)
                        {
                            broker.MemoryRequest = FormatMemoryToMB(totalMemoryRequest);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch pod metrics for Kafka brokers, continuing without resource data");
            }
        }

        private async Task<(List<ControllerHealth> Controllers, int TotalControllers, int OnlineControllers, int ActiveControllers)> FetchControllersFromKubernetesAsync()
        {
            var controllers = new List<ControllerHealth>();
            var totalControllers = 0;
            var onlineControllers = 0;
            var activeControllers = 0;

            if (_kubernetesClient == null || _metricsService == null)
                return (controllers, totalControllers, onlineControllers, activeControllers);

            try
            {
                // Build list of namespaces to check
                var configuredNamespaces = _configuration.GetSection("KubernetesInfo:Namespaces").Get<List<string>>() ?? new List<string>();
                var kafkaNamespace = _configuration.GetValue<string>("Kafka:Namespace");
                var kafkaNamespaces = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                
                // Add configured namespaces first
                foreach (var ns in configuredNamespaces)
                {
                    kafkaNamespaces.Add(ns);
                }
                
                // Add Kafka-specific namespace if configured
                if (!string.IsNullOrEmpty(kafkaNamespace))
                {
                    kafkaNamespaces.Add(kafkaNamespace);
                }
                
                // Add common fallback namespaces
                kafkaNamespaces.Add("kafka");
                kafkaNamespaces.Add("default");
                
                // Use Strimzi label selector
                var controllerLabelSelector = "strimzi.io/pool-name=controller";
                
                _logger.LogInformation($"Searching for Kafka controllers using label selector: {controllerLabelSelector} in {kafkaNamespaces.Count} namespaces");
                
                foreach (var ns in kafkaNamespaces)
                {
                    try
                    {
                        _logger.LogDebug($"Checking namespace '{ns}' for controllers");
                        var pods = await _kubernetesClient.CoreV1.ListNamespacedPodAsync(
                            ns, 
                            labelSelector: controllerLabelSelector
                        );
                        
                        if (pods.Items != null && pods.Items.Any())
                        {
                            _logger.LogInformation($"Found {pods.Items.Count} controller(s) in namespace '{ns}'");
                            totalControllers = pods.Items.Count;
                            
                            // Get pod metrics for controllers
                            Dictionary<string, PodMetrics>? controllerMetrics = null;
                            try
                            {
                                controllerMetrics = await _metricsService.GetPodMetricsAsync(ns);
                            }
                            catch
                            {
                                // Continue without metrics
                            }
                            
                            var activeControllerPodNames = await FetchActiveControllerPodNamesAsync(pods.Items);
                            var hasMetricBasedActiveSignal = activeControllerPodNames.Count > 0;

                            if (hasMetricBasedActiveSignal && activeControllerPodNames.Count > 1)
                            {
                                _logger.LogWarning("Kafka metrics reported multiple active controllers ({ActiveCount}): {PodNames}",
                                    activeControllerPodNames.Count,
                                    string.Join(", ", activeControllerPodNames));
                            }

                            foreach (var pod in pods.Items)
                            {
                                // A controller is considered "online" if it's Running AND all containers are ready
                                // This matches the logic in FetchActualPodsFromKubernetesAsync for consistency
                                var isOnline = pod.Status?.Phase == "Running" && 
                                              pod.Status?.ContainerStatuses != null &&
                                              pod.Status.ContainerStatuses.All(c => c.Ready == true);
                                if (isOnline)
                                {
                                    onlineControllers++;
                                }
                                
                                // Prefer Kafka's own active-controller metric. Only fall back to labels when metrics cannot be read.
                                var podName = pod.Metadata?.Name ?? string.Empty;
                                var isActive = hasMetricBasedActiveSignal
                                    ? activeControllerPodNames.Contains(podName)
                                    : pod.Metadata?.Labels?.ContainsKey("active-controller") == true ||
                                      (pod.Status?.Conditions?.Any(c =>
                                          c.Type == "Ready" && c.Status == "True") == true &&
                                       pod.Metadata?.Labels?.Any(l =>
                                           l.Key.Contains("controller") && l.Value.Contains("active")) == true);

                                if (isActive)
                                {
                                    activeControllers++;
                                }
                                
                                var controllerId = ExtractControllerIdFromPod(pod);
                                
                                var controller = new ControllerHealth
                                {
                                    ControllerId = controllerId,
                                    Host = pod.Status?.PodIP ?? pod.Metadata?.Name ?? "",
                                    Port = 9093, // Default controller port
                                    IsOnline = isOnline,
                                    IsActive = isActive,
                                    PodName = pod.Metadata?.Name
                                };
                                
                                // Get resource metrics if available
                                if (controllerMetrics != null && !string.IsNullOrEmpty(controller.PodName))
                                {
                                    if (controllerMetrics.TryGetValue(controller.PodName, out var metrics))
                                    {
                                        controller.CpuUsage = metrics.CpuUsage;
                                        
                                        var memUsageBytes = ParseMemoryQuantity(metrics.MemoryUsage);
                                        controller.MemoryUsage = FormatMemoryToMB(memUsageBytes);
                                        
                                        // Get pod resource limits/requests
                                        var containers = pod.Spec?.Containers ?? new List<V1Container>();
                                        long totalCpuLimit = 0;
                                        long totalCpuRequest = 0;
                                        long totalMemoryLimit = 0;
                                        long totalMemoryRequest = 0;
                                        
                                        foreach (var container in containers)
                                        {
                                            if (container.Resources?.Limits?.ContainsKey("cpu") == true)
                                            {
                                                totalCpuLimit += ParseCpuQuantity(container.Resources.Limits["cpu"].ToString());
                                            }
                                            if (container.Resources?.Requests?.ContainsKey("cpu") == true)
                                            {
                                                totalCpuRequest += ParseCpuQuantity(container.Resources.Requests["cpu"].ToString());
                                            }
                                            if (container.Resources?.Limits?.ContainsKey("memory") == true)
                                            {
                                                totalMemoryLimit += ParseMemoryQuantity(container.Resources.Limits["memory"].ToString());
                                            }
                                            if (container.Resources?.Requests?.ContainsKey("memory") == true)
                                            {
                                                totalMemoryRequest += ParseMemoryQuantity(container.Resources.Requests["memory"].ToString());
                                            }
                                        }
                                        
                                        if (totalCpuLimit > 0)
                                        {
                                            controller.CpuLimit = FormatCpuQuantity(totalCpuLimit);
                                            if (!string.IsNullOrEmpty(metrics.CpuUsage))
                                            {
                                                var cpuUsageValue = ParseCpuQuantity(metrics.CpuUsage);
                                                controller.CpuUsagePercent = (cpuUsageValue / (double)totalCpuLimit) * 100;
                                            }
                                        }
                                        if (totalCpuRequest > 0)
                                        {
                                            controller.CpuRequest = FormatCpuQuantity(totalCpuRequest);
                                        }
                                        if (totalMemoryLimit > 0)
                                        {
                                            controller.MemoryLimit = FormatMemoryToMB(totalMemoryLimit);
                                            if (memUsageBytes > 0)
                                            {
                                                controller.MemoryUsagePercent = (memUsageBytes / (double)totalMemoryLimit) * 100;
                                            }
                                        }
                                        if (totalMemoryRequest > 0)
                                        {
                                            controller.MemoryRequest = FormatMemoryToMB(totalMemoryRequest);
                                        }
                                    }
                                }
                                
                                controllers.Add(controller);
                            }
                            
                            break; // Found controllers, exit namespace loop
                        }
                    }
                    catch (Exception nsEx)
                    {
                        _logger.LogDebug(nsEx, $"Failed to query namespace '{ns}' for controllers, trying next namespace");
                        // Try next namespace
                    }
                }
                
                if (totalControllers == 0)
                {
                    _logger.LogWarning($"No Kafka controllers found using label selector '{controllerLabelSelector}' in any of the checked namespaces");
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch Kafka controllers from Kubernetes");
            }

            return (controllers, totalControllers, onlineControllers, activeControllers);
        }

        private async Task<HashSet<string>> FetchActiveControllerPodNamesAsync(IEnumerable<V1Pod> controllerPods)
        {
            var activePodNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var checks = controllerPods.Select(async pod =>
            {
                var podName = pod.Metadata?.Name;
                if (string.IsNullOrWhiteSpace(podName))
                {
                    return (PodName: string.Empty, IsActive: false);
                }

                var isActive = await IsControllerActiveFromMetricsAsync(pod);
                return (PodName: podName, IsActive: isActive);
            });

            var results = await Task.WhenAll(checks);
            foreach (var result in results)
            {
                if (result.IsActive && !string.IsNullOrWhiteSpace(result.PodName))
                {
                    activePodNames.Add(result.PodName);
                }
            }

            return activePodNames;
        }

        private async Task<bool> IsControllerActiveFromMetricsAsync(V1Pod pod)
        {
            var podIp = pod.Status?.PodIP;
            if (string.IsNullOrWhiteSpace(podIp))
            {
                return false;
            }

            try
            {
                using var httpClient = new HttpClient
                {
                    Timeout = TimeSpan.FromSeconds(3)
                };

                var metricsUrl = $"http://{podIp}:9404/metrics";
                var metricsText = await httpClient.GetStringAsync(metricsUrl);
                var match = Regex.Match(
                    metricsText,
                    @"kafka_controller_kafkacontroller_activecontrollercount\s+(?<value>[0-9.]+)",
                    RegexOptions.IgnoreCase);

                if (!match.Success)
                {
                    return false;
                }

                return double.TryParse(match.Groups["value"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value >= 1;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Unable to read active-controller metric for pod {PodName}", pod.Metadata?.Name);
                return false;
            }
        }

        private int ExtractBrokerIdFromPod(V1Pod pod)
        {
            if (pod?.Metadata == null)
                return -1;

            // Try to get broker ID from pod labels first
            if (pod.Metadata.Labels != null)
            {
                if (pod.Metadata.Labels.TryGetValue("strimzi.io/broker-id", out var brokerIdLabel) &&
                    int.TryParse(brokerIdLabel, out var parsedId))
                {
                    return parsedId;
                }
            }

            // Fallback: extract from pod name (e.g., "kafka-broker-0" -> 0)
            var podName = pod.Metadata.Name ?? "";
            var nameMatch = Regex.Match(podName, @"(\d+)$");
            if (nameMatch.Success && int.TryParse(nameMatch.Value, out var nameId))
            {
                return nameId;
            }

            return -1;
        }

        private int ExtractControllerId(string podName)
        {
            // Try to extract numeric ID from pod name (e.g., "kafka-controller-4" -> 4)
            var match = Regex.Match(podName, @"(\d+)$");
            if (match.Success && int.TryParse(match.Value, out var id))
            {
                return id;
            }
            return -1;
        }
        
        private int ExtractControllerIdFromPod(V1Pod pod)
        {
            if (pod?.Metadata == null)
                return -1;

            // Try to get controller ID from pod labels first (if Strimzi provides it)
            if (pod.Metadata.Labels != null)
            {
                // Strimzi might use a similar label for controllers
                if (pod.Metadata.Labels.TryGetValue("strimzi.io/controller-id", out var controllerIdLabel) &&
                    int.TryParse(controllerIdLabel, out var parsedId))
                {
                    return parsedId;
                }
                // Also check for broker-id label (controllers might use the same)
                if (pod.Metadata.Labels.TryGetValue("strimzi.io/broker-id", out var brokerIdLabel) &&
                    int.TryParse(brokerIdLabel, out var parsedBrokerId))
                {
                    return parsedBrokerId;
                }
            }

            // Fallback: extract from pod name (e.g., "kafka-controller-4" -> 4)
            return ExtractControllerId(pod.Metadata.Name ?? "");
        }

        private long ParseCpuQuantity(string quantity)
        {
            if (string.IsNullOrEmpty(quantity))
                return 0;

            try
            {
                quantity = quantity.Trim();
                
                // CPU parsing (convert to nanocores for consistency)
                if (quantity.EndsWith("n", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.TrimEnd('n', 'N'));
                }
                else if (quantity.EndsWith("u", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.TrimEnd('u', 'U')) * 1_000; // microcores to nanocores
                }
                else if (quantity.EndsWith("m", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.TrimEnd('m', 'M')) * 1_000_000; // millicores to nanocores
                }
                else if (double.TryParse(quantity, out var cpuValue))
                {
                    return (long)(cpuValue * 1_000_000_000); // cores to nanocores
                }
                
                return 0;
            }
            catch
            {
                return 0;
            }
        }

        private long ParseMemoryQuantity(string quantity)
        {
            if (string.IsNullOrEmpty(quantity))
                return 0;
            
            try
            {
                quantity = quantity.Trim();
                
                if (quantity.EndsWith("Ki", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.Replace("Ki", "").Replace("ki", "")) * 1024;
                }
                else if (quantity.EndsWith("Mi", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.Replace("Mi", "").Replace("mi", "")) * 1024 * 1024;
                }
                else if (quantity.EndsWith("Gi", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.Replace("Gi", "").Replace("gi", "")) * 1024L * 1024 * 1024;
                }
                else if (quantity.EndsWith("Ti", StringComparison.OrdinalIgnoreCase))
                {
                    return long.Parse(quantity.Replace("Ti", "").Replace("ti", "")) * 1024L * 1024 * 1024 * 1024;
                }
                
                return long.TryParse(quantity, out var bytes) ? bytes : 0;
            }
            catch
            {
                return 0;
            }
        }

        private string FormatCpuQuantity(long nanocores)
        {
            if (nanocores >= 1_000_000_000)
            {
                var cores = nanocores / 1_000_000_000.0;
                return cores % 1 == 0 ? cores.ToString("F0") : cores.ToString("F2");
            }
            else if (nanocores >= 1_000_000)
            {
                return $"{nanocores / 1_000_000.0:F0}m";
            }
            else if (nanocores >= 1_000)
            {
                return $"{nanocores / 1_000.0:F0}m";
            }
            else
            {
                return $"{nanocores}n";
            }
        }

        private string FormatMemoryToMB(long bytes)
        {
            return $"{bytes / (1024.0 * 1024):F2}Mi";
        }

        public KafkaConfig GetKafkaConfig()
        {
            return new KafkaConfig
            {
                MaxDaysBack = _maxDaysBack,
                MaxRangeDays = _maxRangeDays,
                DefaultRangeDays = _defaultRangeDays
            };
        }
    }
}

