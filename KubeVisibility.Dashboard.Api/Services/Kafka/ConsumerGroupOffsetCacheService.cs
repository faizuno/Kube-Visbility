using KubeVisibility.Dashboard.Api.Models.Kafka;
using Confluent.Kafka;
using Confluent.Kafka.Admin;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;

namespace KubeVisibility.Dashboard.Api.Services.Kafka
{
    /// <summary>
    /// Request-scoped service that caches consumer group offsets for the duration of an HTTP request.
    /// Optimizes performance by fetching offsets once per request and reusing the cached data.
    /// </summary>
    public class ConsumerGroupOffsetCacheService : IConsumerGroupOffsetCacheService
    {
        private readonly IKafkaClientFactory _clientFactory;
        private readonly ILogger<ConsumerGroupOffsetCacheService> _logger;
        private readonly int _defaultTimeoutSeconds;
        private readonly int _maxConcurrency;
        
        // Per-request caches (scoped instance = one per HTTP request)
        private ConsumerGroupOffsetCache? _cachedAllTopicsData;
        private readonly Dictionary<string, ConsumerGroupOffsetCache> _cachedTopicData = new();
        private readonly SemaphoreSlim _fetchAllLock = new SemaphoreSlim(1, 1);
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _fetchTopicLocks = new();

        public ConsumerGroupOffsetCacheService(
            IKafkaClientFactory clientFactory,
            IConfiguration configuration,
            ILogger<ConsumerGroupOffsetCacheService> logger)
        {
            _clientFactory = clientFactory ?? throw new ArgumentNullException(nameof(clientFactory));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _defaultTimeoutSeconds = configuration.GetValue<int>("Kafka:Consumer:DefaultTimeoutSeconds", 30);
            _maxConcurrency = configuration.GetValue<int>("Kafka:Consumer:MaxConcurrency", 20);
        }

        public async Task<ConsumerGroupOffsetCache> GetOrFetchAllConsumerGroupOffsetsAsync()
        {
            if (_cachedAllTopicsData != null)
            {
                _logger.LogDebug("Returning cached all-topics consumer group offsets for this request");
                return _cachedAllTopicsData;
            }

            await _fetchAllLock.WaitAsync();
            try
            {
                if (_cachedAllTopicsData != null)
                {
                    return _cachedAllTopicsData;
                }

                _logger.LogInformation("Fetching all consumer group offsets for all topics (first call in this request)");
                _cachedAllTopicsData = await FetchAllConsumerGroupOffsetsAsync();
                return _cachedAllTopicsData;
            }
            finally
            {
                _fetchAllLock.Release();
            }
        }

        public async Task<ConsumerGroupOffsetCache> GetOrFetchConsumerGroupOffsetsForTopicAsync(string topicName)
        {
            if (string.IsNullOrEmpty(topicName))
            {
                throw new ArgumentException("Topic name cannot be null or empty", nameof(topicName));
            }

            // Check cache for this specific topic
            if (_cachedTopicData.TryGetValue(topicName, out var cachedData))
            {
                _logger.LogDebug($"Returning cached consumer group offsets for topic {topicName}");
                return cachedData;
            }

            // Get or create lock for this topic
            var topicLock = _fetchTopicLocks.GetOrAdd(topicName, _ => new SemaphoreSlim(1, 1));
            
            await topicLock.WaitAsync();
            try
            {
                // Double-check after acquiring lock
                if (_cachedTopicData.TryGetValue(topicName, out cachedData))
                {
                    return cachedData;
                }

                _logger.LogInformation($"Fetching consumer group offsets for topic {topicName} (first call in this request)");
                var fetchedData = await FetchConsumerGroupOffsetsForTopicAsync(topicName);
                _cachedTopicData[topicName] = fetchedData;
                return fetchedData;
            }
            finally
            {
                topicLock.Release();
            }
        }

        private async Task<ConsumerGroupOffsetCache> FetchAllConsumerGroupOffsetsAsync()
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            var result = new ConsumerGroupOffsetCache
            {
                ConsumerGroups = new List<ConsumerGroupOffsetInfo>(),
                FetchedAt = DateTime.UtcNow
            };

