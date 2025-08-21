#!/bin/bash

# VPN Test Script for Ocean-Scraper
# This script tests the VPN configuration locally before Unraid deployment

set -e

echo "🧪 Ocean-Scraper VPN Test Script"
echo "================================="

# Check if PIA credentials are provided
if [ ! -f ".env.vpn" ]; then
    echo "❌ Error: .env.vpn file not found"
    echo "📝 Please copy .env.vpn.test to .env.vpn and fill in your PIA credentials"
    exit 1
fi

# Source VPN environment
source .env.vpn

if [ -z "$PIA_USERNAME" ] || [ -z "$PIA_PASSWORD" ] || [ "$PIA_USERNAME" = "your_pia_username_here" ]; then
    echo "❌ Error: PIA_USERNAME and PIA_PASSWORD must be set in .env.vpn"
    echo "📝 Please edit .env.vpn with your actual PIA credentials"
    exit 1
fi

echo "✅ VPN credentials configured"
echo "📍 Location: $PIA_LOCATION"

# Function to check if containers are running
check_container_health() {
    local service=$1
    local max_attempts=30
    local attempt=1
    
    echo "⏳ Waiting for $service to be healthy..."
    
    while [ $attempt -le $max_attempts ]; do
        if docker-compose -f docker/docker-compose.vpn.yml ps | grep -q "$service.*healthy"; then
            echo "✅ $service is healthy"
            return 0
        fi
        
        if [ $attempt -eq 1 ]; then
            echo "   Attempt $attempt/$max_attempts..."
        elif [ $(($attempt % 5)) -eq 0 ]; then
            echo "   Attempt $attempt/$max_attempts..."
        fi
        
        sleep 2
        ((attempt++))
    done
    
    echo "❌ $service failed to become healthy after $max_attempts attempts"
    return 1
}

# Function to test IP change
test_ip_change() {
    echo "🌐 Testing IP address change..."
    
    # Get IP without VPN (from host)
    echo "📍 Getting host IP address..."
    HOST_IP=$(curl -s --max-time 10 https://ipinfo.io/ip || echo "unknown")
    echo "   Host IP: $HOST_IP"
    
    # Get IP through VPN container
    echo "📍 Getting VPN container IP address..."
    VPN_IP=$(docker exec ocean-vpn curl -s --max-time 10 https://ipinfo.io/ip || echo "unknown")
    echo "   VPN IP: $VPN_IP"
    
    if [ "$HOST_IP" != "$VPN_IP" ] && [ "$VPN_IP" != "unknown" ]; then
        echo "✅ IP address changed successfully!"
        echo "   Host: $HOST_IP → VPN: $VPN_IP"
        return 0
    else
        echo "❌ IP address did not change or could not be determined"
        echo "   Host: $HOST_IP, VPN: $VPN_IP"
        return 1
    fi
}

# Function to test Ocean-Scraper through VPN
test_ocean_scraper() {
    echo "🔍 Testing Ocean-Scraper functionality through VPN..."
    
    # Test health endpoint
    echo "📊 Testing health endpoint..."
    if curl -s -f --max-time 10 "http://localhost:3000/api/v1/health" > /dev/null; then
        echo "✅ Health endpoint working"
    else
        echo "❌ Health endpoint failed"
        return 1
    fi
    
    # Test scraping with IP check
    echo "🕷️ Testing scraping functionality..."
    SCRAPE_RESULT=$(curl -s --max-time 30 -X POST "http://localhost:3000/api/v1/test/scrape" \
        -H "Content-Type: application/json" \
        -d '{"url": "https://httpbin.org/ip", "formats": ["json"]}' || echo "failed")
    
    if echo "$SCRAPE_RESULT" | grep -q '"origin"'; then
        SCRAPED_IP=$(echo "$SCRAPE_RESULT" | grep -o '"origin": "[^"]*"' | cut -d'"' -f4)
        echo "✅ Scraping successful!"
        echo "   Scraped content shows IP: $SCRAPED_IP"
        
        # Verify scraped IP matches VPN IP
        if [ "$SCRAPED_IP" = "$VPN_IP" ]; then
            echo "✅ Scraped content confirms VPN is working!"
            return 0
        else
            echo "⚠️  Warning: Scraped IP doesn't match VPN IP"
            echo "   Expected: $VPN_IP, Got: $SCRAPED_IP"
            return 1
        fi
    else
        echo "❌ Scraping failed"
        echo "   Response: $SCRAPE_RESULT"
        return 1
    fi
}

# Function to show logs
show_logs() {
    echo "📜 Container Logs:"
    echo "------------------"
    docker-compose -f docker/docker-compose.vpn.yml logs --tail=10 vpn
    echo ""
    docker-compose -f docker/docker-compose.vpn.yml logs --tail=10 ocean-scraper
}

# Main test execution
echo ""
echo "🚀 Starting VPN test deployment..."

# Clean up any existing containers
docker-compose -f docker/docker-compose.vpn.yml down -v 2>/dev/null || true

# Start the VPN stack
echo "🏗️ Building and starting containers..."
docker-compose -f docker/docker-compose.vpn.yml up -d --build

# Wait for services to be healthy
echo ""
echo "⏳ Waiting for services to start..."

# Check VPN first
if ! check_container_health "ocean-vpn"; then
    echo "❌ VPN container failed to start properly"
    show_logs
    exit 1
fi

# Check database and redis
if ! check_container_health "ocean-postgres"; then
    echo "❌ PostgreSQL container failed to start properly"
    show_logs
    exit 1
fi

if ! check_container_health "ocean-redis"; then
    echo "❌ Redis container failed to start properly"
    show_logs
    exit 1
fi

# Check ocean-scraper
if ! check_container_health "ocean-scraper"; then
    echo "❌ Ocean-Scraper container failed to start properly"
    show_logs
    exit 1
fi

echo ""
echo "✅ All containers are healthy!"

# Test VPN functionality
echo ""
if test_ip_change; then
    echo ""
    if test_ocean_scraper; then
        echo ""
        echo "🎉 VPN Test PASSED!"
        echo "============================="
        echo "✅ VPN is working correctly"
        echo "✅ Ocean-Scraper routes through VPN"
        echo "✅ IP address is properly masked"
        echo ""
        echo "🚀 Ready for Unraid deployment!"
        echo ""
        echo "📋 Next steps:"
        echo "   1. Copy docker/docker-compose.vpn.yml to your Unraid server"
        echo "   2. Copy docker/nginx.conf to your Unraid server"
        echo "   3. Create .env.vpn with your PIA credentials on Unraid"
        echo "   4. Run: docker-compose -f docker-compose.vpn.yml up -d"
        echo ""
    else
        echo ""
        echo "❌ VPN Test FAILED - Ocean-Scraper Issues"
        echo "=================================="
        show_logs
        exit 1
    fi
else
    echo ""
    echo "❌ VPN Test FAILED - VPN Not Working"
    echo "==================================="
    show_logs
    exit 1
fi

# Optional: Keep containers running for manual testing
read -p "💡 Keep containers running for manual testing? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔧 Containers are still running. Test URLs:"
    echo "   Health: http://localhost:3000/api/v1/health"
    echo "   Test Scrape: curl -X POST http://localhost:3000/api/v1/test/scrape -H 'Content-Type: application/json' -d '{\"url\": \"https://httpbin.org/ip\", \"formats\": [\"json\"]}'"
    echo ""
    echo "To stop: docker-compose -f docker/docker-compose.vpn.yml down"
else
    echo "🧹 Cleaning up containers..."
    docker-compose -f docker/docker-compose.vpn.yml down -v
    echo "✅ Cleanup complete"
fi