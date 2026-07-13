using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using KubeVisibility.Dashboard.Api.Services.Kafka;
using KubeVisibility.Dashboard.Api.Models.Kafka;

namespace KubeVisibility.Dashboard.Api.Controllers.Kafka
{
    [Route("api/kafka/consumer-groups")]
    [ApiController]
    [Authorize]
    public class KafkaConsumerGroupsController : ControllerBase
    {
        private readonly IKafkaService _kafkaService;
        private readonly ILogger<KafkaConsumerGroupsController> _logger;

        public KafkaConsumerGroupsController(IKafkaService kafkaService, ILogger<KafkaConsumerGroupsController> logger)
        {
            _kafkaService = kafkaService;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> GetConsumerGroups([FromQuery] string? topic = null)
        {
            try
            {
                _logger.LogInformation($"Retrieving consumer groups{(topic != null ? $" for topic: {topic}" : "")}");
                var response = await _kafkaService.GetConsumerGroupsAsync(topic);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving consumer groups");
                return StatusCode(500, new { error = "Failed to retrieve consumer groups", details = ex.Message });
            }
        }

        [HttpGet("associations")]
        public async Task<IActionResult> GetConsumerGroupTopicAssociations([FromQuery] string? topic = null)
        {
            try
            {
                _logger.LogInformation($"Retrieving consumer group topic associations{(topic != null ? $" for topic: {topic}" : "")}");
                var response = await _kafkaService.GetConsumerGroupTopicAssociationsAsync(topic);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving consumer group topic associations");
                return StatusCode(500, new { error = "Failed to retrieve consumer group topic associations", details = ex.Message });
            }
        }

        [HttpGet("consumer-group")]
        public async Task<IActionResult> GetConsumerGroups()
        {
            try
            {
                _logger.LogInformation("Retrieving consumer groups");
                var response = await _kafkaService.GetConsumerGroupSummariesAsync();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving consumer groups");
                return StatusCode(500, new { error = "Failed to retrieve consumer groups", details = ex.Message });
            }
        }

        [HttpGet("details")]
        public async Task<IActionResult> GetConsumerGroupDetails([FromQuery] string topic)
        {
            try
            {
                if (string.IsNullOrEmpty(topic))
                {
                    return BadRequest(new { error = "Topic parameter is required" });
                }

                _logger.LogInformation($"Retrieving consumer group details for topic: {topic}");
                var response = await _kafkaService.GetConsumerGroupDetailsAsync(topic);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving consumer group details for topic {topic}");
                return StatusCode(500, new { error = "Failed to retrieve consumer group details", details = ex.Message });
            }
        }

        [HttpGet("all-details")]
        public async Task<IActionResult> GetAllConsumerGroupDetails()
        {
            try
            {
                _logger.LogInformation("Retrieving all consumer group details");
                var response = await _kafkaService.GetAllConsumerGroupDetailsAsync();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving all consumer group details");
                return StatusCode(500, new { error = "Failed to retrieve all consumer group details", details = ex.Message });
            }
        }

        [HttpGet("{groupId}/topics/{topicName}")]
        public async Task<IActionResult> GetConsumerGroupInfo(string groupId, string topicName)
        {
            try
            {
                _logger.LogInformation($"Retrieving consumer group information for {groupId} on topic {topicName}");
                var response = await _kafkaService.GetConsumerGroupInfoAsync(groupId, topicName);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving consumer group information for {groupId} on topic {topicName}");
                return StatusCode(500, new { error = $"Failed to retrieve consumer group information", details = ex.Message });
            }
        }

        [HttpGet("{groupId}")]
        public async Task<IActionResult> GetConsumerGroupDetailsById(string groupId)
        {
            try
            {
                if (string.IsNullOrEmpty(groupId))
                {
                    return BadRequest(new { error = "Group ID parameter is required" });
                }

                _logger.LogInformation($"Retrieving consumer group details for group ID: {groupId}");
                var response = await _kafkaService.GetConsumerGroupDetailsByIdAsync(groupId);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error retrieving consumer group details for group ID {groupId}");
                return StatusCode(500, new { error = "Failed to retrieve consumer group details", details = ex.Message });
            }
        }
    }
}


