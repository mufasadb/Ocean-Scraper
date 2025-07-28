import { Router, Request, Response } from 'express';
import database from '@/utils/database';
import redis from '@/utils/redis';
import jobManager from '@/core/queue/job-manager';
import scrapingService from '@/core/scraper/scraping-service';
import vpnService from '@/core/vpn/vpn-service';
import { config } from '@/config';
import logger from '@/utils/logger';

const router = Router();

router.get('/health', async (req: Request, res: Response) => {
  try {
    const healthChecks = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: false,
        redis: false,
        vpn: false as boolean | string,
      },
    };

    // Check VPN health if enabled
    let vpnHealth = true;
    if (config.vpn.enabled) {
      try {
        const vpnHealthCheck = await vpnService.performHealthCheck();
        vpnHealth = vpnHealthCheck.isHealthy;
      } catch (error) {
        vpnHealth = false;
      }
    }

    const [dbHealth, redisHealth] = await Promise.all([
      database.healthCheck().catch(() => false),
      redis.healthCheck().catch(() => false),
    ]);

    healthChecks.services.database = dbHealth;
    healthChecks.services.redis = redisHealth;
    healthChecks.services.vpn = config.vpn.enabled ? vpnHealth : 'disabled';

    const allServicesHealthy = Object.values(healthChecks.services).every(service => 
      service === true || service === 'disabled'
    );
    
    if (!allServicesHealthy) {
      healthChecks.status = 'degraded';
      logger.warn('Health check - some services are unhealthy', healthChecks.services);
    }

    const statusCode = allServicesHealthy ? 200 : 503;
    
    res.status(statusCode).json({
      success: allServicesHealthy,
      ...healthChecks,
    });
  } catch (error) {
    logger.error('Health check error', error);
    res.status(500).json({
      success: false,
      status: 'error',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/health/ready', async (req: Request, res: Response) => {
  try {
    const [dbHealth, redisHealth] = await Promise.all([
      database.healthCheck(),
      redis.healthCheck(),
    ]);

    if (dbHealth && redisHealth) {
      res.status(200).json({ 
        success: true, 
        ready: true,
        message: 'Service is ready to accept requests' 
      });
    } else {
      res.status(503).json({ 
        success: false, 
        ready: false,
        message: 'Service is not ready',
        services: { database: dbHealth, redis: redisHealth }
      });
    }
  } catch (error) {
    logger.error('Readiness check error', error);
    res.status(503).json({ 
      success: false, 
      ready: false,
      error: 'Readiness check failed' 
    });
  }
});

router.get('/health/live', (req: Request, res: Response) => {
  res.status(200).json({ 
    success: true, 
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

router.get('/health/queues', async (req: Request, res: Response) => {
  try {
    const queueStats = await jobManager.getQueueStats();
    const scrapingStats = await scrapingService.getStats();

    res.json({
      success: true,
      data: {
        queues: queueStats,
        scraping: scrapingStats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Failed to get queue stats', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get queue statistics',
    });
  }
});

export default router;