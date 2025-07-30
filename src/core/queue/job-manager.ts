import { Queue, Worker, Job, QueueOptions, WorkerOptions } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { config } from '@/config';
import redis from '@/utils/redis';
import database from '@/utils/database';
import logger from '@/utils/logger';

export interface JobPayload {
  id: string;
  type: 'scrape' | 'crawl' | 'search';
  url: string;
  options: any;
  formats?: string[];
  apiKeyId?: string;
  priority?: 'high' | 'medium' | 'low';
  retryCount?: number;
  maxRetries?: number;
}

export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  processingTime: number;
  pages?: number;
  urls?: string[];
}

export class JobManager {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private isInitialized = false;

  private queueConfigs = {
    'scrape-queue': {
      priority: 'high',
      concurrency: 10,
      maxRetries: 3,
      backoffType: 'exponential',
      backoffDelay: 2000,
    },
    'crawl-queue': {
      priority: 'medium', 
      concurrency: 3,
      maxRetries: 2,
      backoffType: 'exponential',
      backoffDelay: 5000,
    },
    'search-queue': {
      priority: 'low',
      concurrency: 2,
      maxRetries: 2,
      backoffType: 'exponential',
      backoffDelay: 3000,
    },
  };

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('Initializing job queue system...');

      await redis.connect();

      const redisConnection = {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
      };

      for (const [queueName, queueConfig] of Object.entries(this.queueConfigs)) {
        await this.createQueue(queueName, queueConfig, redisConnection);
        await this.createWorker(queueName, queueConfig, redisConnection);
      }

      await this.setupQueueEvents();
      