            try
            {
                // 1. List all consumer groups
                var listGroupsResult = await adminClient.ListConsumerGroupsAsync(
                    new ListConsumerGroupsOptions
                    {
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                    }
                );

                var allGroupIds = listGroupsResult.Valid.Select(g => g.GroupId).ToList();
                _logger.LogInformation($"Found {allGroupIds.Count} consumer groups to process");

                if (allGroupIds.Count == 0)
                {
                    return result;
                }

                // 2. Get all topics and their partitions
                // Wrap GetMetadata in a timeout to prevent hanging if brokers are down
                Metadata? metadata = null;
                try
                {
                    var metadataTask = Task.Run(() => adminClient.GetMetadata(TimeSpan.FromSeconds(_defaultTimeoutSeconds)));
                    metadata = await metadataTask.WaitAsync(TimeSpan.FromSeconds(_defaultTimeoutSeconds + 2));
                }
                catch (KafkaException ex)
                {
                    _logger.LogWarning(ex, "Kafka broker transport failure while fetching consumer group offsets. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (TimeoutException)
                {
                    _logger.LogWarning("GetMetadata timed out while fetching consumer group offsets. Kafka brokers may be down.");
                    metadata = null;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to get metadata while fetching consumer group offsets. Kafka brokers may be down.");
                    metadata = null;
                }

                if (metadata == null || metadata.Topics == null)
                {
                    _logger.LogWarning("Metadata or topics is null while fetching consumer group offsets");
                    return result;
                }

                var allTopicPartitions = new Dictionary<string, List<TopicPartition>>();
                
                foreach (var topic in metadata.Topics.Where(t => !t.Topic.StartsWith("__")))
                {
                    var partitions = topic.Partitions
                        .Select(p => new TopicPartition(topic.Topic, p.PartitionId))
                        .ToList();
                    allTopicPartitions[topic.Topic] = partitions;
                }

                // 3. Query offsets for all groups in parallel batches
                var semaphore = new SemaphoreSlim(_maxConcurrency);
                var tasks = allGroupIds.Select(groupId =>
                    FetchGroupOffsetsAsync(adminClient, groupId, allTopicPartitions, semaphore)
                ).ToList();

                var groupResults = await Task.WhenAll(tasks);
                
                result.ConsumerGroups = groupResults
                    .Where(g => g != null && g.Topics.Count > 0)
                    .Select(g => g!)
                    .ToList();

                _logger.LogInformation($"Fetched offsets for {result.ConsumerGroups.Count} consumer groups across all topics");
                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching all consumer group offsets");
                throw;
            }
        }

        private async Task<ConsumerGroupOffsetCache> FetchConsumerGroupOffsetsForTopicAsync(string topicName)
        {
            using var adminClient = _clientFactory.CreateAdminClient();
            var result = new ConsumerGroupOffsetCache
            {
                ConsumerGroups = new List<ConsumerGroupOffsetInfo>(),
                FetchedAt = DateTime.UtcNow
            };

            try
            {
                // 1. Verify topic exists and get partitions
                var metadata = adminClient.GetMetadata(topicName, TimeSpan.FromSeconds(_defaultTimeoutSeconds));
                var topicMetadata = metadata.Topics.FirstOrDefault(t => t.Topic == topicName);
                
                if (topicMetadata == null)
                {
                    _logger.LogWarning($"Topic {topicName} not found");
                    return result;
                }

                var topicPartitions = topicMetadata.Partitions
                    .Select(p => new TopicPartition(topicName, p.PartitionId))
                    .ToList();

                if (topicPartitions.Count == 0)
                {
                    return result;
                }

                // 2. List all consumer groups
                var listGroupsResult = await adminClient.ListConsumerGroupsAsync(
                    new ListConsumerGroupsOptions
                    {
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                    }
                );

                var allGroupIds = listGroupsResult.Valid.Select(g => g.GroupId).ToList();
                _logger.LogInformation($"Found {allGroupIds.Count} consumer groups to check for topic {topicName}");

                if (allGroupIds.Count == 0)
                {
                    return result;
                }

                // 3. Query offsets for this topic only (much faster!)
                var semaphore = new SemaphoreSlim(_maxConcurrency);
                var tasks = allGroupIds.Select(groupId =>
                    FetchGroupOffsetsForTopicAsync(adminClient, groupId, topicName, topicPartitions, semaphore)
                ).ToList();

                var groupResults = await Task.WhenAll(tasks);
                
                result.ConsumerGroups = groupResults
                    .Where(g => g != null && g.Topics.Count > 0)
                    .Select(g => g!)
                    .ToList();

                // If no groups found with offsets, check for active consumers assigned to topic
                if (result.ConsumerGroups.Count == 0)
                {
                    _logger.LogInformation($"No consumer groups with offsets found for topic {topicName}. Checking for active STABLE consumers...");
                    
                    // 1. Filter listGroupsResult.Valid for STABLE groups only (State is available directly!)
                    var stableGroupIds = listGroupsResult.Valid
                        .Where(g => g.State.ToString().Equals("Stable", StringComparison.OrdinalIgnoreCase))
                        .Select(g => g.GroupId)
                        .ToList();
                    
                    if (stableGroupIds.Count == 0)
                    {
                        _logger.LogInformation($"No STABLE consumer groups found for topic {topicName}");
                        return result;
                    }
                    
                    _logger.LogInformation($"Found {stableGroupIds.Count} STABLE consumer groups to check for topic assignments");
                    
                    // 2. Describe only STABLE groups to check for topic assignments (much fewer groups!)
                    var describeResult = await adminClient.DescribeConsumerGroupsAsync(
                        stableGroupIds,
                        new DescribeConsumerGroupsOptions
                        {
                            RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds)
                        }
                    );
                    
                    // 3. Check STABLE groups for topic assignments in parallel
                    var checkSemaphore = new SemaphoreSlim(_maxConcurrency);
                    var checkTasks = stableGroupIds.Select(groupId =>
                        CheckStableGroupForTopicAssignmentAsync(adminClient, groupId, topicName, describeResult, checkSemaphore)
                    ).ToList();
                    
                    var activeGroupResults = await Task.WhenAll(checkTasks);
                    
                    result.ConsumerGroups = activeGroupResults
                        .Where(g => g != null)
                        .Select(g => g!)
                        .ToList();
                    
                    _logger.LogInformation($"Found {result.ConsumerGroups.Count} STABLE consumer groups with active consumers assigned to topic {topicName} (no offsets yet)");
                }
                else
                {
                    _logger.LogInformation($"Fetched offsets for {result.ConsumerGroups.Count} consumer groups for topic {topicName}");
                }
                
                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error fetching consumer group offsets for topic {topicName}");
                throw;
            }
        }

