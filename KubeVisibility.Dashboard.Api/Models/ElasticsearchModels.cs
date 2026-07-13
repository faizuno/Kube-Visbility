namespace KubeVisibility.Dashboard.Api.Models
{
    public class ElasticsearchLogsRequest
    {
        public string? ServiceName { get; set; }
        public string? PodName { get; set; }
        public string? LogKey { get; set; }
        public string? Message { get; set; }
        public List<string>? LogLevels { get; set; }
        public DateTime? TimeFrom { get; set; }
        public DateTime? TimeTo { get; set; }
        public int Size { get; set; } = 1000;
        public int From { get; set; } = 0;
    }

    public class ElasticsearchLogEntry
    {
        public string Timestamp { get; set; } = string.Empty;
        public string? ServiceName { get; set; }
        public string? PodName { get; set; }
        public string? Message { get; set; }
        public string? LogLevel { get; set; }
        public string? LogKey { get; set; }
        public string? Exception { get; set; }
        public Dictionary<string, object>? AdditionalFields { get; set; }
    }

    public class ElasticsearchLogsResponse
    {
        public List<ElasticsearchLogEntry> Logs { get; set; } = new();
        public long Total { get; set; }
    }

    public class ErrorAnalyticsResponse
    {
        public List<ErrorGroup> ErrorGroups { get; set; } = new();
        public long TotalErrors { get; set; } // Sum of all error group counts
        public long TotalErrorDocuments { get; set; } // Total number of error log documents/records
        public DateTime TimeFrom { get; set; }
        public DateTime TimeTo { get; set; }
    }

    public class ErrorGroup
    {
        public string ErrorMessage { get; set; } = string.Empty;
        public string NormalizedMessage { get; set; } = string.Empty;
        public long Count { get; set; }
        public double SimilarityScore { get; set; }
        public string? ServiceName { get; set; }
        public string? LogKey { get; set; }
        public DateTime FirstOccurrence { get; set; }
        public DateTime LastOccurrence { get; set; }
        public List<ElasticsearchLogEntry> SampleLogs { get; set; } = new();
    }

    public class SimilarErrorsResponse
    {
        public string OriginalMessage { get; set; } = string.Empty;
        public string ServiceName { get; set; } = string.Empty;
        public bool IncludeAllServices { get; set; }
        public int Days { get; set; }
        public bool StrictPattern { get; set; }
        public string QueryMode { get; set; } = "fuzzy";
        public int RequestedGroups { get; set; }
        public int CandidateCount { get; set; }
        public int GroupCount { get; set; }
        public long ElapsedMs { get; set; }
        public List<ErrorGroup> SimilarErrors { get; set; } = new();
    }

    public class TopicErrorsRequest
    {
        public DateTime? TimeFrom { get; set; }
        public DateTime? TimeTo { get; set; }
        public string? ServiceName { get; set; }
    }

    public class TopicErrorEntry
    {
        public string ApplicationName { get; set; } = string.Empty;
        public string? ServiceName { get; set; }
        public string? Message { get; set; }
        public string? Exception { get; set; }
        public string TopicName { get; set; } = string.Empty;
        public long? Offset { get; set; }
        public int? Partition { get; set; }
        public string Timestamp { get; set; } = string.Empty;
    }

    public class TopicErrorsResponse
    {
        public List<TopicErrorEntry> Errors { get; set; } = new();
        public long Total { get; set; }
    }

    public class TopicErrorEventIngestRequest
    {
        public string? EventId { get; set; }
        public string? TopicName { get; set; }
        public string? Message { get; set; }
        public string? Exception { get; set; }
        public string? Timestamp { get; set; }
        public string? ServiceName { get; set; }
        public string? ApplicationName { get; set; }
        public string? Namespace { get; set; }
        public int? Partition { get; set; }
        public long? Offset { get; set; }
        public string? PodName { get; set; }
        public string? LogLevel { get; set; }
    }

    public class TopicErrorEventsIngestRequest
    {
        public List<TopicErrorEventIngestRequest> Events { get; set; } = new();
    }

    public class TopicErrorEventsIngestResponse
    {
        public int Received { get; set; }
        public int NewInWindow { get; set; }
        public int DuplicateByEventId { get; set; }
        public int DuplicateInWindow { get; set; }
        public int Invalid { get; set; }
        public int Failed { get; set; }
        public List<TopicErrorEventIngestResult> Results { get; set; } = new();
    }

    public class TopicErrorEventIngestResult
    {
        public string? EventId { get; set; }
        public string? TopicName { get; set; }
        public string Status { get; set; } = "Invalid";
        public string? Reason { get; set; }
        public string? Fingerprint { get; set; }
        public DateTime? WindowStartUtc { get; set; }
        public string? DedupeKey { get; set; }
    }
}

