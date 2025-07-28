#!/bin/bash

set -e

echo "Ocean Scraper starting..."

# Function to handle graceful shutdown
cleanup() {
    echo "Shutting down gracefully..."
    
    # Stop VPN if running
    if [ "$VPN_ENABLED" = "true" ] && [ -f /var/run/openvpn.pid ]; then
        echo "Stopping VPN..."
        kill $(cat /var/run/openvpn.pid) 2>/dev/null || true
        rm -f /var/run/openvpn.pid
    fi
    
    # Stop the Node.js application
    if [ ! -z "$NODE_PID" ]; then
        echo "Stopping Node.js application..."
        kill $NODE_PID 2>/dev/null || true
        wait $NODE_PID 2>/dev/null || true
    fi
    
    echo "Shutdown complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Check if VPN is enabled
if [ "$VPN_ENABLED" = "true" ]; then
    echo "VPN is enabled, setting up VPN connection..."
    
    # Validate VPN credentials
    if [ -z "$PIA_USERNAME" ] || [ -z "$PIA_PASSWORD" ]; then
        echo "ERROR: VPN enabled but credentials not provided. Set PIA_USERNAME and PIA_PASSWORD environment variables."
        exit 1
    fi
    
    # Set default region if not specified
    export PIA_REGION=${PIA_REGION:-us-east}
    
    echo "Setting up VPN with region: $PIA_REGION"
    
    # Run VPN setup script (this needs root privileges)
    cd /app
    ./vpn/pia-config.sh start
    
    # Wait a moment for VPN to establish
    sleep 5
    
    # Verify VPN connection
    if ip addr show tun0 >/dev/null 2>&1; then
        echo "VPN connection established successfully"
        EXTERNAL_IP=$(curl -s --max-time 10 https://ipapi.co/ip/ || echo "unknown")
        echo "External IP: $EXTERNAL_IP"
    else
        if [ "$VPN_REQUIRED" = "true" ]; then
            echo "ERROR: VPN connection failed and VPN_REQUIRED=true"
            exit 1
        else
            echo "WARNING: VPN connection failed, but VPN_REQUIRED=false, continuing..."
        fi
    fi
else
    echo "VPN is disabled, starting without VPN"
fi

# Change ownership of app files to nodejs user
chown -R nodejs:nodejs /app/logs /app/screenshots /app/downloads

# Set up environment for the nodejs user
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-3000}

# Start the Node.js application as the nodejs user
echo "Starting Ocean Scraper application..."
cd /app

# Use su to run as nodejs user while keeping environment variables
su -p nodejs -c "node dist/index.js" &
NODE_PID=$!

echo "Ocean Scraper started with PID: $NODE_PID"

# Wait for the Node.js process
wait $NODE_PID

# If we get here, the Node.js process has exited
echo "Node.js process has exited"
cleanup