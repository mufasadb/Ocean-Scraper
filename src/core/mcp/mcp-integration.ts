/**
 * MCP Server Integration for Ocean Scraper
 * Provides MCP-compatible interface for web crawling with progress streaming
 */

import { crawlingService } from '../scraper/crawling-service';
import { v4 as uuidv4 } from 'uuid';
import logger from '@/utils/logger';

export interface MCPCrawlRequest {
  url: string;
  max_pages?: number;
  max_depth?: number;
  verbosity?: 'minimal' | 'normal' | 'verbose';
  formats?: string[];
  stream_progress?: boolean;
}

export interface MCPCrawlResponse {
  job_id: string;
  status: 'started' | 'error';
  message: string;
  progress_available: boolean;
}

export interface MCPProgressResponse {
  job_id: string;
  timestamp: string;
  progress: {
    percentage: number;
    current_url?: string;
    pages_processed: number;
    pages_successful: number;
    pages_failed: number;
    status: string;
    phase: string;
    estimated_time_remaining?: number;
  };
  stdout_messages?: string[];
}

/**
 * MCP Server Integration Class
 * Handles MCP protocol communication and stdout streaming
 */
export class MCPIntegration {
  private activeCrawls = new Map<string, { startTime: number; stdoutBuffer: string[] }>();

