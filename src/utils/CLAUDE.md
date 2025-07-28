# Infrastructure Layer - Vertical Slice Technical Implementation

## Overview
The infrastructure layer provides shared utilities and external system integrations for the entire application. This layer handles database operations, caching, logging, and configuration management while maintaining clean abstractions for the upper layers.

## Architecture Pattern
```
Core Services → Infrastructure Abstractions → External Systems (PostgreSQL, Redis, File System)
```

## Directory Structure
```
src/utils/
├── database.ts        # PostgreSQL connection and query management
├── redis.ts          # Redis client wrapper and caching utilities
└── logger.ts         # Winston-based centralized logging
```

## Database Integration (`database.ts`)

### Purpose
Centralized PostgreSQL database management with connection pooling, query execution, and transaction support.

### Key Features
- Connection pooling with automatic reconnection
- Parameterized query execution for security
- Transaction support for data consistency
- Environment-based configuration
- Comprehensive error handling and logging

### Implementation
```typescript
import { Pool, PoolClient, QueryResult } from 'pg';
import logger from './logger';

class Database {
  private pool: Pool;
  private isConnected: boolean = false;

  constructor() {
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'ocean_scraper',
      user: process.env.POSTGRES_USER || 'ocean_user',
      password: process.env.POSTGRES_PASSWORD || 'ocean_password',
      max: 20,                    // Maximum pool size
      idleTimeoutMillis: 30000,   // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return error after 2 seconds if unable to connect
    });
  }

  async query(text: string, params?: any[]): Promise<QueryResult> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.info('Database query executed', {
        query: text.substring(0, 100),
        duration,
        rowCount: result.rowCount
      });
      
      return result;
    } catch (error) {
      logger.error('Database query failed', {
        query: text.substring(0, 100),
        params: params?.map(p => typeof p === 'string' ? p.substring(0, 50) : p),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
```

### Database Schema Management
The database schema is managed through Docker initialization scripts:

**Core Tables**:
```sql
-- API Keys and Authentication
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  rate_limit_per_hour INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- Job Management
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,                    -- 'scrape', 'crawl', 'search'
  status VARCHAR(50) DEFAULT 'pending',         -- 'pending', 'processing', 'completed', 'failed'
  url TEXT NOT NULL,
  options JSONB,                                -- Scraping/crawling options
  result JSONB,                                 -- Final result data
  progress INTEGER DEFAULT 0,                   -- Progress percentage (0-100)
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Individual Page Results
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  content_markdown TEXT,
  content_html TEXT,
  content_json JSONB,
  metadata JSONB,
  links JSONB,
  status_code INTEGER,
  processing_time_ms INTEGER,
  scraped_at TIMESTAMP DEFAULT NOW(),
  screenshot_path TEXT,
  pdf_path TEXT
);

-- Indexing for Performance
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_created_at ON jobs(created_at);
CREATE INDEX idx_pages_job_id ON pages(job_id);
CREATE INDEX idx_pages_url ON pages(url);
```

### Common Database Operations
```typescript
// Job Management
async function createJob(jobData: JobData): Promise<string> {
  const result = await database.query(
    `INSERT INTO jobs (id, type, status, url, options)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [jobData.id, jobData.type, 'pending', jobData.url, JSON.stringify(jobData.options)]
  );
  return result.rows[0].id;
}

async function updateJobStatus(jobId: string, status: string, progress?: number): Promise<void> {
  await database.query(
    'UPDATE jobs SET status = $1, progress = $2, updated_at = NOW() WHERE id = $3',
    [status, progress, jobId]
  );
}

