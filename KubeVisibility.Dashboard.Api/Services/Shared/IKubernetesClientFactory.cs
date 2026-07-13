using k8s;

namespace KubeVisibility.Dashboard.Api.Services.Shared
{
    public interface IKubernetesClientFactory
    {
        IKubernetes CreateClient();
    }
}

