# Kube Visibility Dashboard

Open-source Kubernetes visibility dashboard for cluster health, logs, Kafka consumers, CronWorkflows, and Prometheus alerts.

This project is **not affiliated with BioReference Laboratories, BLIS, or any related trademarks**.

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

## Configuration

Namespace roles and admin groups are config-driven (no hard-coded product topology):

```json
"KubernetesInfo": {
  "Namespaces": ["app", "app-services", "app-consumers", "app-jobs"],
  "ConsumersNamespace": "app-consumers",
  "JobsNamespace": "app-jobs",
  "ApplicationNamespaces": ["app", "app-services"],
  "ManagedLabelPrefix": "kube-visibility.io"
},
"Authorization": {
  "AdminGroups": ["Dashboard-Admin", "Dashboard-Leads"]
}
```

- Copy `KubeVisibility.Dashboard.Api/appsettings.Production.example.json` for deploy overlays.
- Keep real secrets and internal URLs in gitignored local files or your secret store.
- `/api/user/info` returns `consumersNamespace`, `jobsNamespace`, `applicationNamespaces`, and `adminGroups` for the UI.