      this.isInitialized = true;
      logger.info('Job queue system initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize job queue system', error);
      throw error;
    }
  }

  private async createQueue(
    queueName: string, 
    queueConfig: any, 
    redisConnection: any
  ): Promise<void> {
    const queueOptions: QueueOptions = {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: queueConfig.maxRetries,
        backoff: {
          type: queueConfig.backoffType,
          delay: queueConfig.backoffDelay,
        },
      },
    };

    const queue = new Queue(queueName, queueOptions);
    this.queues.set(queueName, queue);

    logger.debug('Queue created', { queueName, config: queueConfig });
  }

  private async createWorker(
    queueName: string,
    queueConfig: any,
    redisConnection: any
  ): Promise<void> {
    const workerOptions: WorkerOptions = {
      connection: redisConnection,
      concurrency: queueConfig.concurrency,
      maxStalledCount: 3,
      stalledInterval: 30000,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    };

    const worker = new Worker(
      queueName,
      this.getJobProcessor(queueName),
      workerOptions
    );

    this.workers.set(queueName, worker);

    worker.on('completed', this.handleJobCompleted.bind(this));
    worker.on('failed', this.handleJobFailed.bind(this));
    worker.on('progress', (job, progress) => this.handleJobProgress(job, Number(progress)));
    worker.on('stalled', this.handleJobStalled.bind(this));

    logger.debug('Worker created', { queueName, concurrency: queueConfig.concurrency });
  }

  private getJobProcessor(queueName: string) {
    return async (job: Job<JobPayload>): Promise<JobResult> => {
      const startTime = Date.now();
      
      try {
        logger.info('Processing job', { 
          jobId: job.id, 
          queueName, 
          type: job.data.type,
          url: job.data.url 
        });

        await this.updateJobStatus(job.data.id, 'processing', 0);

        let result: JobResult;

        switch (job.data.type) {
          case 'scrape':
            result = await this.processScrapeJob(job);
            break;
          case 'crawl':
            result = await this.processCrawlJob(job);
            break;
          case 'search':
            result = await this.processSearchJob(job);
            break;
          default:
            throw new Error(`Unknown job type: ${job.data.type}`);
        }

        result.processingTime = Date.now() - startTime;

        await this.updateJobStatus(
          job.data.id, 
          result.success ? 'completed' : 'failed',
          100,
          result.success ? result : undefined,
          result.success ? undefined : result.error
        );

        logger.info('Job completed', { 
          jobId: job.id, 
          success: result.success,
          processingTime: result.processingTime 
        });

        return result;

      } catch (error) {
        const processingTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        await this.updateJobStatus(job.data.id, 'failed', 0, undefined, errorMessage);

        logger.error('Job failed', { 
          jobId: job.id, 
          error: errorMessage,
          processingTime 
        });

        throw error;
      }
    };
  }

  async addJob(payload: JobPayload): Promise<string> {
    const jobId = payload.id || uuidv4();
    const queueName = this.getQueueName(payload.type);
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    const priority = this.getPriorityValue(payload.priority || 'medium');
    
    const jobOptions = {
      priority,
      delay: payload.type === 'crawl' ? 1000 : 0, // Small delay for crawl jobs
      jobId,
    };

    try {
      await database.query(
        'INSERT INTO jobs (id, type, status, url, options, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
        [jobId, payload.type, 'pending', payload.url, JSON.stringify(payload.options)]
      );

      await queue.add(payload.type, { ...payload, id: jobId }, jobOptions);

      logger.info('Job added to queue', { 
        jobId, 
        queueName, 
        type: payload.type,
        url: payload.url,
        priority: payload.priority 
      });

      return jobId;

    } catch (error) {
      logger.error('Failed to add job to queue', { error, payload });
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<any> {
    try {
      const result = await database.query(
        'SELECT * FROM jobs WHERE id = $1',
        [jobId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const job = result.rows[0];
      
      const queueName = this.getQueueName(job.type);
      const queue = this.queues.get(queueName);
      
      let queuePosition = null;
      if (queue && job.status === 'pending') {
        const waitingJobs = await queue.getWaiting();
        queuePosition = waitingJobs.findIndex(j => j.id === jobId) + 1;
      }

      return {
        ...job,
        queuePosition: queuePosition && queuePosition > 0 ? queuePosition : null,
      };

    } catch (error) {
      logger.error('Failed to get job status', { error, jobId });
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const jobData = await this.getJobStatus(jobId);
      if (!jobData || jobData.status === 'completed') {
        return false;
      }

      const queueName = this.getQueueName(jobData.type);
      const queue = this.queues.get(queueName);

      if (queue) {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
        }
      }

      await this.updateJobStatus(jobId, 'cancelled');

      logger.info('Job cancelled', { jobId });
      return true;

    } catch (error) {
      logger.error('Failed to cancel job', { error, jobId });
      return false;
    }
  }

  private async updateJobStatus(
    jobId: string,
    status: string,
    progress?: number,
    result?: any,
    errorMessage?: string
  ): Promise<void> {
    try {
      let query = 'UPDATE jobs SET status = $1, updated_at = NOW()';
      const values: any[] = [status];
      let paramCount = 1;

      if (progress !== undefined) {
        query += `, progress = $${++paramCount}`;
        values.push(progress);
      }

      if (result !== undefined) {
        query += `, result = $${++paramCount}`;
        values.push(JSON.stringify(result));
      }

      if (errorMessage !== undefined) {
        query += `, error_message = $${++paramCount}`;
        values.push(errorMessage);
      }

      if (status === 'processing') {
        query += `, started_at = NOW()`;
      }

      if (status === 'completed' || status === 'failed') {
        query += `, completed_at = NOW()`;
      }

      query += ` WHERE id = $${++paramCount}`;
      values.push(jobId);

      await database.query(query, values);

    } catch (error) {
      logger.error('Failed to update job status', { error, jobId, status });
    }
  }

  private getQueueName(jobType: string): string {
    return `${jobType}-queue`;
  }

  private getPriorityValue(priority: string): number {
    const priorities = { high: 1, medium: 2, low: 3 };
    return priorities[priority as keyof typeof priorities] || 2;
  }

  private async setupQueueEvents(): Promise<void> {
    for (const [queueName, queue] of this.queues.entries()) {
      queue.on('waiting', (job) => {
        logger.debug('Job waiting', { queueName, jobId: job.id });
      });

      queue.on('active' as any, (job: any) => {
        logger.debug('Job active', { queueName, jobId: job.id });
      });

      queue.on('error', (error) => {
        logger.error('Queue error', { queueName, error });
      });
    }
  }

  private async handleJobCompleted(job: Job, result: JobResult): Promise<void> {
    logger.info('Job completed successfully', { 
      jobId: job.id, 
      processingTime: result.processingTime 
    });
  }

  private async handleJobFailed(job: Job | undefined, error: Error): Promise<void> {
    if (!job) return;
    
    logger.error('Job failed', { 
      jobId: job.id, 
      error: error.message,
      attemptsMade: job.attemptsMade,
      attemptsOptions: job.opts.attempts 
    });
  }

  private async handleJobProgress(job: Job, progress: number): Promise<void> {
    await this.updateJobStatus(job.data.id, 'processing', progress);
    
    logger.debug('Job progress updated', { 
      jobId: job.id, 
      progress 
    });
  }

  private async handleJobStalled(jobId: string): Promise<void> {
    logger.warn('Job stalled', { jobId });
  }

  private async processScrapeJob(job: Job<JobPayload>): Promise<JobResult> {
    const { scrapingService } = await import('@/core/scraper/scraping-service');
    
    try {
      const result = await scrapingService.scrapePage(
        job.data.url,
        job.data.formats || ['markdown'],
        job.data.options || {}
      );

      return {
        success: true,
        data: result,
        processingTime: result.responseTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown scraping error';
      
      return {
        success: false,
        error: errorMessage,
        processingTime: 0,
      };
    }
  }

  private async processCrawlJob(job: Job<JobPayload>): Promise<JobResult> {
    const { crawlingService } = await import('@/core/scraper/crawling-service');
    
    try {
      logger.info('Starting crawl job processing', {
        jobId: job.data.id,
        url: job.data.url,
        options: job.data.options
      });

      const result = await crawlingService.crawlMultiPage(
        job.data.id,
        job.data.url,
        job.data.options || {},
        // Progress callback to update job progress in real-time
        async (progress) => {
          await job.updateProgress(progress.progress);
          logger.debug('Crawl progress updated', {
            jobId: job.data.id,
            progress: progress.progress,
            currentUrl: progress.currentUrl,
            pagesCrawled: progress.pagesCrawled
          });
        }
      );

      logger.info('Crawl job completed successfully', {
        jobId: job.data.id,
        totalPages: result.totalPages,
        successfulPages: result.successfulPages,
        processingTime: result.totalProcessingTime
      });

      return {
        success: true,
        data: result,
        processingTime: result.totalProcessingTime,
        pages: result.totalPages,
        urls: result.results.map(r => r.url),
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown crawling error';
      
      logger.error('Crawl job failed', {
        jobId: job.data.id,
        url: job.data.url,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage,
        processingTime: 0,
      };
    }
  }

  private async processSearchJob(job: Job<JobPayload>): Promise<JobResult> {
    // TODO: Implement actual search logic
    // This is a placeholder that will be replaced with real search
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate work
    
    return {
      success: true,
      data: {
        query: job.data.url, // In search jobs, 'url' contains the search query
        results: ['result1', 'result2'],
      },
      processingTime: 0,
    };
  }

  async getQueueStats(): Promise<any> {
    const stats: any = {};

    for (const [queueName, queue] of this.queues.entries()) {
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();

      stats[queueName] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        total: waiting.length + active.length,
      };
    }

    return stats;
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up job queue system...');

    for (const worker of this.workers.values()) {
      await worker.close();
    }

    for (const queue of this.queues.values()) {
      await queue.close();
    }

    this.workers.clear();
    this.queues.clear();
    this.isInitialized = false;

    logger.info('Job queue system cleaned up');
  }
}

export const jobManager = new JobManager();
export default jobManager;