using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services;
using KubeVisibility.Dashboard.Api.Models;
using System.Text;
using System.Text.Json;

namespace KubeVisibility.Dashboard.Api.Controllers
{
    [Route("api/elasticsearch")]
    [ApiController]
    [Authorize]
    public class ElasticsearchController : ControllerBase
    {
        private const int MinSimilarDays = 1;
        private const int MaxSimilarDays = 60;
        private const int MinSimilarResults = 1;
        private const int MaxSimilarResults = 100;

        private readonly IElasticsearchService _elasticsearchService;
        private readonly ILogger<ElasticsearchController> _logger;
        private readonly IConfiguration _configuration;

        public ElasticsearchController(
            IElasticsearchService elasticsearchService,
            ILogger<ElasticsearchController> logger,
            IConfiguration configuration)
        {
            _elasticsearchService = elasticsearchService;
            _logger = logger;
            _configuration = configuration;
        }

        [HttpGet("logs")]
        public async Task<IActionResult> GetLogs(
            [FromQuery] string? serviceName = null,
            [FromQuery] string? podName = null,
            [FromQuery] string? logKey = null,
            [FromQuery] string? message = null,
            [FromQuery] List<string>? logLevel = null,
            [FromQuery] DateTime? timeFrom = null,
            [FromQuery] DateTime? timeTo = null,
            [FromQuery] int size = 1000,
            [FromQuery] int from = 0)
        {
            try
            {
                _logger.LogInformation(
                    "Retrieving Aggregated logs. ServiceName: {ServiceName}, PodName: {PodName}, LogKey: {LogKey}, Message: {Message}, Levels: {Levels}, From: {From}, Size: {Size}",
                    serviceName ?? "All", podName ?? "All", logKey, message, logLevel == null ? "All" : string.Join(",", logLevel), from, size);

                var request = new ElasticsearchLogsRequest
                {
                    ServiceName = serviceName,
                    PodName = podName,
                    LogKey = logKey,
                    Message = message,
                    LogLevels = logLevel,
                    TimeFrom = timeFrom,
                    TimeTo = timeTo,
                    Size = size,
                    From = from
                };

                var response = await _elasticsearchService.GetLogsAsync(request);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving Aggregated logs");
                return StatusCode(500, new { error = "Failed to retrieve Aggregated logs", details = ex.Message });
            }
        }

        [HttpGet("errors/analytics")]
        public async Task<IActionResult> GetErrorAnalytics(
            [FromQuery] string? serviceName = null,
            [FromQuery] int days = 7,
            [FromQuery] int minCount = 1)
        {
            try
            {
                _logger.LogInformation(
                    "Retrieving error analytics. ServiceName: {ServiceName}, Days: {Days}, MinCount: {MinCount}",
                    serviceName, days, minCount);

                var timeFrom = DateTime.UtcNow.AddDays(-days);
                var timeTo = DateTime.UtcNow;

                var response = await _elasticsearchService.GetErrorAnalyticsAsync(
                    serviceName, timeFrom, timeTo, minCount);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving error analytics");
                return StatusCode(500, new { error = "Failed to retrieve error analytics", details = ex.Message });
            }
        }

        [HttpGet("errors/similar")]
        public async Task<IActionResult> GetSimilarErrors(
            [FromQuery] string serviceName,
            [FromQuery] string errorMessage,
            [FromQuery] int days = 7,
            [FromQuery] int maxResults = 10,
            [FromQuery] bool strictPattern = false,
            [FromQuery] bool includeAllServices = false)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(serviceName))
                {
                    return BadRequest(new { error = "serviceName is required" });
                }

                if (string.IsNullOrWhiteSpace(errorMessage))
                {
                    return BadRequest(new { error = "errorMessage is required" });
                }

                var normalizedDays = Math.Clamp(days, MinSimilarDays, MaxSimilarDays);
                var normalizedMaxResults = Math.Clamp(maxResults, MinSimilarResults, MaxSimilarResults);

                _logger.LogInformation(
                    "Finding similar errors for service: {ServiceName}, Message: {Message}, StrictPattern: {StrictPattern}, IncludeAllServices: {IncludeAllServices}, Days: {Days}, MaxResults: {MaxResults}",
                    serviceName, errorMessage, strictPattern, includeAllServices, normalizedDays, normalizedMaxResults);

                var timeFrom = DateTime.UtcNow.AddDays(-normalizedDays);
                var timeTo = DateTime.UtcNow;

