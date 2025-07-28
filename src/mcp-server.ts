#!/usr/bin/env node

/**
 * Ocean-Scraper MCP Server
 * 
 * A Model Context Protocol server for web scraping and crawling operations.
 * Designed for bot integration with comprehensive tool descriptions and flexible output formats.
 * 
 * Features:
 * - Real-time progress updates via stdout
 * - Multiple output formats (Markdown, JSON, HTML, Screenshots, PDF)
 * - Comprehensive crawling with depth control
 * - VPN integration for IP anonymization
 * - Production-ready with extensive error handling
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import database from './utils/database';
import redis from './utils/redis';
import jobManager from './core/queue/job-manager';
import { scrapingService } from './core/scraper/scraping-service';
import { mcpIntegration } from './core/mcp/mcp-integration';
import { v4 as uuidv4 } from 'uuid';

// Initialize the MCP server
const server = new McpServer({
  name: "ocean-scraper",
  version: "1.0.0",
  description: "Production-ready web scraping and crawling service with VPN support"
});

/**
 * TOOL: scrape_page
 * 
 * Scrapes a single web page and extracts content in multiple formats.
 * Perfect for extracting structured data from individual pages.
 * 
 * Use Cases:
 * - Extract article content in Markdown for LLM processing
 * - Get page screenshots for visual analysis
 * - Extract structured data and metadata
 * - Convert web content to clean formats
 * 
 * Input Parameters:
 * - url: Target URL to scrape (required)
 * - formats: Array of output formats (markdown, json, html, screenshot, pdf)
 * - options: Advanced scraping configuration
 * 
 * Output: Immediate response with extracted content in requested formats
 */
server.registerTool(
  "scrape_page",
  {
    title: "Single Page Web Scraper",
    description: "Scrape a single web page and extract content in multiple formats (Markdown, JSON, HTML, Screenshots, PDF). Returns immediate results with comprehensive content extraction and metadata.",
    inputSchema: {
      url: z.string().url().describe("The URL of the web page to scrape. Must be a valid HTTP/HTTPS URL."),
      formats: z.array(z.enum(["markdown", "json", "html", "screenshot", "pdf"]))
        .default(["markdown", "json"])
        .describe("Output formats to generate. Options: 'markdown' (clean text), 'json' (structured data), 'html' (raw HTML), 'screenshot' (PNG image), 'pdf' (full page PDF)"),
      options: z.object({
        wait_for: z.number().optional().describe("Milliseconds to wait for page to load (default: 3000)"),
        include_images: z.boolean().optional().describe("Whether to include image URLs in extraction (default: true)"),
        include_links: z.boolean().optional().describe("Whether to extract and include page links (default: true)"),
        custom_user_agent: z.string().optional().describe("Custom User-Agent string for the request"),
        viewport_width: z.number().optional().describe("Browser viewport width in pixels (default: 1280)"),
        viewport_height: z.number().optional().describe("Browser viewport height in pixels (default: 720)"),
        timeout: z.number().optional().describe("Maximum time to wait for page load in milliseconds (default: 30000)")
      }).optional().describe("Advanced scraping options for customizing the extraction behavior")
    }
  },
  async ({ url, formats, options = {} }) => {
    try {
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | SCRAPE_STARTED | ${url} | formats=${formats.join(',')}`);
      
      const scrapeOptions = {
        waitForTimeout: options.wait_for || 3000,
        includeImages: options.include_images !== false,
        includeLinks: options.include_links !== false,
        userAgent: options.custom_user_agent,
        viewport: {
          width: options.viewport_width || 1280,
          height: options.viewport_height || 720
        }
      };

      const result = await scrapingService.scrapePage(url, formats, scrapeOptions);
      
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | SCRAPE_COMPLETED | ${url} | success=true | title="${result.title}"`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            url,
            title: result.title,
            content: result.content,
            metadata: result.metadata,
            links: result.links,
            processing_time_ms: result.responseTime,
            formats_generated: formats,
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | SCRAPE_FAILED | ${url} | error="${errorMessage}"`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            url,
            error: errorMessage,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: start_crawl
 * 
 * Initiates a multi-page crawling operation with real-time progress tracking.
 * Ideal for extracting content from entire websites or specific sections.
 * 
 * Use Cases:
 * - Crawl documentation sites or blogs
 * - Extract content from product catalogs
 * - Build knowledge bases from websites
 * - Monitor website changes over time
 * 
 * Input Parameters:
 * - start_url: Starting URL for the crawl
 * - max_pages: Maximum number of pages to crawl
 * - max_depth: Maximum link depth to follow
 * - formats: Output formats for each page
 * 
 * Output: Job ID for tracking progress with start_crawl_progress tool
 */
server.registerTool(
  "start_crawl",
  {
    title: "Multi-Page Website Crawler",
    description: "Start crawling multiple pages from a website with configurable depth and page limits. Returns a job ID for tracking real-time progress. Use 'crawl_progress' tool to monitor status and get results.",
    inputSchema: {
      start_url: z.string().url().describe("The starting URL for the crawl. The crawler will begin here and follow internal links."),
      max_pages: z.number().min(1).max(100).default(10).describe("Maximum number of pages to crawl (1-100). Controls crawl scope to prevent runaway operations."),
      max_depth: z.number().min(1).max(5).default(2).describe("Maximum depth of links to follow (1-5). Depth 1 = start page only, depth 2 = start page + direct links, etc."),
      formats: z.array(z.enum(["markdown", "json", "html", "screenshot", "pdf"]))
        .default(["markdown", "json"])
        .describe("Output formats to generate for each crawled page. Multiple formats can be specified."),
      options: z.object({
        delay_between_requests: z.number().optional().describe("Delay between page requests in milliseconds (default: 1000). Be respectful to target servers."),
        include_external_links: z.boolean().optional().describe("Whether to include external domain links in results (default: false)"),
        url_patterns: z.array(z.string()).optional().describe("Array of regex patterns to match URLs. Only matching URLs will be crawled."),
        exclude_patterns: z.array(z.string()).optional().describe("Array of regex patterns to exclude URLs. Matching URLs will be skipped."),
        respect_robots_txt: z.boolean().optional().describe("Whether to respect robots.txt rules (default: true)"),
        custom_user_agent: z.string().optional().describe("Custom User-Agent string for all requests in the crawl")
      }).optional().describe("Advanced crawling configuration options")
    }
  },
  async ({ start_url, max_pages, max_depth, formats, options = {} }) => {
    try {
      const jobId = uuidv4();
      
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | CRAWL_STARTED | ${jobId} | ${start_url} | max_pages=${max_pages} max_depth=${max_depth} formats=${formats.join(',')}`);
      
      const crawlRequest = {
        url: start_url,
        max_pages,
        max_depth,
        formats,
        verbosity: 'normal' as const,
        stream_progress: true,
        delay_between_requests: options.delay_between_requests || 1000,
        include_external_links: options.include_external_links || false,
        url_patterns: options.url_patterns,
        exclude_patterns: options.exclude_patterns,
        respect_robots_txt: options.respect_robots_txt !== false,
        custom_user_agent: options.custom_user_agent
      };

      const response = await mcpIntegration.startCrawl(crawlRequest);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: response.status === 'started',
            job_id: response.job_id,
            status: response.status,
            message: response.message,
            progress_available: response.progress_available,
            start_url,
            max_pages,
            max_depth,
            formats,
            timestamp: new Date().toISOString(),
            note: "Use 'crawl_progress' tool with this job_id to monitor progress and get results"
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | CRAWL_START_FAILED | ${start_url} | error="${errorMessage}"`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            start_url,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: crawl_progress
 * 
 * Check the progress and results of an active or completed crawl job.
 * Provides real-time updates on crawling status and extracted content.
 * 
 * Use Cases:
 * - Monitor crawl progress in real-time
 * - Get partial results as pages are processed
 * - Check for crawl completion and final results
 * - Debug crawl issues and failures
 * 
 * Input Parameters:
 * - job_id: The job ID returned from start_crawl
 * 
 * Output: Current progress, status, and available results
 */
server.registerTool(
  "crawl_progress",
  {
    title: "Crawl Progress Monitor",
    description: "Check the progress and results of a crawling job. Returns real-time status, completion percentage, pages processed, and extracted content for completed pages. Essential for monitoring long-running crawl operations.",
    inputSchema: {
      job_id: z.string().describe("The job ID returned from the 'start_crawl' tool. Used to track and retrieve crawl progress and results.")
    }
  },
  async ({ job_id }) => {
    try {
      const progress = await mcpIntegration.getProgress(job_id);
      
      if (!progress) {
        // Try to get final results from database
        const crawlResults = await mcpIntegration.getCrawlResults(job_id);
        
        if (crawlResults) {
          console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | CRAWL_RESULTS_RETRIEVED | ${job_id} | completed=true`);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                job_id,
                status: "completed",
                message: "Crawl completed successfully",
                results: crawlResults,
                timestamp: new Date().toISOString()
              }, null, 2)
            }]
          };
        } else {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                job_id,
                status: "not_found",
                message: "Job not found. It may have completed and been cleaned up, or the job_id is invalid.",
                timestamp: new Date().toISOString()
              }, null, 2)
            }]
          };
        }
      }

      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | CRAWL_PROGRESS | ${job_id} | ${progress.progress.percentage}% | ${progress.progress.pages_processed} pages | ${progress.progress.status}`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(progress, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | CRAWL_PROGRESS_ERROR | ${job_id} | error="${errorMessage}"`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            job_id,
            status: "error",
            error: errorMessage,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: cancel_crawl
 * 
 * Cancel an active crawling operation.
 * Useful for stopping long-running crawls or freeing up resources.
 * 
 * Use Cases:
 * - Stop runaway crawls
 * - Cancel crawls that are taking too long
 * - Free up system resources
 * - Abort crawls with incorrect parameters
 * 
 * Input Parameters:
 * - job_id: The job ID of the crawl to cancel
 * 
 * Output: Confirmation of cancellation
 */
