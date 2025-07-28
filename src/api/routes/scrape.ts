import { Router, Response } from 'express';
import { validate, scrapeSchema } from '@/api/middleware/validation';
import { authenticateApiKey, AuthenticatedRequest } from '@/api/middleware/auth';
import { apiKeyRateLimit } from '@/api/middleware/rateLimiting';
import jobManager from '@/core/queue/job-manager';
import scrapingServiceFactory from '@/core/scraper/scraping-service-factory';
import logger from '@/utils/logger';

const router = Router();

interface ScrapeRequest extends AuthenticatedRequest {
  body: {
    url: string;
    formats?: string[];
    options?: {
      // Legacy options
      waitForSelector?: string;
      waitForTimeout?: number;
      includeContent?: boolean;
      includeMetadata?: boolean;
      excludeTags?: string[];
      customHeaders?: Record<string, string>;
      actions?: Array<{
        type: 'click' | 'fill' | 'scroll' | 'wait' | 'screenshot' | 'hover' | 'key' | 'mouse_move';
        selector?: string;
        value?: string;
        timeout?: number;
        x?: number;
        y?: number;
        key?: string;
        humanLike?: boolean;
      }>;
      
      // Anti-bot options
      enableAntiBot?: boolean;
      maxRetries?: number;
      retryDelay?: number;
      humanBehavior?: {
        enableMouseMovement?: boolean;
        enableRandomScrolling?: boolean;
        enableTypingDelay?: boolean;
        enableReadingPauses?: boolean;
        minReadingTime?: number;
        maxReadingTime?: number;
      };
      captchaHandling?: boolean;
      
      // Additional legacy options
      userAgent?: string;
      viewport?: { width: number; height: number };
      requireVpn?: boolean;
    };
  };
}

router.post(
  '/scrape',
  authenticateApiKey,
  apiKeyRateLimit,
  validate(scrapeSchema),
  async (req: ScrapeRequest, res: Response) => {
    const startTime = Date.now();
    
    try {
      const { url, formats = ['markdown'], options = {} } = req.body;
      const isAsync = req.query.async === 'true';
      
      logger.info('Scrape request started', {
        url,
        formats,
        isAsync,
        apiKey: req.apiKey?.name,
        requestId: req.headers['x-request-id'],
      });

      if (isAsync) {
        const jobId = await jobManager.addJob({
          id: '',
          type: 'scrape',
          url,
          options,
          formats,
          apiKeyId: req.apiKey?.id,
          priority: 'high',
        });

        logger.info('Async scrape job created', { jobId, url });

        res.status(202).json({
          success: true,
          data: {
            jobId,
            status: 'pending',
            url,
            formats,
            options,
            message: 'Scrape job has been queued for processing',
            statusUrl: `/api/v1/scrape/${jobId}`,
          },
        });

      } else {
        // Use unified scraping service factory with anti-bot support
        const unifiedOptions = {
          formats,
          waitForTimeout: options.waitForTimeout,
          includeMetadata: options.includeMetadata,
          excludeTags: options.excludeTags,
          actions: options.actions,
          
          // Anti-bot options
          enableAntiBot: options.enableAntiBot,
          maxRetries: options.maxRetries,
          retryDelay: options.retryDelay,
          humanBehavior: options.humanBehavior,
          captchaHandling: options.captchaHandling,
          
          // Legacy options for backward compatibility
          waitForSelector: options.waitForSelector,
          includeContent: options.includeContent,
          includeLinks: true,
          includeImages: true,
          customHeaders: options.customHeaders,
          userAgent: options.userAgent,
          viewport: options.viewport,
          requireVpn: options.requireVpn
        };

        const result = await scrapingServiceFactory.scrapePage(url, unifiedOptions);

        logger.info('Sync scrape request completed', {
          url,
          processingTime: result.responseTime,
          statusCode: result.statusCode,
          antiBotMode: result.antiBotMode,
          stealthMetrics: result.stealthMetrics,
        });

        res.json({
          success: true,
          data: result,
        });
      }
      
    } catch (error) {
      logger.error('Scrape request failed', {
        url: req.body.url,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        processingTime: Date.now() - startTime,
      });

      res.status(500).json({
        success: false,
        error: 'Scraping failed',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
        processingTime: Date.now() - startTime,
      });
    }
  }
);

router.get(
  '/scrape/:jobId',
  authenticateApiKey,
  apiKeyRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { jobId } = req.params;

      const jobStatus = await jobManager.getJobStatus(jobId);

      if (!jobStatus) {
        return res.status(404).json({
          success: false,
          error: 'Job not found',
          message: `No scrape job found with ID: ${jobId}`,
        });
      }

      logger.info('Scrape job status retrieved', { jobId, status: jobStatus.status });

      res.json({
        success: true,
        data: jobStatus,
      });

    } catch (error) {
      logger.error('Failed to get scrape job status', {
        jobId: req.params.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get job status',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    }
  }
);

export default router;