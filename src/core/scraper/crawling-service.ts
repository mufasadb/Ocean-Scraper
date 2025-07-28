import scrapingService, { ScrapeResult, ScrapeOptions } from './scraping-service';
import linkExtractor, { LinkExtractionOptions } from './link-extractor';
import ProgressTracker, { ProgressTrackerOptions } from '../progress/progress-tracker';
import database from '@/utils/database';
import logger from '@/utils/logger';

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  respectRobotsTxt?: boolean;
  delayBetweenRequests?: number;
  formats?: string[];
  sameDomainOnly?: boolean;
  scrapeOptions?: ScrapeOptions;
  
  // Enhanced progress tracking options
  enableProgressTracking?: boolean;
  enableStdoutUpdates?: boolean;
  stdoutUpdateInterval?: number;
  stdoutVerbosity?: 'minimal' | 'normal' | 'verbose';
}

export interface PageResult {
  url: string;
  depth: number;
  pageNumber: number;
  timestamp: string;
  success: boolean;
  error?: string;
  scrapeResult?: ScrapeResult;
  linksFound: number;
  processingTime: number;
}

export interface CrawlResult {
  jobId: string;
  startUrl: string;
  totalPages: number;
  successfulPages: number;
  failedPages: number;
  maxDepth: number;
  maxDepthReached: number;
  totalProcessingTime: number;
  results: PageResult[];
  summary: {
    domainsVisited: string[];
    avgProcessingTimePerPage: number;
    successRate: number;
    totalLinksDiscovered: number;
  };
}

export interface CrawlProgress {
  jobId: string;
  currentUrl: string;
  pagesCrawled: number;
  pagesRemaining: number;
  progress: number;
  currentDepth: number;
  estimatedTimeRemaining?: number;
}