server.registerTool(
  "cancel_crawl",
  {
    title: "Cancel Crawl Operation",
    description: "Cancel an active crawling job. This will stop the crawl operation, clean up resources, and mark the job as cancelled. Useful for stopping long-running or problematic crawls.",
    inputSchema: {
      job_id: z.string().describe("The job ID of the crawl operation to cancel. This should be the job_id returned from 'start_crawl'.")
    }
  },
  async ({ job_id }) => {
    try {
      const result = await mcpIntegration.cancelCrawl(job_id);
      
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | CRAWL_CANCEL_REQUESTED | ${job_id} | success=${result.success}`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            job_id,
            success: result.success,
            message: result.message,
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | CRAWL_CANCEL_ERROR | ${job_id} | error="${errorMessage}"`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            job_id,
            success: false,
            error: errorMessage,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: list_active_crawls
 * 
 * Get a list of all currently active crawling operations.
 * Useful for monitoring system load and managing multiple crawls.
 * 
 * Use Cases:
 * - Monitor system activity
 * - Check for stuck or long-running crawls
 * - Get overview of current operations
 * - Debug performance issues
 * 
 * Input Parameters: None
 * 
 * Output: List of active crawl job IDs with basic status
 */
server.registerTool(
  "list_active_crawls",
  {
    title: "List Active Crawls",
    description: "Get a list of all currently active crawling operations. Returns job IDs and basic status information for monitoring and management purposes.",
    inputSchema: {}
  },
  async () => {
    try {
      const activeCrawls = mcpIntegration.getActiveCrawls();
      
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | ACTIVE_CRAWLS_LISTED | count=${activeCrawls.length}`);
      
      const crawlDetails = [];
      for (const jobId of activeCrawls) {
        const progress = await mcpIntegration.getProgress(jobId);
        if (progress) {
          crawlDetails.push({
            job_id: jobId,
            status: progress.progress.status,
            percentage: progress.progress.percentage,
            pages_processed: progress.progress.pages_processed,
            current_url: progress.progress.current_url
          });
        }
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            active_crawls_count: activeCrawls.length,
            active_crawls: crawlDetails,
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | LIST_CRAWLS_ERROR | error="${errorMessage}"`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: errorMessage,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

/**
 * TOOL: health_check
 * 
 * Check the health and status of the Ocean Scraper service.
 * Provides information about system readiness and performance.
 * 
 * Use Cases:
 * - Verify service is operational
 * - Check system resources and capacity
 * - Monitor service health
 * - Debug connectivity issues
 * 
 * Input Parameters: None
 * 
 * Output: System health status and metrics
 */
server.registerTool(
  "health_check",
  {
    title: "Service Health Check",
    description: "Check the health and operational status of the Ocean Scraper service. Returns information about database connectivity, queue status, browser availability, and system metrics.",
    inputSchema: {}
  },
  async () => {
    try {
      const health = mcpIntegration.getHealthStatus();
      
      // Additional health checks
      const dbHealthy = await database.healthCheck();
      const redisHealthy = redis.isConnected();
      const queueStats = await jobManager.getQueueStats();
      
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | HEALTH_CHECK | status=${health.status} | db=${dbHealthy} | redis=${redisHealthy}`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            service: health,
            database: {
              connected: dbHealthy,
              status: dbHealthy ? 'healthy' : 'unhealthy'
            },
            redis: {
              connected: redisHealthy,
              status: redisHealthy ? 'healthy' : 'unhealthy'
            },
            queue: queueStats,
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | HEALTH_CHECK_ERROR | error="${errorMessage}"`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: 'unhealthy',
            error: errorMessage,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

/**
 * Initialize the MCP server and connect to stdio transport
 */
async function main() {
  try {
    // Initialize stdout logging for MCP server
    console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_STARTING | version=1.0.0`);
    
    // Connect to dependencies
    await redis.connect();
    const dbHealthy = await database.healthCheck();
    if (!dbHealthy) {
      throw new Error('Database connection failed');
    }
    await jobManager.initialize();
    
    console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | DEPENDENCIES_READY | redis=connected | db=connected | queues=initialized`);
    
    // Connect to MCP transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_READY | tools_registered=6 | transport=stdio`);
    
    // Periodic cleanup
    setInterval(() => {
      mcpIntegration.cleanup();
    }, 60000); // Clean up every minute
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_ERROR | error="${error instanceof Error ? error.message : 'Unknown error'}"`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_STOPPING | signal=SIGINT`);
  try {
    await jobManager.cleanup();
    await redis.disconnect();
    await database.close();
    console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_STOPPED | cleanup=success`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_STOP_ERROR | error="${error instanceof Error ? error.message : 'Unknown error'}"`);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_STOPPING | signal=SIGTERM`);
  try {
    await jobManager.cleanup();
    await redis.disconnect();
    await database.close();
    console.log(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_STOPPED | cleanup=success`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_STOP_ERROR | error="${error instanceof Error ? error.message : 'Unknown error'}"`);
  }
  process.exit(0);
});

// Start the server
if (require.main === module) {
  main().catch(error => {
    console.error(`[${new Date().toISOString()}] OCEAN_SCRAPER | MCP_SERVER_FATAL | error="${error instanceof Error ? error.message : 'Unknown error'}"`);
    process.exit(1);
  });
}

export default server;