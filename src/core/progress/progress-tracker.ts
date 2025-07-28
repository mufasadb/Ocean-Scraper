/**
 * Progress Tracking System for Web Crawling Operations
 * Designed for MCP server integration with stdout streaming support
 */

export interface CrawlProgress {
  // Core progress metrics
  jobId: string;
  startUrl: string;
  startTime: number;
  currentTime: number;
  
  // Page tracking
  totalPagesDiscovered: number;
  pagesProcessed: number;
  pagesSuccessful: number;
  pagesFailed: number;
  
  // Current operation
  currentUrl: string | null;
  currentDepth: number;
  currentPageNumber: number;
  
  // Progress calculations
  progressPercentage: number;
  estimatedTimeRemaining: number | null;
  pagesPerMinute: number;
  
  // Queue status
  urlsInQueue: number;
  maxDepth: number;
  maxPages: number;
  
  // Status
  status: 'starting' | 'crawling' | 'paused' | 'completed' | 'failed' | 'cancelled';
  phase: 'discovering' | 'processing' | 'finishing';
  
  // Error tracking
  errors: ProgressError[];
  warnings: string[];
  
  // MCP/stdout specific
  lastStdoutUpdate: number;
  stdoutMessageCount: number;
}

export interface ProgressError {
  url: string;
  error: string;
  timestamp: number;
  depth: number;
}

export interface ProgressUpdate {
  type: 'progress' | 'page_complete' | 'error' | 'status_change' | 'discovery';
  timestamp: number;
  data: any;
  message: string;
  shouldOutputToStdout: boolean;
}

export interface ProgressTrackerOptions {
  jobId: string;
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  
  // MCP configuration
  enableStdoutUpdates: boolean;
  stdoutUpdateInterval: number; // milliseconds
  stdoutVerbosity: 'minimal' | 'normal' | 'verbose';
  
  // Progress calculation
  useSmartEstimation: boolean;
  minPagesForEstimation: number;
}

export class ProgressTracker {
  private progress: CrawlProgress;
  private options: ProgressTrackerOptions;
  private updateListeners: ((update: ProgressUpdate) => void)[] = [];
  private stdoutUpdateTimer: NodeJS.Timeout | null = null;
  
  constructor(options: ProgressTrackerOptions) {
    this.options = options;
    this.progress = this.initializeProgress();
    
    if (options.enableStdoutUpdates) {
      this.startStdoutUpdates();
    }
  }

  private initializeProgress(): CrawlProgress {
    const now = Date.now();
    return {
      jobId: this.options.jobId,
      startUrl: this.options.startUrl,
      startTime: now,
      currentTime: now,
      
      totalPagesDiscovered: 1, // Start URL counts as discovered
      pagesProcessed: 0,
      pagesSuccessful: 0,
      pagesFailed: 0,
      
      currentUrl: null,
      currentDepth: 0,
      currentPageNumber: 0,
      
      progressPercentage: 0,
      estimatedTimeRemaining: null,
      pagesPerMinute: 0,
      
      urlsInQueue: 1,
      maxDepth: this.options.maxDepth,
      maxPages: this.options.maxPages,
      
      status: 'starting',
      phase: 'discovering',
      
      errors: [],
      warnings: [],
      
      lastStdoutUpdate: now,
      stdoutMessageCount: 0
    };
  }

  /**
   * Update progress when starting to process a page
   */
  startProcessingPage(url: string, depth: number): void {
    this.progress.currentUrl = url;
    this.progress.currentDepth = depth;
    this.progress.currentPageNumber++;
    this.progress.currentTime = Date.now();
    this.progress.status = 'crawling';
    this.progress.phase = 'processing';

    this.calculateProgress();
    this.emitUpdate({
      type: 'progress',
      timestamp: this.progress.currentTime,
      data: { url, depth, pageNumber: this.progress.currentPageNumber },
      message: `Processing page ${this.progress.currentPageNumber}/${this.progress.maxPages}: ${url}`,
      shouldOutputToStdout: true
    });
  }

  /**
   * Update progress when a page is successfully processed
   */
  pageCompleted(url: string, linksFound: number = 0): void {
    this.progress.pagesProcessed++;
    this.progress.pagesSuccessful++;
    this.progress.currentTime = Date.now();
    
    if (linksFound > 0) {
      this.progress.totalPagesDiscovered += linksFound;
      this.progress.urlsInQueue += linksFound;
    }

    this.calculateProgress();
    this.emitUpdate({
      type: 'page_complete',
      timestamp: this.progress.currentTime,
      data: { url, linksFound },
      message: `✅ Completed: ${url} (${linksFound} links found)`,
      shouldOutputToStdout: this.options.stdoutVerbosity !== 'minimal'
    });
  }

