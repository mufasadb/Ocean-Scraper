# Multi-stage build for optimal image size
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev for building)
RUN npm ci && npm cache clean --force

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install system dependencies for Playwright and VPN
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    openvpn \
    iptables \
    curl \
    bash

# Tell Playwright to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create app user with shell
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -s /bin/sh

WORKDIR /app

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Copy VPN configuration and make executable
COPY docker/vpn ./vpn
RUN chmod +x ./vpn/pia-config.sh

# Create necessary directories
RUN mkdir -p /app/logs /app/screenshots /app/downloads && \
    chown -R nodejs:nodejs /app

# Create VPN startup script that handles privilege escalation
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create openvpn directory and set permissions
RUN mkdir -p /etc/openvpn && \
    mkdir -p /var/log && \
    touch /var/log/openvpn.log && \
    chmod 666 /var/log/openvpn.log

# Note: We start as root to handle VPN setup, then drop to nodejs user for the app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/v1/health || exit 1

EXPOSE 3000

CMD ["/entrypoint.sh"]