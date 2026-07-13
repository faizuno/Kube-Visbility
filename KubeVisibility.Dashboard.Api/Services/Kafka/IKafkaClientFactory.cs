using Confluent.Kafka;

namespace KubeVisibility.Dashboard.Api.Services.Kafka
{
    public interface IKafkaClientFactory
    {
        IAdminClient CreateAdminClient();
        IConsumer<string, string> CreateConsumer(string? groupId = null, bool optimizeForBulkRead = false);
        IProducer<string, string> CreateProducer();
    }
}

