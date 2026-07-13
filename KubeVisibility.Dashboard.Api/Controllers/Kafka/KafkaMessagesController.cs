using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services.Kafka;
using KubeVisibility.Dashboard.Api.Models.Kafka;
using System.Text.Json;

namespace KubeVisibility.Dashboard.Api.Controllers.Kafka
{
    [Route("api/kafka/messages")]
    [ApiController]
    [Authorize]
    public class KafkaMessagesController : ControllerBase
    {
        private readonly IKafkaService _kafkaService;
        private readonly ILogger<KafkaMessagesController> _logger;

        public KafkaMessagesController(IKafkaService kafkaService, ILogger<KafkaMessagesController> logger)
        {
            _kafkaService = kafkaService;
            _logger = logger;
        }

        [HttpPost("search")]
        public async Task<IActionResult> SearchMessages([FromBody] MessageSearchRequest request)
        {
            try
            {
                if (string.IsNullOrEmpty(request.Topic))
                {
                    return BadRequest(new { error = "Topic is required" });
                }

                _logger.LogInformation($"Searching messages in topic: {request.Topic}");
                var response = await _kafkaService.SearchMessagesAsync(request);
                return Ok(response);
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning(ex, "Invalid search request");
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error searching messages in topic {request.Topic}");
                return StatusCode(500, new { error = "Failed to search messages", details = ex.Message });
            }
        }

        [HttpPost("count")]
        [ProducesResponseType(typeof(int), StatusCodes.Status200OK)]
        public async Task<ActionResult<int>> GetMessageCount([FromBody] MessageSearchRequest request)
        {
            try
            {
                if (string.IsNullOrEmpty(request.Topic))
                {
                    return BadRequest(new { error = "Topic is required" });
                }

                _logger.LogInformation($"Counting messages in topic: {request.Topic}");
                var count = await _kafkaService.GetMessageCountAsync(request);
                return Ok(count);
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning(ex, "Invalid count request");
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error counting messages in topic {request.Topic}");
                return StatusCode(500, new { error = "An error occurred while counting messages" });
            }
        }

