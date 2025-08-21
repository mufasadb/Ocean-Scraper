# Unraid VPN Deployment Guide

## Overview
This guide provides step-by-step instructions for deploying Ocean-Scraper with VPN on Unraid using the tested and working configuration.

## Prerequisites
- Unraid server with Docker support
- Private Internet Access (PIA) VPN subscription
- SSH access to your Unraid server

## Deployment Steps

### 1. Prepare Files on Unraid

```bash
# SSH into your Unraid server
ssh root@your-unraid-ip

# Create application directory
mkdir -p /mnt/user/appdata/ocean-scraper
cd /mnt/user/appdata/ocean-scraper

# Create subdirectories
mkdir -p {logs,screenshots,downloads,backups}
```

### 2. Copy Configuration Files

Copy these files from your local machine to Unraid:

```bash
# From your local machine, copy files to Unraid
scp docker/docker-compose.vpn.yml root@unraid-ip:/mnt/user/appdata/ocean-scraper/
scp docker/nginx.conf root@unraid-ip:/mnt/user/appdata/ocean-scraper/
scp docker/init-db.sql root@unraid-ip:/mnt/user/appdata/ocean-scraper/
scp docker/Dockerfile root@unraid-ip:/mnt/user/appdata/ocean-scraper/
```

Or use the Unraid file manager to upload these files.

### 3. Set Up Environment Configuration

Create `/mnt/user/appdata/ocean-scraper/.env.vpn`:

```bash
# Create environment file on Unraid
cat > /mnt/user/appdata/ocean-scraper/.env.vpn << 'EOF'
# Private Internet Access Credentials
PIA_USERNAME=your_actual_pia_username
PIA_PASSWORD=your_actual_pia_password
PIA_LOCATION=us_east

# Database Security
POSTGRES_PASSWORD=your_secure_database_password

# VPN Settings
VPN_ENABLED=true
VPN_REQUIRED=true

# Available PIA Locations:
# us_east, us_west, ca_toronto, uk_london, germany, 
# netherlands, france, switzerland, au_melbourne, japan
EOF
```

**IMPORTANT**: Replace the placeholder credentials with your actual PIA username and password!

### 4. Copy Application Code

You have two options:

#### Option A: Copy Built Application
```bash
# Copy the entire source code
scp -r src/ root@unraid-ip:/mnt/user/appdata/ocean-scraper/
scp package*.json root@unraid-ip:/mnt/user/appdata/ocean-scraper/
scp tsconfig.json root@unraid-ip:/mnt/user/appdata/ocean-scraper/
```

#### Option B: Pre-build Docker Image (Recommended)
```bash
# Build image locally first
docker build -f docker/Dockerfile -t ocean-scraper:latest .

# Save and transfer image
docker save ocean-scraper:latest | ssh root@unraid-ip 'docker load'
```

### 5. Deploy the Stack

```bash
# SSH into Unraid and navigate to app directory
ssh root@unraid-ip
cd /mnt/user/appdata/ocean-scraper

# Start the VPN-enabled stack
docker-compose -f docker-compose.vpn.yml up -d --build

# Monitor the startup process
docker-compose -f docker-compose.vpn.yml logs -f
```

### 6. Verify Deployment

#### Check Container Health
```bash
# Check all containers are running and healthy
docker-compose -f docker-compose.vpn.yml ps

# Should show all services as "healthy"
```

#### Test VPN Functionality
```bash
# Get host IP (your Unraid server's IP)
curl -s https://ipinfo.io/ip

# Get VPN container IP (should be different)
docker exec ocean-vpn curl -s https://ipinfo.io/ip

# Test Ocean-Scraper service
curl -s http://localhost:3000/api/v1/health

# Test scraping with IP verification
curl -X POST http://localhost:3000/api/v1/test/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://httpbin.org/ip", "formats": ["json"]}'
```

#### Expected Results
- VPN container IP should be different from host IP
- Health endpoint should return service status
- Test scrape should return the VPN IP, not your host IP

### 7. Unraid Web UI Integration

#### Add as Unraid Container Template

1. Go to **Docker** tab in Unraid Web UI
2. Click **Add Container**
3. Use these settings:

