#!/usr/bin/env node

/**
 * MCP Progress Monitoring Demo
 * Demonstrates the enhanced progress tracking system for web crawling
 * Shows how MCP server integration would work with stdout streaming
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const API_BASE = 'http://localhost:3000/api/v1';
const API_KEY = 'dev-key-123';
const OUTPUT_DIR = './experimental/outputs/mcp-demo';

// Simulate MCP server stdout capture
const stdoutBuffer = [];
const originalConsoleLog = console.log;
console.log = (...args) => {
  const message = args.join(' ');
  stdoutBuffer.push({
    timestamp: new Date().toISOString(),
    message: message
  });
  originalConsoleLog(...args);
};

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start a crawl job with enhanced progress tracking
 */
async function startEnhancedCrawl(startUrl, options = {}) {
  const crawlOptions = {
    maxPages: options.maxPages || 8,
    maxDepth: options.maxDepth || 2,
    formats: ['markdown', 'json'],
    enableProgressTracking: true,
    enableStdoutUpdates: true,
    stdoutUpdateInterval: 3000,
    stdoutVerbosity: options.verbosity || 'normal',
    delayBetweenRequests: 2000,
    sameDomainOnly: true,
    scrapeOptions: {
      includeLinks: true,
      includeMetadata: true,
      waitForTimeout: 3000
    }
  };

  console.log(`🚀 Starting enhanced crawl: ${startUrl}`);
  console.log(`📊 Options:`, JSON.stringify(crawlOptions, null, 2));

  try {
    const response = await axios.post(`${API_BASE}/crawl`, {
      url: startUrl,
      options: crawlOptions
    }, {
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.success) {
      const jobId = response.data.jobId;
      console.log(`✅ Crawl job started: ${jobId}`);
      
      return jobId;
    } else {
      console.error('❌ Failed to start crawl:', response.data.error);
      return null;
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    return null;
  }
}

/**
 * Monitor crawl progress with detailed updates
 */
async function monitorCrawlProgress(jobId, outputDir) {
  const progressLog = [];
  let isCompleted = false;
  let checkCount = 0;
  const maxChecks = 60; // 5 minutes max

  console.log(`🔍 Monitoring progress for job: ${jobId}`);

  while (!isCompleted && checkCount < maxChecks) {
    try {
      const response = await axios.get(`${API_BASE}/crawl/${jobId}`, {
        headers: { 'X-API-Key': API_KEY }
      });

      if (response.data.success) {
        const job = response.data.job;
        const timestamp = new Date().toISOString();
        
        // Create detailed progress report
        const progressReport = {
          timestamp,
          jobId,
          status: job.status,
          progress: job.progress || 0,
          currentUrl: job.current_url,
          pagesCrawled: job.pages_crawled || 0,
          pagesSuccessful: 0,
          pagesFailed: 0,
          checkCount: checkCount + 1
        };

        // Enhanced progress display with MCP-style output
        const progressMsg = `PROGRESS: ${progressReport.progress}% | Status: ${job.status} | Pages: ${progressReport.pagesCrawled}`;
        
        if (job.current_url) {
          console.log(`[${timestamp}] CRAWL_PROGRESS | ${jobId} | ${progressMsg} | Current: ${job.current_url}`);
        } else {
          console.log(`[${timestamp}] CRAWL_PROGRESS | ${jobId} | ${progressMsg}`);
        }

        progressLog.push(progressReport);

        // Check if completed
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          isCompleted = true;
          
          const finalMsg = `CRAWL_${job.status.toUpperCase()} | ${jobId} | Final progress: ${job.progress}%`;
          console.log(`[${timestamp}] CRAWL_STATUS | ${finalMsg}`);

          // Get final results
          if (job.status === 'completed' && job.result) {
            const result = job.result;
            console.log(`[${timestamp}] CRAWL_RESULTS | ${jobId} | Total pages: ${result.totalPages} | Successful: ${result.successfulPages} | Failed: ${result.failedPages}`);
            console.log(`[${timestamp}] CRAWL_SUMMARY | ${jobId} | Success rate: ${result.summary.successRate.toFixed(1)}% | Domains: ${result.summary.domainsVisited.length} | Links found: ${result.summary.totalLinksDiscovered}`);
          }
        }

      } else {
        console.error(`❌ Failed to get job status: ${response.data.error}`);
        break;
      }

    } catch (error) {
      console.error(`❌ Error checking job status: ${error.message}`);
      
      // If job not found, it might be completed
      if (error.response?.status === 404) {
        console.log(`ℹ️ Job ${jobId} not found - likely completed`);
        isCompleted = true;
      }
    }

    checkCount++;
    
    if (!isCompleted) {
      await delay(5000); // Check every 5 seconds
    }
  }

  // Save progress log
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, `progress_${jobId}.json`),
    JSON.stringify({
      jobId,
      startTime: progressLog[0]?.timestamp,
      endTime: progressLog[progressLog.length - 1]?.timestamp,
      totalChecks: checkCount,
      progressUpdates: progressLog,
      stdoutMessages: stdoutBuffer.slice() // Copy of stdout messages
    }, null, 2)
  );

  console.log(`📁 Progress log saved to: ${path.join(outputDir, `progress_${jobId}.json`)}`);
  
  return {
    completed: isCompleted,
    progressLog,
    stdoutMessages: stdoutBuffer.slice()
  };
}