  /**
   * Start a new crawl job optimized for MCP server usage
   */
  async startCrawl(request: MCPCrawlRequest): Promise<MCPCrawlResponse> {
    try {
      const jobId = uuidv4();
      
      logger.info('Starting MCP crawl job', { jobId, request });

      // Validate URL
      try {
        new URL(request.url);
      } catch (error) {
        return {
          job_id: jobId,
          status: 'error',
          message: 'Invalid URL provided',
          progress_available: false
        };
      }

      // Initialize crawl tracking
      this.activeCrawls.set(jobId, {
        startTime: Date.now(),
        stdoutBuffer: []
      });

      // Start the crawl job
      const mcpOptions = {
        maxPages: request.max_pages || 10,
        maxDepth: request.max_depth || 2,
        stdoutVerbosity: request.verbosity || 'normal',
        formats: request.formats || ['markdown', 'json']
      };

      await crawlingService.createMCPCrawlJob(jobId, request.url, mcpOptions);

      // Output initial status to stdout for MCP server
      this.outputToStdout(jobId, `CRAWL_STARTED | ${jobId} | ${request.url} | max_pages=${mcpOptions.maxPages} max_depth=${mcpOptions.maxDepth}`);

      return {
        job_id: jobId,
        status: 'started',
        message: `Crawl job started for ${request.url}`,
        progress_available: true
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to start MCP crawl job', { error: errorMessage, request });

      return {
        job_id: '',
        status: 'error',
        message: `Failed to start crawl: ${errorMessage}`,
        progress_available: false
      };
    }
  }

  /**
   * Get current progress for a crawl job
   */
  async getProgress(jobId: string): Promise<MCPProgressResponse | null> {
    const crawlInfo = this.activeCrawls.get(jobId);
    if (!crawlInfo) {
      return null;
    }

    const detailedProgress = crawlingService.getDetailedProgress(jobId);
    if (!detailedProgress) {
      // Check if job completed and remove from active list
      this.activeCrawls.delete(jobId);
      return null;
    }

    return {
      job_id: jobId,
      timestamp: new Date().toISOString(),
      progress: {
        percentage: detailedProgress.progress.percentage,
        current_url: detailedProgress.current.url,
        pages_processed: detailedProgress.progress.pages_processed,
        pages_successful: detailedProgress.progress.pages_successful,
        pages_failed: detailedProgress.progress.pages_failed,
        status: detailedProgress.status,
        phase: detailedProgress.phase,
        estimated_time_remaining: detailedProgress.performance.estimated_time_remaining_ms
      },
      stdout_messages: crawlInfo.stdoutBuffer.slice(-10) // Last 10 messages
    };
  }

  /**
   * Stream progress updates as they happen
   * This can be used by MCP server to provide real-time updates
   */
  async* streamProgressUpdates(jobId: string): AsyncGenerator<MCPProgressResponse, void, unknown> {
    const crawlInfo = this.activeCrawls.get(jobId);
    if (!crawlInfo) {
      return;
    }

    try {
      for await (const update of crawlingService.streamProgress(jobId)) {
        if (update.error) {
          yield {
            job_id: jobId,
            timestamp: new Date().toISOString(),
            progress: {
              percentage: 0,
              pages_processed: 0,
              pages_successful: 0,
              pages_failed: 0,
              status: 'error',
              phase: 'error'
            },
            stdout_messages: [update.error]
          };
          break;
        }

        const response: MCPProgressResponse = {
          job_id: jobId,
          timestamp: update.timestamp,
          progress: {
            percentage: update.progress.percentage,
            current_url: update.progress.current_url,
            pages_processed: update.progress.pages_processed,
            pages_successful: update.progress.pages_successful,
            pages_failed: update.progress.pages_failed,
            status: update.progress.status,
            phase: update.progress.phase,
            estimated_time_remaining: update.progress.estimated_time_remaining
          },
          stdout_messages: crawlInfo.stdoutBuffer.slice(-5) // Last 5 messages
        };

        // Output progress to stdout for MCP server
        this.outputProgressToStdout(jobId, update.progress);

        yield response;

        // Clean up if final update
        if (update.final) {
          this.activeCrawls.delete(jobId);
          this.outputToStdout(jobId, `CRAWL_COMPLETED | ${update.progress.status} | pages=${update.progress.total_pages} success=${update.progress.successful_pages}`);
          break;
        }
      }
    } catch (error) {
      logger.error('Error streaming progress updates', { jobId, error });
      this.activeCrawls.delete(jobId);
    }
  }

  /**
   * Cancel an active crawl job
   */
  async cancelCrawl(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      const success = await crawlingService.cancelCrawlJob(jobId);
      
      if (success) {
        this.activeCrawls.delete(jobId);
        this.outputToStdout(jobId, `CRAWL_CANCELLED | ${jobId}`);
        
        return {
          success: true,
          message: 'Crawl job cancelled successfully'
        };
      } else {
        return {
          success: false,
          message: 'Crawl job not found or already completed'
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to cancel crawl job', { jobId, error: errorMessage });
      
      return {
        success: false,
        message: `Failed to cancel crawl: ${errorMessage}`
      };
    }
  }

  /**
   * Get list of active crawl jobs
   */
  getActiveCrawls(): string[] {
    return Array.from(this.activeCrawls.keys());
  }

  /**
   * Get crawl summary/results for completed jobs
   */
  async getCrawlResults(jobId: string): Promise<any> {
    try {
      const stats = await crawlingService.getCrawlStats(jobId);
      return stats;
    } catch (error) {
      logger.error('Failed to get crawl results', { jobId, error });
      return null;
    }
  }

  /**
   * Output message to stdout with MCP-compatible formatting
   */
  private outputToStdout(jobId: string, message: string): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] OCEAN_SCRAPER | ${jobId} | ${message}`;
    
    // Output to stdout (will be captured by MCP server)
    console.log(formattedMessage);
    
    // Add to buffer for tracking
    const crawlInfo = this.activeCrawls.get(jobId);
    if (crawlInfo) {
      crawlInfo.stdoutBuffer.push(formattedMessage);
      
      // Keep buffer size manageable
      if (crawlInfo.stdoutBuffer.length > 50) {
        crawlInfo.stdoutBuffer = crawlInfo.stdoutBuffer.slice(-30);
      }
    }
  }

  /**
   * Output progress update to stdout
   */
  private outputProgressToStdout(jobId: string, progress: any): void {
    const progressMsg = `PROGRESS | ${progress.percentage}% | ${progress.pages_processed}/${progress.pages_successful + progress.pages_failed} pages | ${progress.status}`;
    
    if (progress.current_url) {
      this.outputToStdout(jobId, `${progressMsg} | current: ${progress.current_url}`);
    } else {
      this.outputToStdout(jobId, progressMsg);
    }
  }

  /**
   * Health check for MCP server
   */
  getHealthStatus(): { status: string; active_crawls: number; version: string } {
    return {
      status: 'healthy',
      active_crawls: this.activeCrawls.size,
      version: '1.0.0'
    };
  }

  /**
   * Clean up completed crawls (should be called periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [jobId, crawlInfo] of this.activeCrawls.entries()) {
      if (now - crawlInfo.startTime > maxAge) {
        // Check if still active
        const detailedProgress = crawlingService.getDetailedProgress(jobId);
        if (!detailedProgress) {
          this.activeCrawls.delete(jobId);
          logger.info('Cleaned up old crawl tracking', { jobId });
        }
      }
    }
  }
}

export const mcpIntegration = new MCPIntegration();
export default mcpIntegration;