        private async Task<ConsumerGroupOffsetInfo?> FetchGroupOffsetsForTopicAsync(
            IAdminClient adminClient,
            string groupId,
            string topicName,
            List<TopicPartition> topicPartitions,
            SemaphoreSlim semaphore)
        {
            await semaphore.WaitAsync();
            try
            {
                // Query offsets only for this specific topic (optimized)
                var groupSpec = new ConsumerGroupTopicPartitions(groupId, topicPartitions);
                var offsetsResult = await adminClient.ListConsumerGroupOffsetsAsync(
                    new[] { groupSpec },
                    new ListConsumerGroupOffsetsOptions 
                    { 
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds) 
                    }
                );
                var count = 0;
                foreach(var partition in offsetsResult[0].Partitions)
                {
                    if(topicPartitions[0].Topic.Equals(partition.Topic) && partition.Offset.Value > 0)
                    {
                        count++;
                    }
                    
                    _logger.LogInformation($"Group {groupId} topic {partition.Topic} partition {partition.Partition}: offset={partition.Offset}");
                }
                if(count == 0)
                {
                    return null;
                }

                if (offsetsResult.Count == 0 || offsetsResult[0].Partitions == null || offsetsResult[0].Partitions.Count == 0)
                {
                    return null; // No offsets for this topic
                }

                // Build result for this topic only
                var partitions = offsetsResult[0].Partitions
                    .Where(tp => tp.Topic.Equals(topicName, StringComparison.OrdinalIgnoreCase))
                    .Select(tp => new PartitionOffsetInfo
                    {
                        PartitionId = tp.Partition.Value,
                        LastCommittedOffset = tp.Offset
                    })
                    .ToList();

                if (partitions.Count == 0)
                {
                    return null;
                }

                return new ConsumerGroupOffsetInfo
                {
                    GroupId = groupId,
                    Topics = new List<TopicOffsetInfo>
                    {
                        new TopicOffsetInfo
                        {
                            TopicName = topicName,
                            Partitions = partitions
                        }
                    }
                };
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Failed to fetch offsets for consumer group {groupId} on topic {topicName}");
                return null;
            }
            finally
            {
                semaphore.Release();
            }
        }