export class CrawlingService {
  private activeTrackers = new Map<string, ProgressTracker>();
  /**
   * Main multi-page crawling function
   */
  async crawlMultiPage(
    jobId: string,
    startUrl: string, 
    options: CrawlOptions = {},
    progressCallback?: (progress: CrawlProgress) => Promise<void>
  ): Promise<CrawlResult> {
    const startTime = Date.now();
    
    // Set defaults
    const crawlOptions = {
      maxDepth: options.maxDepth || 2,
      maxPages: options.maxPages || 10,
      delayBetweenRequests: options.delayBetweenRequests || 1000,
      formats: options.formats || ['markdown'],
      sameDomainOnly: options.sameDomainOnly !== false,
      respectRobotsTxt: options.respectRobotsTxt || false,
      includePatterns: options.includePatterns || [],
      excludePatterns: options.excludePatterns || [],
      enableProgressTracking: options.enableProgressTracking !== false,
      enableStdoutUpdates: options.enableStdoutUpdates || false,
      stdoutUpdateInterval: options.stdoutUpdateInterval || 5000,
      stdoutVerbosity: options.stdoutVerbosity || 'normal',
      scrapeOptions: {
        includeLinks: true,
        includeMetadata: true,
        waitForTimeout: 3000,
        ...options.scrapeOptions
      }
    };

    logger.info('Starting multi-page crawl', {
      jobId,
      startUrl,
      options: crawlOptions
    });

    // Initialize enhanced progress tracker
    let progressTracker: ProgressTracker | null = null;
    if (crawlOptions.enableProgressTracking) {
      const trackerOptions: ProgressTrackerOptions = {
        jobId,
        startUrl,
        maxPages: crawlOptions.maxPages,
        maxDepth: crawlOptions.maxDepth,
        enableStdoutUpdates: crawlOptions.enableStdoutUpdates,
        stdoutUpdateInterval: crawlOptions.stdoutUpdateInterval,
        stdoutVerbosity: crawlOptions.stdoutVerbosity,
        useSmartEstimation: true,
        minPagesForEstimation: 3
      };
      
      progressTracker = new ProgressTracker(trackerOptions);
      this.activeTrackers.set(jobId, progressTracker);

      // Set up progress callback integration
      if (progressCallback) {
        progressTracker.onUpdate(async (update) => {
          const progress = progressTracker!.getProgress();
          await progressCallback({
            jobId,
            currentUrl: progress.currentUrl || '',
            pagesCrawled: progress.pagesProcessed,
            pagesRemaining: progress.maxPages - progress.pagesProcessed,
            progress: progress.progressPercentage,
            currentDepth: progress.currentDepth,
            estimatedTimeRemaining: progress.estimatedTimeRemaining || undefined
          });
        });
      }
    }

    // Initialize crawl state
    const crawled = new Set<string>();
    const toCrawl = [{ url: startUrl, depth: 0 }];
    const results: PageResult[] = [];
    const failedUrls: string[] = [];
    let maxDepthReached = 0;

    // Track domains for summary
    const domainsVisited = new Set<string>();
    let totalLinksDiscovered = 0;

    try {
      // Update job status to processing
      await this.updateJobStatus(jobId, 'processing', 0);

      while (toCrawl.length > 0 && results.length < crawlOptions.maxPages) {
        const { url, depth } = toCrawl.shift()!;
        
        // Skip if already crawled or too deep
        if (crawled.has(url) || depth > crawlOptions.maxDepth) {
          continue;
        }

        crawled.add(url);
        maxDepthReached = Math.max(maxDepthReached, depth);

        // Add domain to tracking
        try {
          domainsVisited.add(new URL(url).hostname);
        } catch (error) {
          logger.warn('Invalid URL for domain tracking', { url });
        }

        // Update progress tracker
        if (progressTracker) {
          progressTracker.startProcessingPage(url, depth);
        }

        // Legacy progress reporting for compatibility
        const progress = Math.round((results.length / crawlOptions.maxPages) * 100);
        if (progressCallback && !progressTracker) {
          const progressData: CrawlProgress = {
            jobId,
            currentUrl: url,
            pagesCrawled: results.length,
            pagesRemaining: crawlOptions.maxPages - results.length,
            progress,
            currentDepth: depth
          };
          await progressCallback(progressData);
        }

        await this.updateJobProgress(jobId, progress, url, results.length);

        const pageStartTime = Date.now();
        const pageNumber = results.length + 1;

        try {
          logger.info('Crawling page', { 
            jobId, 
            url, 
            depth, 
            pageNumber,
            remaining: crawlOptions.maxPages - results.length 
          });

          // Scrape the page using existing scraping service
          const scrapeResult = await scrapingService.scrapePage(
            url,
            crawlOptions.formats,
            crawlOptions.scrapeOptions
          );

          const processingTime = Date.now() - pageStartTime;

          // Extract links for next crawl level
          const discoveredLinks = await this.extractAndFilterLinks(
            scrapeResult,
            url,
            crawlOptions
          );

          totalLinksDiscovered += discoveredLinks.length;

          // Add discovered links to crawl queue for next depth level
          const newUrls: string[] = [];
          if (depth < crawlOptions.maxDepth) {
            for (const link of discoveredLinks) {
              if (!crawled.has(link) && !toCrawl.some(item => item.url === link)) {
                toCrawl.push({ url: link, depth: depth + 1 });
                newUrls.push(link);
              }
            }
          }

          // Update progress tracker with successful completion and discovered URLs
          if (progressTracker) {
            progressTracker.pageCompleted(url, discoveredLinks.length);
            if (newUrls.length > 0) {
              progressTracker.urlsDiscovered(newUrls, depth + 1);
            }
            progressTracker.updateQueueStatus(toCrawl.length);
          }

          // Store page result in database
          await this.storePageResult(jobId, url, depth, scrapeResult, discoveredLinks.length);

          // Add to results
          const pageResult: PageResult = {
            url,
            depth,
            pageNumber,
            timestamp: new Date().toISOString(),
            success: true,
            scrapeResult,
            linksFound: discoveredLinks.length,
            processingTime
          };

          results.push(pageResult);

          logger.info('Page crawled successfully', {
            jobId,
            url,
            depth,
            pageNumber,
            linksFound: discoveredLinks.length,
            processingTime
          });

        } catch (error) {
          const processingTime = Date.now() - pageStartTime;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          logger.error('Failed to crawl page', {
            jobId,
            url,
            depth,
            pageNumber,
            error: errorMessage,
            processingTime
          });

          failedUrls.push(url);

          // Update progress tracker with failure
          if (progressTracker) {
            progressTracker.pageFailed(url, errorMessage);
            progressTracker.updateQueueStatus(toCrawl.length);
          }

          // Store failed page result
          await this.storePageResult(jobId, url, depth, undefined, 0, errorMessage);

          // Add failed page to results
          const pageResult: PageResult = {
            url,
            depth,
            pageNumber,
            timestamp: new Date().toISOString(),
            success: false,
            error: errorMessage,
            linksFound: 0,
            processingTime
          };

          results.push(pageResult);
        }

        // Polite delay between requests
        if (crawlOptions.delayBetweenRequests > 0 && toCrawl.length > 0) {
          await this.delay(crawlOptions.delayBetweenRequests);
        }
      }

      const totalProcessingTime = Date.now() - startTime;
      const successfulPages = results.filter(r => r.success).length;
      const failedPages = results.filter(r => !r.success).length;

      // Create final result
      const crawlResult: CrawlResult = {
        jobId,
        startUrl,
        totalPages: results.length,
        successfulPages,
        failedPages,
        maxDepth: crawlOptions.maxDepth,
        maxDepthReached,
        totalProcessingTime,
        results,
        summary: {
          domainsVisited: Array.from(domainsVisited),
          avgProcessingTimePerPage: results.length > 0 ? 
            results.reduce((sum, r) => sum + r.processingTime, 0) / results.length : 0,
          successRate: results.length > 0 ? (successfulPages / results.length) * 100 : 0,
          totalLinksDiscovered
        }
      };

      // Mark progress tracker as completed
      if (progressTracker) {
        progressTracker.markCompleted();
      }

      // Update job status to completed
      await this.updateJobStatus(jobId, 'completed', 100, crawlResult);

      logger.info('Multi-page crawl completed', {
        jobId,
        startUrl,
        totalPages: results.length,
        successfulPages,
        failedPages,
        maxDepthReached,
        totalProcessingTime,
        successRate: crawlResult.summary.successRate
      });

      return crawlResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown crawl error';
      
      // Mark progress tracker as failed
      if (progressTracker) {
        progressTracker.markFailed(errorMessage);
      }
      
      logger.error('Multi-page crawl failed', {
        jobId,
        startUrl,
        error: errorMessage,
        pagesCrawled: results.length
      });

      await this.updateJobStatus(jobId, 'failed', 0, undefined, errorMessage);
      throw error;
    } finally {
      // Cleanup progress tracker
      if (progressTracker) {
        progressTracker.cleanup();
        this.activeTrackers.delete(jobId);
      }
    }
  }

