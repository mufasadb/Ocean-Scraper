import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '@/config';
import database from '@/utils/database';
import logger from '@/utils/logger';

export interface AuthenticatedRequest extends Request {
  apiKey?: {
    id: string;
    name: string;
    rateLimit: number;
  };
}

export const authenticateApiKey = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiKey = req.header(config.server.apiKeyHeader);
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
        message: `Please provide an API key in the ${config.server.apiKeyHeader} header`,
      });
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    const result = await database.query(
      'SELECT id, name, rate_limit_per_hour, is_active FROM api_keys WHERE key_hash = $1',
      [keyHash]
    );

    if (result.rows.length === 0) {
      logger.warn('Invalid API key attempted', { 
        keyPrefix: apiKey.substring(0, 8) + '...', 
        ip: req.ip 
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
    }

    const keyData = result.rows[0];
    
    if (!keyData.is_active) {
      return res.status(401).json({
        success: false,
        error: 'API key is disabled',
      });
    }

    await database.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [keyData.id]
    );

    req.apiKey = {
      id: keyData.id,
      name: keyData.name,
      rateLimit: keyData.rate_limit_per_hour,
    };

    logger.info('API key authenticated', { 
      keyName: keyData.name, 
      keyId: keyData.id 
    });

    next();
  } catch (error) {
    logger.error('Authentication error', error);
    res.status(500).json({
      success: false,
      error: 'Authentication service error',
    });
  }
};

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const apiKey = req.header(config.server.apiKeyHeader);
  
  if (!apiKey) {
    return next();
  }

  return authenticateApiKey(req, res, next);
};