| Setting | Value |
|---------|-------|
| Name | ocean-scraper-stack |
| Repository | Use existing `docker-compose.vpn.yml` |
| Network Type | Custom: ocean-network |
| Port Mappings | 3000:80/tcp |
| Path Mappings | `/mnt/user/appdata/ocean-scraper/logs:/app/logs` |
| | `/mnt/user/appdata/ocean-scraper/screenshots:/app/screenshots` |
| | `/mnt/user/appdata/ocean-scraper/downloads:/app/downloads` |
| Environment Variables | Set PIA credentials and other config |

#### Or Use Docker Compose Plugin

If you have the Docker Compose plugin installed:

1. Navigate to **Apps** → **Docker Compose**
2. Create new stack named "ocean-scraper"
3. Paste the contents of `docker-compose.vpn.yml`
4. Set environment variables
5. Deploy

### 8. Monitoring & Maintenance

#### View Logs
```bash
# Application logs
docker-compose -f docker-compose.vpn.yml logs ocean-scraper

# VPN logs  
docker-compose -f docker-compose.vpn.yml logs vpn

# All services
docker-compose -f docker-compose.vpn.yml logs -f
```

#### Health Monitoring
```bash
# Check VPN status
docker exec ocean-vpn curl -s https://ipinfo.io/json

# Check scraper health
curl http://localhost:3000/api/v1/health

# Monitor resource usage
docker stats
```

#### Backup Database
```bash
# Create database backup
docker exec ocean-postgres pg_dump -U ocean_user ocean_scraper > /mnt/user/appdata/ocean-scraper/backups/backup_$(date +%Y%m%d_%H%M%S).sql
```

## Troubleshooting

### VPN Not Connecting
```bash
# Check VPN container logs
docker logs ocean-vpn

# Verify PIA credentials
docker exec ocean-vpn env | grep PIA

# Restart VPN container
docker-compose -f docker-compose.vpn.yml restart vpn
```

### Ocean-Scraper Not Starting
```bash
# Check application logs
docker logs ocean-scraper

# Verify database connectivity
docker exec ocean-scraper nc -z postgres 5432

# Check environment variables
docker exec ocean-scraper env | grep -E "POSTGRES|REDIS|VPN"
```

### IP Not Changing
```bash
# Compare IPs
echo "Host IP: $(curl -s https://ipinfo.io/ip)"
echo "VPN IP: $(docker exec ocean-vpn curl -s https://ipinfo.io/ip)"

# Check network configuration
docker exec ocean-vpn ip route show
docker exec ocean-scraper ip route show
```

### Port Not Accessible
```bash
# Check nginx proxy
docker logs ocean-nginx

# Verify port mapping
docker port ocean-nginx

# Test internal connectivity
docker exec ocean-nginx curl -f http://172.20.0.10:3000/api/v1/health
```

## Security Recommendations

### Environment Security
- Use strong passwords for database credentials
- Rotate PIA credentials regularly
- Restrict file permissions: `chmod 600 .env.vpn`

### Network Security
```bash
# Optional: Restrict external access
iptables -A INPUT -p tcp --dport 3000 -s your_allowed_ip -j ACCEPT
iptables -A INPUT -p tcp --dport 3000 -j DROP
```

### Regular Updates
```bash
# Update container images monthly
docker-compose -f docker-compose.vpn.yml pull
docker-compose -f docker-compose.vpn.yml up -d
```

## Configuration Options

### PIA Server Locations
Available locations for `PIA_LOCATION`:
- `us_east` - US East Coast
- `us_west` - US West Coast  
- `ca_toronto` - Canada Toronto
- `uk_london` - UK London
- `germany` - Germany
- `netherlands` - Netherlands
- `france` - France
- `switzerland` - Switzerland
- `au_melbourne` - Australia Melbourne
- `japan` - Japan

### Resource Limits
Add to `docker-compose.vpn.yml` for each service:

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'
      memory: 4G
    reservations:
      cpus: '0.5'  
      memory: 1G
```

## Success Indicators

✅ **Working VPN Deployment**:
- All containers show "healthy" status
- VPN container IP differs from host IP
- Ocean-Scraper accessible on port 3000
- Test scraping returns VPN IP address
- Database and Redis accessible internally
- Logs show no connection errors

✅ **Ready for Production**:
- Health checks passing
- VPN connection stable
- Scraping functionality verified
- Proper IP masking confirmed
- All services auto-restart on failure

This deployment configuration has been tested locally and provides a production-ready VPN-enabled Ocean-Scraper setup for Unraid.