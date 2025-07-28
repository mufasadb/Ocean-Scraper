import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import logger from '@/utils/logger';

export interface ValidationSchema {
  body?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
}

export const validate = (schema: ValidationSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];

    if (schema.body) {
      const { error } = schema.body.validate(req.body);
      if (error) {
        errors.push(`Body: ${error.details.map(d => d.message).join(', ')}`);
      }
    }

    if (schema.query) {
      const { error } = schema.query.validate(req.query);
      if (error) {
        errors.push(`Query: ${error.details.map(d => d.message).join(', ')}`);
      }
    }

    if (schema.params) {
      const { error } = schema.params.validate(req.params);
      if (error) {
        errors.push(`Params: ${error.details.map(d => d.message).join(', ')}`);
      }
    }

    if (errors.length > 0) {
      logger.warn('Validation error', { errors, url: req.url, method: req.method });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
    }

    next();
  };
};

export const scrapeSchema = {
  body: Joi.object({
    url: Joi.string().uri().required(),
    formats: Joi.array().items(
      Joi.string().valid('markdown', 'html', 'json', 'screenshot', 'pdf')
    ).default(['markdown']),
    options: Joi.object({
      waitForSelector: Joi.string(),
      waitForTimeout: Joi.number().min(0).max(60000).default(5000),
      includeContent: Joi.boolean().default(true),
      includeMetadata: Joi.boolean().default(true),
      excludeTags: Joi.array().items(Joi.string()),
      customHeaders: Joi.object().pattern(Joi.string(), Joi.string()),
      actions: Joi.array().items(
        Joi.object({
          type: Joi.string().valid('click', 'fill', 'scroll', 'wait', 'screenshot').required(),
          selector: Joi.string(),
          value: Joi.string(),
          timeout: Joi.number().min(0).max(30000),
        })
      ),
    }).default({}),
  }),
};

export const crawlSchema = {
  body: Joi.object({
    url: Joi.string().uri().required(),
    options: Joi.object({
      maxDepth: Joi.number().min(1).max(10).default(3),
      maxPages: Joi.number().min(1).max(1000).default(100),
      includePatterns: Joi.array().items(Joi.string()),
      excludePatterns: Joi.array().items(Joi.string()),
      respectRobotsTxt: Joi.boolean().default(true),
      delayBetweenRequests: Joi.number().min(0).max(10000).default(1000),
      formats: Joi.array().items(
        Joi.string().valid('markdown', 'html', 'json', 'screenshot', 'pdf')
      ).default(['markdown']),
      scrapeOptions: Joi.object({
        includeContent: Joi.boolean().default(true),
        includeMetadata: Joi.boolean().default(true),
        excludeTags: Joi.array().items(Joi.string()),
      }).default({}),
    }).default({}),
  }),
};

export const searchSchema = {
  body: Joi.object({
    query: Joi.string().required(),
    options: Joi.object({
      limit: Joi.number().min(1).max(50).default(10),
      language: Joi.string().default('en'),
      country: Joi.string().default('us'),
      scrapeResults: Joi.boolean().default(true),
      formats: Joi.array().items(
        Joi.string().valid('markdown', 'html', 'json', 'screenshot')
      ).default(['markdown']),
    }).default({}),
  }),
};

export const jobParamsSchema = {
  params: Joi.object({
    jobId: Joi.string().uuid().required(),
  }),
};