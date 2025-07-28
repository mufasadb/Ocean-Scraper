import { Router } from 'express';
import vpnService from '@/core/vpn/vpn-service';
import { config } from '@/config';
import logger from '@/utils/logger';

const router = Router();

/**
 * Get VPN status
 * GET /api/v1/vpn/status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await vpnService.getVpnStatus();
    const stats = vpnService.getStats();
    
    res.json({
      success: true,
      data: {
        ...status,
        ...stats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Failed to get VPN status', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get VPN status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Perform VPN health check
 * GET /api/v1/vpn/health
 */
router.get('/health', async (req, res) => {
  try {
    const healthCheck = await vpnService.performHealthCheck();
    
    res.json({
      success: true,
      data: {
        ...healthCheck,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('VPN health check failed', { error });
    res.status(500).json({
      success: false,
      error: 'VPN health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Start VPN connection
 * POST /api/v1/vpn/start
 */
router.post('/start', async (req, res) => {
  try {
    if (!config.vpn.enabled) {
      return res.status(400).json({
        success: false,
        error: 'VPN not enabled',
        message: 'VPN is not enabled in configuration. Set VPN_ENABLED=true to enable VPN functionality.',
      });
    }

    const started = await vpnService.startVpn();
    
    if (started) {
      const status = await vpnService.getVpnStatus();
      res.json({
        success: true,
        message: 'VPN started successfully',
        data: status,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to start VPN',
        message: 'VPN connection could not be established',
      });
    }
  } catch (error) {
    logger.error('Failed to start VPN', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to start VPN',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Stop VPN connection
 * POST /api/v1/vpn/stop
 */
router.post('/stop', async (req, res) => {
  try {
    await vpnService.stopVpn();
    
    res.json({
      success: true,
      message: 'VPN stopped successfully',
    });
  } catch (error) {
    logger.error('Failed to stop VPN', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to stop VPN',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Restart VPN connection
 * POST /api/v1/vpn/restart
 */
router.post('/restart', async (req, res) => {
  try {
    if (!config.vpn.enabled) {
      return res.status(400).json({
        success: false,
        error: 'VPN not enabled',
        message: 'VPN is not enabled in configuration',
      });
    }

    const restarted = await vpnService.restartVpn();
    
    if (restarted) {
      const status = await vpnService.getVpnStatus();
      res.json({
        success: true,
        message: 'VPN restarted successfully',
        data: status,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to restart VPN',
        message: 'VPN restart operation failed',
      });
    }
  } catch (error) {
    logger.error('Failed to restart VPN', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to restart VPN',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;