  /**
   * Extract and filter links from a scraped page
   */
  private async extractAndFilterLinks(
    scrapeResult: ScrapeResult,
    currentUrl: string,
    options: CrawlOptions
  ): Promise<string[]> {
    try {
      if (!scrapeResult.links || scrapeResult.links.length === 0) {
        return [];
      }

      // Extract links using link extractor
      const extractionOptions: LinkExtractionOptions = {
        includePatterns: options.includePatterns,
        excludePatterns: options.excludePatterns,
        sameDomainOnly: options.sameDomainOnly,
        maxLinksPerPage: 20 // Limit links per page to prevent explosion
      };

      let discoveredLinks = linkExtractor.extractLinks(
        scrapeResult.links,
        currentUrl,
        extractionOptions
      );

      // Apply pattern filtering
      discoveredLinks = linkExtractor.filterLinksByPatterns(
        discoveredLinks,
        options.includePatterns,
        options.excludePatterns
      );

      // Deduplicate and normalize
      discoveredLinks = linkExtractor.deduplicateLinks(discoveredLinks);

      // Validate crawlable URLs
      discoveredLinks = discoveredLinks.filter(url => linkExtractor.isValidCrawlUrl(url));

      // Check robots.txt if required
      if (options.respectRobotsTxt) {
        const allowedLinks: string[] = [];
        for (const link of discoveredLinks) {
          const allowed = await linkExtractor.respectsRobotsTxt(link);
          if (allowed) {
            allowedLinks.push(link);
          }
        }
        discoveredLinks = allowedLinks;
      }

      logger.debug('Links extracted and filtered', {
        currentUrl,
        originalLinks: scrapeResult.links.length,
        discoveredLinks: discoveredLinks.length
      });

      return discoveredLinks;

    } catch (error) {
      logger.error('Failed to extract and filter links', {
        currentUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Store page result in database
   */
  private async storePageResult(
    jobId: string,
    url: string,
    depth: number,
    scrapeResult?: ScrapeResult,
    linksFound: number = 0,
    errorMessage?: string
  ): Promise<void> {
    try {
      const statusCode = scrapeResult?.statusCode || (errorMessage ? 0 : 200);
      const title = scrapeResult?.title || null;
      const content = scrapeResult ? JSON.stringify(scrapeResult.content) : null;
      const metadata = scrapeResult?.metadata ? JSON.stringify(scrapeResult.metadata) : null;
      const processingTime = scrapeResult?.responseTime || 0;

      await database.query(`
        INSERT INTO pages (
          job_id, url, title, depth, status_code, content, metadata, 
          links_found, processing_time_ms, scraped_at, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
      `, [
        jobId, url, title, depth, statusCode, content, metadata,
        linksFound, processingTime, errorMessage || null
      ]);

    } catch (error) {
      logger.error('Failed to store page result', {
        jobId,
        url,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Update job status in database
   */
  private async updateJobStatus(
    jobId: string,
    status: string,
    progress: number = 0,
    result?: any,
    errorMessage?: string
  ): Promise<void> {
    try {
      let query = 'UPDATE jobs SET status = $1, progress = $2, updated_at = NOW()';
      const values: any[] = [status, progress];
      let paramCount = 2;

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
      logger.error('Failed to update job status', {
        jobId,
        status,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Update job progress with current crawling info
   */
  private async updateJobProgress(
    jobId: string,
    progress: number,
    currentUrl: string,
    pagesCrawled: number
  ): Promise<void> {
    try {
      await database.query(`
        UPDATE jobs 
        SET progress = $1, 
            current_url = $2, 
            pages_crawled = $3,
            updated_at = NOW() 
        WHERE id = $4
      `, [progress, currentUrl, pagesCrawled, jobId]);

    } catch (error) {
      logger.error('Failed to update job progress', {
        jobId,
        progress,
        currentUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Simple delay utility
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get crawl statistics for monitoring
   */
  async getCrawlStats(jobId: string): Promise<any> {
    try {
      const [jobResult, pagesResult] = await Promise.all([
        database.query('SELECT * FROM jobs WHERE id = $1', [jobId]),
        database.query(`
          SELECT 
            COUNT(*) as total_pages,
            COUNT(CASE WHEN status_code = 200 THEN 1 END) as successful_pages,
            AVG(processing_time_ms) as avg_processing_time,
            MAX(depth) as max_depth_reached,
            SUM(links_found) as total_links_found
          FROM pages 
          WHERE job_id = $1
        `, [jobId])
      ]);

      if (jobResult.rows.length === 0) {
        return null;
      }

      const job = jobResult.rows[0];
      const stats = pagesResult.rows[0];

      return {
        jobId,
        status: job.status,
        progress: job.progress,
        totalPages: parseInt(stats.total_pages),
        successfulPages: parseInt(stats.successful_pages),
        avgProcessingTime: parseFloat(stats.avg_processing_time) || 0,
        maxDepthReached: parseInt(stats.max_depth_reached) || 0,
        totalLinksFound: parseInt(stats.total_links_found) || 0,
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at
      };

    } catch (error) {
      logger.error('Failed to get crawl stats', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get detailed progress information for MCP server integration
   */
  getDetailedProgress(jobId: string): any {
    const tracker = this.activeTrackers.get(jobId);
    if (tracker) {
      return tracker.generateMCPReport();
    }
    return null;
  }

  /**
   * Get list of active crawl jobs
   */
  getActiveJobs(): string[] {
    return Array.from(this.activeTrackers.keys());
  }

  /**
   * Cancel an active crawl job
   */
  async cancelCrawlJob(jobId: string): Promise<boolean> {
    const tracker = this.activeTrackers.get(jobId);
    if (tracker) {
      tracker.markFailed('Cancelled by user');
      tracker.cleanup();
      this.activeTrackers.delete(jobId);
      
      // Update database status
      await this.updateJobStatus(jobId, 'cancelled', 0, undefined, 'Cancelled by user');
      
      logger.info('Crawl job cancelled', { jobId });
      return true;
    }
    return false;
  }

  /**
   * Create a crawl job with MCP-optimized settings
   */
  async createMCPCrawlJob(
    jobId: string,
    startUrl: string,
    mcpOptions: {
      maxPages?: number;
      maxDepth?: number;
      stdoutVerbosity?: 'minimal' | 'normal' | 'verbose';
      formats?: string[];
    } = {}
  ): Promise<string> {
    
    const crawlOptions: CrawlOptions = {
      maxPages: mcpOptions.maxPages || 10,
      maxDepth: mcpOptions.maxDepth || 2,
      enableProgressTracking: true,
      enableStdoutUpdates: true,
      stdoutUpdateInterval: 3000, // Update every 3 seconds for MCP
      stdoutVerbosity: mcpOptions.stdoutVerbosity || 'normal',
      formats: mcpOptions.formats || ['markdown', 'json'],
      delayBetweenRequests: 1500, // Polite crawling
      sameDomainOnly: true,
      scrapeOptions: {
        includeLinks: true,
        includeMetadata: true,
        waitForTimeout: 3000
      }
    };

    // Start the crawl in background
    this.crawlMultiPage(jobId, startUrl, crawlOptions).catch(error => {
      logger.error('MCP crawl job failed', { jobId, startUrl, error: error.message });
    });

    return jobId;
  }

  /**
   * Stream progress updates for MCP server
   * Returns an async generator that yields progress updates
   */
  async* streamProgress(jobId: string): AsyncGenerator<any, void, unknown> {
    const tracker = this.activeTrackers.get(jobId);
    if (!tracker) {
      yield { error: 'Job not found or not active' };
      return;
    }

    let lastUpdate = 0;
    const updateInterval = 2000; // 2 seconds

    while (this.activeTrackers.has(jobId)) {
      const now = Date.now();
      if (now - lastUpdate >= updateInterval) {
        const progress = tracker.getProgress();
        
        yield {
          timestamp: new Date().toISOString(),
          progress: {
            percentage: progress.progressPercentage,
            current_url: progress.currentUrl,
            pages_processed: progress.pagesProcessed,
            pages_successful: progress.pagesSuccessful,
            pages_failed: progress.pagesFailed,
            current_depth: progress.currentDepth,
            estimated_time_remaining: progress.estimatedTimeRemaining,
            status: progress.status,
            phase: progress.phase
          },
          raw_progress: progress
        };
        
        lastUpdate = now;

        // Break if crawl is completed or failed
        if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
          break;
        }
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Final update
    if (tracker) {
      const finalProgress = tracker.getProgress();
      yield {
        timestamp: new Date().toISOString(),
        final: true,
        progress: {
          percentage: finalProgress.progressPercentage,
          status: finalProgress.status,
          total_pages: finalProgress.pagesProcessed,
          successful_pages: finalProgress.pagesSuccessful,
          failed_pages: finalProgress.pagesFailed,
          errors: finalProgress.errors
        }
      };
    }
  }
}

export const crawlingService = new CrawlingService();
export default crawlingService;