# Ocean-Scraper MCP Server

## Overview

Ocean-Scraper MCP Server is a Model Context Protocol (MCP) server that provides comprehensive web scraping and crawling capabilities for AI bots and applications. It offers production-ready web scraping with real-time progress updates, multiple output formats, and advanced features like VPN integration.

## Features

### ✅ Production-Ready Capabilities
- **Multi-format output**: Markdown, JSON, HTML, Screenshots, PDF
- **Real-time progress tracking** via stdout for long-running operations
- **VPN integration** with Private Internet Access for IP anonymization
- **Anti-bot evasion** with stealth mode and CAPTCHA solving
- **Comprehensive error handling** with detailed error messages
- **Resource management** with automatic cleanup and limits

### 🔧 MCP Tools Available

#### 1. `scrape_page` - Single Page Scraper
**Purpose**: Extract content from a single web page in multiple formats.

**Input Parameters**:
- `url` (required): Target URL to scrape
- `formats` (optional): Array of output formats ["markdown", "json", "html", "screenshot", "pdf"]
- `options` (optional): Advanced configuration object

**Use Cases**:
- Extract article content for LLM processing
- Get page screenshots for visual analysis
- Convert web content to clean Markdown
- Extract structured data and metadata

**Example Usage**:
```json
{
  "url": "https://en.wikipedia.org/wiki/Artificial_intelligence",
  "formats": ["markdown", "json", "screenshot"],
  "options": {
    "wait_for": 3000,
    "include_images": true,
    "viewport_width": 1280,
    "viewport_height": 720
  }
}
```

#### 2. `start_crawl` - Multi-Page Crawler
**Purpose**: Initiate crawling of multiple pages with configurable depth and limits.

**Input Parameters**:
- `start_url` (required): Starting URL for the crawl
- `max_pages` (optional): Maximum pages to crawl (1-100, default: 10)
- `max_depth` (optional): Maximum link depth (1-5, default: 2)
- `formats` (optional): Output formats for each page
- `options` (optional): Advanced crawling configuration

**Use Cases**:
- Crawl documentation sites or blogs
- Extract content from product catalogs
- Build knowledge bases from websites
- Monitor website changes over time

**Example Usage**:
```json
{
  "start_url": "https://docs.example.com",
  "max_pages": 25,
  "max_depth": 3,
  "formats": ["markdown", "json"],
  "options": {
    "delay_between_requests": 2000,
    "respect_robots_txt": true,
    "url_patterns": [".*\\/docs\\/.*"]
  }
}
```

#### 3. `crawl_progress` - Progress Monitor
**Purpose**: Check progress and results of crawling operations.

**Input Parameters**:
- `job_id` (required): Job ID returned from `start_crawl`

**Use Cases**:
- Monitor crawl progress in real-time
- Get partial results as pages are processed
- Check for crawl completion
- Debug crawl issues

#### 4. `cancel_crawl` - Cancel Operation
**Purpose**: Cancel active crawling operations.

**Input Parameters**:
- `job_id` (required): Job ID to cancel

**Use Cases**:
- Stop runaway crawls
- Cancel incorrect operations
- Free up system resources

#### 5. `list_active_crawls` - Monitor Active Operations
**Purpose**: List all currently active crawling operations.

**Use Cases**:
- Monitor system activity
- Check for stuck operations
- System administration

#### 6. `health_check` - System Health
**Purpose**: Check service health and system status.

**Use Cases**:
- Verify service is operational
- Check system resources
- Debug connectivity issues

## Real-Time Progress Updates

The MCP server provides real-time progress updates via stdout for all operations:

### Stdout Message Format
```
[TIMESTAMP] OCEAN_SCRAPER | EVENT_TYPE | JOB_ID | DETAILS
```

### Event Types
- `SCRAPE_STARTED` - Single page scrape begins
- `SCRAPE_COMPLETED` - Single page scrape finishes
- `SCRAPE_FAILED` - Single page scrape fails
- `CRAWL_STARTED` - Multi-page crawl begins
- `CRAWL_PROGRESS` - Crawl progress update
- `CRAWL_COMPLETED` - Multi-page crawl finishes
- `CRAWL_CANCELLED` - Crawl operation cancelled
- `MCP_SERVER_READY` - Server initialization complete

### Example Progress Output
```
[2024-01-15T10:30:00.000Z] OCEAN_SCRAPER | CRAWL_STARTED | abc123 | https://example.com | max_pages=10 max_depth=2
[2024-01-15T10:30:02.000Z] OCEAN_SCRAPER | PROGRESS | 20% | 2/10 pages | processing | current: https://example.com/about
[2024-01-15T10:30:05.000Z] OCEAN_SCRAPER | PROGRESS | 50% | 5/10 pages | processing | current: https://example.com/contact
[2024-01-15T10:30:08.000Z] OCEAN_SCRAPER | CRAWL_COMPLETED | success | pages=8 success=8
```

## Installation & Setup

### Prerequisites
- Node.js 18+ 
- Docker and Docker Compose
- PostgreSQL (or use Docker)
- Redis (or use Docker)

### Quick Start with Docker

1. **Clone and setup environment**:
```bash
git clone <repository>
cd ocean-scraper
cp .env.example .env
# Edit .env with your configuration
```

2. **Start services**:
```bash
docker-compose -f docker/docker-compose.mcp.yml up -d
```

3. **Test MCP server**:
```bash
echo '{"method":"tools/list","jsonrpc":"2.0","id":1}' | docker exec -i ocean-mcp-server node dist/mcp-server.js
```

### Local Development Setup

1. **Install dependencies**:
```bash
npm install
npx playwright install
```

2. **Start infrastructure**:
```bash
docker-compose -f docker/docker-compose.dev.yml up -d
```

3. **Run MCP server**:
```bash
npm run mcp:server
```

### Production Deployment

1. **Set environment variables**:
```bash
export POSTGRES_PASSWORD="secure_production_password"
export REDIS_PASSWORD="secure_redis_password"
export PIA_USERNAME="your_pia_username"  # Optional for VPN
export PIA_PASSWORD="your_pia_password"  # Optional for VPN
export VPN_ENABLED="true"  # Optional for VPN
```

2. **Deploy with Docker**:
```bash
docker-compose -f docker/docker-compose.mcp.yml up -d
```

3. **Verify deployment**:
```bash
docker-compose -f docker/docker-compose.mcp.yml ps
docker-compose -f docker/docker-compose.mcp.yml logs ocean-mcp-server
```

## Configuration

### Environment Variables

#### Core Configuration
- `NODE_ENV` - Environment (development/production)
- `POSTGRES_HOST` - Database host
- `POSTGRES_USER` - Database user
- `POSTGRES_PASSWORD` - Database password
- `REDIS_HOST` - Redis host
- `REDIS_PASSWORD` - Redis password (optional)

#### Scraping Configuration
- `MAX_BROWSER_INSTANCES` - Browser pool size (default: 3)
- `BROWSER_TIMEOUT` - Browser timeout in ms (default: 30000)
- `BROWSER_HEADLESS` - Run browsers headless (default: true)
- `MAX_CRAWL_DEPTH` - Maximum crawl depth (default: 3)
- `MAX_PAGES_PER_CRAWL` - Maximum pages per crawl (default: 100)
- `REQUEST_DELAY_MS` - Delay between requests (default: 1000)

#### VPN Configuration (Optional)
- `VPN_ENABLED` - Enable VPN integration (default: false)
- `VPN_REQUIRED` - Require VPN for operations (default: false)
- `PIA_USERNAME` - Private Internet Access username
- `PIA_PASSWORD` - Private Internet Access password
- `PIA_REGION` - PIA server region (default: us-east)

#### Anti-Bot Configuration
- `ANTI_BOT_ENABLED` - Enable anti-bot evasion (default: true)
- `STEALTH_MODE` - Enable stealth mode (default: true)
- `CAPTCHA_SOLVING` - Enable CAPTCHA solving (default: true)
- `CAPTCHA_API_KEY` - 2Captcha API key (optional)

## Output Formats

### Markdown
- Clean, LLM-friendly text format
- Preserves structure (headings, lists, links)
- Removes ads and navigation elements
- Perfect for AI processing

### JSON
- Structured data format
- Includes metadata, links, and extracted content
- Programmatically parseable
- Contains page title, description, language

### HTML
- Raw or cleaned HTML content
- Preserves original formatting
- Useful for analysis or re-processing

### Screenshot
- Full-page PNG images
- Configurable viewport size
- High-quality captures
- Useful for visual analysis

### PDF
- Complete page exports
- Print-friendly format
- Includes all visual elements
- Professional document format

## Advanced Features

### VPN Integration
- Automatic IP rotation via Private Internet Access
- Multiple global server locations
- Transparent proxy for all requests
- IP anonymization for sensitive scraping

### Anti-Bot Evasion
- Stealth mode with browser fingerprint randomization
- Human-like behavior simulation
- CAPTCHA detection and solving
- Automatic retry with different strategies

### Error Handling
- Comprehensive error reporting with context
- Automatic retries with exponential backoff
- Graceful degradation for partial failures
- Detailed logging for debugging

### Resource Management
- Browser instance pooling and reuse
- Automatic cleanup of old resources
- Memory usage monitoring
- Configurable limits and timeouts

## Integration Examples

### Using with Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "ocean-scraper": {
      "command": "docker",
      "args": [
        "exec", "-i", "ocean-mcp-server", 
        "node", "dist/mcp-server.js"
      ]
    }
  }
}
```

### Using with Python MCP Client

```python
from mcp_client import Client
import asyncio

async def scrape_example():
    client = Client()
    await client.connect("docker exec -i ocean-mcp-server node dist/mcp-server.js")
    
    # Scrape a single page
    result = await client.call_tool("scrape_page", {
        "url": "https://example.com",
        "formats": ["markdown", "json"]
    })
    
    print(result)
    await client.disconnect()

asyncio.run(scrape_example())
```

### Using with Node.js MCP Client

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "docker",
  args: ["exec", "-i", "ocean-mcp-server", "node", "dist/mcp-server.js"]
});

const client = new Client({ name: "scraper-client", version: "1.0.0" });
await client.connect(transport);

// Start a crawl
const crawlResult = await client.callTool({
  name: "start_crawl",
  arguments: {
    start_url: "https://docs.example.com",
    max_pages: 20,
    formats: ["markdown"]
  }
});

console.log(crawlResult);
```

## Monitoring & Debugging

### Health Monitoring
```bash
# Check service health
echo '{"method":"tools/call","params":{"name":"health_check","arguments":{}},"jsonrpc":"2.0","id":1}' | \
  docker exec -i ocean-mcp-server node dist/mcp-server.js

# Monitor logs
docker-compose -f docker/docker-compose.mcp.yml logs -f ocean-mcp-server

# Check active crawls
echo '{"method":"tools/call","params":{"name":"list_active_crawls","arguments":{}},"jsonrpc":"2.0","id":1}' | \
  docker exec -i ocean-mcp-server node dist/mcp-server.js
```

### Performance Tuning

#### Browser Pool Optimization
- Increase `MAX_BROWSER_INSTANCES` for higher concurrency
- Adjust `BROWSER_TIMEOUT` based on target sites
- Enable `BROWSER_HEADLESS=false` for debugging only

#### Memory Management
- Monitor container memory usage
- Adjust Redis `maxmemory` setting
- Use `docker stats` to monitor resource usage

#### Network Optimization
- Increase `REQUEST_DELAY_MS` for respectful crawling
- Use VPN for rate limit avoidance
- Configure appropriate timeouts

## Troubleshooting

### Common Issues

#### Browser Launch Failures
```bash
# Check browser installation
docker exec ocean-mcp-server chromium-browser --version

# Check permissions
docker exec ocean-mcp-server ls -la /usr/bin/chromium-browser
```

#### Database Connection Issues
```bash
# Check database health
docker-compose -f docker/docker-compose.mcp.yml exec postgres pg_isready -U ocean_user

# Check network connectivity
docker-compose -f docker/docker-compose.mcp.yml exec ocean-mcp-server nc -zv postgres 5432
```

#### Redis Connection Issues
```bash
# Check Redis health
docker-compose -f docker/docker-compose.mcp.yml exec redis redis-cli ping

# Check network connectivity
docker-compose -f docker/docker-compose.mcp.yml exec ocean-mcp-server nc -zv redis 6379
```

### Debug Mode

Enable debug logging:
```bash
export LOG_LEVEL=debug
docker-compose -f docker/docker-compose.mcp.yml --profile debug up -d
```

Access Redis Commander for queue inspection:
```
http://localhost:8081
```

## Security Considerations

### Container Security
- Runs as non-root user (`ocean`)
- Minimal base image (Alpine Linux)
- No unnecessary network exposure
- Resource limits and health checks

### VPN Security
- All traffic routed through VPN when enabled
- Automatic IP rotation
- DNS leak protection
- Certificate validation

### Data Security
- No sensitive data logging
- Secure environment variable handling
- Database connection encryption
- API key validation

## Support & Contribution

### Getting Help
- Check the troubleshooting section
- Review logs with `LOG_LEVEL=debug`
- Create GitHub issues for bugs
- Join community discussions

### Contributing
- Follow the existing code style
- Add tests for new features
- Update documentation
- Submit pull requests

### Roadmap
- [ ] Enhanced anti-bot capabilities
- [ ] More output formats (XML, CSV)
- [ ] Distributed crawling support
- [ ] Advanced scheduling features
- [ ] Webhook notifications
- [ ] Custom JavaScript execution

## License

MIT License - see LICENSE file for details.

---

**Ocean-Scraper MCP Server** - Production-ready web scraping for AI applications.