                var response = await _elasticsearchService.GetSimilarErrorsAsync(
                    serviceName, errorMessage, timeFrom, timeTo, normalizedMaxResults, strictPattern, includeAllServices);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error finding similar errors");
                return StatusCode(500, new { error = "Failed to find similar errors", details = ex.Message });
            }
        }

        [HttpGet("errors/topics")]
        public async Task<IActionResult> GetTopicErrors(
            [FromQuery] DateTime? timeFrom = null,
            [FromQuery] DateTime? timeTo = null,
            [FromQuery] string? serviceName = null)
        {
            try
            {
                _logger.LogInformation(
                    "Retrieving topic errors. ServiceName: {ServiceName}, TimeFrom: {TimeFrom}, TimeTo: {TimeTo}",
                    serviceName, timeFrom, timeTo);

                var request = new TopicErrorsRequest
                {
                    TimeFrom = timeFrom,
                    TimeTo = timeTo,
                    ServiceName = serviceName
                };

                var response = await _elasticsearchService.GetTopicErrorsAsync(request);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving topic errors");
                return StatusCode(500, new { error = "Failed to retrieve topic errors", details = ex.Message });
            }
        }

        [HttpPost("errors/topics/events")]
        public async Task<IActionResult> IngestTopicErrorEvents(
            [FromBody] TopicErrorEventsIngestRequest request,
            CancellationToken cancellationToken)
        {
            if (request == null || request.Events == null || request.Events.Count == 0)
            {
                return BadRequest(new { error = "Request must include at least one topic error event in events[]" });
            }

            try
            {
                _logger.LogInformation(
                    "Ingesting topic error events. Count: {Count}",
                    request.Events.Count);

                var response = await _elasticsearchService.IngestTopicErrorEventsAsync(request, cancellationToken);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error ingesting topic error events");
                return StatusCode(500, new { error = "Failed to ingest topic error events", details = ex.Message });
            }
        }

        [HttpPost("/v1/logs")]
        [AllowAnonymous]
        public async Task<IActionResult> IngestTopicErrorLogsFromOtlp(
            CancellationToken cancellationToken)
        {
            _logger.LogInformation(
                "Received OTLP logs request on /v1/logs. ContentType: {ContentType}, ContentLength: {ContentLength}",
                Request.ContentType ?? "(none)",
                Request.ContentLength ?? 0);

            JsonElement otlpPayload;
            try
            {
                var rawBody = await ReadRequestBodyAsync(cancellationToken);
                if (string.IsNullOrWhiteSpace(rawBody))
                {
                    _logger.LogWarning("Rejected OTLP logs request on /v1/logs because request body is empty.");
                    return BadRequest(new { error = "Request body is required" });
                }

                using var jsonDoc = JsonDocument.Parse(rawBody);
                otlpPayload = jsonDoc.RootElement.Clone();
                LogOtlpPayloadIfEnabled(otlpPayload);
            }
            catch (JsonException ex)
            {
                var bodyPreview = await TryReadBodyPreviewAsync(cancellationToken);
                _logger.LogWarning(ex,
                    "Rejected OTLP logs request on /v1/logs because body is not valid JSON. Preview: {Preview}",
                    bodyPreview);
                return BadRequest(new { error = "Invalid JSON payload for /v1/logs" });
            }

            if (!IsCollectorRequestAuthorized())
            {
                _logger.LogWarning(
                    "Rejected OTLP logs request on /v1/logs due to invalid collector ingest key.");
                return Unauthorized(new { error = "Invalid collector ingest key" });
            }

            try
            {
                var response = await _elasticsearchService.IngestOtlpTopicErrorLogsAsync(otlpPayload, cancellationToken);
                _logger.LogInformation(
                    "Processed OTLP logs request on /v1/logs. Received: {Received}, NewInWindow: {NewInWindow}, DuplicateByEventId: {DuplicateByEventId}, DuplicateInWindow: {DuplicateInWindow}, Invalid: {Invalid}, Failed: {Failed}",
                    response.Received,
                    response.NewInWindow,
                    response.DuplicateByEventId,
                    response.DuplicateInWindow,
                    response.Invalid,
                    response.Failed);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error ingesting OTLP topic error logs");
                return StatusCode(500, new { error = "Failed to ingest OTLP topic error logs", details = ex.Message });
            }
        }

        private bool IsCollectorRequestAuthorized()
        {
            var expectedKey = _configuration["Elasticsearch:TopicErrors:Ingest:SharedKey"];
            if (string.IsNullOrWhiteSpace(expectedKey))
            {
                return true;
            }

            var providedKey = Request.Headers["X-Topic-Errors-Key"].FirstOrDefault();
            return !string.IsNullOrWhiteSpace(providedKey) &&
                   string.Equals(providedKey, expectedKey, StringComparison.Ordinal);
        }

        private void LogOtlpPayloadIfEnabled(JsonElement otlpPayload)
        {
            var shouldLogPayload = _configuration.GetValue<bool>("Elasticsearch:TopicErrors:Ingest:LogPayload", false);
            if (!shouldLogPayload)
            {
                return;
            }

            var maxChars = Math.Clamp(
                _configuration.GetValue<int>("Elasticsearch:TopicErrors:Ingest:LogPayloadMaxChars", 4000),
                200,
                200_000);

            var payload = JsonSerializer.Serialize(otlpPayload);
            var isTruncated = payload.Length > maxChars;
            if (isTruncated)
            {
                payload = payload[..maxChars];
            }

            _logger.LogInformation(
                "OTLP /v1/logs payload (maxChars: {MaxChars}, truncated: {IsTruncated}): {Payload}",
                maxChars,
                isTruncated,
                payload);
        }

        private async Task<string> ReadRequestBodyAsync(CancellationToken cancellationToken)
        {
            Request.EnableBuffering();
            if (Request.Body.CanSeek)
            {
                Request.Body.Position = 0;
            }
            using var reader = new StreamReader(
                Request.Body,
                Encoding.UTF8,
                detectEncodingFromByteOrderMarks: true,
                bufferSize: 1024,
                leaveOpen: true);

            var body = await reader.ReadToEndAsync();
            cancellationToken.ThrowIfCancellationRequested();
            if (Request.Body.CanSeek)
            {
                Request.Body.Position = 0;
            }
            return body;
        }

        private async Task<string> TryReadBodyPreviewAsync(CancellationToken cancellationToken)
        {
            var body = await ReadRequestBodyAsync(cancellationToken);
            const int maxPreviewChars = 1200;
            if (body.Length <= maxPreviewChars)
            {
                return body;
            }

            return body[..maxPreviewChars];
        }
    }
}

