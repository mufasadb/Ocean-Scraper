#!/bin/bash
# Check if VPN tunnel interface exists
if ip addr show | grep -q "tun0"; then
    # Check if we can reach the internet through VPN
    if curl -s --max-time 5 https://ipapi.co/ip/ > /dev/null; then
        exit 0
    fi
fi
exit 1