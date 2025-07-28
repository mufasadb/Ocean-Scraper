#!/bin/bash

# Development Mock VPN Script for Ocean Scraper
# This script simulates VPN functionality for development/testing

set -e

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] VPN-DEV: $1"
}

# Create mock VPN interface state file
VPN_STATE_FILE="/tmp/ocean-scraper-vpn-state"

case "${1:-start}" in
    start)
        log "Starting mock VPN connection (development mode)"
        log "NOTE: This is a development mock - no actual VPN connection is made"
        
        # Create mock state file
        echo "connected" > $VPN_STATE_FILE
        echo "region:singapore" >> $VPN_STATE_FILE
        echo "started_at:$(date)" >> $VPN_STATE_FILE
        
        # Create mock tun0 interface state
        mkdir -p /tmp/ocean-scraper
        echo "inet 10.0.0.2/24" > /tmp/ocean-scraper/tun0-state
        
        log "Mock VPN connection established"
        log "Mock IP: 103.107.198.12 (Singapore)"
        log "Note: For real VPN testing, use Docker environment"
        ;;
        
    stop)
        log "Stopping mock VPN connection"
        rm -f $VPN_STATE_FILE
        rm -f /tmp/ocean-scraper/tun0-state
        log "Mock VPN connection stopped"
        ;;
        
    restart)
        log "Restarting mock VPN connection"
        $0 stop
        sleep 1
        $0 start
        ;;
        
    status)
        if [ -f $VPN_STATE_FILE ]; then
            log "Mock VPN is connected"
            log "Mock state: $(cat $VPN_STATE_FILE)"
            exit 0
        else
            log "Mock VPN is not connected"
            exit 1
        fi
        ;;
        
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac