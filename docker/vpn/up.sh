#!/bin/bash
echo "[$(date)] VPN connection established"
echo "[$(date)] New IP: $(curl -s --max-time 10 https://ipapi.co/ip/ || echo 'unknown')"

# Set up NAT/forwarding for containerized apps
iptables -t nat -A POSTROUTING -o tun+ -j MASQUERADE
iptables -A FORWARD -i tun+ -j ACCEPT
iptables -A FORWARD -o tun+ -j ACCEPT

echo "[$(date)] VPN routing configured"