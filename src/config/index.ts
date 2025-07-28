import dotenv from 'dotenv';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    env: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    apiKeyHeader: process.env.API_KEY_HEADER || 'X-API-Key',
  },
  
  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'ocean_scraper',
    username: process.env.POSTGRES_USER || 'ocean_user',
    password: process.env.POSTGRES_PASSWORD || 'ocean_password',
    ssl: process.env.NODE_ENV === 'production',
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  },
  
  vpn: {
    enabled: process.env.VPN_ENABLED === 'true',
    required: process.env.VPN_REQUIRED === 'true',
    username: process.env.PIA_USERNAME,
    password: process.env.PIA_PASSWORD,
    region: process.env.PIA_REGION || 'us-east',
    healthCheckInterval: parseInt(process.env.VPN_HEALTH_CHECK_INTERVAL || '30000'),
    connectionTimeout: parseInt(process.env.VPN_CONNECTION_TIMEOUT || '60000'),
    scriptPath: process.env.VPN_SCRIPT_PATH || (process.env.NODE_ENV === 'production' ? '/app/vpn/pia-config.sh' : './docker/vpn/pia-config-dev.sh'),
  },
  
  rateLimiting: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  },
  
  browser: {
    maxInstances: parseInt(process.env.MAX_BROWSER_INSTANCES || '5'),
    timeout: parseInt(process.env.BROWSER_TIMEOUT || '30000'),
    headless: process.env.BROWSER_HEADLESS !== 'false',
    userAgent: process.env.DEFAULT_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  },
  
  scraping: {
    maxCrawlDepth: parseInt(process.env.MAX_CRAWL_DEPTH || '3'),
    maxPagesPerCrawl: parseInt(process.env.MAX_PAGES_PER_CRAWL || '100'),
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '1000'),
    defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '30000'),
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
  },
  
  paths: {
    screenshots: './screenshots',
    downloads: './downloads',
    logs: './logs',
  },

  antiBot: {
    enabled: process.env.ANTI_BOT_ENABLED !== 'false',
    stealthMode: process.env.STEALTH_MODE !== 'false',
    fingerprintRotation: process.env.FINGERPRINT_ROTATION !== 'false',
    humanBehavior: process.env.HUMAN_BEHAVIOR !== 'false',
    captchaSolving: process.env.CAPTCHA_SOLVING !== 'false',
    maxContextRotations: parseInt(process.env.MAX_CONTEXT_ROTATIONS || '10'),
    retryAttempts: parseInt(process.env.ANTI_BOT_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.ANTI_BOT_RETRY_DELAY || '1000'),
  },

  captcha: {
    enabled: process.env.CAPTCHA_SOLVING !== 'false',
    apiKey: process.env.CAPTCHA_API_KEY || process.env.TWOCAPTCHA_API_KEY,
    timeout: parseInt(process.env.CAPTCHA_TIMEOUT || '300000'), // 5 minutes
    pollingInterval: parseInt(process.env.CAPTCHA_POLLING_INTERVAL || '10000'), // 10 seconds
    maxRetries: parseInt(process.env.CAPTCHA_MAX_RETRIES || '3'),
  },

  humanBehavior: {
    mouseMovement: process.env.HUMAN_MOUSE_MOVEMENT !== 'false',
    randomScrolling: process.env.HUMAN_RANDOM_SCROLLING !== 'false',
    typingDelay: process.env.HUMAN_TYPING_DELAY !== 'false',
    readingPauses: process.env.HUMAN_READING_PAUSES !== 'false',
    minReadingTime: parseInt(process.env.MIN_READING_TIME || '2000'),
    maxReadingTime: parseInt(process.env.MAX_READING_TIME || '10000'),
  },
};