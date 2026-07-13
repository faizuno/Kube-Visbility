using System.Text.Json.Serialization;

namespace KubeVisibility.Dashboard.Api.Models;

public class AdminAuditEvent
{
    public string EventId { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AdminAuditEventType EventType { get; set; } = AdminAuditEventType.Updated;
    public string ServiceName { get; set; } = string.Empty;
    public string ActionPerformedOn { get; set; } = string.Empty;
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AdminAuditEventStatus EventStatus { get; set; } = AdminAuditEventStatus.Success;
    public string Action { get; set; } = string.Empty;
    public string? ResourceType { get; set; }
    public string? ResourceName { get; set; }
    public string? Namespace { get; set; }
    public string EventDescription { get; set; } = string.Empty;
    public string Actor { get; set; } = "unknown";
    public string? ActorEmail { get; set; }
    public IReadOnlyList<string> ActorGroups { get; set; } = Array.Empty<string>();
    public string HttpMethod { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public string? EndpointDisplayName { get; set; }
    public int StatusCode { get; set; }
    public bool Success { get; set; }
    public string? CorrelationId { get; set; }
    public string? RequestBody { get; set; }
    public string? Error { get; set; }
}