// Page Results Storage
async function storePage(pageData: PageData): Promise<void> {
  await database.query(
    `INSERT INTO pages (job_id, url, title, content_markdown, metadata, links, status_code, processing_time_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      pageData.jobId,
      pageData.url,
      pageData.title,
      pageData.content.markdown,
      JSON.stringify(pageData.metadata),
      JSON.stringify(pageData.links),
      pageData.statusCode,
      pageData.processingTime
    ]
  );
}

// API Key Validation
async function validateApiKey(keyHash: string): Promise<ApiKeyData | null> {
  const result = await database.query(
    'SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true',
    [keyHash]
  );
  return result.rows[0] || null;
}
```

## Redis Integration (`redis.ts`)

### Purpose
Redis client wrapper providing caching, session management, and job queue storage with connection management and error handling.

### Key Features
- Connection management with automatic reconnection
- Caching utilities with TTL support
- Rate limiting data storage
- Job queue integration with BullMQ
- Session management for async operations

### Implementation
```typescript
import Redis from 'ioredis';
import logger from './logger';

class RedisClient {
  private client: Redis;
  private isConnected: boolean = false;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      lazyConnect: true
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis connected successfully');
    });

    this.client.on('error', (error) => {
      this.isConnected = false;
      logger.error('Redis connection error', { error: error.message });
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis connection closed');
    });
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error('Redis SET operation failed', { key, error });
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error('Redis GET operation failed', { key, error });
      throw error;
    }
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    try {
      const result = await this.client.incr(key);
      if (ttlSeconds && result === 1) {
        await this.client.expire(key, ttlSeconds);
      }
      return result;
    } catch (error) {
      logger.error('Redis INCR operation failed', { key, error });
      throw error;
    }
  }
}
```

### Caching Patterns
```typescript
// Cache with automatic JSON serialization
async function cacheObject<T>(key: string, object: T, ttlSeconds: number = 3600): Promise<void> {
  await redis.set(key, JSON.stringify(object), ttlSeconds);
}

async function getCachedObject<T>(key: string): Promise<T | null> {
  const cached = await redis.get(key);
  return cached ? JSON.parse(cached) : null;
}

// Rate limiting implementation
async function checkRateLimit(identifier: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = `rate_limit:${identifier}`;
  const current = await redis.increment(key, windowSeconds);
  return current <= limit;
}

// Job status caching
async function cacheJobStatus(jobId: string, status: JobStatus): Promise<void> {
  await redis.set(`job:${jobId}`, JSON.stringify(status), 3600);
}
```

### BullMQ Integration
```typescript
// Queue configuration using Redis
export const queueConfig = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 3,
    backoff: 'exponential'
  }
};

// Session storage for async operations
async function storeJobSession(jobId: string, sessionData: any): Promise<void> {
  await redis.set(`session:${jobId}`, JSON.stringify(sessionData), 86400); // 24 hours
}
```

## Logging Infrastructure (`logger.ts`)

### Purpose
Centralized logging system using Winston with multiple transports, structured logging, and environment-based configuration.

### Key Features
- Multiple log levels with filtering
- File and console transports
- Structured logging with metadata
- Error tracking and stack traces
- Environment-based configuration
- Log rotation and archival

### Implementation
```typescript
import winston from 'winston';
import path from 'path';

// Custom format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...meta
    });
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'ocean-scraper' },
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // Combined log file
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
    
    // Console output for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Production configuration
if (process.env.NODE_ENV === 'production') {
  logger.remove(logger.transports.find(t => t.constructor.name === 'Console'));
}

export default logger;
```

### Logging Patterns
```typescript
// Structured logging for operations
logger.info('Database query executed', {
  query: 'SELECT * FROM jobs WHERE status = $1',
  params: ['pending'],
  duration: 150,
  rowCount: 5
});

// Error logging with context
logger.error('Scraping operation failed', {
  url: 'https://example.com',
  jobId: 'abc-123',
  error: error.message,
  stack: error.stack,
  metadata: { retry: 2, timeout: 30000 }
});

// Performance monitoring
const start = Date.now();
// ... operation
logger.info('Scraping completed', {
  url: 'https://example.com',
  duration: Date.now() - start,
  formats: ['markdown', 'screenshot'],
  success: true
});

// Security logging
logger.warn('Rate limit exceeded', {
  apiKey: req.apiKey?.name,
  clientIp: req.ip,
  endpoint: req.path,
  limit: 100,
  current: 105
});
```

### Log Categories
```typescript
// Application lifecycle
logger.info('Application starting', { 
  version: process.env.npm_package_version,
  environment: process.env.NODE_ENV,
  pid: process.pid
});

// Database operations
logger.info('Database connection established', {
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB
});

// API requests
logger.info('API request processed', {
  method: req.method,
  url: req.url,
  statusCode: res.statusCode,
  duration: responseTime,
  apiKey: req.apiKey?.name
});

// Scraping operations
logger.info('Page scraped successfully', {
  url: targetUrl,
  title: pageTitle,
  contentLength: content.length,
  formats: requestedFormats,
  processingTime: duration
});

// Error tracking
logger.error('Browser automation failed', {
  url: targetUrl,
  error: error.message,
  browserType: 'chromium',
  retryAttempt: 2
});
```

## Configuration Management (`src/config/`)

### Environment Configuration
```typescript
// src/config/index.ts
interface Config {
  server: {
    port: number;
    environment: string;
  };
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  browser: {
    headless: boolean;
    maxInstances: number;
  };
  vpn: {
    enabled: boolean;
    provider: string;
    username?: string;
    password?: string;
  };
}

const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    environment: process.env.NODE_ENV || 'development'
  },
  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'ocean_scraper',
    user: process.env.POSTGRES_USER || 'ocean_user',
    password: process.env.POSTGRES_PASSWORD || 'ocean_password'
  },
  // ... other configuration sections
};

export default config;
```

## Error Handling Patterns

### Database Error Handling
```typescript
async function handleDatabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      logger.warn('Duplicate entry attempted', { error: error.detail });
      throw new Error('Resource already exists');
    } else if (error.code === 'ECONNREFUSED') {
      logger.error('Database connection refused');
      throw new Error('Database unavailable');
    } else {
      logger.error('Unexpected database error', { 
        error: error.message,
        code: error.code 
      });
      throw error;
    }
  }
}
```

### Redis Error Handling
```typescript
async function safeRedisOperation<T>(operation: () => Promise<T>, fallback?: T): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    logger.warn('Redis operation failed, continuing without cache', { 
      error: error.message 
    });
    return fallback;
  }
}
```

## Health Monitoring

### Infrastructure Health Checks
```typescript
export async function checkInfrastructureHealth(): Promise<HealthStatus> {
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Database health
  try {
    await database.query('SELECT 1');
    health.services.database = 'connected';
  } catch (error) {
    health.services.database = 'disconnected';
    health.status = 'unhealthy';
  }

  // Redis health
  try {
    await redis.ping();
    health.services.redis = 'connected';
  } catch (error) {
    health.services.redis = 'disconnected';
    health.status = 'degraded';
  }

  // File system health
  try {
    await fs.access('./logs', fs.constants.W_OK);
    health.services.filesystem = 'writable';
  } catch (error) {
    health.services.filesystem = 'readonly';
    health.status = 'degraded';
  }

  return health;
}
```

## Performance Monitoring

### Database Performance
```typescript
// Query performance monitoring
const queryPerformanceMiddleware = (originalQuery: Function) => {
  return async function(text: string, params?: any[]) {
    const start = Date.now();
    const result = await originalQuery.call(this, text, params);
    const duration = Date.now() - start;
    
    if (duration > 1000) { // Log slow queries
      logger.warn('Slow database query detected', {
        query: text.substring(0, 100),
        duration,
        rowCount: result.rowCount
      });
    }
    
    return result;
  };
};
```

### Memory Usage Monitoring
```typescript
setInterval(() => {
  const memUsage = process.memoryUsage();
  logger.info('Memory usage', {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024)
  });
}, 60000); // Every minute
```

## Production Considerations

### Connection Pooling
- Database: 20 max connections with idle timeout
- Redis: Automatic reconnection with retry logic
- Browser: 5 max instances with health monitoring

### Security
- Parameterized queries to prevent SQL injection
- Redis password authentication
- Log sanitization for sensitive data
- Environment variable validation

### Monitoring & Alerting
- Database connection health monitoring
- Redis availability checks
- Disk space monitoring for logs
- Memory usage tracking
- Error rate monitoring

### Backup & Recovery
- Database backup automation
- Log rotation and archival
- Redis persistence configuration
- Configuration backup procedures