  /**
   * Update progress when a page fails
   */
  pageFailed(url: string, error: string): void {
    this.progress.pagesProcessed++;
    this.progress.pagesFailed++;
    this.progress.currentTime = Date.now();

    const progressError: ProgressError = {
      url,
      error,
      timestamp: this.progress.currentTime,
      depth: this.progress.currentDepth
    };
    
    this.progress.errors.push(progressError);

    this.calculateProgress();
    this.emitUpdate({
      type: 'error',
      timestamp: this.progress.currentTime,
      data: progressError,
      message: `❌ Failed: ${url} - ${error}`,
      shouldOutputToStdout: true
    });
  }

  /**
   * Update when new URLs are discovered
   */
  urlsDiscovered(urls: string[], depth: number): void {
    const newUrls = urls.length;
    this.progress.totalPagesDiscovered += newUrls;
    this.progress.urlsInQueue += newUrls;
    this.progress.currentTime = Date.now();

    this.emitUpdate({
      type: 'discovery',
      timestamp: this.progress.currentTime,
      data: { urls, depth, count: newUrls },
      message: `🔍 Discovered ${newUrls} new URLs at depth ${depth}`,
      shouldOutputToStdout: this.options.stdoutVerbosity === 'verbose'
    });
  }

  /**
   * Update queue status
   */
  updateQueueStatus(urlsInQueue: number): void {
    this.progress.urlsInQueue = urlsInQueue;
    this.progress.currentTime = Date.now();
    this.calculateProgress();
  }

  /**
   * Calculate progress percentage and time estimates
   */
  private calculateProgress(): void {
    const { pagesProcessed, maxPages, startTime, currentTime } = this.progress;
    
    // Basic percentage based on pages processed vs max pages
    this.progress.progressPercentage = Math.min(
      Math.round((pagesProcessed / maxPages) * 100),
      100
    );

    // Calculate pages per minute
    const elapsedMinutes = (currentTime - startTime) / (1000 * 60);
    if (elapsedMinutes > 0) {
      this.progress.pagesPerMinute = Math.round(pagesProcessed / elapsedMinutes);
    }

    // Estimate time remaining (only if we have enough data)
    if (this.options.useSmartEstimation && 
        pagesProcessed >= this.options.minPagesForEstimation &&
        this.progress.pagesPerMinute > 0) {
      
      const remainingPages = maxPages - pagesProcessed;
      const estimatedMinutes = remainingPages / this.progress.pagesPerMinute;
      this.progress.estimatedTimeRemaining = Math.round(estimatedMinutes * 60 * 1000); // in milliseconds
    }

    // Update phase based on progress
    if (this.progress.progressPercentage >= 95) {
      this.progress.phase = 'finishing';
    } else if (this.progress.urlsInQueue === 0 && pagesProcessed > 0) {
      this.progress.phase = 'finishing';
    } else if (pagesProcessed > 0) {
      this.progress.phase = 'processing';
    } else {
      this.progress.phase = 'discovering';
    }
  }

  /**
   * Mark crawl as completed
   */
  markCompleted(): void {
    this.progress.status = 'completed';
    this.progress.phase = 'finishing';
    this.progress.currentTime = Date.now();
    this.progress.progressPercentage = 100;

    this.emitUpdate({
      type: 'status_change',
      timestamp: this.progress.currentTime,
      data: { status: 'completed' },
      message: `🏁 Crawl completed! ${this.progress.pagesSuccessful}/${this.progress.pagesProcessed} pages successful`,
      shouldOutputToStdout: true
    });

    this.stopStdoutUpdates();
  }

  /**
   * Mark crawl as failed
   */
  markFailed(reason: string): void {
    this.progress.status = 'failed';
    this.progress.currentTime = Date.now();

    this.emitUpdate({
      type: 'status_change',
      timestamp: this.progress.currentTime,
      data: { status: 'failed', reason },
      message: `💥 Crawl failed: ${reason}`,
      shouldOutputToStdout: true
    });

    this.stopStdoutUpdates();
  }

  /**
   * Get current progress snapshot
   */
  getProgress(): CrawlProgress {
    return { ...this.progress };
  }

  /**
   * Add progress update listener
   */
  onUpdate(listener: (update: ProgressUpdate) => void): void {
    this.updateListeners.push(listener);
  }

  /**
   * Remove progress update listener
   */
  removeListener(listener: (update: ProgressUpdate) => void): void {
    const index = this.updateListeners.indexOf(listener);
    if (index > -1) {
      this.updateListeners.splice(index, 1);
    }
  }

