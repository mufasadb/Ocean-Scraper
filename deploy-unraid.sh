#!/bin/bash

# Ocean-Scraper Unraid Deployment Script
# This script sets up Ocean-Scraper on Unraid

set -e

echo "🚀 Ocean-Scraper Unraid Deployment"
echo "=================================="

# Configuration
UNRAID_IP=${UNRAID_IP:-"192.168.1.100"}  # Change to your Unraid IP
UNRAID_USER=${UNRAID_USER:-"root"}
APPDATA_PATH="/mnt/user/appdata/ocean-scraper"

echo "📋 Configuration:"
echo "   Unraid IP: $UNRAID_IP"
echo "   Unraid User: $UNRAID_USER"
echo "   App Data Path: $APPDATA_PATH"
echo ""

# Function to run commands on Unraid
run_on_unraid() {
    echo "🔧 Running on Unraid: $1"
    ssh $UNRAID_USER@$UNRAID_IP "$1"
}

# Function to copy files to Unraid
copy_to_unraid() {
    echo "📁 Copying $1 to $2"
    scp -r "$1" "$UNRAID_USER@$UNRAID_IP:$2"
}

echo "1. Creating directory structure on Unraid..."
run_on_unraid "mkdir -p $APPDATA_PATH/{logs,screenshots,downloads,config,postgres,redis,backups,docker}"

echo "2. Copying Docker configuration..."
copy_to_unraid "docker/" "$APPDATA_PATH/"
copy_to_unraid "docker-compose.unraid-simple.yml" "$APPDATA_PATH/docker-compose.yml"

echo "3. Copying environment configuration..."
copy_to_unraid ".env.unraid" "$APPDATA_PATH/.env"

echo "4. Setting up Docker context on Unraid..."
run_on_unraid "cd $APPDATA_PATH && docker context create unraid-context || echo 'Context already exists'"

echo "5. Building Docker image on Unraid..."
copy_to_unraid "." "$APPDATA_PATH/source/"
run_on_unraid "cd $APPDATA_PATH/source && docker build -t ocean-scraper -f docker/Dockerfile ."

echo "6. Starting services on Unraid..."
run_on_unraid "cd $APPDATA_PATH && docker-compose up -d"

echo "7. Waiting for services to start..."
sleep 30

echo "8. Checking service status..."
run_on_unraid "cd $APPDATA_PATH && docker-compose ps"

echo "9. Testing health endpoint..."
run_on_unraid "curl -s http://localhost:3000/api/v1/health | jq . || curl -s http://localhost:3000/api/v1/health"

echo ""
echo "✅ Deployment Complete!"
echo ""
echo "🌐 Access Ocean-Scraper at: http://$UNRAID_IP:3000"
echo "📊 Redis Management at: http://$UNRAID_IP:8081"
echo "🔧 Database port: $UNRAID_IP:5432"
echo ""
echo "📖 API Documentation:"
echo "   Health: curl http://$UNRAID_IP:3000/api/v1/health"
echo "   Test Scrape: curl -X POST http://$UNRAID_IP:3000/api/v1/test/scrape \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"url\": \"https://example.com\", \"formats\": [\"markdown\"]}'"
echo ""
echo "⚠️  Important Next Steps:"
echo "   1. Change default passwords in $APPDATA_PATH/.env"
echo "   2. Add your PIA credentials for VPN"
echo "   3. Generate secure API keys"
echo "   4. Set VPN_ENABLED=true when ready"
echo ""
echo "📝 Logs: ssh $UNRAID_USER@$UNRAID_IP 'cd $APPDATA_PATH && docker-compose logs -f'"