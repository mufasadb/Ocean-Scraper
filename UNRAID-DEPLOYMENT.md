# Ocean-Scraper Unraid Deployment Guide

## Overview
This guide will help you deploy Ocean-Scraper on your Unraid server with a working configuration tested locally first.

## 🎯 Quick Deployment (Recommended)

### Method 1: Automated Deployment Script

1. **Update the deployment script with your Unraid details:**
   ```bash
   # Edit deploy-unraid.sh
   UNRAID_IP="192.168.1.100"  # Your Unraid IP
   UNRAID_USER="root"         # Your Unraid username
   ```

2. **Run the deployment:**
   ```bash
   ./deploy-unraid.sh
   ```

3. **Access your Ocean-Scraper:**
   - Web Interface: `http://YOUR_UNRAID_IP:3000`
   - Health Check: `http://YOUR_UNRAID_IP:3000/api/v1/health`

### Method 2: Manual Deployment

1. **Copy files to Unraid:**
   ```bash
   # Replace with your Unraid IP
   scp -r docker/ root@192.168.1.100:/mnt/user/appdata/ocean-scraper/
   scp docker-compose.unraid-simple.yml root@192.168.1.100:/mnt/user/appdata/ocean-scraper/docker-compose.yml
   scp .env.unraid root@192.168.1.100:/mnt/user/appdata/ocean-scraper/.env
   ```

2. **SSH into Unraid and deploy:**
   ```bash
   ssh root@192.168.1.100
   cd /mnt/user/appdata/ocean-scraper
   
   # Create directories
   mkdir -p logs screenshots downloads config postgres redis backups
   
   # Start services
   docker-compose up -d
   ```

## 📁 File Structure on Unraid

After deployment, your Unraid will have:

```
/mnt/user/appdata/ocean-scraper/
├── docker-compose.yml          # Main orchestration file
├── .env                        # Environment configuration
├── docker/                     # Docker configurations
│   ├── Dockerfile
│   ├── init-db.sql
│   └── vpn/                    # VPN configs (for later)
├── logs/                       # Application logs
├── screenshots/                # Generated screenshots
├── downloads/                  # Generated PDFs
├── postgres/                   # Database files
├── redis/                      # Redis data
└── backups/                    # Database backups
```

## 🔧 Configuration

### Essential Configuration (.env file)

Update `/mnt/user/appdata/ocean-scraper/.env`:

```bash
# Change these passwords!
POSTGRES_PASSWORD=your_secure_db_password
REDIS_PASSWORD=your_secure_redis_password

# Add your PIA VPN credentials (for VPN mode)
PIA_USERNAME=your_pia_username
PIA_PASSWORD=your_pia_password
PIA_REGION=australia  # Melbourne server

# Generate secure API keys
API_KEYS=your-secure-api-key-here
```

### Port Configuration

The deployment exposes these ports:

- **3000**: Ocean-Scraper API (main interface)
- **8081**: Redis Commander (database management)
- **5432**: PostgreSQL (admin access)
- **6379**: Redis (admin access)

## 🧪 Testing Your Deployment

### 1. Health Check
```bash
curl http://YOUR_UNRAID_IP:3000/api/v1/health
```

Expected response:
```json
{
  "success": true,
  "status": "healthy",
  "services": {
    "database": true,
    "redis": true,
    "vpn": false
  }
}
```

### 2. Test Scraping
```bash
curl -X POST http://YOUR_UNRAID_IP:3000/api/v1/test/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'
```

### 3. Production Scraping (with API key)
```bash
curl -X POST http://YOUR_UNRAID_IP:3000/api/v1/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"url": "https://wikipedia.org", "formats": ["markdown", "screenshot"]}'
```

## 🛡️ Security Recommendations

### 1. Change Default Passwords
```bash
# SSH into Unraid
ssh root@YOUR_UNRAID_IP
cd /mnt/user/appdata/ocean-scraper

# Edit environment file
nano .env

# Update these lines:
POSTGRES_PASSWORD=your_secure_password_here
REDIS_PASSWORD=your_secure_redis_password_here
API_KEYS=your-secure-api-key-here

# Restart services
docker-compose restart
```

