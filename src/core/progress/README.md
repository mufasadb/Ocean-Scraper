# Progress Tracking System for Ocean Scraper

## Overview

The Ocean Scraper progress tracking system provides comprehensive, real-time monitoring of web crawling operations with full support for MCP (Model Context Protocol) server integration. The system captures detailed progress metrics, outputs structured stdout messages, and enables real-time progress streaming.

## Key Features

### 🎯 **Comprehensive Progress Metrics**
- **Percentage completion** based on pages processed vs. target
- **Current URL** being processed with depth information
- **Page statistics**: successful, failed, and total pages
- **Time estimates**: elapsed time, pages per minute, ETA
- **Queue status**: URLs in queue, discovery progress
- **Error tracking**: failed URLs with detailed error messages

### 📊 **Real-time Updates**
- **Live progress tracking** during crawl execution
- **Smart estimation** based on processing patterns
- **Phase tracking**: discovering, processing, finishing
- **Queue monitoring**: URLs discovered vs. processed

### 🖥️ **MCP Server Integration**
- **Stdout streaming** with structured message format
- **Progress callbacks** for real-time API updates
- **JSON progress reports** for programmatic access
- **Background job monitoring** with cleanup

### 🔄 **Flexible Configuration**
- **Verbosity levels**: minimal, normal, verbose
- **Update intervals**: configurable timing
- **Progress estimation**: smart vs. linear
- **Output formats**: stdout, JSON, callbacks

## System Architecture

```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   Crawling Service  │───▶│   Progress Tracker   │───▶│   MCP Integration   │
│                     │    │                      │    │                     │
│ - Page processing   │    │ - Progress metrics   │    │ - Stdout streaming  │
│ - Link discovery    │    │ - Time estimation    │    │ - JSON reports      │
│ - Error handling    │    │ - Status tracking    │    │ - API endpoints     │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
                                       │                           │
                                       ▼                           ▼
                           ┌──────────────────────┐    ┌─────────────────────┐
                           │     Database         │    │   MCP Server        │
                           │                      │    │                     │
                           │ - Progress storage   │    │ - Real-time updates │
                           │ - Job status         │    │ - Stdout capture    │
                           │ - Result caching     │    │ - Progress queries  │
                           └──────────────────────┘    └─────────────────────┘
```

## Progress Data Structure

```typescript
interface CrawlProgress {
  // Core identification
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
  
  // Status tracking
  status: 'starting' | 'crawling' | 'completed' | 'failed' | 'cancelled';
  phase: 'discovering' | 'processing' | 'finishing';
  
  // Error tracking
  errors: ProgressError[];
  warnings: string[];
}
```

## Usage Examples

### Basic Progress Tracking

```typescript
import { ProgressTracker } from './progress-tracker';

const tracker = new ProgressTracker({
  jobId: 'crawl-123',
  startUrl: 'https://example.com',
  maxPages: 10,
  maxDepth: 2,
  enableStdoutUpdates: true,
  stdoutVerbosity: 'normal'
});

// Start processing a page
tracker.startProcessingPage('https://example.com/page1', 0);

// Mark page as completed with discovered links
tracker.pageCompleted('https://example.com/page1', 5);

// Mark page as failed
tracker.pageFailed('https://example.com/page2', 'Network timeout');

// Mark crawl as completed
tracker.markCompleted();
```

### Enhanced Crawling with Progress

```typescript
import { crawlingService } from '../scraper/crawling-service';

const crawlOptions = {
  maxPages: 15,
  maxDepth: 3,
  enableProgressTracking: true,
  enableStdoutUpdates: true,
  stdoutUpdateInterval: 3000,
  stdoutVerbosity: 'normal'
};

// Start crawl with progress tracking
const result = await crawlingService.crawlMultiPage(
  'job-456',
  'https://docs.example.com',
  crawlOptions,
  // Progress callback
  async (progress) => {
    console.log(`Progress: ${progress.progress}% - ${progress.currentUrl}`);
  }
);
```

### MCP Server Integration

```typescript
import { mcpIntegration } from '../mcp/mcp-integration';

// Start MCP-optimized crawl
const response = await mcpIntegration.startCrawl({
  url: 'https://wiki.example.com',
  max_pages: 20,
  max_depth: 2,
  verbosity: 'verbose',
  formats: ['markdown', 'json']
});

// Stream progress updates
for await (const update of mcpIntegration.streamProgressUpdates(response.job_id)) {
  console.log('MCP Progress Update:', update);
  
  if (update.progress.status === 'completed') {
    break;
  }
}
```

## Stdout Message Format

The system outputs structured messages to stdout that can be easily parsed by MCP servers:

```
[2024-01-15T10:30:00.000Z] CRAWL_PROGRESS | progress | Processing page 3/10: https://example.com/docs
[2024-01-15T10:30:03.000Z] CRAWL_PROGRESS | page_complete | ✅ Completed: https://example.com/docs (4 links found)
[2024-01-15T10:30:05.000Z] CRAWL_PROGRESS | progress | PROGRESS: 30% (3/10) | 12 pages/min | ETA: 2m | Current: https://example.com/guide
[2024-01-15T10:32:15.000Z] CRAWL_PROGRESS | status_change | 🏁 Crawl completed! 9/10 pages successful
```

### Message Types

- **`progress`**: Regular progress updates with percentage and current URL
- **`page_complete`**: Individual page completion with link discovery
- **`error`**: Page processing failures with error details
- **`discovery`**: New URL discovery at different depths
- **`status_change`**: Crawl lifecycle changes (started, completed, failed)

## Configuration Options

### Progress Tracker Options

```typescript
interface ProgressTrackerOptions {
  jobId: string;
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  
  // MCP configuration
  enableStdoutUpdates: boolean;        // Enable stdout output
  stdoutUpdateInterval: number;        // Update frequency (ms)
  stdoutVerbosity: 'minimal' | 'normal' | 'verbose';
  
  // Progress calculation
  useSmartEstimation: boolean;         // Intelligent time estimation
  minPagesForEstimation: number;       // Min pages before estimating
}
```

### Crawl Options with Progress

```typescript
interface CrawlOptions {
  // Standard crawl options
  maxDepth?: number;
  maxPages?: number;
  delayBetweenRequests?: number;
  
  // Enhanced progress tracking
  enableProgressTracking?: boolean;     // Enable progress system
  enableStdoutUpdates?: boolean;        // Output to stdout
  stdoutUpdateInterval?: number;        // Update frequency
  stdoutVerbosity?: 'minimal' | 'normal' | 'verbose';
}
```

## API Integration Points

### REST API Endpoints

The progress system integrates with existing Ocean Scraper API endpoints:

```bash
# Start crawl with progress tracking
POST /api/v1/crawl
{
  "url": "https://example.com",
  "options": {
    "enableProgressTracking": true,
    "enableStdoutUpdates": true,
    "stdoutVerbosity": "normal"
  }
}

# Get progress status
GET /api/v1/crawl/{jobId}
# Returns enhanced progress information

# Cancel crawl
DELETE /api/v1/crawl/{jobId}
# Properly updates progress tracker
```

### Database Integration

Progress data is automatically stored in the existing database schema:

```sql
-- Enhanced job progress tracking
UPDATE jobs SET 
  progress = ?,
  current_url = ?,
  pages_crawled = ?,
  updated_at = NOW()
WHERE id = ?;

-- Redis cache for real-time queries
SETEX progress:{jobId} 3600 '{JSON progress data}'
```

## Performance Considerations

### Memory Management
- **Progress buffers** are size-limited to prevent memory leaks
- **Stdout buffers** keep only recent messages (configurable)
- **Active tracker cleanup** removes completed jobs automatically

### Update Frequency
- **Default intervals**: 3-5 seconds for stdout updates
- **Smart throttling**: Avoid overwhelming stdout in high-frequency scenarios
- **Batch updates**: Combine multiple progress changes efficiently

### Resource Usage
- **Minimal overhead**: Progress tracking adds <5% processing time
- **Efficient storage**: JSON compression for progress data
- **Background processing**: Non-blocking progress updates

## Testing and Development

### Demo Script

Run the comprehensive demo to see the system in action:

```bash
# Start Ocean Scraper service
npm run dev

# Run MCP progress demo
node experimental/tools/mcp-progress-demo.js
```

The demo will:
1. Start a crawl with enhanced progress tracking
2. Monitor real-time progress updates
3. Capture stdout messages (MCP-style)
4. Generate detailed progress logs
5. Show final crawl summary

### Example Output

```
🚀 Starting enhanced crawl: https://en.wikipedia.org/wiki/Web_scraping
✅ Crawl job started: a1b2c3d4-e5f6-7890-abcd-ef1234567890

[2024-01-15T10:30:00.000Z] CRAWL_PROGRESS | progress | Processing page 1/8: https://en.wikipedia.org/wiki/Web_scraping
[2024-01-15T10:30:07.000Z] CRAWL_PROGRESS | page_complete | ✅ Completed: https://en.wikipedia.org/wiki/Web_scraping (12 links found)
[2024-01-15T10:30:10.000Z] CRAWL_PROGRESS | progress | PROGRESS: 12% (1/8) | 8 pages/min | ETA: 4m | Current: https://en.wikipedia.org/wiki/Data_scraping
[2024-01-15T10:32:45.000Z] CRAWL_PROGRESS | status_change | 🏁 Crawl completed! 7/8 pages successful

📊 Final Results:
   • Total pages: 8
   • Successful: 7 (87.5%)
   • Processing time: 2m 45s
   • Links discovered: 47
   • Unique domains: 3
```

## Integration with External Systems

### MCP Server Usage

MCP servers can integrate the progress system by:

1. **Starting crawls** via the MCP integration interface
2. **Capturing stdout** for real-time progress updates
3. **Querying progress** via JSON API endpoints
4. **Streaming updates** using async generators

### Custom Applications

Applications can integrate by:

1. **Using progress callbacks** for real-time UI updates
2. **Subscribing to progress events** via the tracker
3. **Polling progress APIs** for status dashboards
4. **Processing stdout streams** for logging systems

## Future Enhancements

### Planned Features
- **WebSocket streaming** for real-time web dashboards
- **Prometheus metrics** for monitoring integration
- **Progress persistence** across service restarts
- **Multi-crawl dashboards** for batch operations
- **Historical progress analysis** and performance tuning

### Extensibility
The system is designed for easy extension:
- **Custom progress phases** for specialized crawling
- **Additional metrics** for specific use cases
- **Custom stdout formatters** for different systems
- **Progress middleware** for custom processing

This comprehensive progress tracking system makes Ocean Scraper fully compatible with MCP server integration while providing detailed monitoring capabilities for any crawling operation.