        private async Task<ConsumerGroupOffsetInfo?> FetchGroupOffsetsAsync(
            IAdminClient adminClient,
            string groupId,
            Dictionary<string, List<TopicPartition>> allTopicPartitions,
            SemaphoreSlim semaphore)
        {
            await semaphore.WaitAsync();
            try
            {
                var groupInfo = new ConsumerGroupOffsetInfo
                {
                    GroupId = groupId,
                    Topics = new List<TopicOffsetInfo>()
                };

                // Query offsets for all topics at once
                var allPartitions = allTopicPartitions.Values.SelectMany(p => p).ToList();
                if (allPartitions.Count == 0)
                {
                    return null;
                }

                var groupSpec = new ConsumerGroupTopicPartitions(groupId, allPartitions);
                var offsetsResult = await adminClient.ListConsumerGroupOffsetsAsync(
                    new[] { groupSpec },
                    new ListConsumerGroupOffsetsOptions 
                    { 
                        RequestTimeout = TimeSpan.FromSeconds(_defaultTimeoutSeconds) 
                    }
                );

                if (offsetsResult.Count == 0 || offsetsResult[0].Partitions == null)
                {
                    return null;
                }

                // Group offsets by topic
                var offsetsByTopic = offsetsResult[0].Partitions
                    .GroupBy(tp => tp.Topic)
                    .ToList();

                foreach (var topicGroup in offsetsByTopic)
                {
                    var topicName = topicGroup.Key;
                    var partitions = topicGroup
                        .Select(tp => new PartitionOffsetInfo
                        {
                            PartitionId = tp.Partition.Value,
                            LastCommittedOffset = tp.Offset
                        })
                        .ToList();

                    if (partitions.Count > 0)
                    {
                        groupInfo.Topics.Add(new TopicOffsetInfo
                        {
                            TopicName = topicName,
                            Partitions = partitions
                        });
                    }
                }

                return groupInfo.Topics.Count > 0 ? groupInfo : null;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Failed to fetch offsets for consumer group {groupId}");
                return null;
            }
            finally
            {
                semaphore.Release();
            }
        }

        private async Task<ConsumerGroupOffsetInfo?> CheckStableGroupForTopicAssignmentAsync(
            IAdminClient adminClient,
            string groupId,
            string topicName,
            DescribeConsumerGroupsResult describeResult,
            SemaphoreSlim semaphore)
        {
            await semaphore.WaitAsync();
            try
            {
                // Get the group description from the already-fetched result
                var groupDescription = describeResult.ConsumerGroupDescriptions
                    .FirstOrDefault(d => d.GroupId == groupId);
                
                if (groupDescription == null || 
                    groupDescription.Members == null || 
                    groupDescription.Members.Count == 0)
                {
                    return null;
                }
                
                // Check if any member is assigned to the target topic
                var assignedPartitions = new HashSet<int>();
                
                foreach (var member in groupDescription.Members)
                {
                    if (member.Assignment?.TopicPartitions != null)
                    {
                        foreach (var tp in member.Assignment.TopicPartitions)
                        {
                            if (tp.Topic.Equals(topicName, StringComparison.OrdinalIgnoreCase))
                            {
                                assignedPartitions.Add(tp.Partition.Value);
                            }
                        }
                    }
                }
                
                if (assignedPartitions.Count == 0)
                {
                    return null; // No assignments for this topic
                }
                
                // Return group info with partitions (no offsets yet, but active consumers)
                return new ConsumerGroupOffsetInfo
                {
                    GroupId = groupId,
                    Topics = new List<TopicOffsetInfo>
                    {
                        new TopicOffsetInfo
                        {
                            TopicName = topicName,
                            Partitions = assignedPartitions.Select(p => new PartitionOffsetInfo
                            {
                                PartitionId = p,
                                LastCommittedOffset = -1 // No offset committed yet
                            }).ToList()
                        }
                    }
                };
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Failed to check topic assignment for STABLE group {groupId} on topic {topicName}");
                return null;
            }
            finally
            {
                semaphore.Release();
            }
        }

        public void ClearCache()
        {
            _cachedAllTopicsData = null;
            _cachedTopicData.Clear();
        }
    }
}

