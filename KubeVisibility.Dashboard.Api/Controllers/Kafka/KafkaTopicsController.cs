using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services.Kafka;
using KubeVisibility.Dashboard.Api.Models.Kafka;

namespace KubeVisibility.Dashboard.Api.Controllers.Kafka
{
    [Route("api/kafka/topics")]
    [ApiController]
    [Authorize]
    public class KafkaTopicsController : ControllerBase
    {
        private readonly IKafkaService _kafkaService;
        private readonly ILogger<KafkaTopicsController> _logger;

        public KafkaTopicsController(IKafkaService kafkaService, ILogger<KafkaTopicsController> logger)
        {
            _kafkaService = kafkaService;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> GetTopics()
        {
            try
            {
                _logger.LogInformation("Retrieving Kafka topics");
                var topics = await _kafkaService.GetTopicsAsync();
                return Ok(new TopicsResponse { Topics = topics });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving Kafka topics");
                return StatusCode(500, new { error = "Failed to retrieve Kafka topics", details = ex.Message });
            }
        }

        [HttpGet("{topicName}")]
        public async Task<IActionResult> GetTopicInfo(string topicName)
        {
            try
            {
                _logger.LogInformation($"Retrieving topic information for: {topicName}");
                var topicInfo = await _kafkaService.GetTopicInfoAsync(topicName);
                
                if (topicInfo == null)
                {
                    return NotFound(new { error = $"Topic not found: {topicName}" });
                }

                return Ok(topicInfo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving topic information for {topicName}");
                return StatusCode(500, new { error = $"Failed to retrieve topic information for {topicName}", details = ex.Message });
            }
        }

        [HttpGet("{topicName}/partitions")]
        public async Task<IActionResult> GetTopicPartitions(string topicName)
        {
            try
            {
                _logger.LogInformation($"Retrieving partition details for topic: {topicName}");
                var partitionsResponse = await _kafkaService.GetTopicPartitionsAsync(topicName);
                return Ok(partitionsResponse);
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning(ex, $"Topic not found: {topicName}");
                return NotFound(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving partition details for topic {topicName}");
                return StatusCode(500, new { error = $"Failed to retrieve partition details for {topicName}", details = ex.Message });
            }
        }
    }
}

