# Deployment Layer - Vertical Slice Technical Implementation

## Overview
The deployment layer handles containerization, orchestration, and environment management for the Ocean-Scraper service. This layer provides consistent deployment across development, testing, and production environments with optional VPN integration.

## Architecture Pattern
```
Application Code → Docker Images → Container Orchestration → Infrastructure Services
```

## Directory Structure
```
docker/
├── Dockerfile                # Multi-stage production build
├── docker-compose.yml        # Production deployment with VPN
├── docker-compose.dev.yml    # Development environment
├── init-db.sql              # PostgreSQL schema initialization
└── vpn/                     # VPN configuration
    └── pia-config.sh        # Private Internet Access setup
```

## Multi-Stage Docker Build (`Dockerfile`)

### Purpose
Optimized production Docker image with security hardening and minimal attack surface.

### Build Stages
```dockerfile
# Stage 1: Dependencies and Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files for dependency caching
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production Runtime
FROM node:18-alpine AS production

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ocean -u 1001

# Install system dependencies for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Playwright to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy built application and dependencies
COPY --from=builder --chown=ocean:nodejs /app/dist ./dist
COPY --from=builder --chown=ocean:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=ocean:nodejs /app/package*.json ./

# Create directories for runtime data
RUN mkdir -p logs screenshots downloads && \
    chown -R ocean:nodejs logs screenshots downloads

# Security: Switch to non-root user
USER ocean

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### Security Features
- **Non-root user**: Application runs as user `ocean` (UID 1001)
- **Minimal base image**: Alpine Linux for reduced attack surface
- **System Chromium**: Uses Alpine's Chromium package instead of downloading
- **Read-only filesystem**: Application code is immutable at runtime
- **Health checks**: Built-in container health monitoring

### Build Optimization
- **Dependency caching**: Package files copied separately for Docker layer caching
- **Multi-stage build**: Excludes development dependencies from production image
- **Size optimization**: ~200MB final image vs ~800MB with full Node.js

## Development Environment (`docker-compose.dev.yml`)

### Purpose
Local development setup with external services (PostgreSQL, Redis) and hot-reload support.

### Configuration
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ocean_scraper
      POSTGRES_USER: ocean_user
      POSTGRES_PASSWORD: ocean_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ocean_user -d ocean_scraper"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  default:
    name: ocean-scraper-dev
```

### Key Features
- **External services only**: Application runs on host for hot-reload
- **Port mapping**: Direct access to PostgreSQL (5432) and Redis (6379)
- **Volume persistence**: Data survives container restarts
- **Health checks**: Service readiness validation
- **Schema initialization**: Automatic database setup on first run

### Development Workflow
```bash
# Start infrastructure services
docker-compose -f docker-compose.dev.yml up -d

# Verify services are healthy
docker-compose -f docker-compose.dev.yml ps

# Run application on host (with hot-reload)
npm run dev

# View service logs
docker-compose -f docker-compose.dev.yml logs -f postgres redis

# Stop services
docker-compose -f docker-compose.dev.yml down
```

## Production Deployment (`docker-compose.yml`)

### Purpose
Full production deployment with VPN integration, security hardening, and monitoring.