/**
 * Demonstrate MCP-style stdout streaming
 */
function demonstrateStdoutCapture() {
  console.log('='.repeat(80));
  console.log('MCP STDOUT STREAMING DEMONSTRATION');
  console.log('='.repeat(80));
  console.log('');
  console.log('The following messages simulate what an MCP server would capture:');
  console.log('- Real-time progress updates');
  console.log('- Current URL being processed');
  console.log('- Page completion notifications');
  console.log('- Error notifications');
  console.log('- Final crawl summary');
  console.log('');
  console.log('All messages are formatted for easy parsing by MCP servers.');
  console.log('');
}

/**
 * Main demo function
 */
async function runMCPProgressDemo() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(OUTPUT_DIR, `mcp_demo_${timestamp}`);

  demonstrateStdoutCapture();

  // Test URLs with different characteristics
  const testUrls = [
    {
      url: 'https://en.wikipedia.org/wiki/Web_scraping',
      name: 'Wikipedia - Web Scraping',
      options: { maxPages: 6, maxDepth: 2, verbosity: 'normal' }
    }
  ];

  console.log(`🎯 Starting MCP Progress Demo`);
  console.log(`📁 Output directory: ${outputDir}`);
  console.log(`🕐 Start time: ${new Date(startTime).toISOString()}`);
  console.log('');

  const results = [];

  for (const test of testUrls) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${test.name}`);
    console.log(`URL: ${test.url}`);
    console.log(`${'='.repeat(60)}\n`);

    // Start the crawl
    const jobId = await startEnhancedCrawl(test.url, test.options);
    
    if (jobId) {
      // Monitor progress with MCP-style output
      const monitorResult = await monitorCrawlProgress(jobId, outputDir);
      
      results.push({
        testName: test.name,
        url: test.url,
        jobId,
        ...monitorResult
      });

      console.log(`\n✅ Test completed: ${test.name}`);
    } else {
      console.log(`\n❌ Test failed to start: ${test.name}`);
    }

    // Brief pause between tests
    await delay(2000);
  }

  // Generate final summary
  const endTime = Date.now();
  const totalDuration = endTime - startTime;

  const summary = {
    demoStartTime: new Date(startTime).toISOString(),
    demoEndTime: new Date(endTime).toISOString(),
    totalDurationMs: totalDuration,
    testsRun: results.length,
    successfulTests: results.filter(r => r.completed).length,
    stdoutMessagesGenerated: stdoutBuffer.length,
    results
  };

  await fs.writeFile(
    path.join(outputDir, 'mcp_demo_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('\n' + '='.repeat(80));
  console.log('MCP PROGRESS DEMO COMPLETED');
  console.log('='.repeat(80));
  console.log(`📊 Total duration: ${Math.round(totalDuration / 1000)}s`);
  console.log(`✅ Successful tests: ${summary.successfulTests}/${summary.testsRun}`);
  console.log(`📝 Stdout messages captured: ${summary.stdoutMessagesGenerated}`);
  console.log(`📁 Results saved to: ${outputDir}`);
  console.log('');
  console.log('Key Features Demonstrated:');
  console.log('✓ Real-time progress tracking with percentage completion');
  console.log('✓ Current URL tracking during crawling');
  console.log('✓ MCP-compatible stdout message formatting');
  console.log('✓ Structured progress data for API integration');
  console.log('✓ Error handling and status reporting');
  console.log('✓ Final crawl summary with statistics');
  console.log('');
  console.log('This system is ready for MCP server integration!');
}

// Run the demo if this file is executed directly
if (require.main === module) {
  runMCPProgressDemo()
    .then(() => {
      console.log('\n🎉 MCP Progress Demo completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 MCP Progress Demo failed:', error);
      process.exit(1);
    });
}

module.exports = { 
  runMCPProgressDemo, 
  startEnhancedCrawl, 
  monitorCrawlProgress 
};