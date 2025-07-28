# API Layer - Vertical Slice Technical Implementation

## Overview
The API layer handles all HTTP interactions, implementing a complete middleware pipeline for authentication, validation, rate limiting, and routing. This layer serves as the entry point for all web scraping operations.

## Architecture Pattern
```
HTTP Request → Middleware Pipeline → Route Handler → Core Services → HTTP Response
```

## Directory Structure
```
src/api/
├── routes/                 # Feature-specific route handlers
│   ├── health.ts          # System health monitoring
│   ├── scrape.ts          # Single-page scraping operations
│   ├── crawl.ts           # Multi-page crawling operations
│   └── test.ts            # Unauthenticated testing endpoints
└── middleware/            # Cross-cutting concerns
    ├── auth.ts            # API key authentication
    ├── validation.ts      # Request validation with Joi
    └── rateLimiting.ts    # Rate limiting per API key
```

## Middleware Pipeline

### 1. Authentication (`middleware/auth.ts`)
**Purpose**: API key validation and user context injection

**Implementation**:
- Database lookup for API key validation
- Rate limit information attachment
- User context injection into request object
- Secure key hashing verification

**Flow**:
```typescript
Request → Extract X-API-Key header → Database lookup → Attach user context → Next()
```

**Key Features**:
- Database-backed API key storage
- Automatic rate limit information loading
- Secure SHA-256 key hashing
- Development key (`dev-key-123`) for testing

### 2. Validation (`middleware/validation.ts`)
**Purpose**: Request schema validation using Joi

**Schemas**:
- `scrapeSchema`: Single page scraping parameters
- `crawlSchema`: Multi-page crawling parameters  
- `jobParamsSchema`: Job ID parameter validation

**Implementation**:
```typescript
// Example scrape schema
{
  url: Joi.string().uri().required(),
  formats: Joi.array().items(Joi.string().valid('markdown', 'html', 'json', 'screenshot', 'pdf')),
  options: Joi.object({
    waitForTimeout: Joi.number().min(1000).max(30000),
    includeMetadata: Joi.boolean(),
    excludeTags: Joi.array().items(Joi.string())
  })
}
```

### 3. Rate Limiting (`middleware/rateLimiting.ts`)
**Purpose**: API usage throttling and abuse prevention

**Implementation**:
- Per-API-key rate limiting using Redis
- Global rate limiting for system protection
- Heavy operation limits for resource-intensive requests
- Configurable limits per API key in database

**Rate Limit Types**:
- `apiKeyRateLimit`: Per-user rate limiting
- `globalRateLimit`: System-wide protection  
- `heavyOperationLimit`: Special limits for crawling/large jobs

## Route Handlers

### Health Routes (`routes/health.ts`)
**Endpoints**:
- `GET /api/v1/health` - Basic system health
- `GET /api/v1/health/queues` - Job queue statistics

**Implementation**:
- Database connectivity checks
- Redis connectivity validation
- Browser pool health monitoring
- Queue statistics (pending, processing, completed jobs)

**Response Format**:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-01-01T00:00:00Z",
    "services": {
      "database": "connected",
      "redis": "connected", 
      "browser": "3/5 instances active"
    }
  }
}
```

### Scraping Routes (`routes/scrape.ts`)
**Endpoints**:
- `POST /api/v1/scrape` - Single page scraping (sync/async)
- `GET /api/v1/scrape/:jobId` - Async job status

**Key Features**:
- Synchronous and asynchronous processing modes
- Multiple output format support
- Custom browser actions (click, fill, wait)
- Progress tracking for async jobs

**Request Flow**:
```
POST /scrape → Validation → Auth → Rate Limit → ScrapingService → Response
```

**Async Mode**:
```
POST /scrape?async=true → Job Creation → Queue → JobId Response
GET /scrape/:jobId → Job Status → Results (if complete)
```

### Crawling Routes (`routes/crawl.ts`)
**Endpoints**:
- `POST /api/v1/crawl` - Start multi-page crawl
- `GET /api/v1/crawl/:jobId` - Crawl status and results
- `DELETE /api/v1/crawl/:jobId` - Cancel crawl job

**Features**:
- Depth-limited crawling
- URL pattern filtering (include/exclude)
- Robots.txt respect option
- Configurable delays between requests
- Real-time progress tracking

**Current Status**: API endpoints implemented, integration with experimental crawler pending

### Test Routes (`routes/test.ts`)
**Endpoints**:
- `POST /api/v1/test/scrape` - Unauthenticated scraping for testing

**Purpose**: 
- Development and testing without API key setup
- Public demonstration endpoint
- Quick validation of scraping capabilities

## Error Handling

### Standardized Error Responses
All API responses follow a consistent format:

**Success Response**:
```json
{
  "success": true,
  "data": { ... }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Error Type",
  "message": "Human-readable error message"
}
```

### Error Types
- `400 Bad Request`: Validation errors, malformed requests
- `401 Unauthorized`: Missing or invalid API key
- `404 Not Found`: Job not found, invalid endpoints
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: System errors, service failures

## Security Implementation

### API Key Authentication
- SHA-256 hashed key storage
- Database-backed key validation
- Per-key rate limiting
- Key rotation support

### Input Sanitization
- Joi schema validation for all inputs
- URL validation and sanitization
- File path protection
- XSS prevention in responses

### Rate Limiting Strategy
```typescript
// Per API key limits
const userLimit = user.rate_limit_per_hour || 100;

// Global system protection  
const globalLimit = 1000; // requests per hour

// Heavy operation limits
const heavyLimit = 10; // crawl jobs per hour
```

## Request/Response Examples

### Single Page Scraping
```bash
# Request
curl -X POST http://localhost:3000/api/v1/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-key-123" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "screenshot"],
    "options": {
      "waitForTimeout": 5000,
      "includeMetadata": true,
      "excludeTags": ["nav", "footer"]
    }
  }'

# Response
{
  "success": true,
  "data": {
    "url": "https://example.com",
    "title": "Example Page",
    "content": {
      "markdown": "# Example Page\n\nContent here...",
      "screenshot": "/screenshots/example_123456.png"
    },
    "metadata": {
      "description": "Page description",
      "language": "en"
    },
    "processingTime": 3542
  }
}
```

### Async Job Status
```bash
# Status Check
curl http://localhost:3000/api/v1/scrape/job-123 \
  -H "X-API-Key: dev-key-123"

# Response
{
  "success": true,
  "data": {
    "jobId": "job-123",
    "status": "completed",
    "progress": 100,
    "result": { ... },
    "createdAt": "2025-01-01T00:00:00Z",
    "completedAt": "2025-01-01T00:00:05Z"
  }
}
```

## Integration with Core Services

### Service Layer Integration
```typescript
// Route handler pattern
async (req: AuthenticatedRequest, res: Response) => {
  const { url, formats, options } = req.body;
  
  // Call core service
  const result = await scrapingService.scrapePage(url, {
    formats,
    ...options
  });
  
  res.json({
    success: true,
    data: result
  });
}
```

### Async Job Integration
```typescript
// Async processing pattern
const jobId = uuidv4();

// Store job in database
await database.query(
  'INSERT INTO jobs (id, type, status, url) VALUES ($1, $2, $3, $4)',
  [jobId, 'scrape', 'pending', url]
);

// Add to processing queue
await jobManager.addScrapeJob(jobId, { url, formats, options });

res.status(202).json({
  success: true,
  data: { jobId, status: 'pending' }
});
```

## Development & Testing

### Local Development
```bash
# Start API server
npm run dev

# Test authentication
curl -H "X-API-Key: dev-key-123" http://localhost:3000/api/v1/health

# Test validation
curl -X POST http://localhost:3000/api/v1/test/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "invalid-url"}' # Should return validation error
```

### API Testing Commands
```bash
# Health check
curl http://localhost:3000/api/v1/health

# Test scraping (no auth)
curl -X POST http://localhost:3000/api/v1/test/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'

# Production scraping (with auth)
curl -X POST http://localhost:3000/api/v1/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-key-123" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'
```

## Performance Considerations

### Response Time Optimization
- Async processing for heavy operations
- Efficient middleware pipeline
- Database query optimization
- Redis caching for rate limits

### Scalability Features
- Stateless request handling
- Database-backed session management
- Horizontal scaling support
- Load balancer compatibility

## Production Deployment Notes

### Environment Configuration
```bash
# Required environment variables
PORT=3000
NODE_ENV=production
POSTGRES_HOST=db-host
REDIS_HOST=cache-host
```

### Security Hardening
- Remove development API keys
- Enable HTTPS only
- Configure proper CORS policies
- Set up security headers (helmet.js)
- Enable request logging

### Monitoring & Logging
- Request/response logging via Winston
- Error tracking and alerting
- Performance metrics collection
- Rate limit monitoring