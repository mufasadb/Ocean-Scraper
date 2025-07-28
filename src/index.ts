import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '@/config';
import logger from '@/utils/logger';
import database from '@/utils/database';
import redis from '@/utils/redis';
import jobManager from '@/core/queue/job-manager';
import vpnService from '@/core/vpn/vpn-service';
import { globalRateLimit } from '@/api/middleware/rateLimiting';

import healthRoutes from '@/api/routes/health';
import scrapeRoutes from '@/api/routes/scrape';
import crawlRoutes from '@/api/routes/crawl';
import testRoutes from '@/api/routes/test';
import vpnRoutes from '@/api/routes/vpn';

const app = express();

app.use(helmet());
app.use(cors({
  origin: config.server.corsOrigin,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(globalRateLimit);

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  
  logger.info('Request received', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId,
  });
  
  next();
});

app.use('/api/v1', healthRoutes);
app.use('/api/v1', scrapeRoutes);
app.use('/api/v1', crawlRoutes);
app.use('/api/v1', testRoutes);
app.use('/api/v1/vpn', vpnRoutes);

app.get('/', (req, res) => {
  res.json({
    name: 'Ocean Scraper',
    version: '1.0.0',
    description: 'FireCrawl-like web crawler service with VPN support',
    endpoints: {
      health: '/api/v1/health',
      scrape: 'POST /api/v1/scrape',
      crawl: 'POST /api/v1/crawl',
      crawlStatus: 'GET /api/v1/crawl/:jobId',
      vpnStatus: 'GET /api/v1/vpn/status',
      vpnHealth: 'GET /api/v1/vpn/health',
    },
    documentation: '/api/v1/docs',
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
  });
});

app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    requestId: req.headers['x-request-id'],
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: config.server.env === 'development' ? error.message : 'An unexpected error occurred',
    requestId: req.headers['x-request-id'],
  });
});

async function startServer() {
  try {
    logger.info('Starting Ocean Scraper service...');

    await redis.connect();
    logger.info('Connected to Redis');

    try {
      const dbHealth = await database.healthCheck();
      if (dbHealth) {
        logger.info('Connected to PostgreSQL database');
      } else {
        logger.warn('Database health check failed, but continuing...');
      }
    } catch (error) {
      logger.warn('Database connection issue, but continuing...', error);
    }

    await jobManager.initialize();
    logger.info('Job queue system initialized');

    const server = app.listen(config.server.port, () => {
      logger.info(`Ocean Scraper started successfully`, {
        port: config.server.port,
        environment: config.server.env,
        vpnEnabled: config.vpn.enabled,
      });
    });

    const gracefulShutdown = (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      server.close(async () => {
        try {
          await jobManager.cleanup();
          await vpnService.cleanup();
          await redis.disconnect();
          await database.close();
          logger.info('Ocean Scraper shut down successfully');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown', error);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start Ocean Scraper', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

export default app;