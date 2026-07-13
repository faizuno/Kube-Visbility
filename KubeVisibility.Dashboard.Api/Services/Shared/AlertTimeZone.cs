namespace KubeVisibility.Dashboard.Api.Services.Shared;

public static class AlertTimeZone
{
    private static readonly TimeZoneInfo EasternTimeZone = ResolveEasternTimeZone();

    public static DateTime EasternNow() => ConvertFromUtc(DateTime.UtcNow);

    public static DateTimeOffset EasternNowOffset() => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, EasternTimeZone);

    public static DateTime ConvertFromUtc(DateTime utcDateTime)
    {
        if (utcDateTime == DateTime.MinValue || utcDateTime == DateTime.MaxValue)
        {
            return utcDateTime;
        }

        var normalizedUtc = utcDateTime.Kind switch
        {
            DateTimeKind.Utc => utcDateTime,
            DateTimeKind.Local => utcDateTime.ToUniversalTime(),
            _ => DateTime.SpecifyKind(utcDateTime, DateTimeKind.Utc)
        };

        return TimeZoneInfo.ConvertTimeFromUtc(normalizedUtc, EasternTimeZone);
    }

    private static TimeZoneInfo ResolveEasternTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        }
    }
}
