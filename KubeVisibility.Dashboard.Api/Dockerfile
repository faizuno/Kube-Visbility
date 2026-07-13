# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build

# Add labels for metadata
LABEL maintainer="Kube Visibility"
LABEL description="Kube Visibility Dashboard API - Build Stage"
LABEL version="1.0"

# Set working directory
WORKDIR /src

# NuGet source arguments
ARG NUGET_USER
ARG NUGET_PASSWORD
ARG PACKAGE_REPO

# Copy project file first for better layer caching
COPY ["dashboard/KubeVisibility.Dashboard.Api/KubeVisibility.Dashboard.Api.csproj", "dashboard/KubeVisibility.Dashboard.Api/"]

# Add NuGet source and restore dependencies (this layer will be cached if .csproj doesn't change)
RUN dotnet nuget add source --username $NUGET_USER --password $NUGET_PASSWORD --store-password-in-clear-text --name github $PACKAGE_REPO
RUN dotnet restore "dashboard/KubeVisibility.Dashboard.Api/KubeVisibility.Dashboard.Api.csproj"

# Copy remaining source code
COPY dashboard/KubeVisibility.Dashboard.Api/ dashboard/KubeVisibility.Dashboard.Api/

# Build and publish application in one layer
WORKDIR /src/dashboard/KubeVisibility.Dashboard.Api
RUN dotnet build "KubeVisibility.Dashboard.Api.csproj" -c Release -o /app/build && \
    dotnet publish "KubeVisibility.Dashboard.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Run stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0

# Add labels for metadata
LABEL maintainer="Kube Visibility"
LABEL description="Kube Visibility Dashboard API - Production"
LABEL version="1.0"

# Install curl for health checks (before creating user)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Set working directory
WORKDIR /app

# Copy published files from build stage
COPY --from=build /app/publish .


# Set proper ownership and permissions
RUN chown -R appuser:appuser /app && \
    chmod -R 755 /app

# Switch to non-root user
USER appuser

# Expose non-privileged port
EXPOSE 8080

# Environment variables
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false

# Use exec form for ENTRYPOINT
ENTRYPOINT ["dotnet", "KubeVisibility.Dashboard.Api.dll"]