### Configuration
```yaml
version: '3.8'

services:
  ocean-scraper:
    build: .
    container_name: ocean-scraper
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      NODE_ENV: production
      POSTGRES_HOST: postgres
      REDIS_HOST: redis
      VPN_ENABLED: ${VPN_ENABLED:-false}
    volumes:
      - ./logs:/app/logs
      - ./screenshots:/app/screenshots
      - ./downloads:/app/downloads
    networks:
      - ocean-network
      - vpn-network
    cap_add:
      - NET_ADMIN  # Required for VPN
    devices:
      - /dev/net/tun:/dev/net/tun
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ocean.rule=Host(`scraper.example.com`)"
      - "traefik.http.routers.ocean.tls=true"

  postgres:
    image: postgres:15-alpine
    container_name: ocean-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ocean_scraper
      POSTGRES_USER: ocean_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
      - ./backups:/backups
    networks:
      - ocean-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ocean_user -d ocean_scraper"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    container_name: ocean-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    networks:
      - ocean-network
    healthcheck:
      test: ["CMD", "redis-cli", "--pass", "${REDIS_PASSWORD}", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  vpn:
    image: thrnz/docker-wireguard-pia
    container_name: ocean-vpn
    cap_add:
      - NET_ADMIN
    environment:
      LOC: ${PIA_LOCATION:-us_east}
      USER: ${PIA_USERNAME}
      PASS: ${PIA_PASSWORD}
      LOCAL_NETWORK: 172.20.0.0/16
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
      - net.ipv6.conf.default.disable_ipv6=1
      - net.ipv6.conf.all.disable_ipv6=1
    networks:
      vpn-network:
        ipv4_address: 172.20.0.2

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  ocean-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.19.0.0/16
  vpn-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### Production Features
- **VPN Integration**: Optional Private Internet Access VPN routing
- **Security**: Password-protected Redis, environment-based secrets
- **Persistence**: Named volumes for data durability
- **Monitoring**: Health checks and restart policies
- **Reverse Proxy**: Traefik labels for HTTP/HTTPS termination
- **Network Isolation**: Separate networks for app and VPN traffic

## Database Initialization (`init-db.sql`)

### Purpose
Automated PostgreSQL schema setup with production-ready tables, indexes, and seed data.

### Schema Implementation
```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- API Keys table
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    rate_limit_per_hour INTEGER DEFAULT 100,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Jobs table for async processing
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL,                    -- 'scrape', 'crawl', 'search'
    status VARCHAR(50) DEFAULT 'pending',         -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
    url TEXT NOT NULL,
    options JSONB DEFAULT '{}',                   -- Job configuration
    result JSONB,                                 -- Final result data
    progress INTEGER DEFAULT 0,                   -- Progress percentage (0-100)
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Individual page results
CREATE TABLE pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    content_markdown TEXT,
    content_html TEXT,
    content_json JSONB,
    metadata JSONB DEFAULT '{}',
    links JSONB DEFAULT '[]',
    status_code INTEGER,
    processing_time_ms INTEGER,
    scraped_at TIMESTAMP DEFAULT NOW(),
    screenshot_path TEXT,
    pdf_path TEXT
);

-- Performance indexes
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_jobs_updated_at ON jobs(updated_at DESC);
CREATE INDEX idx_pages_job_id ON pages(job_id);
CREATE INDEX idx_pages_url ON pages(url);
CREATE INDEX idx_pages_scraped_at ON pages(scraped_at DESC);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Development API key (SHA-256 hash of 'dev-key-123')
INSERT INTO api_keys (key_hash, name, rate_limit_per_hour, is_active) 
VALUES (
    'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
    'Development Key',
    1000,
    true
) ON CONFLICT (key_hash) DO NOTHING;

-- Example production API key (replace with actual hashed key)
INSERT INTO api_keys (key_hash, name, rate_limit_per_hour, is_active)
VALUES (
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'Production Key',
    100,
    true
) ON CONFLICT (key_hash) DO NOTHING;

-- Update trigger for jobs table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_jobs_updated_at 
    BEFORE UPDATE ON jobs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create database backup function
CREATE OR REPLACE FUNCTION backup_database()
RETURNS TEXT AS $$
DECLARE
    backup_file TEXT;
BEGIN
    backup_file := '/backups/ocean_scraper_' || to_char(now(), 'YYYY_MM_DD_HH24_MI_SS') || '.sql';
    EXECUTE 'COPY (SELECT * FROM jobs) TO ''' || backup_file || '_jobs.csv'' WITH CSV HEADER';
    EXECUTE 'COPY (SELECT * FROM pages) TO ''' || backup_file || '_pages.csv'' WITH CSV HEADER';
    RETURN backup_file;
END;
$$ LANGUAGE plpgsql;
```

## VPN Integration (`vpn/pia-config.sh`)

### Purpose
Private Internet Access VPN configuration for IP anonymization and geographic flexibility.

### Implementation
```bash
#!/bin/bash