### 2. Restrict Network Access
Add these to your Unraid firewall:
- Allow port 3000 from your local network only
- Block external access to ports 5432, 6379, 8081

### 3. Enable VPN (Optional)
```bash
# Edit .env file
VPN_ENABLED=true
PIA_USERNAME=your_pia_username
PIA_PASSWORD=your_pia_password

# Restart to apply VPN
docker-compose restart
```

## 🚀 Using Your Ocean-Scraper

### Basic API Endpoints

1. **Health Check:**
   ```
   GET http://YOUR_UNRAID_IP:3000/api/v1/health
   ```

2. **Simple Scrape:**
   ```
   POST http://YOUR_UNRAID_IP:3000/api/v1/test/scrape
   Content-Type: application/json
   
   {
     "url": "https://example.com",
     "formats": ["markdown"]
   }
   ```

3. **Advanced Scraping:**
   ```
   POST http://YOUR_UNRAID_IP:3000/api/v1/scrape
   Content-Type: application/json
   X-API-Key: your-api-key
   
   {
     "url": "https://example.com",
     "formats": ["markdown", "screenshot", "pdf"],
     "actions": [
       {"type": "wait", "selector": ".content", "timeout": 5000}
     ]
   }
   ```

### Available Output Formats
- `markdown`: Clean markdown content
- `html`: Raw HTML
- `json`: Structured data
- `screenshot`: PNG screenshot
- `pdf`: PDF export

## 📊 Monitoring

### View Logs
```bash
ssh root@YOUR_UNRAID_IP
cd /mnt/user/appdata/ocean-scraper

# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f ocean-scraper
```

### Redis Management
Access Redis Commander at: `http://YOUR_UNRAID_IP:8081`

### Database Access
```bash
# Connect to PostgreSQL
docker exec -it ocean-postgres psql -U ocean_user -d ocean_scraper
```

## 🔧 Troubleshooting

### Common Issues

1. **Services won't start:**
   ```bash
   # Check status
   docker-compose ps
   
   # Check logs
   docker-compose logs
   
   # Restart services
   docker-compose restart
   ```

2. **Database connection issues:**
   ```bash
   # Reset database
   docker-compose down
   docker volume rm ocean-scraper_postgres_data
   docker-compose up -d
   ```

3. **Permission issues:**
   ```bash
   # Fix permissions
   chown -R nobody:users /mnt/user/appdata/ocean-scraper/
   chmod -R 755 /mnt/user/appdata/ocean-scraper/
   ```

### Performance Tuning

For better performance on Unraid:

1. **Use SSD for database:**
   ```bash
   # Move postgres data to SSD
   mv /mnt/user/appdata/ocean-scraper/postgres /mnt/cache/appdata/ocean-scraper/
   ln -s /mnt/cache/appdata/ocean-scraper/postgres /mnt/user/appdata/ocean-scraper/postgres
   ```

2. **Adjust browser instances:**
   ```bash
   # Edit .env
   BROWSER_MAX_INSTANCES=2  # Reduce for lower-end hardware
   ```

## 🔄 Updating

To update Ocean-Scraper:

```bash
ssh root@YOUR_UNRAID_IP
cd /mnt/user/appdata/ocean-scraper

# Pull latest code and rebuild
git pull  # if using git
docker-compose build --no-cache
docker-compose up -d
```

## 📞 Support

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Verify configuration: `cat .env`
3. Test connectivity: `curl http://localhost:3000/api/v1/health`
4. Check Unraid system resources: `htop`

## 🎉 Success!

Once deployed, you'll have a fully functional web scraping service with:
- ✅ High-performance browser automation
- ✅ Job queue for async processing
- ✅ Multiple output formats
- ✅ Anti-bot detection evasion
- ✅ Optional VPN integration
- ✅ Web-based management interfaces

Your Ocean-Scraper is ready to handle scraping tasks efficiently on your Unraid server!