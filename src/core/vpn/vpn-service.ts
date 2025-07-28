import { ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { config } from '@/config';
import logger from '@/utils/logger';

const execAsync = promisify(exec);

export interface VpnStatus {
  connected: boolean;
  region?: string;
  publicIp?: string;
  vpnIp?: string;
  connectionTime?: Date;
  lastHealthCheck?: Date;
}

export interface VpnHealthCheck {
  isHealthy: boolean;
  latency?: number;
  ipChanged: boolean;
  errorMessage?: string;
}

export class VpnService {
  private vpnProcess: ChildProcess | null = null;
  private originalIp: string | null = null;
  private connectionStartTime: Date | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly healthCheckIntervalMs = 30000; // 30 seconds

  constructor() {
    this.initializeOriginalIp();
  }

  private async initializeOriginalIp(): Promise<void> {
    try {
      if (!config.vpn.enabled) {
        this.originalIp = await this.getCurrentPublicIp();
        logger.info('VPN disabled, current IP recorded', { ip: this.originalIp });
      }
    } catch (error) {
      logger.warn('Failed to get original IP', { error });
    }
  }

  async isVpnRequired(): Promise<boolean> {
    return config.vpn.required === true;
  }

  async isVpnEnabled(): Promise<boolean> {
    return config.vpn.enabled === true;
  }

  async getVpnStatus(): Promise<VpnStatus> {
    try {
      const connected = await this.isVpnConnected();
      let publicIp: string | undefined;
      let vpnIp: string | undefined;

      if (connected) {
        publicIp = await this.getCurrentPublicIp();
        vpnIp = await this.getVpnInterfaceIp();
      }

      return {
        connected,
        region: config.vpn.region,
        publicIp,
        vpnIp,
        connectionTime: this.connectionStartTime || undefined,
        lastHealthCheck: new Date(),
      };
    } catch (error) {
      logger.error('Failed to get VPN status', { error });
      return {
        connected: false,
        lastHealthCheck: new Date(),
      };
    }
  }

  async startVpn(): Promise<boolean> {
    if (!config.vpn.enabled) {
      logger.info('VPN is disabled in configuration');
      return false;
    }

    if (!config.vpn.username || !config.vpn.password) {
      throw new Error('VPN credentials not provided. Set PIA_USERNAME and PIA_PASSWORD environment variables.');
    }

    try {
      logger.info('Starting VPN connection', { region: config.vpn.region });

      // Check if already connected
      if (await this.isVpnConnected()) {
        logger.info('VPN already connected');
        return true;
      }

      // Execute VPN startup script
      const scriptPath = config.vpn.scriptPath;
      const { stdout, stderr } = await execAsync(`chmod +x ${scriptPath} && ${scriptPath} start`);

      if (stderr && !stderr.includes('VPN connection established')) {
        logger.warn('VPN startup warnings', { stderr });
      }

      logger.debug('VPN startup output', { stdout });

      // Wait for connection to establish
      for (let i = 0; i < 30; i++) {
        if (await this.isVpnConnected()) {
          this.connectionStartTime = new Date();
          logger.info('VPN connection established successfully');
          
          // Start health monitoring
          this.startHealthMonitoring();
          
          return true;
        }
        await this.delay(2000);
      }

      throw new Error('VPN connection failed to establish within timeout');

    } catch (error) {
      logger.error('Failed to start VPN', { error });
      throw error;
    }
  }

  async stopVpn(): Promise<void> {
    try {
      logger.info('Stopping VPN connection');

      // Stop health monitoring
      this.stopHealthMonitoring();

      if (this.vpnProcess) {
        this.vpnProcess.kill('SIGTERM');
        this.vpnProcess = null;
      }

      // Execute VPN stop script
      const scriptPath = config.vpn.scriptPath;
      await execAsync(`${scriptPath} stop`);

      this.connectionStartTime = null;
      logger.info('VPN connection stopped');

    } catch (error) {
      logger.error('Failed to stop VPN', { error });
      throw error;
    }
  }

  async restartVpn(): Promise<boolean> {
    try {
      logger.info('Restarting VPN connection');
      await this.stopVpn();
      await this.delay(2000);
      return await this.startVpn();
    } catch (error) {
      logger.error('Failed to restart VPN', { error });
      throw error;
    }
  }

  async performHealthCheck(): Promise<VpnHealthCheck> {
    try {
      const startTime = Date.now();
      const isConnected = await this.isVpnConnected();
      
      if (!isConnected) {
        return {
          isHealthy: false,
          ipChanged: false,
          errorMessage: 'VPN is not connected',
        };
      }

      const currentIp = await this.getCurrentPublicIp();
      const latency = Date.now() - startTime;
      const ipChanged = this.originalIp ? currentIp !== this.originalIp : true;

      const isHealthy = isConnected && ipChanged && latency < 10000; // 10 second timeout

      logger.debug('VPN health check completed', {
        isHealthy,
        latency,
        currentIp,
        originalIp: this.originalIp,
        ipChanged,
      });

      return {
        isHealthy,
        latency,
        ipChanged,
      };

    } catch (error) {
      logger.error('VPN health check failed', { error });
      return {
        isHealthy: false,
        ipChanged: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown health check error',
      };
    }
  }

  async ensureVpnConnection(): Promise<void> {
    const isRequired = await this.isVpnRequired();
    const isEnabled = await this.isVpnEnabled();

    if (isRequired && !isEnabled) {
      throw new Error('VPN is required but not enabled. Set VPN_ENABLED=true and provide VPN credentials.');
    }

    if (isEnabled) {
      const status = await this.getVpnStatus();
      
      if (!status.connected) {
        logger.info('VPN required but not connected, attempting to start');
        const started = await this.startVpn();
        
        if (!started) {
          throw new Error('Failed to establish required VPN connection');
        }
      }

      // Perform health check
      const healthCheck = await this.performHealthCheck();
      if (!healthCheck.isHealthy) {
        const errorMsg = `VPN health check failed: ${healthCheck.errorMessage || 'Connection unhealthy'}`;
        
        if (isRequired) {
          throw new Error(errorMsg);
        } else {
          logger.warn(errorMsg);
        }
      }
    }
  }

  private async isVpnConnected(): Promise<boolean> {
    try {
      // In development mode, check for mock state file
      if (config.server.env === 'development') {
        try {
          const { stdout } = await execAsync('ls /tmp/ocean-scraper-vpn-state 2>/dev/null || echo "not found"');
          return !stdout.includes('not found');
        } catch (error) {
          return false;
        }
      }
      
      // In production mode, check if tun0 interface exists and is up
      const { stdout } = await execAsync('ip addr show tun0 2>/dev/null || echo "not found"');
      return stdout.includes('inet') && !stdout.includes('not found');
    } catch (error) {
      return false;
    }
  }

  private async getCurrentPublicIp(): Promise<string> {
    try {
      // In development mode with mock VPN, return Singapore IP when connected
      if (config.server.env === 'development' && await this.isVpnConnected()) {
        return '103.107.198.12'; // Mock Singapore IP
      }
      
      // Try multiple IP detection services for reliability
      const services = [
        'https://ipinfo.io/ip',
        'https://ipapi.co/ip',
        'https://api.ipify.org',
        'https://checkip.amazonaws.com',
      ];

      for (const service of services) {
        try {
          const { stdout } = await execAsync(`curl -s --max-time 5 "${service}"`);
          const ip = stdout.trim();
          
          if (ip && this.isValidIp(ip)) {
            return ip;
          }
        } catch (error) {
          continue; // Try next service
        }
      }

      throw new Error('Failed to get public IP from all services');
    } catch (error) {
      throw new Error(`Failed to get current public IP: ${error}`);
    }
  }

  private async getVpnInterfaceIp(): Promise<string | undefined> {
    try {
      // In development mode, return mock IP
      if (config.server.env === 'development') {
        const { stdout } = await execAsync('cat /tmp/ocean-scraper/tun0-state 2>/dev/null | grep "inet" | awk "{print $2}" | cut -d/ -f1');
        return stdout.trim() || '10.0.0.2';
      }
      
      // In production mode, get real tun0 IP
      const { stdout } = await execAsync('ip addr show tun0 2>/dev/null | grep "inet " | awk "{print $2}" | cut -d/ -f1');
      return stdout.trim() || undefined;
    } catch (error) {
      return undefined;
    }
  }

  private isValidIp(ip: string): boolean {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip);
  }

  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        const healthCheck = await this.performHealthCheck();
        
        if (!healthCheck.isHealthy) {
          logger.warn('VPN health check failed, attempting reconnection', {
            errorMessage: healthCheck.errorMessage,
          });
          
          // Attempt to restart VPN if health check fails
          try {
            await this.restartVpn();
          } catch (error) {
            logger.error('Failed to restart VPN during health check', { error });
          }
        }
      } catch (error) {
        logger.error('Error during VPN health monitoring', { error });
      }
    }, this.healthCheckIntervalMs);

    logger.debug('VPN health monitoring started', { 
      intervalMs: this.healthCheckIntervalMs 
    });
  }

  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.debug('VPN health monitoring stopped');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup(): Promise<void> {
    try {
      this.stopHealthMonitoring();
      
      if (config.vpn.enabled && await this.isVpnConnected()) {
        await this.stopVpn();
      }
    } catch (error) {
      logger.error('Error during VPN service cleanup', { error });
    }
  }

  getStats() {
    return {
      enabled: config.vpn.enabled,
      required: config.vpn.required,
      region: config.vpn.region,
      connected: this.connectionStartTime !== null,
      connectionTime: this.connectionStartTime?.toISOString(),
      healthMonitoring: this.healthCheckInterval !== null,
    };
  }
}

export const vpnService = new VpnService();
export default vpnService;