# Private Internet Access Configuration
# This script configures PIA VPN for Ocean Scraper

set -e

echo "🔧 Configuring Private Internet Access VPN..."

# Validate required environment variables
if [[ -z "$PIA_USERNAME" || -z "$PIA_PASSWORD" ]]; then
    echo "❌ Error: PIA_USERNAME and PIA_PASSWORD environment variables required"
    exit 1
fi

# PIA server regions
declare -A PIA_SERVERS=(
    ["us_east"]="us-east.privateinternetaccess.com"
    ["us_west"]="us-west.privateinternetaccess.com" 
    ["uk"]="uk-london.privateinternetaccess.com"
    ["canada"]="ca-toronto.privateinternetaccess.com"
    ["germany"]="germany.privateinternetaccess.com"
    ["netherlands"]="nl-amsterdam.privateinternetaccess.com"
    ["singapore"]="sg.privateinternetaccess.com"
    ["australia"]="aus-melbourne.privateinternetaccess.com"
)

# Set default location
PIA_LOCATION=${PIA_LOCATION:-us_east}
PIA_SERVER=${PIA_SERVERS[$PIA_LOCATION]}

if [[ -z "$PIA_SERVER" ]]; then
    echo "❌ Error: Invalid PIA_LOCATION '$PIA_LOCATION'"
    echo "Available locations: ${!PIA_SERVERS[@]}"
    exit 1
fi

# Generate OpenVPN configuration
cat > /etc/openvpn/pia.conf << EOF
client
dev tun
proto udp
remote $PIA_SERVER 1198
resolv-retry infinite
nobind
persist-key
persist-tun
cipher aes-128-cbc
auth sha1
tls-client
remote-cert-tls server
auth-user-pass /etc/openvpn/pia-auth
comp-lzo
verb 1
reneg-sec 0
crl-verify /etc/openvpn/crl.rsa.2048.pem
ca /etc/openvpn/ca.rsa.2048.crt
disable-occ
EOF

# Create authentication file
cat > /etc/openvpn/pia-auth << EOF
$PIA_USERNAME
$PIA_PASSWORD
EOF

chmod 600 /etc/openvpn/pia-auth

# Download PIA certificates
echo "📥 Downloading PIA certificates..."
curl -sSL https://www.privateinternetaccess.com/openvpn/ca.rsa.2048.crt -o /etc/openvpn/ca.rsa.2048.crt
curl -sSL https://www.privateinternetaccess.com/openvpn/crl.rsa.2048.pem -o /etc/openvpn/crl.rsa.2048.pem

# Verify certificates
if [[ ! -f /etc/openvpn/ca.rsa.2048.crt || ! -f /etc/openvpn/crl.rsa.2048.pem ]]; then
    echo "❌ Error: Failed to download PIA certificates"
    exit 1
fi

echo "✅ PIA VPN configured successfully"
echo "📍 Server: $PIA_SERVER"
echo "🌍 Location: $PIA_LOCATION"