        [HttpGet("by-offset")]
        [ProducesResponseType(typeof(KafkaMessage), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<KafkaMessage>> GetMessageByOffset(
            [FromQuery] string topic,
            [FromQuery] int partition,
            [FromQuery] long offset)
        {
            try
            {
                if (string.IsNullOrEmpty(topic))
                {
                    return BadRequest(new { error = "Topic is required" });
                }

                if (partition < 0)
                {
                    return BadRequest(new { error = "Partition must be non-negative" });
                }

                if (offset < 0)
                {
                    return BadRequest(new { error = "Offset must be non-negative" });
                }

                _logger.LogInformation($"Retrieving message from topic: {topic}, partition: {partition}, offset: {offset}");
                var message = await _kafkaService.GetMessageByOffsetAsync(topic, partition, offset);

                if (message == null)
                {
                    return NotFound(new
                    {
                        error = "Message not found at the specified offset",
                        topic = topic,
                        partition = partition,
                        offset = offset
                    });
                }

                return Ok(message);
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning(ex, "Invalid request parameters");
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving message from topic {topic}, partition {partition}, offset {offset}");
                return StatusCode(500, new { error = "Failed to retrieve message", details = ex.Message });
            }
        }

        [HttpGet("search-stream")]
        public async Task SearchMessagesStream(
            [FromQuery] string topic,
            [FromQuery] string? key = null,
            [FromQuery] string? value = null,
            [FromQuery] int? partition = null,
            [FromQuery] int pageSize = 100,
            [FromQuery] DateTime? startTime = null,
            [FromQuery] DateTime? endTime = null,
            CancellationToken cancellationToken = default)
        {
            Response.Headers["Content-Type"] = "text/event-stream";
            Response.Headers["Cache-Control"] = "no-cache";
            Response.Headers["Connection"] = "keep-alive";
            Response.Headers["X-Accel-Buffering"] = "no"; // Disable nginx buffering
            
            // Flush headers immediately to establish SSE connection
            await Response.Body.FlushAsync();

            try
            {
                if (string.IsNullOrEmpty(topic))
                {
                    var errorProgress = new SearchProgress
                    {
                        Status = "error",
                        Error = "Topic is required"
                    };
                    await WriteSSEAsync(errorProgress);
                    return;
                }

                _logger.LogInformation($"Starting streaming search for topic: {topic}, key: {key}");

                // Send initial message to establish SSE connection
                await WriteSSEAsync(new SearchProgress
                {
                    Status = "searching",
                    PartitionsScanned = 0,
                    TotalPartitions = 0,
                    TotalMessagesFound = 0,
                    TotalBytes = 0
                });

                var request = new MessageSearchRequest
                {
                    Topic = topic,
                    Key = key,
                    Value = value,
                    Partition = partition,
                    PageSize = pageSize,
                    TimeRange = (startTime.HasValue && endTime.HasValue)
                        ? new TimeRange
                        {
                            StartTime = startTime.Value,
                            EndTime = endTime.Value
                        }
                        : null
                };

                // Create SSE progress reporter
                var progressReporter = new SseProgressReporter(Response, _logger);

                await _kafkaService.SearchMessagesStreamAsync(request, progressReporter, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation($"Stream search cancelled for topic: {topic}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error in streaming search for topic {topic}");
                try
                {
                    var errorProgress = new SearchProgress
                    {
                        Status = "error",
                        Error = ex.Message
                    };
                    await WriteSSEAsync(errorProgress);
                }
                catch
                {
                    // Client may have disconnected
                }
            }
        }

        private async Task WriteSSEAsync(SearchProgress progress)
        {
            var json = JsonSerializer.Serialize(progress, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });
            await Response.WriteAsync($"data: {json}\n\n");
            await Response.Body.FlushAsync();
        }

        // Inner class following Single Responsibility Principle - handles SSE writing with buffering
        private class SseProgressReporter : IProgressReporter
        {
            private readonly HttpResponse _response;
            private readonly ILogger _logger;
            private readonly SemaphoreSlim _writeLock = new SemaphoreSlim(1, 1);
            private SearchProgress? _lastProgress;
            private readonly List<KafkaMessage> _bufferedMessages = new List<KafkaMessage>();
            private DateTime _lastSentTime = DateTime.MinValue;
            private readonly TimeSpan _minUpdateInterval = TimeSpan.FromMilliseconds(300); // Minimum 300ms between sends

            public SseProgressReporter(HttpResponse response, ILogger logger)
            {
                _response = response;
                _logger = logger;
            }

            public async Task ReportProgressAsync(SearchProgress progress)
            {
                await _writeLock.WaitAsync();
                try
                {
                    // Always update the latest progress
                    _lastProgress = progress;
                    
                    // Accumulate messages if they exist
                    if (progress.Messages != null && progress.Messages.Count > 0)
                    {
                        _bufferedMessages.AddRange(progress.Messages);
                    }
                    
                    // Check if enough time has passed since last send OR if this is a completion/error OR if we have messages
                    var now = DateTime.UtcNow;
                    var timeSinceLastSend = now - _lastSentTime;
                    var hasBufferedMessages = _bufferedMessages.Count > 0;
                    var shouldSend = timeSinceLastSend >= _minUpdateInterval ||
                                   progress.Status == "complete" ||
                                   progress.Status == "error" ||
                                   _lastSentTime == DateTime.MinValue; // Always send first message

                    if (shouldSend)
                    {
                        // Include buffered messages in the progress
                        var progressToSend = _lastProgress!;
                        if (hasBufferedMessages)
                        {
                            progressToSend = new SearchProgress
                            {
                                Status = _lastProgress.Status,
                                Messages = new List<KafkaMessage>(_bufferedMessages),
                                PartitionId = _lastProgress.PartitionId,
                                PartitionsScanned = _lastProgress.PartitionsScanned,
                                TotalPartitions = _lastProgress.TotalPartitions,
                                TotalMessagesFound = _lastProgress.TotalMessagesFound,
                                TotalBytes = _lastProgress.TotalBytes,
                                Error = _lastProgress.Error
                            };
                            _bufferedMessages.Clear();
                        }
                        
                        var json = JsonSerializer.Serialize(progressToSend, new JsonSerializerOptions
                        {
                            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                        });
                        await _response.WriteAsync($"data: {json}\n\n");
                        await _response.Body.FlushAsync();
                        _lastSentTime = now;
                    }
                    // If not enough time has passed, messages are buffered and will be sent on the next interval
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to write SSE progress");
                }
                finally
                {
                    _writeLock.Release();
                }
            }
        }

        [HttpPost("requeue")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> RequeueMessages([FromBody] RequeueRequest request)
        {
            try
            {
                if (string.IsNullOrEmpty(request.SourceTopic) || string.IsNullOrEmpty(request.TargetTopic))
                {
                    return BadRequest(new { error = "Source topic and target topic are required" });
                }

                if (request.Messages == null || request.Messages.Count == 0)
                {
                    return BadRequest(new { error = "At least one message reference is required" });
                }

                _logger.LogInformation($"Requeuing {request.Messages.Count} messages from {request.SourceTopic} to {request.TargetTopic}");
                var response = await _kafkaService.RequeueMessagesAsync(request);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error requeuing messages");
                return StatusCode(500, new { error = "Failed to requeue messages", details = ex.Message });
            }
        }

        [HttpGet("config")]
        [ProducesResponseType(typeof(KafkaConfig), StatusCodes.Status200OK)]
        public IActionResult GetKafkaConfig()
        {
            try
            {
                var config = _kafkaService.GetKafkaConfig();
                return Ok(config);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving Kafka configuration");
                return StatusCode(500, new { error = "Failed to retrieve Kafka configuration", details = ex.Message });
            }
        }
    }
}

