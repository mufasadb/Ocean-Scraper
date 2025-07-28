#!/bin/bash
echo "[$(date)] VPN connection terminated"

# Clean up iptables rules
iptables -t nat -D POSTROUTING -o tun+ -j MASQUERADE 2>/dev/null || true
iptables -D FORWARD -i tun+ -j ACCEPT 2>/dev/null || true
iptables -D FORWARD -o tun+ -j ACCEPT 2>/dev/null || true

echo "[$(date)] VPN cleanup complete"