  /**
   * Emit progress update to all listeners
   */
  private emitUpdate(update: ProgressUpdate): void {
    // Add to database/redis if needed
    this.updateJobProgress();

    // Emit to listeners
    this.updateListeners.forEach(listener => {
      try {
        listener(update);
      } catch (error) {
        console.error('Progress listener error:', error);
      }
    });

    // Handle stdout output
    if (update.shouldOutputToStdout && this.options.enableStdoutUpdates) {
      this.outputToStdout(update);
    }
  }

  /**
   * Start periodic stdout updates
   */
  private startStdoutUpdates(): void {
    if (this.stdoutUpdateTimer) return;

    this.stdoutUpdateTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.progress.lastStdoutUpdate >= this.options.stdoutUpdateInterval) {
        this.outputProgressSummary();
        this.progress.lastStdoutUpdate = now;
      }
    }, this.options.stdoutUpdateInterval);
  }

  /**
   * Stop periodic stdout updates
   */
  private stopStdoutUpdates(): void {
    if (this.stdoutUpdateTimer) {
      clearInterval(this.stdoutUpdateTimer);
      this.stdoutUpdateTimer = null;
    }
  }

  /**
   * Output formatted message to stdout (MCP compatible)
   */
  private outputToStdout(update: ProgressUpdate): void {
    const timestamp = new Date(update.timestamp).toISOString();
    const prefix = `[${timestamp}] CRAWL_PROGRESS`;
    
    // Format for MCP server stdout parsing
    const message = `${prefix} | ${update.type} | ${update.message}`;
    
    // Output to stdout (will be captured by MCP server)
    console.log(message);
    
    this.progress.stdoutMessageCount++;
  }

  /**
   * Output progress summary to stdout
   */
  private outputProgressSummary(): void {
    const { progressPercentage, pagesProcessed, maxPages, currentUrl, pagesPerMinute, estimatedTimeRemaining } = this.progress;
    
    let timeEstimate = '';
    if (estimatedTimeRemaining) {
      const minutes = Math.round(estimatedTimeRemaining / (1000 * 60));
      timeEstimate = ` | ETA: ${minutes}m`;
    }

    const summary = `PROGRESS: ${progressPercentage}% (${pagesProcessed}/${maxPages}) | ${pagesPerMinute} pages/min${timeEstimate}`;
    
    if (currentUrl) {
      this.outputToStdout({
        type: 'progress',
        timestamp: Date.now(),
        data: this.progress,
        message: `${summary} | Current: ${currentUrl}`,
        shouldOutputToStdout: true
      });
    } else {
      this.outputToStdout({
        type: 'progress',
        timestamp: Date.now(),
        data: this.progress,
        message: summary,
        shouldOutputToStdout: true
      });
    }
  }

  /**
   * Update job progress in database/redis
   */
  private async updateJobProgress(): Promise<void> {
    // This would integrate with the existing job-manager system
    // to store progress in database and Redis for API queries
    try {
      // Update Redis for real-time queries
      const redis = require('@/utils/redis').default;
      await redis.setex(
        `progress:${this.progress.jobId}`,
        3600, // 1 hour TTL
        JSON.stringify(this.progress)
      );

      // Update database
      const database = require('@/utils/database').default;
      await database.query(
        'UPDATE jobs SET progress = $1, updated_at = NOW() WHERE id = $2',
        [this.progress.progressPercentage, this.progress.jobId]
      );

    } catch (error) {
      console.error('Failed to update job progress:', error);
    }
  }

  /**
   * Generate MCP-compatible progress report
   */
  generateMCPReport(): object {
    const runtime = this.progress.currentTime - this.progress.startTime;
    
    return {
      job_id: this.progress.jobId,
      status: this.progress.status,
      phase: this.progress.phase,
      progress: {
        percentage: this.progress.progressPercentage,
        pages_processed: this.progress.pagesProcessed,
        pages_successful: this.progress.pagesSuccessful,
        pages_failed: this.progress.pagesFailed,
        total_pages_limit: this.progress.maxPages,
        pages_discovered: this.progress.totalPagesDiscovered
      },
      performance: {
        runtime_ms: runtime,
        pages_per_minute: this.progress.pagesPerMinute,
        estimated_time_remaining_ms: this.progress.estimatedTimeRemaining
      },
      current: {
        url: this.progress.currentUrl,
        depth: this.progress.currentDepth,
        page_number: this.progress.currentPageNumber
      },
      queue: {
        urls_in_queue: this.progress.urlsInQueue,
        max_depth: this.progress.maxDepth
      },
      errors: this.progress.errors.length,
      last_update: this.progress.currentTime,
      stdout_messages: this.progress.stdoutMessageCount
    };
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stopStdoutUpdates();
    this.updateListeners.length = 0;
  }
}

export default ProgressTracker;