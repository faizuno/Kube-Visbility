# Kube Visibility Dashboard

Open-source Kubernetes visibility dashboard for cluster health, logs, Kafka consumers, CronWorkflows, and Prometheus alerts.

## Components

| Path | Description |
|------|-------------|
| `KubeVisibility.Dashboard.Api` | ASP.NET Core API |
| `KubeVisibility.Dashboard.UI` | Angular UI |

## Quick start

### API

```bash
cd KubeVisibility.Dashboard.Api
dotnet restore
dotnet run --launch-profile http
```

Swagger: `http://localhost:5259/swagger`

### UI

```bash
cd KubeVisibility.Dashboard.UI
npm ci
ng serve
```

UI: `http://localhost:4200/dashboard/`

Set `apiBaseUrl` in `src/environments/environment.ts` to match the API (default `http://localhost:5259`).
