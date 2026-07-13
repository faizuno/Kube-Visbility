# Build stage
FROM node:24-alpine AS build

# Add labels for metadata
LABEL maintainer="Kube Visibility"
LABEL description="Kube Visibility Dashboard UI - Build Stage"
LABEL version="1.0"

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY ["dashboard/KubeVisibility.Dashboard.UI/package*.json", "./"]

# Install all dependencies (including devDependencies needed for build) and clean cache in one layer
RUN npm ci --no-audit --no-fund && \
    npm cache clean --force

# Copy source code
COPY dashboard/KubeVisibility.Dashboard.UI/ .

# Build application for production with base-href
RUN npm run build -- --configuration production --base-href=/dashboard/

# Serve stage
FROM nginx:mainline-alpine3.22-slim

# Add labels for metadata
LABEL maintainer="Kube Visibility"
LABEL description="Kube Visibility Dashboard UI - Production"
LABEL version="1.0"

# Copy built files from build stage
COPY --from=build /app/dist/KubeVisibility.Dashboard.UI/browser /usr/share/nginx/html

# Copy nginx configuration
COPY dashboard/KubeVisibility.Dashboard.UI/nginx.conf /etc/nginx/nginx.conf

# Expose port
EXPOSE 80

# Use exec form for CMD
CMD ["nginx", "-g", "daemon off;"]

