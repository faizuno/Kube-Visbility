using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
using System.Text.RegularExpressions;
using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services
{
    public class ElasticsearchService : IElasticsearchService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<ElasticsearchService> _logger;
        private readonly string _elasticsearchUrl;
        private readonly string _indexPattern;
        private readonly string? _apiKey;
        private readonly int _defaultTopicErrorsHoursBack;
        private readonly string _topicErrorsDedupeIndexAlias;
        private readonly string _topicErrorsEventIdIndexAlias;
        private readonly int _topicErrorsDedupeWindowMinutes;
        private readonly string _topicAlertingConfigIndexAlias;
        private readonly string _topicAlertingSmtpHost;
        private readonly int _topicAlertingSmtpPort;
        private readonly string _topicAlertingSmtpFrom;
        private readonly string? _topicAlertingDashboardBaseUrl;
        private static readonly JsonSerializerOptions CaseInsensitiveJsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        public ElasticsearchService(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            ILogger<ElasticsearchService> logger)
        {
            _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
            _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));

            // Load Elasticsearch configuration
            _elasticsearchUrl = _configuration["Elasticsearch:Url"] 
                ?? throw new InvalidOperationException("Elasticsearch:Url configuration is required");
            
            _indexPattern = _configuration["Elasticsearch:IndexPattern"] ?? "logs-*";
            
            // Load default hours back for topic errors (default: 30 days)
            _defaultTopicErrorsHoursBack = _configuration.GetValue<int>("Elasticsearch:TopicErrors:DefaultHoursBack", 720);
            _topicErrorsDedupeIndexAlias = _configuration["Elasticsearch:TopicErrors:Ingest:DedupeIndexAlias"] ?? "kube-topic-error-dedupe";
            _topicErrorsEventIdIndexAlias = _configuration["Elasticsearch:TopicErrors:Ingest:EventIdIndexAlias"] ?? "kube-topic-error-eventid";
            _topicErrorsDedupeWindowMinutes = Math.Clamp(
                _configuration.GetValue<int>("Elasticsearch:TopicErrors:Ingest:DedupeWindowMinutes", 60),
                1,
                1440);
            _topicAlertingConfigIndexAlias = _configuration["TopicAlerting:ElasticIndexAlias"] ?? "kube-topic-alert-config";
            var smtpEndpoint = _configuration["TopicAlerting:Email:Smtp"] ?? "localhost:25";
            (_topicAlertingSmtpHost, _topicAlertingSmtpPort) = ParseSmtpEndpoint(smtpEndpoint);
            _topicAlertingSmtpFrom = _configuration["TopicAlerting:Email:SmtpFrom"] ?? "noreply@localhost";
            _topicAlertingDashboardBaseUrl = NormalizeDashboardBaseUrl(_configuration["TopicAlerting:Email:DashboardBaseUrl"]);
            
            // Load API key from environment variable
            _apiKey = Environment.GetEnvironmentVariable("Elasticsearch__Key");
            
            if (string.IsNullOrWhiteSpace(_apiKey))
            {
                _logger.LogWarning("Elasticsearch API key (elastic-key) not found in environment variables");
            }
        }

        public async Task<ElasticsearchLogsResponse> GetLogsAsync(ElasticsearchLogsRequest request)
        {
            try
            {
                _logger.LogInformation(
                    "Querying Elasticsearch for logs. ServiceName: {ServiceName}, Size: {Size}",
                    request.ServiceName,
                    request.Size);

                // Use named HttpClient configured to ignore SSL validation
                var httpClient = _httpClientFactory.CreateClient("Elasticsearch");
                
                // Set default timeout
                httpClient.Timeout = TimeSpan.FromSeconds(30);

                // Build Elasticsearch query
                var query = BuildElasticsearchQuery(request);
                
                // Construct the search URL
                var searchUrl = $"{_elasticsearchUrl.TrimEnd('/')}/{_indexPattern}/_search";
                
                _logger.LogDebug("Elasticsearch query URL: {Url}", searchUrl);
                _logger.LogDebug("Elasticsearch query: {Query}", JsonSerializer.Serialize(query, new JsonSerializerOptions { WriteIndented = true }));

                // Create HTTP request
                var httpRequest = new HttpRequestMessage(HttpMethod.Post, searchUrl)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(query),
                        Encoding.UTF8,
                        "application/json")
                };

                // Add API key authentication if available
                if (!string.IsNullOrWhiteSpace(_apiKey))
                {
                    httpRequest.Headers.Add("Authorization", $"ApiKey {_apiKey}");
                }

                // Execute request
                var response = await httpClient.SendAsync(httpRequest);
                
                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError(
                        "Elasticsearch request failed. Status: {Status}, Response: {Response}",
                        response.StatusCode,
                        errorContent);
                    throw new HttpRequestException(
                        $"Elasticsearch request failed with status {response.StatusCode}: {errorContent}");
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                var elasticsearchResponse = JsonSerializer.Deserialize<ElasticsearchSearchResponse>(responseContent);

                if (elasticsearchResponse == null)
                {
                    throw new InvalidOperationException("Failed to deserialize Elasticsearch response");
                }

                // Map Elasticsearch response to our model
                var result = new ElasticsearchLogsResponse
                {
                    Total = elasticsearchResponse.Hits?.Total?.Value ?? 0,
                    Logs = elasticsearchResponse.Hits?.Hits?
                        .Select(hit => MapToLogEntry(hit.Source))
                        .ToList() ?? new List<ElasticsearchLogEntry>()
                };

                _logger.LogInformation(
                    "Retrieved {Count} logs from Elasticsearch (Total: {Total})",
                    result.Logs.Count,
                    result.Total);

                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error querying Elasticsearch");
                throw;
            }
        }

        public async Task<ErrorAnalyticsResponse> GetErrorAnalyticsAsync(
            string? serviceName,
            DateTime timeFrom,
            DateTime timeTo,
            int minCount)
        {
            try
            {
                _logger.LogInformation(
                    "Querying Elasticsearch for error analytics. ServiceName: {ServiceName}, TimeRange: {TimeFrom} to {TimeTo}",
                    serviceName, timeFrom, timeTo);

                var httpClient = _httpClientFactory.CreateClient("Elasticsearch");
                httpClient.Timeout = TimeSpan.FromSeconds(60);

                var query = BuildErrorAnalyticsQuery(serviceName, timeFrom, timeTo, minCount);
                
                var searchUrl = $"{_elasticsearchUrl.TrimEnd('/')}/{_indexPattern}/_search";
                
                _logger.LogDebug("Elasticsearch analytics query URL: {Url}", searchUrl);

                var httpRequest = new HttpRequestMessage(HttpMethod.Post, searchUrl)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(query),
                        Encoding.UTF8,
                        "application/json")
                };

                if (!string.IsNullOrWhiteSpace(_apiKey))
                {
                    httpRequest.Headers.Add("Authorization", $"ApiKey {_apiKey}");
                }

                var response = await httpClient.SendAsync(httpRequest);
                
                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError(
                        "Elasticsearch analytics request failed. Status: {Status}, Response: {Response}",
                        response.StatusCode, errorContent);
                    
                    // If script-based aggregation fails, try with direct field access
                    if (errorContent.Contains("script") || errorContent.Contains("keyword"))
                    {
                        _logger.LogInformation("Retrying with direct field aggregation (without script)");
                        query = BuildErrorAnalyticsQueryFallback(serviceName, timeFrom, timeTo, minCount);
                        
                        httpRequest = new HttpRequestMessage(HttpMethod.Post, searchUrl)
                        {
                            Content = new StringContent(
                                JsonSerializer.Serialize(query),
                                Encoding.UTF8,
                                "application/json")
                        };

                        if (!string.IsNullOrWhiteSpace(_apiKey))
                        {
                            httpRequest.Headers.Add("Authorization", $"ApiKey {_apiKey}");
                        }

                        response = await httpClient.SendAsync(httpRequest);
                        
                        if (!response.IsSuccessStatusCode)
                        {
                            errorContent = await response.Content.ReadAsStringAsync();
                            _logger.LogError(
                                "Elasticsearch analytics fallback request also failed. Status: {Status}, Response: {Response}",
                                response.StatusCode, errorContent);
                            throw new HttpRequestException(
                                $"Elasticsearch request failed with status {response.StatusCode}: {errorContent}");
                        }
                    }
                    else
                    {
                        throw new HttpRequestException(
                            $"Elasticsearch request failed with status {response.StatusCode}: {errorContent}");
                    }
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                
                // Log the raw response for debugging
                _logger.LogDebug("Elasticsearch analytics response: {Response}", responseContent);
                
                var elasticsearchResponse = JsonSerializer.Deserialize<ElasticsearchAggregationResponse>(responseContent);

                if (elasticsearchResponse == null)
                {
                    throw new InvalidOperationException("Failed to deserialize Elasticsearch response");
                }

                // Log aggregation structure for debugging
                if (elasticsearchResponse.Aggregations?.ErrorMessages?.Buckets != null)
                {
                    _logger.LogInformation(
                        "Found {Count} error message buckets in aggregation",
                        elasticsearchResponse.Aggregations.ErrorMessages.Buckets.Count);
                }
                else
                {
                    _logger.LogWarning(
                        "No error message buckets found in aggregation. Aggregations structure: {Aggregations}",
                        JsonSerializer.Serialize(elasticsearchResponse.Aggregations));
                }

                var errorGroups = ProcessErrorAggregations(elasticsearchResponse, minCount);
                
                // Calculate total errors as sum of all error group counts
                var totalErrorOccurrences = errorGroups.Sum(g => g.Count);
                var totalErrorDocuments = elasticsearchResponse.Hits?.Total?.Value ?? 0;
                
                var result = new ErrorAnalyticsResponse
                {
                    ErrorGroups = errorGroups,
                    TotalErrors = totalErrorOccurrences, // Sum of all error group counts
                    TotalErrorDocuments = totalErrorDocuments, // Total error log documents
                    TimeFrom = timeFrom,
                    TimeTo = timeTo
                };

                _logger.LogInformation(
                    "Retrieved {Count} error groups from Elasticsearch (Total Occurrences: {TotalOccurrences}, Total Documents: {TotalDocuments})",
                    errorGroups.Count,
                    result.TotalErrors,
                    result.TotalErrorDocuments);

                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error querying Elasticsearch for analytics");
                throw;
            }
        }

        public async Task<SimilarErrorsResponse> GetSimilarErrorsAsync(
            string serviceName,
            string errorMessage,
            DateTime timeFrom,
            DateTime timeTo,
            int maxResults,
            bool strictPattern = false,
            bool includeAllServices = false)
        {
            try
            {
                var stopwatch = Stopwatch.StartNew();
                _logger.LogInformation(
                    "Finding similar errors. ServiceName: {ServiceName}, Message: {Message}, StrictPattern: {StrictPattern}, IncludeAllServices: {IncludeAllServices}",
                    serviceName, errorMessage, strictPattern, includeAllServices);

                var httpClient = _httpClientFactory.CreateClient("Elasticsearch");
                httpClient.Timeout = TimeSpan.FromSeconds(60);

                // Pull a larger candidate set before grouping so results are less biased.
                var candidateSize = Math.Clamp(maxResults * 30, 200, 5000);
                var query = BuildSimilarErrorsQuery(serviceName, errorMessage, timeFrom, timeTo, candidateSize, strictPattern, includeAllServices);
                
                var searchUrl = $"{_elasticsearchUrl.TrimEnd('/')}/{_indexPattern}/_search";
                
                var httpRequest = new HttpRequestMessage(HttpMethod.Post, searchUrl)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(query),
                        Encoding.UTF8,
                        "application/json")
                };

                if (!string.IsNullOrWhiteSpace(_apiKey))
                {
                    httpRequest.Headers.Add("Authorization", $"ApiKey {_apiKey}");
                }

                var response = await httpClient.SendAsync(httpRequest);
                
                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    throw new HttpRequestException(
                        $"Elasticsearch request failed with status {response.StatusCode}: {errorContent}");
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                var elasticsearchResponse = JsonSerializer.Deserialize<ElasticsearchSearchResponse>(responseContent);

                if (elasticsearchResponse == null)
                {
                    throw new InvalidOperationException("Failed to deserialize Elasticsearch response");
                }

                var similarLogMatches = elasticsearchResponse.Hits?.Hits?
                    .Select(h => new SimilarLogMatch
                    {
                        Log = MapToLogEntry(h.Source),
                        Score = h.Score ?? 0
                    })
                    .ToList() ?? new List<SimilarLogMatch>();

                var similarErrors = GroupSimilarErrors(similarLogMatches, errorMessage);
                var groupedCount = similarErrors.Count;
                var trimmedSimilarErrors = similarErrors.Take(maxResults).ToList();
                stopwatch.Stop();

                return new SimilarErrorsResponse
                {
                    OriginalMessage = errorMessage,
                    ServiceName = serviceName,
                    IncludeAllServices = includeAllServices,
                    Days = Math.Max(1, (int)Math.Ceiling((timeTo - timeFrom).TotalDays)),
                    StrictPattern = strictPattern,
                    QueryMode = strictPattern ? "exact" : "fuzzy",
                    RequestedGroups = maxResults,
                    CandidateCount = similarLogMatches.Count,
                    GroupCount = groupedCount,
                    ElapsedMs = stopwatch.ElapsedMilliseconds,
                    SimilarErrors = trimmedSimilarErrors
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error finding similar errors");
                throw;
            }
        }

        public async Task<TopicErrorsResponse> GetTopicErrorsAsync(TopicErrorsRequest request)
        {
            try
            {
                _logger.LogInformation(
                    "Querying Elasticsearch for topic errors. TimeFrom: {TimeFrom}, TimeTo: {TimeTo}",
                    request.TimeFrom, request.TimeTo);

                var httpClient = _httpClientFactory.CreateClient("Elasticsearch");
                httpClient.Timeout = TimeSpan.FromSeconds(60);

                var query = BuildTopicErrorsQuery(request);
                
                var searchUrl = $"{_elasticsearchUrl.TrimEnd('/')}/{_indexPattern}/_search";
                
                _logger.LogDebug("Elasticsearch topic errors query URL: {Url}", searchUrl);
                _logger.LogDebug("Elasticsearch topic errors query: {Query}", JsonSerializer.Serialize(query, new JsonSerializerOptions { WriteIndented = true }));

                var httpRequest = new HttpRequestMessage(HttpMethod.Post, searchUrl)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(query),
                        Encoding.UTF8,
                        "application/json")
                };

                if (!string.IsNullOrWhiteSpace(_apiKey))
                {
                    httpRequest.Headers.Add("Authorization", $"ApiKey {_apiKey}");
                }

                var response = await httpClient.SendAsync(httpRequest);
                
                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError(
                        "Elasticsearch topic errors request failed. Status: {Status}, Response: {Response}",
                        response.StatusCode,
                        errorContent);
                    throw new HttpRequestException(
                        $"Elasticsearch request failed with status {response.StatusCode}: {errorContent}");
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                var elasticsearchResponse = JsonSerializer.Deserialize<ElasticsearchSearchResponse>(responseContent);

                if (elasticsearchResponse == null)
                {
                    throw new InvalidOperationException("Failed to deserialize Elasticsearch response");
                }

                var errors = elasticsearchResponse.Hits?.Hits?
                    .Select(h => MapToTopicErrorEntry(h.Source))
                    .Where(e => !string.IsNullOrWhiteSpace(e.TopicName))
                    .ToList() ?? new List<TopicErrorEntry>();

                var result = new TopicErrorsResponse
                {
                    Errors = errors,
                    Total = elasticsearchResponse.Hits?.Total?.Value ?? 0
                };

                _logger.LogInformation(
                    "Retrieved {Count} topic errors from Elasticsearch (Total: {Total})",
                    result.Errors.Count,
                    result.Total);

                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error querying Elasticsearch for topic errors");
                throw;
            }
        }

        public async Task<TopicErrorEventsIngestResponse> IngestTopicErrorEventsAsync(
            TopicErrorEventsIngestRequest request,
            CancellationToken cancellationToken = default)
        {
            var response = new TopicErrorEventsIngestResponse
            {
                Received = request.Events?.Count ?? 0
            };

            if (request.Events == null || request.Events.Count == 0)
            {
                return response;
            }

            var httpClient = _httpClientFactory.CreateClient("Elasticsearch");
            httpClient.Timeout = TimeSpan.FromSeconds(30);
            var baseUrl = _elasticsearchUrl.TrimEnd('/');
            await EnsureTopicErrorIngestIndicesAsync(httpClient, baseUrl, cancellationToken);
            var alertingContext = await LoadTopicAlertingRuntimeContextAsync(httpClient, baseUrl, cancellationToken);
            if (!alertingContext.HasRules)
            {
                _logger.LogInformation("No topic alert rules configured. Email alert evaluation is skipped.");
            }

            foreach (var item in request.Events)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var validationError = ValidateTopicErrorIngestEvent(item, out var effectiveEventId, out var eventTimestampUtc);
                if (validationError != null)
                {
                    response.Invalid++;
                    response.Results.Add(new TopicErrorEventIngestResult
                    {
                        EventId = effectiveEventId,
                        TopicName = item.TopicName,
                        Status = "Invalid",
                        Reason = validationError
                    });
                    continue;
                }

                var eventIdKey = ComputeSha256(effectiveEventId);
                var eventIdDocument = new
                {
                    eventId = effectiveEventId,
                    topicName = item.TopicName!.Trim(),
                    timestampUtc = eventTimestampUtc!.Value.ToString("O"),
                    ingestedAtUtc = DateTime.UtcNow.ToString("O")
                };

                var eventIdUrl = $"{baseUrl}/{_topicErrorsEventIdIndexAlias}/_create/{Uri.EscapeDataString(eventIdKey)}";
                using var eventIdRequest = new HttpRequestMessage(HttpMethod.Put, eventIdUrl)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(eventIdDocument),
                        Encoding.UTF8,
                        "application/json")
                };

                if (!string.IsNullOrWhiteSpace(_apiKey))
                {
                    eventIdRequest.Headers.Add("Authorization", $"ApiKey {_apiKey}");
                }

                try
                {
                    using var eventIdResponse = await httpClient.SendAsync(eventIdRequest, cancellationToken);
                    if (eventIdResponse.StatusCode == HttpStatusCode.Conflict)
                    {
                        response.DuplicateByEventId++;
                        response.Results.Add(new TopicErrorEventIngestResult
                        {
                            EventId = effectiveEventId,
                            TopicName = item.TopicName,
                            Status = "Duplicate",
                            Reason = "Duplicate eventId",
                            DedupeKey = eventIdKey
                        });
                        continue;
                    }

                    if (!eventIdResponse.IsSuccessStatusCode)
                    {
                        response.Failed++;
                        var eventIdErrorBody = await eventIdResponse.Content.ReadAsStringAsync(cancellationToken);
                        _logger.LogError(
                            "Failed to write topic-error eventId document. Status: {StatusCode}, Topic: {Topic}, EventId: {EventId}, Response: {Response}",
                            (int)eventIdResponse.StatusCode,
                            item.TopicName,
                            effectiveEventId,
                            eventIdErrorBody);
                        response.Results.Add(new TopicErrorEventIngestResult
                        {
                            EventId = effectiveEventId,
                            TopicName = item.TopicName,
                            Status = "Failed",
                            Reason = $"Elasticsearch returned {(int)eventIdResponse.StatusCode} for eventId write",
                            DedupeKey = eventIdKey
                        });
                        continue;
                    }
                }
                catch (Exception ex)
                {
                    response.Failed++;
                    _logger.LogError(ex,
                        "Exception while writing topic-error eventId document for Topic: {Topic}, EventId: {EventId}",
                        item.TopicName,
                        effectiveEventId);
                    response.Results.Add(new TopicErrorEventIngestResult
                    {
                        EventId = effectiveEventId,
                        TopicName = item.TopicName,
                        Status = "Failed",
                        Reason = ex.Message,
                        DedupeKey = eventIdKey
                    });
                    continue;
                }

                var normalizedTopic = item.TopicName!.Trim().ToLowerInvariant();
                var normalizedService = (item.ServiceName ?? string.Empty).Trim().ToLowerInvariant();
                var normalizedMessage = NormalizeErrorMessage(item.Message ?? string.Empty);
                var normalizedException = NormalizeErrorMessage(item.Exception ?? string.Empty);
                var fingerprint = ComputeSha256($"{normalizedTopic}|{normalizedService}|{normalizedMessage}|{normalizedException}");
                var windowStartUtc = GetWindowStartUtc(eventTimestampUtc!.Value, _topicErrorsDedupeWindowMinutes);
                var dedupeKey = ComputeSha256($"{normalizedTopic}|{fingerprint}|{windowStartUtc:O}");

                var dedupeDocument = new
                {
                    eventId = effectiveEventId,
                    topicName = item.TopicName!.Trim(),
                    message = item.Message,
                    exception = item.Exception,
                    serviceName = item.ServiceName,
                    applicationName = item.ApplicationName,
                    namespaceName = item.Namespace,
                    partition = item.Partition,
                    offset = item.Offset,
                    podName = item.PodName,
                    timestampUtc = eventTimestampUtc.Value.ToString("O"),
                    fingerprint,
                    windowStartUtc = windowStartUtc.ToString("O"),
                    dedupeWindowMinutes = _topicErrorsDedupeWindowMinutes,
                    ingestedAtUtc = DateTime.UtcNow.ToString("O")
                };

                var requestUrl = $"{baseUrl}/{_topicErrorsDedupeIndexAlias}/_create/{Uri.EscapeDataString(dedupeKey)}";
                using var httpRequest = new HttpRequestMessage(HttpMethod.Put, requestUrl)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(dedupeDocument),
                        Encoding.UTF8,
                        "application/json")
                };

                if (!string.IsNullOrWhiteSpace(_apiKey))
                {
                    httpRequest.Headers.Add("Authorization", $"ApiKey {_apiKey}");
                }

                try
                {
                    using var esResponse = await httpClient.SendAsync(httpRequest, cancellationToken);
                    if (esResponse.IsSuccessStatusCode)
                    {
                        response.NewInWindow++;
                        if (alertingContext.HasRules)
                        {
                            await TrySendTopicAlertEmailsAsync(item, eventTimestampUtc.Value, alertingContext);
                        }
                        response.Results.Add(new TopicErrorEventIngestResult
                        {
                            EventId = effectiveEventId,
                            TopicName = item.TopicName,
                            Status = "New",
                            Fingerprint = fingerprint,
                            WindowStartUtc = windowStartUtc,
                            DedupeKey = dedupeKey
                        });
                        continue;
                    }

                    if (esResponse.StatusCode == HttpStatusCode.Conflict)
                    {
                        response.DuplicateInWindow++;
                        response.Results.Add(new TopicErrorEventIngestResult
                        {
                            EventId = effectiveEventId,
                            TopicName = item.TopicName,
                            Status = "Duplicate",
                            Fingerprint = fingerprint,
                            WindowStartUtc = windowStartUtc,
                            DedupeKey = dedupeKey
                        });
                        continue;
                    }

                    response.Failed++;
                    var errorBody = await esResponse.Content.ReadAsStringAsync(cancellationToken);
                    _logger.LogError(
                        "Failed to write topic-error dedupe document. Status: {StatusCode}, Topic: {Topic}, EventId: {EventId}, Response: {Response}",
                        (int)esResponse.StatusCode,
                        item.TopicName,
                        effectiveEventId,
                        errorBody);
                    response.Results.Add(new TopicErrorEventIngestResult
                    {
                        EventId = effectiveEventId,
                        TopicName = item.TopicName,
                        Status = "Failed",
                        Reason = $"Elasticsearch returned {(int)esResponse.StatusCode}",
                        Fingerprint = fingerprint,
                        WindowStartUtc = windowStartUtc,
                        DedupeKey = dedupeKey
                    });
                }
                catch (Exception ex)
                {
                    response.Failed++;
                    _logger.LogError(ex,
                        "Exception while writing topic-error dedupe document for Topic: {Topic}, EventId: {EventId}",
                        item.TopicName,
                        effectiveEventId);
                    response.Results.Add(new TopicErrorEventIngestResult
                    {
                        EventId = effectiveEventId,
                        TopicName = item.TopicName,
                        Status = "Failed",
                        Reason = ex.Message,
                        Fingerprint = fingerprint,
                        WindowStartUtc = windowStartUtc,
                        DedupeKey = dedupeKey
                    });
                }
            }

            return response;
        }

        public Task<TopicErrorEventsIngestResponse> IngestOtlpTopicErrorLogsAsync(
            JsonElement otlpPayload,
            CancellationToken cancellationToken = default)
        {
            var mappedRequest = MapOtlpPayloadToTopicErrorEvents(otlpPayload);
            return IngestTopicErrorEventsAsync(mappedRequest, cancellationToken);
        }

        private async Task<TopicAlertingRuntimeContext> LoadTopicAlertingRuntimeContextAsync(
            HttpClient httpClient,
            string baseUrl,
            CancellationToken cancellationToken)
        {
            var rules = await SearchTopicAlertDocumentsByDocTypeAsync<TopicAlertRule>(
                httpClient,
                baseUrl,
                TopicAlertingDocTypes.Rule,
                cancellationToken);
            if (rules.Count == 0)
            {
                return TopicAlertingRuntimeContext.Empty;
            }

            var groups = await SearchTopicAlertDocumentsByDocTypeAsync<TopicAlertGroup>(
                httpClient,
                baseUrl,
                TopicAlertingDocTypes.Group,
                cancellationToken);
            var groupsById = groups
                .Where(group => !string.IsNullOrWhiteSpace(group.GroupId))
                .GroupBy(group => group.GroupId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(grouping => grouping.Key, grouping => grouping.First(), StringComparer.OrdinalIgnoreCase);

            return new TopicAlertingRuntimeContext(rules, groupsById);
        }

        private async Task<List<T>> SearchTopicAlertDocumentsByDocTypeAsync<T>(
            HttpClient httpClient,
            string baseUrl,
            string docType,
            CancellationToken cancellationToken)
        {
            var requestUrl = $"{baseUrl}/{Uri.EscapeDataString(_topicAlertingConfigIndexAlias)}/_search";
            var query = new
            {
                size = 5000,
                query = new
                {
                    @bool = new
                    {
                        filter = new object[]
                        {
                            new
                            {
                                @bool = new
                                {
                                    should = new object[]
                                    {
                                        new { term = new Dictionary<string, object> { ["docType.keyword"] = docType } },
                                        new { term = new Dictionary<string, object> { ["docType"] = docType } }
                                    },
                                    minimum_should_match = 1
                                }
                            }
                        }
                    }
                }
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
            {
                Content = new StringContent(JsonSerializer.Serialize(query), Encoding.UTF8, "application/json")
            };
            ApplyElasticsearchAuthorization(request);

            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning(
                    "Failed to load topic alert documents. Index: {IndexAlias}, DocType: {DocType}, Status: {StatusCode}, Response: {Response}",
                    _topicAlertingConfigIndexAlias,
                    docType,
                    (int)response.StatusCode,
                    body);
                return new List<T>();
            }

            var payload = await response.Content.ReadAsStringAsync(cancellationToken);
            var searchResponse = JsonSerializer.Deserialize<ElasticsearchSearchResponse>(payload, CaseInsensitiveJsonOptions);
            if (searchResponse?.Hits?.Hits == null || searchResponse.Hits.Hits.Count == 0)
            {
                return new List<T>();
            }

            var result = new List<T>(searchResponse.Hits.Hits.Count);
            foreach (var hit in searchResponse.Hits.Hits)
            {
                if (hit.Source.ValueKind == JsonValueKind.Null || hit.Source.ValueKind == JsonValueKind.Undefined)
                {
                    continue;
                }

                try
                {
                    var item = JsonSerializer.Deserialize<T>(hit.Source.GetRawText(), CaseInsensitiveJsonOptions);
                    if (item != null)
                    {
                        result.Add(item);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Skipped malformed topic alert document for docType {DocType}.", docType);
                }
            }

            return result;
        }

        private async Task TrySendTopicAlertEmailsAsync(
            TopicErrorEventIngestRequest item,
            DateTime eventTimestampUtc,
            TopicAlertingRuntimeContext alertingContext)
        {
            try
            {
                var matchingRules = alertingContext.Rules
                    .Where(rule => RuleMatchesEvent(rule, item, alertingContext.GroupsById))
                    .ToList();

                if (matchingRules.Count == 0)
                {
                    return;
                }

                var recipients = matchingRules
                    .SelectMany(rule => rule.RecipientEmails ?? Array.Empty<string>())
                    .Where(email => !string.IsNullOrWhiteSpace(email))
                    .Select(email => email.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (recipients.Count == 0)
                {
                    return;
                }

                var subject = $"Topic : {FormatAlertValue(item.TopicName)} - Error";
                var body = BuildTopicAlertEmailBody(item, eventTimestampUtc);
                var htmlBody = BuildTopicAlertEmailHtmlBody(item, eventTimestampUtc, _topicAlertingDashboardBaseUrl);

                using var message = new MailMessage
                {
                    From = new MailAddress(_topicAlertingSmtpFrom),
                    Subject = subject,
                    Body = body,
                    IsBodyHtml = false
                };
                message.SubjectEncoding = Encoding.UTF8;
                message.BodyEncoding = Encoding.UTF8;
                foreach (var recipient in recipients)
                {
                    message.To.Add(recipient);
                }
                message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(htmlBody, Encoding.UTF8, MediaTypeNames.Text.Html));

                using var smtpClient = new SmtpClient(_topicAlertingSmtpHost, _topicAlertingSmtpPort)
                {
                    DeliveryMethod = SmtpDeliveryMethod.Network,
                    EnableSsl = false
                };

                await smtpClient.SendMailAsync(message);
                var matchedRuleIds = matchingRules
                    .Where(rule => !string.IsNullOrWhiteSpace(rule.RuleId))
                    .Select(rule => rule.RuleId)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray();
                _logger.LogInformation(
                    "Sent topic alert email. Topic: {TopicName}, Recipients: {RecipientCount}, MatchedRules: {MatchedRuleIds}, TimestampUtc: {TimestampUtc}",
                    item.TopicName,
                    recipients.Count,
                    matchedRuleIds.Length == 0 ? "(none)" : string.Join(", ", matchedRuleIds),
                    eventTimestampUtc.ToString("O"));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to send topic alert email. Topic: {TopicName}, ServiceName: {ServiceName}",
                    item.TopicName,
                    item.ServiceName);
            }
        }

        private static bool RuleMatchesEvent(
            TopicAlertRule rule,
            TopicErrorEventIngestRequest item,
            IReadOnlyDictionary<string, TopicAlertGroup> groupsById)
        {
            if (rule == null || !rule.Enabled)
            {
                return false;
            }

            var eventTopic = (item.TopicName ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(eventTopic))
            {
                return false;
            }

            var targetTopics = ResolveRuleTopics(rule, groupsById);
            if (targetTopics.Count == 0)
            {
                return false;
            }

            if (!targetTopics.Contains(eventTopic))
            {
                return false;
            }

            return EvaluateRuleConditions(rule.Conditions, item);
        }

        private static HashSet<string> ResolveRuleTopics(
            TopicAlertRule rule,
            IReadOnlyDictionary<string, TopicAlertGroup> groupsById)
        {
            if (string.Equals(rule.TargetType, "group", StringComparison.OrdinalIgnoreCase))
            {
                if (!string.IsNullOrWhiteSpace(rule.TopicGroupId) &&
                    groupsById.TryGetValue(rule.TopicGroupId.Trim(), out var group))
                {
                    return group.TopicNames
                        .Where(topic => !string.IsNullOrWhiteSpace(topic))
                        .Select(topic => topic.Trim())
                        .ToHashSet(StringComparer.OrdinalIgnoreCase);
                }

                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }

            return (rule.TopicNames ?? Array.Empty<string>())
                .Where(topic => !string.IsNullOrWhiteSpace(topic))
                .Select(topic => topic.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        private static bool EvaluateRuleConditions(
            IReadOnlyList<TopicAlertCondition> conditions,
            TopicErrorEventIngestRequest item)
        {
            if (conditions == null || conditions.Count == 0)
            {
                return true;
            }

            var hasInitialized = false;
            var aggregate = true;

            for (var index = 0; index < conditions.Count; index++)
            {
                var condition = conditions[index];
                var current = EvaluateSingleCondition(condition, item);

                if (!hasInitialized)
                {
                    aggregate = current;
                    hasInitialized = true;
                    continue;
                }

                var join = (condition.JoinWithPrevious ?? "AND").Trim().ToUpperInvariant();
                aggregate = join == "OR" ? aggregate || current : aggregate && current;
            }

            return aggregate;
        }

        private static bool EvaluateSingleCondition(TopicAlertCondition condition, TopicErrorEventIngestRequest item)
        {
            var fieldValue = GetConditionFieldValue(condition.Field, item);
            var needle = condition.Value ?? string.Empty;
            var operation = (condition.Operator ?? string.Empty).Trim();

            bool isMatch = operation.ToLowerInvariant() switch
            {
                "contains" => fieldValue.Contains(needle, StringComparison.OrdinalIgnoreCase),
                "equals" => string.Equals(fieldValue, needle, StringComparison.OrdinalIgnoreCase),
                "startswith" => fieldValue.StartsWith(needle, StringComparison.OrdinalIgnoreCase),
                "endswith" => fieldValue.EndsWith(needle, StringComparison.OrdinalIgnoreCase),
                "wildcard" => IsWildcardMatchSafe(fieldValue, needle),
                _ => false
            };

            return condition.Negate ? !isMatch : isMatch;
        }

        private static string GetConditionFieldValue(string? field, TopicErrorEventIngestRequest item)
        {
            return (field ?? string.Empty).Trim().ToLowerInvariant() switch
            {
                "message" => item.Message ?? string.Empty,
                "exception" => item.Exception ?? string.Empty,
                "servicename" => item.ServiceName ?? string.Empty,
                "applicationname" => item.ApplicationName ?? string.Empty,
                _ => string.Empty
            };
        }

        private static bool IsWildcardMatchSafe(string input, string pattern)
        {
            if (string.IsNullOrWhiteSpace(pattern))
            {
                return false;
            }

            try
            {
                var wildcard = pattern.Trim();
                var escapedPattern = Regex.Escape(wildcard)
                    .Replace(@"\*", ".*")
                    .Replace(@"\?", ".");
                var regexPattern = $"^{escapedPattern}$";

                return Regex.IsMatch(
                    input ?? string.Empty,
                    regexPattern,
                    RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
                    TimeSpan.FromMilliseconds(100));
            }
            catch
            {
                return false;
            }
        }

        private static string BuildTopicAlertEmailBody(TopicErrorEventIngestRequest item, DateTime eventTimestampUtc)
        {
            var lines = new[]
            {
                $"Timestamp : {FormatAlertValue(eventTimestampUtc.ToString("O"))}",
                $"ServiceName: {FormatAlertValue(item.ServiceName)}",
                $"ApplicationName: {FormatAlertValue(item.ApplicationName)}",
                $"Partition: {FormatAlertValue(item.Partition?.ToString())}",
                $"Offset : {FormatAlertValue(item.Offset?.ToString())}",
                $"Message : {FormatAlertValue(item.Message)}",
                $"Exception : {FormatAlertValue(item.Exception)}"
            };

            return string.Join(Environment.NewLine, lines);
        }

        private static string BuildTopicAlertEmailHtmlBody(
            TopicErrorEventIngestRequest item,
            DateTime eventTimestampUtc,
            string? dashboardBaseUrl)
        {
            static string Enc(string? value) => WebUtility.HtmlEncode(FormatAlertValue(value));
            static string EncRaw(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);

            var timestamp = eventTimestampUtc.ToString("O");
            var topicName = FormatAlertValue(item.TopicName);
            var serviceName = FormatAlertValue(item.ServiceName);
            var appName = FormatAlertValue(item.ApplicationName);
            var partition = FormatAlertValue(item.Partition?.ToString());
            var offset = FormatAlertValue(item.Offset?.ToString());
            var message = TruncateForEmail(FormatAlertValue(item.Message), 6000);
            var exception = TruncateForEmail(FormatAlertValue(item.Exception), 6000);
            var hasDashboardBase = !string.IsNullOrWhiteSpace(dashboardBaseUrl);

            var globalSearchUrl = hasDashboardBase
                ? BuildTopicAlertGlobalSearchUrl(dashboardBaseUrl!, eventTimestampUtc, item.ServiceName)
                : string.Empty;
            var serviceDeepDiveUrl = hasDashboardBase
                ? BuildTopicAlertServiceDeepDiveUrl(dashboardBaseUrl!, item.ServiceName)
                : string.Empty;

            var linksSection = hasDashboardBase
                ? $@"
          <tr>
            <td style=""padding:4px 22px 0 22px;"">
              <table role=""presentation"" cellpadding=""0"" cellspacing=""0"" border=""0"">
                <tr>
                  <td style=""padding-right:10px;"">
                    <a href=""{EncRaw(serviceDeepDiveUrl)}"" style=""display:inline-block; background:#ffffff; color:#0b5fff; text-decoration:none; font-size:13px; font-weight:600; border:1px solid #93c5fd; border-radius:8px; padding:10px 14px;"">
                      Open Service
                    </a>
                  </td>
                  <td>
                    <a href=""{EncRaw(globalSearchUrl)}"" style=""display:inline-block; background:#ffffff; color:#0b5fff; text-decoration:none; font-size:13px; font-weight:600; border:1px solid #93c5fd; border-radius:8px; padding:10px 14px;"">
                      Open Global Search
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>"
                : @"
          <tr>
            <td style=""padding:10px 22px 0 22px; font-size:12px; color:#64748b;"">
              Dashboard links are unavailable because TopicAlerting:Email:DashboardBaseUrl is not configured.
            </td>
          </tr>";

            return $@"<!DOCTYPE html>
<html lang=""en"">
<head>
  <meta charset=""UTF-8"" />
  <meta name=""viewport"" content=""width=device-width, initial-scale=1.0"" />
  <title>Topic Alert</title>
</head>
<body style=""margin:0; padding:0; background:#f3f6fb; font-family:Segoe UI, Tahoma, Arial, sans-serif; color:#1f2937;"">
  <table role=""presentation"" cellpadding=""0"" cellspacing=""0"" border=""0"" width=""100%"" style=""width:100%; background:#f3f6fb; margin:0; padding:24px 12px;"">
    <tr>
      <td align=""center"" style=""padding:0;"">
        <!--[if mso]>
        <table role=""presentation"" cellpadding=""0"" cellspacing=""0"" border=""0"" width=""680"">
          <tr>
            <td>
        <![endif]-->
        <table role=""presentation"" cellpadding=""0"" cellspacing=""0"" border=""0"" width=""680"" style=""width:680px; max-width:680px; min-width:680px; background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;"">
          <tr>
            <td style=""background:#0f172a; padding:18px 22px;"">
              <div style=""font-size:12px; letter-spacing:0.6px; text-transform:uppercase; color:#93c5fd; font-weight:700;"">
                Topic Error Alert
              </div>
              <div style=""margin-top:6px; font-size:24px; line-height:1.35; color:#ffffff; font-weight:700;"">
                Topic : {Enc(topicName)} - Error
              </div>
            </td>
          </tr>

          <tr>
            <td style=""padding:18px 22px 8px 22px;"">
              <table role=""presentation"" cellpadding=""0"" cellspacing=""0"" border=""0"" width=""100%"" style=""table-layout:fixed; width:100%;"">
                <tr>
                  <td style=""padding:0 0 8px 0; font-size:13px; color:#64748b; width:45%;"">Timestamp</td>
                  <td align=""right"" style=""padding:0 0 8px 0; font-size:13px; color:#111827; font-weight:600; width:55%; word-break:break-word; overflow-wrap:anywhere;"">{Enc(timestamp)}</td>
                </tr>
                <tr>
                  <td style=""padding:0 0 8px 0; font-size:13px; color:#64748b;"">Service Name</td>
                  <td align=""right"" style=""padding:0 0 8px 0; font-size:13px; color:#111827; font-weight:600; word-break:break-word; overflow-wrap:anywhere;"">{Enc(serviceName)}</td>
                </tr>
                <tr>
                  <td style=""padding:0 0 8px 0; font-size:13px; color:#64748b;"">Application Name</td>
                  <td align=""right"" style=""padding:0 0 8px 0; font-size:13px; color:#111827; font-weight:600; word-break:break-word; overflow-wrap:anywhere;"">{Enc(appName)}</td>
                </tr>
                <tr>
                  <td style=""padding:0 0 8px 0; font-size:13px; color:#64748b;"">Partition</td>
                  <td align=""right"" style=""padding:0 0 8px 0; font-size:13px; color:#111827; font-weight:600;"">{Enc(partition)}</td>
                </tr>
                <tr>
                  <td style=""padding:0; font-size:13px; color:#64748b;"">Offset</td>
                  <td align=""right"" style=""padding:0; font-size:13px; color:#111827; font-weight:600;"">{Enc(offset)}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style=""padding:8px 22px 6px 22px;"">
              <div style=""font-size:13px; color:#64748b; margin-bottom:6px;"">Message</div>
              <div style=""background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; font-size:14px; line-height:1.55; color:#0f172a; white-space:pre-wrap; word-break:break-all; overflow-wrap:anywhere;"">
                {Enc(message)}
              </div>
            </td>
          </tr>

          <tr>
            <td style=""padding:6px 22px 12px 22px;"">
              <div style=""font-size:13px; color:#64748b; margin-bottom:6px;"">Exception</div>
              <div style=""background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; font-size:14px; line-height:1.55; color:#0f172a; white-space:pre-wrap; word-break:break-all; overflow-wrap:anywhere;"">
                {Enc(exception)}
              </div>
            </td>
          </tr>
{linksSection}
          <tr>
            <td style=""border-top:1px solid #e5e7eb; padding:12px 22px; font-size:12px; color:#6b7280;"">
              Sent by Kube Visibility Dashboard Topic Alerting
            </td>
          </tr>
        </table>
        <!--[if mso]>
            </td>
          </tr>
        </table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>";
        }

        private static string BuildTopicAlertGlobalSearchUrl(string dashboardBaseUrl, DateTime eventTimestampUtc, string? serviceName)
        {
            var startUtc = eventTimestampUtc.AddSeconds(-60).ToString("O");
            var endUtc = eventTimestampUtc.AddSeconds(60).ToString("O");

            var query = new StringBuilder();
            query.Append("view=scanning");
            query.Append("&globalLogs=1");
            query.Append("&searched=1");
            query.Append("&levels=Error");
            query.Append("&from=").Append(Uri.EscapeDataString(startUtc));
            query.Append("&to=").Append(Uri.EscapeDataString(endUtc));

            var normalizedServiceName = FormatAlertValue(serviceName);
            if (!string.Equals(normalizedServiceName, "Empty", StringComparison.OrdinalIgnoreCase))
            {
                query.Append("&svc=").Append(Uri.EscapeDataString(normalizedServiceName));
            }

            return BuildAbsoluteDashboardUrl(dashboardBaseUrl, "/cluster?" + query);
        }

        private static string BuildTopicAlertServiceDeepDiveUrl(string dashboardBaseUrl, string? serviceName)
        {
            var resource = FormatAlertValue(serviceName);
            if (string.Equals(resource, "Empty", StringComparison.OrdinalIgnoreCase))
            {
                return BuildAbsoluteDashboardUrl(dashboardBaseUrl, "/cluster?view=scanning");
            }

            return BuildAbsoluteDashboardUrl(
                dashboardBaseUrl,
                "/cluster?view=deepdive&resource=" + Uri.EscapeDataString(resource));
        }

        private static string BuildAbsoluteDashboardUrl(string dashboardBaseUrl, string relativePath)
        {
            var normalizedBase = dashboardBaseUrl.TrimEnd('/');
            var normalizedPath = relativePath.StartsWith("/", StringComparison.Ordinal)
                ? relativePath
                : "/" + relativePath;
            return normalizedBase + normalizedPath;
        }

        private static string FormatAlertValue(string? value)
        {
            return string.IsNullOrWhiteSpace(value) ? "Empty" : value.Trim();
        }

        private static (string host, int port) ParseSmtpEndpoint(string endpoint)
        {
            var raw = string.IsNullOrWhiteSpace(endpoint) ? "localhost:25" : endpoint.Trim();
            var parts = raw.Split(':', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (parts.Length == 0)
            {
                return ("localhost", 25);
            }
            if (parts.Length >= 2 && int.TryParse(parts[^1], out var parsedPort))
            {
                return (parts[0], parsedPort);
            }

            return (parts[0], 25);
        }

        private static string? NormalizeDashboardBaseUrl(string? dashboardBaseUrl)
        {
            if (string.IsNullOrWhiteSpace(dashboardBaseUrl))
            {
                return null;
            }

            return dashboardBaseUrl.Trim().TrimEnd('/');
        }

        private static string TruncateForEmail(string value, int maxChars)
        {
            if (string.IsNullOrEmpty(value) || value.Length <= maxChars || maxChars <= 0)
            {
                return value;
            }

            return value[..maxChars] + " ... [truncated]";
        }

        private static TopicErrorEventsIngestRequest MapOtlpPayloadToTopicErrorEvents(JsonElement otlpPayload)
        {
            var request = new TopicErrorEventsIngestRequest();
            if (otlpPayload.ValueKind != JsonValueKind.Object)
            {
                return request;
            }

            if (!otlpPayload.TryGetProperty("resourceLogs", out var resourceLogs) || resourceLogs.ValueKind != JsonValueKind.Array)
            {
                return request;
            }

            foreach (var resourceLog in resourceLogs.EnumerateArray())
            {
                var resourceAttributes = ReadOtlpAttributes(resourceLog, "resource", "attributes");
                var serviceName = GetPreferredString(resourceAttributes, "service.name", "service_name");
                var podName = GetPreferredString(resourceAttributes, "k8s.pod.name", "pod.name");
                var namespaceName = GetPreferredString(resourceAttributes, "k8s.namespace.name", "namespace");

                if (!resourceLog.TryGetProperty("scopeLogs", out var scopeLogs) || scopeLogs.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var scopeLog in scopeLogs.EnumerateArray())
                {
                    if (!scopeLog.TryGetProperty("logRecords", out var logRecords) || logRecords.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    foreach (var logRecord in logRecords.EnumerateArray())
                    {
                        var logAttributes = ReadOtlpAttributes(logRecord, "attributes");
                        var topicName = GetPreferredString(logAttributes, "Topic", "topic");
                        var message = ExtractOtlpBodyAsString(logRecord);
                        var exception = GetPreferredString(logAttributes, "Exception", "exception");
                        var eventId = GetPreferredString(logAttributes, "eventId", "event_id");
                        var applicationName = GetPreferredString(logAttributes, "ApplicationName", "application.name", "application_name");
                        var logLevel = GetPreferredString(logAttributes, "LogLevel", "log.level");
                        var partition = TryParseInt(GetPreferredString(logAttributes, "Partition", "partition"));
                        var offset = TryParseLong(GetPreferredString(logAttributes, "Offset", "offset"));
                        var timestamp = ParseOtlpTimestamp(logRecord);

                        request.Events.Add(new TopicErrorEventIngestRequest
                        {
                            EventId = eventId,
                            TopicName = topicName,
                            Message = message,
                            Exception = exception,
                            Timestamp = timestamp,
                            ServiceName = serviceName,
                            ApplicationName = applicationName,
                            Namespace = namespaceName,
                            Partition = partition,
                            Offset = offset,
                            PodName = podName,
                            LogLevel = logLevel
                        });
                    }
                }
            }

            return request;
        }

        private static Dictionary<string, string?> ReadOtlpAttributes(JsonElement root, params string[] path)
        {
            var current = root;
            foreach (var segment in path)
            {
                if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                {
                    return new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
                }
            }

            if (current.ValueKind != JsonValueKind.Array)
            {
                return new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            }

            var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in current.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("key", out var keyElement))
                {
                    continue;
                }

                var key = keyElement.GetString();
                if (string.IsNullOrWhiteSpace(key))
                {
                    continue;
                }

                string? value = null;
                if (item.TryGetProperty("value", out var valueElement))
                {
                    value = ExtractOtlpAnyValueAsString(valueElement);
                }

                result[key] = value;
            }

            return result;
        }

        private static string? ExtractOtlpBodyAsString(JsonElement logRecord)
        {
            if (!logRecord.TryGetProperty("body", out var bodyElement))
            {
                return null;
            }

            return ExtractOtlpAnyValueAsString(bodyElement);
        }

        private static string? ExtractOtlpAnyValueAsString(JsonElement anyValue)
        {
            if (anyValue.ValueKind != JsonValueKind.Object)
            {
                return anyValue.ValueKind switch
                {
                    JsonValueKind.String => anyValue.GetString(),
                    JsonValueKind.Number => anyValue.GetRawText(),
                    JsonValueKind.True => "true",
                    JsonValueKind.False => "false",
                    _ => anyValue.GetRawText()
                };
            }

            if (anyValue.TryGetProperty("stringValue", out var stringValue))
            {
                return stringValue.GetString();
            }

            if (anyValue.TryGetProperty("intValue", out var intValue))
            {
                return intValue.ValueKind == JsonValueKind.String ? intValue.GetString() : intValue.GetRawText();
            }

            if (anyValue.TryGetProperty("doubleValue", out var doubleValue))
            {
                return doubleValue.GetRawText();
            }

            if (anyValue.TryGetProperty("boolValue", out var boolValue))
            {
                return boolValue.ValueKind == JsonValueKind.True ? "true" : "false";
            }

            if (anyValue.TryGetProperty("bytesValue", out var bytesValue))
            {
                return bytesValue.GetString();
            }

            // For arrayValue/kvlistValue keep raw JSON to preserve original content.
            return anyValue.GetRawText();
        }

        private static string? ParseOtlpTimestamp(JsonElement logRecord)
        {
            if (TryReadUnixNanos(logRecord, "timeUnixNano", out var eventTime))
            {
                return eventTime.ToString("O");
            }

            if (TryReadUnixNanos(logRecord, "observedTimeUnixNano", out var observedTime))
            {
                return observedTime.ToString("O");
            }

            return null;
        }

        private static bool TryReadUnixNanos(JsonElement element, string propertyName, out DateTime timestampUtc)
        {
            timestampUtc = default;
            if (!element.TryGetProperty(propertyName, out var nanosElement))
            {
                return false;
            }

            string? nanosText = nanosElement.ValueKind switch
            {
                JsonValueKind.String => nanosElement.GetString(),
                JsonValueKind.Number => nanosElement.GetRawText(),
                _ => null
            };

            if (string.IsNullOrWhiteSpace(nanosText) || !long.TryParse(nanosText, out var nanos))
            {
                return false;
            }

            // 1 tick = 100 nanoseconds.
            var ticksSinceUnixEpoch = nanos / 100;
            timestampUtc = DateTime.SpecifyKind(DateTime.UnixEpoch.AddTicks(ticksSinceUnixEpoch), DateTimeKind.Utc);
            return true;
        }

        private static string? GetPreferredString(Dictionary<string, string?> attributes, params string[] keys)
        {
            foreach (var key in keys)
            {
                if (attributes.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                {
                    return value;
                }
            }

            return null;
        }

        private static int? TryParseInt(string? value)
        {
            return int.TryParse(value, out var parsed) ? parsed : null;
        }

        private static long? TryParseLong(string? value)
        {
            return long.TryParse(value, out var parsed) ? parsed : null;
        }

        private async Task EnsureTopicErrorIngestIndicesAsync(HttpClient httpClient, string baseUrl, CancellationToken cancellationToken)
        {
            await EnsureIndexExistsAsync(httpClient, baseUrl, _topicErrorsEventIdIndexAlias, cancellationToken);
            await EnsureIndexExistsAsync(httpClient, baseUrl, _topicErrorsDedupeIndexAlias, cancellationToken);
        }

        private async Task EnsureIndexExistsAsync(HttpClient httpClient, string baseUrl, string indexName, CancellationToken cancellationToken)
        {
            var encodedIndexName = Uri.EscapeDataString(indexName);
            var headUrl = $"{baseUrl}/{encodedIndexName}";
            using var headRequest = new HttpRequestMessage(HttpMethod.Head, headUrl);
            ApplyElasticsearchAuthorization(headRequest);

            using var headResponse = await httpClient.SendAsync(headRequest, cancellationToken);
            if (headResponse.IsSuccessStatusCode)
            {
                return;
            }

            if (headResponse.StatusCode != HttpStatusCode.NotFound)
            {
                _logger.LogWarning(
                    "Unexpected status checking Elasticsearch index {IndexName}: {StatusCode}",
                    indexName,
                    (int)headResponse.StatusCode);
                return;
            }

            var createBody = new
            {
                settings = new
                {
                    number_of_shards = 1,
                    number_of_replicas = 1
                },
                mappings = new
                {
                    dynamic = true
                }
            };

            var createUrl = $"{baseUrl}/{encodedIndexName}";
            using var createRequest = new HttpRequestMessage(HttpMethod.Put, createUrl)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(createBody),
                    Encoding.UTF8,
                    "application/json")
            };
            ApplyElasticsearchAuthorization(createRequest);

            using var createResponse = await httpClient.SendAsync(createRequest, cancellationToken);
            if (createResponse.IsSuccessStatusCode || createResponse.StatusCode == HttpStatusCode.BadRequest)
            {
                return;
            }

            var error = await createResponse.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogWarning(
                "Failed to create Elasticsearch index {IndexName}. Status: {StatusCode}, Response: {Response}",
                indexName,
                (int)createResponse.StatusCode,
                error);
        }

        private void ApplyElasticsearchAuthorization(HttpRequestMessage request)
        {
            if (!string.IsNullOrWhiteSpace(_apiKey))
            {
                request.Headers.Add("Authorization", $"ApiKey {_apiKey}");
            }
        }

        private Dictionary<string, object> BuildElasticsearchQuery(ElasticsearchLogsRequest request)
        {
            var mustClauses = new List<Dictionary<string, object>>();
            var filterClauses = new List<Dictionary<string, object>>();

            // Must have service.name field
            mustClauses.Add(new Dictionary<string, object>
            {
                ["exists"] = new Dictionary<string, object>
                {
                    ["field"] = "service.name"
                }
            });

            // Filter by service.name (exact match; use keyword for term, or match_phrase for text field)
            if (!string.IsNullOrWhiteSpace(request.ServiceName))
            {
                var serviceName = request.ServiceName.Trim();
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["bool"] = new Dictionary<string, object>
                    {
                        ["should"] = new List<Dictionary<string, object>>
                        {
                            new Dictionary<string, object> { ["term"] = new Dictionary<string, object> { ["service.name.keyword"] = serviceName } },
                            new Dictionary<string, object> { ["term"] = new Dictionary<string, object> { ["service.name"] = serviceName } },
                            new Dictionary<string, object> { ["match_phrase"] = new Dictionary<string, object> { ["service.name"] = serviceName } }
                        },
                        ["minimum_should_match"] = 1
                    }
                });
            }

            // Filter by log.key (prefix match on attributes.log_key)
            if (!string.IsNullOrWhiteSpace(request.LogKey))
            {
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["prefix"] = new Dictionary<string, object>
                    {
                        ["attributes.log_key"] = request.LogKey
                    }
                });
            }

            // Filter by PodName (exact pod match, with log file path fallback)
            if (!string.IsNullOrWhiteSpace(request.PodName))
            {
                var podName = request.PodName.Trim();
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["bool"] = new Dictionary<string, object>
                    {
                        ["should"] = new List<Dictionary<string, object>>
                        {
                            new Dictionary<string, object> { ["term"] = new Dictionary<string, object> { ["resource.attributes.k8s.pod.name.keyword"] = podName } },
                            new Dictionary<string, object> { ["term"] = new Dictionary<string, object> { ["resource.attributes.k8s.pod.name"] = podName } },
                            new Dictionary<string, object> { ["term"] = new Dictionary<string, object> { ["k8s.pod.name.keyword"] = podName } },
                            new Dictionary<string, object> { ["term"] = new Dictionary<string, object> { ["k8s.pod.name"] = podName } },
                            new Dictionary<string, object> { ["wildcard"] = new Dictionary<string, object> { ["attributes.log.file.path"] = $"*_{podName}_*" } }
                        },
                        ["minimum_should_match"] = 1
                    }
                });
            }

            // Filter by Message (wildcard match on attributes.Message or attributes.Exception)
            if (!string.IsNullOrWhiteSpace(request.Message))
            {
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["bool"] = new Dictionary<string, object>
                    {
                        ["should"] = new List<Dictionary<string, object>>
                        {
                            new Dictionary<string, object>
                            {
                                ["wildcard"] = new Dictionary<string, object>
                                {
                                    ["attributes.Message"] = $"*{request.Message}*"
                                }
                            },
                            new Dictionary<string, object>
                            {
                                ["wildcard"] = new Dictionary<string, object>
                                {
                                    ["attributes.Exception"] = $"*{request.Message}*"
                                }
                            }
                        },
                        ["minimum_should_match"] = 1
                    }
                });
            }

            // Filter by LogLevel(s) (exact term match on attributes.LogLevel)
            if (request.LogLevels != null && request.LogLevels.Any(level => !string.IsNullOrWhiteSpace(level)))
            {
                var selectedLevels = request.LogLevels
                    .Where(level => !string.IsNullOrWhiteSpace(level))
                    .Where(level => !string.Equals(level.Trim(), "All", StringComparison.OrdinalIgnoreCase))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (selectedLevels.Any())
                {
                    mustClauses.Add(new Dictionary<string, object>
                    {
                        ["terms"] = new Dictionary<string, object>
                        {
                            ["attributes.LogLevel"] = selectedLevels
                        }
                    });
                }
            }

            // Time range filter (normalize to UTC so range is correct regardless of server timezone)
            var timeFrom = request.TimeFrom?.ToUniversalTime() ?? DateTime.UtcNow.AddHours(-24);
            var timeTo = request.TimeTo?.ToUniversalTime() ?? DateTime.UtcNow;
            if (timeFrom > timeTo)
                (timeFrom, timeTo) = (timeTo, timeFrom);

            filterClauses.Add(new Dictionary<string, object>
            {
                ["range"] = new Dictionary<string, object>
                {
                    ["@timestamp"] = new Dictionary<string, object>
                    {
                        ["gte"] = timeFrom.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                        ["lte"] = timeTo.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                }
            });

            var boolQuery = new Dictionary<string, object>();
            if (mustClauses.Any())
            {
                boolQuery["must"] = mustClauses;
            }
            if (filterClauses.Any())
            {
                boolQuery["filter"] = filterClauses;
            }

            return new Dictionary<string, object>
            {
                ["query"] = new Dictionary<string, object>
                {
                    ["bool"] = boolQuery
                },
                ["sort"] = new List<Dictionary<string, object>>
                {
                    new Dictionary<string, object>
                    {
                        ["@timestamp"] = new Dictionary<string, object>
                        {
                            ["order"] = "desc"
                        }
                    }
                },
                ["from"] = request.From,
                ["size"] = request.Size
            };
        }

        private Dictionary<string, object> BuildErrorAnalyticsQuery(
            string? serviceName,
            DateTime timeFrom,
            DateTime timeTo,
            int minCount)
        {
            var mustClauses = new List<Dictionary<string, object>>();
            var filterClauses = new List<Dictionary<string, object>>();

            // Filter by Error log level
            mustClauses.Add(new Dictionary<string, object>
            {
                ["term"] = new Dictionary<string, object>
                {
                    ["attributes.LogLevel"] = "Error"
                }
            });

            // Filter by service name if provided
            if (!string.IsNullOrWhiteSpace(serviceName))
            {
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["term"] = new Dictionary<string, object>
                    {
                        ["service.name"] = serviceName
                    }
                });
            }

            // Time range filter
            filterClauses.Add(new Dictionary<string, object>
            {
                ["range"] = new Dictionary<string, object>
                {
                    ["@timestamp"] = new Dictionary<string, object>
                    {
                        ["gte"] = timeFrom.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                        ["lte"] = timeTo.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                }
            });

            var boolQuery = new Dictionary<string, object>();
            if (mustClauses.Any())
            {
                boolQuery["must"] = mustClauses;
            }
            if (filterClauses.Any())
            {
                boolQuery["filter"] = filterClauses;
            }

            return new Dictionary<string, object>
            {
                ["query"] = new Dictionary<string, object>
                {
                    ["bool"] = boolQuery
                },
                ["size"] = 0, // We only want aggregations, not individual hits
                ["aggs"] = new Dictionary<string, object>
                {
                    ["error_messages"] = new Dictionary<string, object>
                    {
                        ["terms"] = new Dictionary<string, object>
                        {
                            // Use script to extract message value - try keyword first, then text field
                            // This works with both field types
                            ["script"] = new Dictionary<string, object>
                            {
                                ["source"] = "String msg = ''; try { if (doc['attributes.Message.keyword'].size() > 0) { msg = doc['attributes.Message.keyword'].value; } } catch (Exception e) { } if (msg == '' || msg.length() == 0) { try { if (doc['attributes.Message'].size() > 0) { msg = doc['attributes.Message'].value.toString(); } } catch (Exception e) { } } return msg.length() > 0 ? msg : 'N/A';",
                                ["lang"] = "painless"
                            },
                            ["size"] = 1000, // Get top 1000 unique error messages
                            // Keep raw bucket threshold low and apply minCount after
                            // normalized re-grouping in ProcessErrorAggregations.
                            ["min_doc_count"] = 1,
                            ["order"] = new Dictionary<string, object>
                            {
                                ["_count"] = "desc"
                            }
                        },
                        ["aggs"] = new Dictionary<string, object>
                        {
                            ["sample_logs"] = new Dictionary<string, object>
                            {
                                ["top_hits"] = new Dictionary<string, object>
                                {
                                    ["size"] = 3,
                                    ["sort"] = new List<Dictionary<string, object>>
                                    {
                                        new Dictionary<string, object>
                                        {
                                            ["@timestamp"] = new Dictionary<string, object>
                                            {
                                                ["order"] = "desc"
                                            }
                                        }
                                    }
                                }
                            },
                            ["first_occurrence"] = new Dictionary<string, object>
                            {
                                ["min"] = new Dictionary<string, object>
                                {
                                    ["field"] = "@timestamp"
                                }
                            },
                            ["last_occurrence"] = new Dictionary<string, object>
                            {
                                ["max"] = new Dictionary<string, object>
                                {
                                    ["field"] = "@timestamp"
                                }
                            }
                        }
                    }
                }
            };
        }

        private Dictionary<string, object> BuildErrorAnalyticsQueryFallback(
            string? serviceName,
            DateTime timeFrom,
            DateTime timeTo,
            int minCount)
        {
            // Fallback query that uses the field directly without script
            var mustClauses = new List<Dictionary<string, object>>();
            var filterClauses = new List<Dictionary<string, object>>();

            // Filter by Error log level
            mustClauses.Add(new Dictionary<string, object>
            {
                ["term"] = new Dictionary<string, object>
                {
                    ["attributes.LogLevel"] = "Error"
                }
            });

            // Filter by service name if provided
            if (!string.IsNullOrWhiteSpace(serviceName))
            {
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["term"] = new Dictionary<string, object>
                    {
                        ["service.name"] = serviceName
                    }
                });
            }

            // Time range filter
            filterClauses.Add(new Dictionary<string, object>
            {
                ["range"] = new Dictionary<string, object>
                {
                    ["@timestamp"] = new Dictionary<string, object>
                    {
                        ["gte"] = timeFrom.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                        ["lte"] = timeTo.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                }
            });

            var boolQuery = new Dictionary<string, object>();
            if (mustClauses.Any())
            {
                boolQuery["must"] = mustClauses;
            }
            if (filterClauses.Any())
            {
                boolQuery["filter"] = filterClauses;
            }

            return new Dictionary<string, object>
            {
                ["query"] = new Dictionary<string, object>
                {
                    ["bool"] = boolQuery
                },
                ["size"] = 0,
                ["aggs"] = new Dictionary<string, object>
                {
                    ["error_messages"] = new Dictionary<string, object>
                    {
                        ["terms"] = new Dictionary<string, object>
                        {
                            // Try direct field access - some ES versions support this
                            ["field"] = "attributes.Message",
                            ["size"] = 1000,
                            // Keep raw bucket threshold low and apply minCount after
                            // normalized re-grouping in ProcessErrorAggregations.
                            ["min_doc_count"] = 1,
                            ["order"] = new Dictionary<string, object>
                            {
                                ["_count"] = "desc"
                            }
                        },
                        ["aggs"] = new Dictionary<string, object>
                        {
                            ["sample_logs"] = new Dictionary<string, object>
                            {
                                ["top_hits"] = new Dictionary<string, object>
                                {
                                    ["size"] = 3,
                                    ["sort"] = new List<Dictionary<string, object>>
                                    {
                                        new Dictionary<string, object>
                                        {
                                            ["@timestamp"] = new Dictionary<string, object>
                                            {
                                                ["order"] = "desc"
                                            }
                                        }
                                    }
                                }
                            },
                            ["first_occurrence"] = new Dictionary<string, object>
                            {
                                ["min"] = new Dictionary<string, object>
                                {
                                    ["field"] = "@timestamp"
                                }
                            },
                            ["last_occurrence"] = new Dictionary<string, object>
                            {
                                ["max"] = new Dictionary<string, object>
                                {
                                    ["field"] = "@timestamp"
                                }
                            }
                        }
                    }
                }
            };
        }

        private Dictionary<string, object> BuildSimilarErrorsQuery(
            string serviceName,
            string errorMessage,
            DateTime timeFrom,
            DateTime timeTo,
            int candidateSize,
            bool strictPattern,
            bool includeAllServices)
        {
            var mustClauses = new List<Dictionary<string, object>>();
            var filterClauses = new List<Dictionary<string, object>>();

            // Filter by Error log level
            mustClauses.Add(new Dictionary<string, object>
            {
                ["term"] = new Dictionary<string, object>
                {
                    ["attributes.LogLevel"] = "Error"
                }
            });

            if (!includeAllServices)
            {
                // Default mode is same-service only.
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["term"] = new Dictionary<string, object>
                    {
                        ["service.name"] = serviceName
                    }
                });
            }

            if (strictPattern)
            {
                // Strict mode uses phrase matching against raw message text.
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["match_phrase"] = new Dictionary<string, object>
                    {
                        ["attributes.Message"] = errorMessage
                    }
                });
            }
            else
            {
                // Fuzzy mode uses semantic token similarity.
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["more_like_this"] = new Dictionary<string, object>
                    {
                        ["fields"] = new[] { "attributes.Message" },
                        ["like"] = errorMessage,
                        ["min_term_freq"] = 1,
                        ["min_doc_freq"] = 1,
                        ["max_query_terms"] = 25
                    }
                });
            }

            // Time range filter
            filterClauses.Add(new Dictionary<string, object>
            {
                ["range"] = new Dictionary<string, object>
                {
                    ["@timestamp"] = new Dictionary<string, object>
                    {
                        ["gte"] = timeFrom.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                        ["lte"] = timeTo.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                }
            });

            return new Dictionary<string, object>
            {
                ["query"] = new Dictionary<string, object>
                {
                    ["bool"] = new Dictionary<string, object>
                    {
                        ["must"] = mustClauses,
                        ["filter"] = filterClauses
                    }
                },
                ["size"] = candidateSize,
                ["track_total_hits"] = false,
                ["sort"] = strictPattern
                    ? new List<Dictionary<string, object>>
                    {
                        new Dictionary<string, object>
                        {
                            ["@timestamp"] = new Dictionary<string, object>
                            {
                                ["order"] = "desc"
                            }
                        }
                    }
                    : new List<Dictionary<string, object>>
                    {
                        new Dictionary<string, object>
                        {
                            ["_score"] = new Dictionary<string, object>
                            {
                                ["order"] = "desc"
                            }
                        },
                        new Dictionary<string, object>
                        {
                            ["@timestamp"] = new Dictionary<string, object>
                            {
                                ["order"] = "desc"
                            }
                        }
                    }
            };
        }

        private Dictionary<string, object> BuildTopicErrorsQuery(TopicErrorsRequest request)
        {
            var mustClauses = new List<Dictionary<string, object>>();
            var filterClauses = new List<Dictionary<string, object>>();

            // Must have attributes.Topic field
            mustClauses.Add(new Dictionary<string, object>
            {
                ["exists"] = new Dictionary<string, object>
                {
                    ["field"] = "attributes.Topic"
                }
            });

            // Filter by Error log level
            mustClauses.Add(new Dictionary<string, object>
            {
                ["term"] = new Dictionary<string, object>
                {
                    ["attributes.LogLevel"] = "Error"
                }
            });

            // Filter by service name if provided
            if (!string.IsNullOrWhiteSpace(request.ServiceName))
            {
                mustClauses.Add(new Dictionary<string, object>
                {
                    ["term"] = new Dictionary<string, object>
                    {
                        ["service.name"] = request.ServiceName
                    }
                });
            }

            // Time range filter (use configured default if not provided)
            var timeFrom = request.TimeFrom ?? DateTime.UtcNow.AddHours(-_defaultTopicErrorsHoursBack);
            var timeTo = request.TimeTo ?? DateTime.UtcNow;

            filterClauses.Add(new Dictionary<string, object>
            {
                ["range"] = new Dictionary<string, object>
                {
                    ["@timestamp"] = new Dictionary<string, object>
                    {
                        ["gte"] = timeFrom.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                        ["lte"] = timeTo.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                }
            });

            var boolQuery = new Dictionary<string, object>();
            if (mustClauses.Any())
            {
                boolQuery["must"] = mustClauses;
            }
            if (filterClauses.Any())
            {
                boolQuery["filter"] = filterClauses;
            }

            return new Dictionary<string, object>
            {
                ["query"] = new Dictionary<string, object>
                {
                    ["bool"] = boolQuery
                },
                ["sort"] = new List<Dictionary<string, object>>
                {
                    new Dictionary<string, object>
                    {
                        ["@timestamp"] = new Dictionary<string, object>
                        {
                            ["order"] = "desc"
                        }
                    }
                },
                ["size"] = 10000 // Get up to 10000 errors
            };
        }

        private List<ErrorGroup> ProcessErrorAggregations(
            ElasticsearchAggregationResponse response,
            int minCount)
        {
            var errorGroups = new List<ErrorGroup>();

            if (response.Aggregations?.ErrorMessages?.Buckets == null)
            {
                _logger.LogWarning(
                    "Aggregations or buckets are null. Aggregations: {Aggregations}, ErrorMessages: {ErrorMessages}",
                    response.Aggregations != null,
                    response.Aggregations?.ErrorMessages != null);
                return errorGroups;
            }

            _logger.LogInformation(
                "Processing {Count} buckets from aggregation",
                response.Aggregations.ErrorMessages.Buckets.Count);

            // Re-group raw message buckets by normalized message so dynamic values
            // (timestamps/ids/etc.) collapse into a single actionable error group.
            var normalizedGroups = new Dictionary<string, ErrorGroup>(StringComparer.Ordinal);

            foreach (var bucket in response.Aggregations.ErrorMessages.Buckets)
            {
                var errorMessage = bucket.Key;
                var normalizedMessage = NormalizeErrorMessage(errorMessage);

                // Extract sample logs
                var sampleLogs = new List<ElasticsearchLogEntry>();
                if (bucket.SampleLogs?.Hits?.Hits != null)
                {
                    foreach (var hit in bucket.SampleLogs.Hits.Hits)
                    {
                        sampleLogs.Add(MapToLogEntry(hit.Source));
                    }
                }

                // Extract first and last occurrence
                var firstOccurrence = DateTime.UtcNow;
                var lastOccurrence = DateTime.UtcNow;
                
                if (bucket.FirstOccurrence?.ValueAsString != null)
                {
                    if (DateTime.TryParse(bucket.FirstOccurrence.ValueAsString, out var first))
                    {
                        firstOccurrence = first;
                    }
                }
                
                if (bucket.LastOccurrence?.ValueAsString != null)
                {
                    if (DateTime.TryParse(bucket.LastOccurrence.ValueAsString, out var last))
                    {
                        lastOccurrence = last;
                    }
                }

                // Get service name and log key from first sample log
                var serviceName = sampleLogs.FirstOrDefault()?.ServiceName;
                var logKey = sampleLogs.FirstOrDefault()?.LogKey;

                if (!normalizedGroups.TryGetValue(normalizedMessage, out var existingGroup))
                {
                    normalizedGroups[normalizedMessage] = new ErrorGroup
                    {
                        ErrorMessage = errorMessage,
                        NormalizedMessage = normalizedMessage,
                        Count = bucket.DocCount,
                        ServiceName = serviceName,
                        LogKey = logKey,
                        FirstOccurrence = firstOccurrence,
                        LastOccurrence = lastOccurrence,
                        SampleLogs = sampleLogs.Take(3).ToList()
                    };
                    continue;
                }

                // Aggregate counts/time range/samples into the normalized group.
                existingGroup.Count += bucket.DocCount;
                existingGroup.FirstOccurrence = existingGroup.FirstOccurrence <= firstOccurrence
                    ? existingGroup.FirstOccurrence
                    : firstOccurrence;
                existingGroup.LastOccurrence = existingGroup.LastOccurrence >= lastOccurrence
                    ? existingGroup.LastOccurrence
                    : lastOccurrence;

                if (string.IsNullOrWhiteSpace(existingGroup.ServiceName))
                {
                    existingGroup.ServiceName = serviceName;
                }

                if (string.IsNullOrWhiteSpace(existingGroup.LogKey))
                {
                    existingGroup.LogKey = logKey;
                }

                if (sampleLogs.Count > 0)
                {
                    existingGroup.SampleLogs = existingGroup.SampleLogs
                        .Concat(sampleLogs)
                        .Where(log => log != null)
                        .OrderByDescending(log => DateTime.TryParse(log.Timestamp, out var dt) ? dt : DateTime.MinValue)
                        .Take(3)
                        .ToList();
                }
            }

            errorGroups = normalizedGroups.Values
                .Where(group => group.Count >= minCount)
                .OrderByDescending(group => group.Count)
                .ThenByDescending(group => group.LastOccurrence)
                .ToList();

            return errorGroups;
        }

        private string NormalizeErrorMessage(string errorMessage)
        {
            if (string.IsNullOrWhiteSpace(errorMessage))
            {
                return errorMessage;
            }

            // Remove common dynamic values (IDs, timestamps, etc.)
            var normalized = errorMessage;
            
            // Remove GUIDs
            normalized = System.Text.RegularExpressions.Regex.Replace(
                normalized, 
                @"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", 
                "{GUID}");

            // Normalize common date+time shapes first.
            normalized = System.Text.RegularExpressions.Regex.Replace(
                normalized,
                @"\b\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?\b",
                "{DATETIME}");

            // Normalize date-only values.
            normalized = System.Text.RegularExpressions.Regex.Replace(
                normalized,
                @"\b\d{4}[-/]\d{2}[-/]\d{2}\b|\b\d{2}[-/]\d{2}[-/]\d{4}\b",
                "{DATE}");

            // Normalize time-only values.
            normalized = System.Text.RegularExpressions.Regex.Replace(
                normalized,
                @"\b\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?\b",
                "{TIME}");
            
            // Remove numbers that might be IDs
            normalized = System.Text.RegularExpressions.Regex.Replace(
                normalized, 
                @"\b\d{4,}\b", 
                "{ID}");
            
            // Remove email addresses
            normalized = System.Text.RegularExpressions.Regex.Replace(
                normalized, 
                @"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", 
                "{EMAIL}");
            
            // Remove URLs
            normalized = System.Text.RegularExpressions.Regex.Replace(
                normalized, 
                @"https?://[^\s]+", 
                "{URL}");

            return normalized;
        }

        private List<ErrorGroup> GroupSimilarErrors(
            List<SimilarLogMatch> logs,
            string originalMessage)
        {
            // Group by normalized message
            var grouped = logs
                .GroupBy(match => NormalizeErrorMessage(match.Log.Message ?? string.Empty))
                .Select(g => new ErrorGroup
                {
                    ErrorMessage = g.First().Log.Message ?? string.Empty,
                    NormalizedMessage = g.Key,
                    Count = g.Count(),
                    SimilarityScore = Math.Round(g.Average(match => match.Score), 3),
                    ServiceName = g.First().Log.ServiceName,
                    LogKey = g.First().Log.LogKey,
                    FirstOccurrence = g.Min(match => DateTime.TryParse(match.Log.Timestamp, out var dt) ? dt : DateTime.UtcNow),
                    LastOccurrence = g.Max(match => DateTime.TryParse(match.Log.Timestamp, out var dt) ? dt : DateTime.UtcNow),
                    SampleLogs = g.Select(match => match.Log).Take(3).ToList()
                })
                .OrderByDescending(g => g.SimilarityScore)
                .ThenByDescending(g => g.Count)
                .ThenByDescending(g => g.LastOccurrence)
                .ToList();

            return grouped;
        }

        private ElasticsearchLogEntry MapToLogEntry(JsonElement source)
        {
            var entry = new ElasticsearchLogEntry();

            // Extract timestamp
            if (source.TryGetProperty("@timestamp", out var timestampProp))
            {
                var timestampStr = timestampProp.GetString();
                if (!string.IsNullOrWhiteSpace(timestampStr))
                {
                    entry.Timestamp = timestampStr;
                }
            }

            // Extract service.name from resource.attributes.service.name
            if (source.TryGetProperty("resource", out var resourceProp) &&
                resourceProp.TryGetProperty("attributes", out var resourceAttrsProp) &&
                resourceAttrsProp.TryGetProperty("service.name", out var serviceNameProp))
            {
                entry.ServiceName = serviceNameProp.GetString();
            }

            // Extract PodName from resource.attributes.k8s.pod.name, fallback to k8s.pod.name
            if (source.TryGetProperty("resource", out var podResourceProp) &&
                podResourceProp.TryGetProperty("attributes", out var podResourceAttrsProp) &&
                podResourceAttrsProp.TryGetProperty("k8s.pod.name", out var podNameProp))
            {
                entry.PodName = podNameProp.GetString();
            }
            else if (source.TryGetProperty("k8s", out var k8sProp) &&
                     k8sProp.TryGetProperty("pod", out var podProp) &&
                     podProp.TryGetProperty("name", out var podNameDirectProp))
            {
                entry.PodName = podNameDirectProp.GetString();
            }

            // Extract Message from attributes.Message, fallback to body.text
            if (source.TryGetProperty("attributes", out var attributesProp))
            {
                if (attributesProp.TryGetProperty("Message", out var messageProp))
                {
                    entry.Message = messageProp.GetString();
                }

                // Extract LogLevel from attributes.LogLevel
                if (attributesProp.TryGetProperty("LogLevel", out var logLevelProp))
                {
                    entry.LogLevel = logLevelProp.GetString();
                }

                // Extract log.key from attributes.log_key
                if (attributesProp.TryGetProperty("log_key", out var logKeyProp))
                {
                    entry.LogKey = logKeyProp.GetString();
                }

                // Extract Exception from attributes.Exception
                if (attributesProp.TryGetProperty("Exception", out var exceptionProp))
                {
                    entry.Exception = exceptionProp.GetString();
                }

                // Fallback PodName from attributes.log.file.path if available
                if (string.IsNullOrWhiteSpace(entry.PodName) &&
                    attributesProp.TryGetProperty("log.file.path", out var logFilePathProp))
                {
                    var logFilePath = logFilePathProp.GetString();
                    if (!string.IsNullOrWhiteSpace(logFilePath))
                    {
                        entry.PodName = ExtractPodNameFromLogFilePath(logFilePath);
                    }
                }
            }

            // Fallback: If Message is not found in attributes, try body.text
            if (string.IsNullOrWhiteSpace(entry.Message) && 
                source.TryGetProperty("body", out var bodyProp) &&
                bodyProp.TryGetProperty("text", out var bodyTextProp))
            {
                entry.Message = bodyTextProp.GetString();
            }

            // Store additional fields (excluding already extracted fields)
            var additionalFields = new Dictionary<string, object>();
            foreach (var prop in source.EnumerateObject())
            {
                if (prop.Name != "@timestamp" && 
                    prop.Name != "resource" && 
                    prop.Name != "attributes")
                {
                    additionalFields[prop.Name] = prop.Value.GetRawText();
                }
            }
            if (additionalFields.Any())
            {
                entry.AdditionalFields = additionalFields;
            }

            return entry;
        }

        private string? ExtractPodNameFromLogFilePath(string logFilePath)
        {
            // Expected format:
            // /var/log/pods/{namespace}_{pod-name}_{pod-uid}/{container}/0.log
            var segments = logFilePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var podsIndex = Array.FindIndex(segments, segment => segment.Equals("pods", StringComparison.OrdinalIgnoreCase));
            if (podsIndex < 0 || podsIndex + 1 >= segments.Length)
            {
                return null;
            }

            var podSegment = segments[podsIndex + 1];
            var parts = podSegment.Split('_');
            if (parts.Length < 3)
            {
                return null;
            }

            return parts[1];
        }

        private TopicErrorEntry MapToTopicErrorEntry(JsonElement source)
        {
            var entry = new TopicErrorEntry();

            // Extract timestamp
            if (source.TryGetProperty("@timestamp", out var timestampProp))
            {
                var timestampStr = timestampProp.GetString();
                if (!string.IsNullOrWhiteSpace(timestampStr))
                {
                    entry.Timestamp = timestampStr;
                }
            }

            // Extract ApplicationName from attributes.ApplicationName
            if (source.TryGetProperty("attributes", out var attributesProp))
            {
                if (attributesProp.TryGetProperty("ApplicationName", out var appNameProp))
                {
                    entry.ApplicationName = appNameProp.GetString() ?? string.Empty;
                }

                // Extract Topic from attributes.Topic
                if (attributesProp.TryGetProperty("Topic", out var topicProp))
                {
                    entry.TopicName = topicProp.GetString() ?? string.Empty;
                }

                // Extract Offset from attributes.Offset
                if (attributesProp.TryGetProperty("Offset", out var offsetProp))
                {
                    if (offsetProp.ValueKind == System.Text.Json.JsonValueKind.Number)
                    {
                        entry.Offset = offsetProp.GetInt64();
                    }
                    else if (offsetProp.ValueKind == System.Text.Json.JsonValueKind.String)
                    {
                        if (long.TryParse(offsetProp.GetString(), out var offsetValue))
                        {
                            entry.Offset = offsetValue;
                        }
                    }
                }

                // Extract Partition from attributes.Partition
                if (attributesProp.TryGetProperty("Partition", out var partitionProp))
                {
                    if (partitionProp.ValueKind == System.Text.Json.JsonValueKind.Number)
                    {
                        entry.Partition = partitionProp.GetInt32();
                    }
                    else if (partitionProp.ValueKind == System.Text.Json.JsonValueKind.String)
                    {
                        if (int.TryParse(partitionProp.GetString(), out var partitionValue))
                        {
                            entry.Partition = partitionValue;
                        }
                    }
                }

                // Extract Message from attributes.Message
                if (attributesProp.TryGetProperty("Message", out var messageProp))
                {
                    entry.Message = messageProp.GetString();
                }

                // Extract Exception from attributes.Exception
                if (attributesProp.TryGetProperty("Exception", out var exceptionProp))
                {
                    entry.Exception = exceptionProp.GetString();
                }
            }

            // Extract service.name from resource.attributes.service.name or service.name
            if (source.TryGetProperty("resource", out var resourceProp) &&
                resourceProp.TryGetProperty("attributes", out var resourceAttrsProp) &&
                resourceAttrsProp.TryGetProperty("service.name", out var serviceNameProp))
            {
                entry.ServiceName = serviceNameProp.GetString();
            }
            else if (source.TryGetProperty("service", out var serviceProp) &&
                     serviceProp.TryGetProperty("name", out var serviceNameDirectProp))
            {
                entry.ServiceName = serviceNameDirectProp.GetString();
            }

            return entry;
        }

        private static string? ValidateTopicErrorIngestEvent(
            TopicErrorEventIngestRequest request,
            out string effectiveEventId,
            out DateTime? eventTimestampUtc)
        {
            effectiveEventId = string.IsNullOrWhiteSpace(request.EventId)
                ? ComputeSha256($"{request.Timestamp}|{request.TopicName}|{request.Message}|{request.Exception}")
                : request.EventId.Trim();

            if (string.IsNullOrWhiteSpace(request.TopicName))
            {
                eventTimestampUtc = null;
                return "topicName is required";
            }

            if (string.IsNullOrWhiteSpace(request.Message) && string.IsNullOrWhiteSpace(request.Exception))
            {
                eventTimestampUtc = null;
                return "either message or exception is required";
            }

            if (!TryParseTimestampUtc(request.Timestamp, out var parsedTimestamp))
            {
                eventTimestampUtc = null;
                return "timestamp is required and must be a valid UTC timestamp";
            }

            eventTimestampUtc = parsedTimestamp;
            return null;
        }

        private static bool TryParseTimestampUtc(string? rawTimestamp, out DateTime timestampUtc)
        {
            if (!string.IsNullOrWhiteSpace(rawTimestamp) &&
                DateTimeOffset.TryParse(rawTimestamp, out var timestampOffset))
            {
                timestampUtc = timestampOffset.UtcDateTime;
                return true;
            }

            timestampUtc = default;
            return false;
        }

        private static DateTime GetWindowStartUtc(DateTime timestampUtc, int windowMinutes)
        {
            var utc = DateTime.SpecifyKind(timestampUtc, DateTimeKind.Utc);
            var windowTicks = TimeSpan.FromMinutes(windowMinutes).Ticks;
            var bucketTicks = utc.Ticks - (utc.Ticks % windowTicks);
            return new DateTime(bucketTicks, DateTimeKind.Utc);
        }

        private static string ComputeSha256(string input)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }

        private sealed class TopicAlertingRuntimeContext
        {
            public static TopicAlertingRuntimeContext Empty { get; } = new(
                new List<TopicAlertRule>(),
                new Dictionary<string, TopicAlertGroup>(StringComparer.OrdinalIgnoreCase));

            public TopicAlertingRuntimeContext(
                List<TopicAlertRule> rules,
                Dictionary<string, TopicAlertGroup> groupsById)
            {
                Rules = rules;
                GroupsById = groupsById;
            }

            public List<TopicAlertRule> Rules { get; }
            public Dictionary<string, TopicAlertGroup> GroupsById { get; }
            public bool HasRules => Rules.Count > 0;
        }

        // Helper classes for deserializing Elasticsearch response
        private class ElasticsearchSearchResponse
        {
            [System.Text.Json.Serialization.JsonPropertyName("hits")]
            public ElasticsearchHits? Hits { get; set; }
        }

        private class ElasticsearchHits
        {
            [System.Text.Json.Serialization.JsonPropertyName("total")]
            public ElasticsearchTotal? Total { get; set; }

            [System.Text.Json.Serialization.JsonPropertyName("hits")]
            public List<ElasticsearchHit>? Hits { get; set; }
        }

        private class ElasticsearchTotal
        {
            [System.Text.Json.Serialization.JsonPropertyName("value")]
            public long Value { get; set; }
        }

        private class ElasticsearchHit
        {
            [System.Text.Json.Serialization.JsonPropertyName("_score")]
            public double? Score { get; set; }

            [System.Text.Json.Serialization.JsonPropertyName("_source")]
            public JsonElement Source { get; set; }
        }

        private class SimilarLogMatch
        {
            public ElasticsearchLogEntry Log { get; set; } = new();
            public double Score { get; set; }
        }

        // Helper classes for aggregation response
        private class ElasticsearchAggregationResponse
        {
            [System.Text.Json.Serialization.JsonPropertyName("hits")]
            public ElasticsearchHits? Hits { get; set; }
            
            [System.Text.Json.Serialization.JsonPropertyName("aggregations")]
            public ElasticsearchAggregations? Aggregations { get; set; }
        }

        private class ElasticsearchAggregations
        {
            [System.Text.Json.Serialization.JsonPropertyName("error_messages")]
            public ElasticsearchTermsAggregation? ErrorMessages { get; set; }
        }

        private class ElasticsearchTermsAggregation
        {
            [System.Text.Json.Serialization.JsonPropertyName("buckets")]
            public List<ElasticsearchBucket>? Buckets { get; set; }
        }

        private class ElasticsearchBucket
        {
            [System.Text.Json.Serialization.JsonPropertyName("key")]
            public string Key { get; set; } = string.Empty;
            
            [System.Text.Json.Serialization.JsonPropertyName("doc_count")]
            public long DocCount { get; set; }
            
            [System.Text.Json.Serialization.JsonPropertyName("sample_logs")]
            public ElasticsearchTopHits? SampleLogs { get; set; }
            
            [System.Text.Json.Serialization.JsonPropertyName("first_occurrence")]
            public ElasticsearchMinMax? FirstOccurrence { get; set; }
            
            [System.Text.Json.Serialization.JsonPropertyName("last_occurrence")]
            public ElasticsearchMinMax? LastOccurrence { get; set; }
        }

        private class ElasticsearchTopHits
        {
            [System.Text.Json.Serialization.JsonPropertyName("hits")]
            public ElasticsearchTopHitsResult? Hits { get; set; }
        }

        private class ElasticsearchTopHitsResult
        {
            [System.Text.Json.Serialization.JsonPropertyName("hits")]
            public List<ElasticsearchHit>? Hits { get; set; }
        }

        private class ElasticsearchMinMax
        {
            [System.Text.Json.Serialization.JsonPropertyName("value_as_string")]
            public string? ValueAsString { get; set; }
        }
    }
}

