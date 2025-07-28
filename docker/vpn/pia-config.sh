#!/bin/bash

# Private Internet Access VPN Configuration Script
# This script manages PIA VPN connection within the Docker container

set -e

# Configuration variables
PIA_USER="${PIA_USERNAME}"
PIA_PASS="${PIA_PASSWORD}"
PIA_REGION="${PIA_REGION:-us-east}"
VPN_ENABLED="${VPN_ENABLED:-false}"

# PIA server regions mapping
declare -A PIA_SERVERS=(
    ["us-east"]="us-east.privateinternetaccess.com"
    ["us-west"]="us-west.privateinternetaccess.com"
    ["us-california"]="ca-toronto.privateinternetaccess.com"
    ["uk-london"]="uk-london.privateinternetaccess.com"
    ["germany"]="germany.privateinternetaccess.com"
    ["netherlands"]="nl.privateinternetaccess.com"
    ["france"]="france.privateinternetaccess.com"
    ["switzerland"]="swiss.privateinternetaccess.com"
    ["australia"]="au-melbourne.privateinternetaccess.com"
    ["japan"]="japan.privateinternetaccess.com"
)

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] VPN: $1"
}

# Check if VPN is enabled
if [ "$VPN_ENABLED" != "true" ]; then
    log "VPN is disabled. Skipping VPN setup."
    exit 0
fi

# Validate credentials
if [ -z "$PIA_USER" ] || [ -z "$PIA_PASS" ]; then
    log "ERROR: PIA_USERNAME and PIA_PASSWORD must be set"
    exit 1
fi

# Get server for region
SERVER=${PIA_SERVERS[$PIA_REGION]}
if [ -z "$SERVER" ]; then
    log "ERROR: Unknown region '$PIA_REGION'. Available regions: ${!PIA_SERVERS[@]}"
    exit 1
fi

log "Setting up PIA VPN connection to region: $PIA_REGION ($SERVER)"

# Create OpenVPN configuration directory
mkdir -p /etc/openvpn

# Download PIA OpenVPN configuration
log "Downloading PIA OpenVPN configuration..."
curl -s "https://www.privateinternetaccess.com/openvpn/openvpn.zip" -o /tmp/pia-ovpn.zip
unzip -q /tmp/pia-ovpn.zip -d /tmp/pia-ovpn/

# Find the configuration file for the selected region
OVPN_FILE=$(find /tmp/pia-ovpn -name "*${PIA_REGION}*.ovpn" | head -1)
if [ -z "$OVPN_FILE" ]; then
    log "ERROR: Could not find OpenVPN configuration for region: $PIA_REGION"
    exit 1
fi

# Copy configuration to OpenVPN directory
cp "$OVPN_FILE" /etc/openvpn/pia.conf

# Create auth file
echo "$PIA_USER" > /etc/openvpn/auth.txt
echo "$PIA_PASS" >> /etc/openvpn/auth.txt
chmod 600 /etc/openvpn/auth.txt

# Modify configuration to use auth file
sed -i 's/auth-user-pass/auth-user-pass \/etc\/openvpn\/auth.txt/' /etc/openvpn/pia.conf

# Add custom settings for container environment
cat >> /etc/openvpn/pia.conf << EOF

# Container-specific settings
script-security 2
up /etc/openvpn/up.sh
down /etc/openvpn/down.sh
log /var/log/openvpn.log
verb 3
mute 10
persist-tun
persist-key
resolv-retry infinite
nobind
EOF

# Create up script for routing
cat > /etc/openvpn/up.sh << 'EOF'
#!/bin/bash
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] VPN-UP: $1"
}

log "VPN connection established"
log "New IP: $(curl -s https://ipapi.co/ip/)"
log "Location: $(curl -s https://ipapi.co/city/), $(curl -s https://ipapi.co/country_name/)"

# Set up routing for the application
iptables -t nat -A OUTPUT -p tcp --dport 80,443 -j MASQUERADE
iptables -A INPUT -i tun+ -j ACCEPT
iptables -A FORWARD -i tun+ -j ACCEPT
iptables -A FORWARD -o tun+ -j ACCEPT
iptables -A OUTPUT -o tun+ -j ACCEPT

log "VPN routing configured"
EOF

# Create down script
cat > /etc/openvpn/down.sh << 'EOF'
#!/bin/bash
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] VPN-DOWN: $1"
}

log "VPN connection terminated"

# Clean up routing rules
iptables -t nat -D OUTPUT -p tcp --dport 80,443 -j MASQUERADE 2>/dev/null || true
iptables -D INPUT -i tun+ -j ACCEPT 2>/dev/null || true
iptables -D FORWARD -i tun+ -j ACCEPT 2>/dev/null || true
iptables -D FORWARD -o tun+ -j ACCEPT 2>/dev/null || true
iptables -D OUTPUT -o tun+ -j ACCEPT 2>/dev/null || true

log "VPN routing cleaned up"
EOF

# Make scripts executable
chmod +x /etc/openvpn/up.sh /etc/openvpn/down.sh

# Function to start VPN
start_vpn() {
    log "Starting OpenVPN connection..."
    openvpn --config /etc/openvpn/pia.conf --daemon --writepid /var/run/openvpn.pid
    
    # Wait for connection
    for i in {1..30}; do
        if ip addr show tun0 >/dev/null 2>&1; then
            log "VPN connection established successfully"
            return 0
        fi
        sleep 2
    done
    
    log "ERROR: VPN connection failed to establish"
    return 1
}

# Function to stop VPN
stop_vpn() {
    log "Stopping VPN connection..."
    if [ -f /var/run/openvpn.pid ]; then
        kill $(cat /var/run/openvpn.pid) 2>/dev/null || true
        rm -f /var/run/openvpn.pid
    fi
    pkill openvpn 2>/dev/null || true
    log "VPN connection stopped"
}

# Function to check VPN status
check_vpn() {
    if ip addr show tun0 >/dev/null 2>&1; then
        log "VPN is connected"
        log "Current IP: $(curl -s https://ipapi.co/ip/)"
        return 0
    else
        log "VPN is not connected"
        return 1
    fi
}

# Handle script arguments
case "${1:-start}" in
    start)
        start_vpn
        ;;
    stop)
        stop_vpn
        ;;
    restart)
        stop_vpn
        sleep 2
        start_vpn
        ;;
    status)
        check_vpn
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac