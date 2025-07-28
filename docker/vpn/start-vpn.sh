#!/bin/bash
set -e

echo "[$(date)] Starting PIA VPN container..."

# Check for required environment variables
if [ -z "$PIA_USERNAME" ] || [ -z "$PIA_PASSWORD" ]; then
    echo "ERROR: PIA_USERNAME and PIA_PASSWORD environment variables required"
    exit 1
fi

# Create auth file
echo "$PIA_USERNAME" > /etc/openvpn/pia-auth.txt
echo "$PIA_PASSWORD" >> /etc/openvpn/pia-auth.txt
chmod 600 /etc/openvpn/pia-auth.txt

# Make scripts executable
chmod +x /etc/openvpn/up.sh /etc/openvpn/down.sh

# Function to check if VPN is connected
check_vpn() {
    if ip addr show | grep -q "tun0"; then
        return 0
    else
        return 1
    fi
}

# Start OpenVPN
echo "[$(date)] Connecting to PIA VPN..."
openvpn --config /etc/openvpn/pia.conf --daemon --writepid /var/run/openvpn.pid

# Wait for connection
for i in {1..60}; do
    if check_vpn; then
        echo "[$(date)] VPN connected successfully!"
        NEW_IP=$(curl -s --max-time 10 https://ipapi.co/ip/ || echo "unknown")
        echo "[$(date)] Current IP: $NEW_IP"
        break
    fi
    echo "[$(date)] Waiting for VPN connection... ($i/60)"
    sleep 2
done

if ! check_vpn; then
    echo "[$(date)] ERROR: VPN connection failed"
    exit 1
fi

# Keep container running and monitor VPN
echo "[$(date)] VPN container ready. Monitoring connection..."
while true; do
    if ! check_vpn; then
        echo "[$(date)] VPN connection lost! Attempting reconnect..."
        openvpn --config /etc/openvpn/pia.conf --daemon --writepid /var/run/openvpn.pid
    fi
    sleep 30
done