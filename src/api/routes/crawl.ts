import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { validate, crawlSchema, jobParamsSchema } from '@/api/middleware/validation';
import { authenticateApiKey, AuthenticatedRequest } from '@/api/middleware/auth';
import { apiKeyRateLimit, heavyOperationLimit } from '@/api/middleware/rateLimiting';
import jobManager from '@/core/queue/job-manager';
import database from '@/utils/database';
import logger from '@/utils/logger';

const router = Router();

interface CrawlRequest extends AuthenticatedRequest {
  body: {
    url: string;
    options?: {
      maxDepth?: number;
      maxPages?: number;
      includePatterns?: string[];
      excludePatterns?: string[];
      respectRobotsTxt?: boolean;
      delayBetweenRequests?: number;
      formats?: string[];
      scrapeOptions?: {
        includeContent?: boolean;
        includeMetadata?: boolean;
        excludeTags?: string[];
      };
    };
  };
}

router.post(
  '/crawl',
  authenticateApiKey,
  apiKeyRateLimit,
  heavyOperationLimit,
  validate(crawlSchema),
  async (req: CrawlRequest, res: Response) => {
    try {
      const { url, options = {} } = req.body;
      const jobId = uuidv4();
      
      logger.info('Crawl request started', {
        jobId,
        url,
        options,
        apiKey: req.apiKey?.name,
      });

      const job = await database.query(
        `INSERT INTO jobs (id, type, status, url, options, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [jobId, 'crawl', 'pending', url, JSON.stringify(options)]
      );

      // Add job to crawl queue for processing
      await jobManager.addJob({
        id: jobId,
        type: 'crawl',
        url,
        options,
        apiKeyId: req.apiKey?.id,
        priority: 'medium'
      });

      logger.info('Crawl job created and queued', { jobId, url, options });

      res.status(202).json({
        success: true,
        data: {
          jobId,
          status: 'pending',
          url,
          options,
          createdAt: job.rows[0].created_at,
          message: 'Crawl job has been queued for processing',
        },
      });

    } catch (error) {
      logger.error('Crawl request failed', {
        url: req.body.url,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create crawl job',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    }
  }
);

router.get(
  '/crawl/:jobId',
  authenticateApiKey,
  apiKeyRateLimit,
  validate(jobParamsSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { jobId } = req.params;

      const jobResult = await database.query(
        'SELECT * FROM jobs WHERE id = $1',
        [jobId]
      );

      if (jobResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Job not found',
          message: `No crawl job found with ID: ${jobId}`,
        });
      }

      const job = jobResult.rows[0];

      const pagesResult = await database.query(
        'SELECT COUNT(*) as total_pages, COUNT(CASE WHEN status_code = 200 THEN 1 END) as successful_pages FROM pages WHERE job_id = $1',
        [jobId]
      );

      const pages = pagesResult.rows[0];

      const result: any = {
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          type: job.type,
          url: job.url,
          options: job.options,
          progress: job.progress,
          totalPages: pages.total_pages,
          successfulPages: pages.successful_pages,
          createdAt: job.created_at,
          updatedAt: job.updated_at,
          startedAt: job.started_at,
          completedAt: job.completed_at,
          errorMessage: job.error_message,
        },
      };

      if (job.status === 'completed') {
        const pagesData = await database.query(
          `SELECT id, url, title, status_code, scraped_at, processing_time_ms, depth, links_found
           FROM pages 
           WHERE job_id = $1 
           ORDER BY scraped_at`,
          [jobId]
        );

        result.data.pages = pagesData.rows;
      }

      res.json(result);

    } catch (error) {
      logger.error('Failed to get crawl job status', {
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

router.delete(
  '/crawl/:jobId',
  authenticateApiKey,
  apiKeyRateLimit,
  validate(jobParamsSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { jobId } = req.params;

      const result = await database.query(
        'UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2 AND status IN ($3, $4) RETURNING *',
        ['cancelled', jobId, 'pending', 'processing']
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Job not found or cannot be cancelled',
          message: 'Job either does not exist or is already completed/failed',
        });
      }

      logger.info('Crawl job cancelled', { jobId });

      res.json({
        success: true,
        message: 'Crawl job has been cancelled',
        data: {
          jobId,
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
        },
      });

    } catch (error) {
      logger.error('Failed to cancel crawl job', {
        jobId: req.params.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to cancel job',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    }
  }
);

export default router;