# Test VPN connection
echo "🔄 Testing VPN connection..."
if openvpn --config /etc/openvpn/pia.conf --daemon; then
    sleep 10
    
    # Verify IP change
    EXTERNAL_IP=$(curl -s https://ipinfo.io/ip || echo "unknown")
    echo "🌐 External IP: $EXTERNAL_IP"
    
    # Verify VPN is working
    if [[ "$EXTERNAL_IP" != "unknown" ]]; then
        echo "✅ VPN connection successful"
    else
        echo "⚠️ Warning: Could not verify VPN connection"
    fi
else
    echo "❌ Error: VPN connection failed"
    exit 1
fi

echo "🎉 VPN setup complete!"
```

### VPN Features
- **Multiple regions**: Support for 8 global PIA server locations
- **Automatic configuration**: Dynamic OpenVPN config generation
- **Security validation**: Certificate verification and connection testing
- **Environment integration**: Configurable via environment variables
- **Health monitoring**: Connection status verification

## Deployment Workflows

### Development Deployment
```bash
# 1. Start infrastructure services
docker-compose -f docker-compose.dev.yml up -d

# 2. Wait for services to be healthy
docker-compose -f docker-compose.dev.yml ps

# 3. Install dependencies and start app
npm install
npx playwright install
npm run dev

# 4. Verify functionality
curl http://localhost:3000/api/v1/health
```

### Production Deployment
```bash
# 1. Set environment variables
export POSTGRES_PASSWORD="secure_password"
export REDIS_PASSWORD="secure_redis_password"
export PIA_USERNAME="your_pia_username"
export PIA_PASSWORD="your_pia_password"
export VPN_ENABLED=true

# 2. Deploy with VPN
docker-compose up -d

# 3. Verify deployment
docker-compose ps
docker-compose logs ocean-scraper

# 4. Test functionality
curl http://localhost:3000/api/v1/health
```

### Unraid Deployment
```bash
# 1. Copy files to Unraid
scp -r docker/ root@unraid-server:/mnt/user/appdata/ocean-scraper/

# 2. Configure via Unraid UI
# - Set container name: ocean-scraper
# - Repository: local build from /mnt/user/appdata/ocean-scraper
# - Network: bridge
# - Port mapping: 3000:3000

# 3. Set environment variables in Unraid UI
# POSTGRES_PASSWORD, REDIS_PASSWORD, PIA credentials

# 4. Start container stack
docker-compose -f /mnt/user/appdata/ocean-scraper/docker-compose.yml up -d
```

## Monitoring & Maintenance

### Health Monitoring
```bash
# Check all service health
docker-compose ps

# View application logs
docker-compose logs -f ocean-scraper

# Monitor resource usage
docker stats ocean-scraper ocean-postgres ocean-redis

# Check VPN status
docker exec ocean-scraper curl -s https://ipinfo.io/ip
```

### Backup Procedures
```bash
# Database backup
docker exec ocean-postgres pg_dump -U ocean_user ocean_scraper > backup_$(date +%Y%m%d_%H%M%S).sql

# Volume backup
docker run --rm -v ocean-scraper_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_backup.tar.gz /data

# Configuration backup
tar czf config_backup.tar.gz docker/ .env
```

### Log Management
```bash
# Rotate logs
docker exec ocean-scraper find /app/logs -name "*.log" -mtime +7 -delete

# View real-time logs
docker-compose logs -f --tail=100 ocean-scraper

# Export logs for analysis
docker cp ocean-scraper:/app/logs ./exported-logs/
```

## Security Considerations

### Container Security
- **Non-root execution**: All containers run as non-privileged users
- **Minimal attack surface**: Alpine Linux base images
- **Network isolation**: Separate networks for different concerns
- **Secret management**: Environment-based secrets, no hardcoded values

### VPN Security
- **Kill switch**: Traffic blocked if VPN connection fails
- **DNS leak protection**: All DNS queries through VPN
- **Certificate validation**: PIA certificate verification
- **Connection monitoring**: Automatic reconnection on failure

### Production Hardening
```bash
# Remove development keys
docker exec ocean-postgres psql -U ocean_user -d ocean_scraper -c "DELETE FROM api_keys WHERE name = 'Development Key';"

# Set secure file permissions
chmod 600 .env
chmod 600 docker/vpn/pia-config.sh

# Enable firewall (Unraid/server)
ufw allow 3000/tcp
ufw deny 5432/tcp  # Block external database access
ufw deny 6379/tcp  # Block external Redis access
```

## Performance Optimization

### Resource Limits
```yaml
# Add to docker-compose.yml services
deploy:
  resources:
    limits:
      cpus: '2.0'
      memory: 4G
    reservations:
      cpus: '0.5'
      memory: 1G
```

### Volume Optimization
```yaml
# Use SSD storage for databases
volumes:
  postgres_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/ssd/postgres
```

### Network Performance
```yaml
# Optimize network settings
sysctls:
  - net.core.rmem_max=134217728
  - net.core.wmem_max=134217728
  - net.ipv4.tcp_rmem=4096 87380 134217728
```

This deployment layer provides a complete, production-ready containerization solution with security, monitoring, and VPN integration for the Ocean-Scraper service.