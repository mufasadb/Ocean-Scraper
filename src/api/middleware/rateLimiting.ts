import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '@/config';
import redis from '@/utils/redis';
import logger from '@/utils/logger';
import { AuthenticatedRequest } from './auth';

export const globalRateLimit = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.maxRequests,
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.ip || 'unknown';
  },
  handler: (req: Request, res: Response) => {
    logger.warn('Rate limit exceeded', { 
      ip: req.ip, 
      url: req.url,
      method: req.method 
    });
    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
    });
  },
});

export const apiKeyRateLimit = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.apiKey) {
    return next();
  }

  try {
    const key = `rate_limit:${req.apiKey.id}`;
    const windowStart = Math.floor(Date.now() / (60 * 60 * 1000));
    const redisKey = `${key}:${windowStart}`;

    const current = await redis.get(redisKey);
    const currentCount = current ? parseInt(current, 10) : 0;

    if (currentCount >= req.apiKey.rateLimit) {
      logger.warn('API key rate limit exceeded', {
        keyId: req.apiKey.id,
        keyName: req.apiKey.name,
        currentCount,
        limit: req.apiKey.rateLimit,
      });

      return res.status(429).json({
        success: false,
        error: 'API rate limit exceeded',
        message: `Rate limit of ${req.apiKey.rateLimit} requests per hour exceeded`,
        rateLimitInfo: {
          limit: req.apiKey.rateLimit,
          current: currentCount,
          windowStart: new Date(windowStart * 60 * 60 * 1000).toISOString(),
        },
      });
    }

    await redis.set(redisKey, (currentCount + 1).toString(), 3600);

    res.set({
      'X-RateLimit-Limit': req.apiKey.rateLimit.toString(),
      'X-RateLimit-Remaining': (req.apiKey.rateLimit - currentCount - 1).toString(),
      'X-RateLimit-Reset': new Date((windowStart + 1) * 60 * 60 * 1000).toISOString(),
    });

    next();
  } catch (error) {
    logger.error('Rate limiting error', error);
    res.status(500).json({
      success: false,
      error: 'Rate limiting service error',
    });
  }
};

export const heavyOperationLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: {
    success: false,
    error: 'Heavy operation rate limit exceeded',
    message: 'Too many heavy operations. Please wait before trying again.',
  },
  keyGenerator: (req: AuthenticatedRequest) => {
    return req.apiKey?.id || req.ip || 'unknown';
  },
});