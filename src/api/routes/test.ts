import { Router, Request, Response } from 'express';
import scrapingServiceFactory from '@/core/scraper/scraping-service-factory';
import logger from '@/utils/logger';

const router = Router();

router.post('/test/scrape', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { url, formats = ['markdown'], options = {} } = req.body;
    
    logger.info('Test scrape request started', { url, formats, antiBotEnabled: options.enableAntiBot });

    // Use unified scraping service factory
    const unifiedOptions = {
      formats,
      waitForTimeout: options.waitForTimeout,
      includeMetadata: options.includeMetadata !== false, // Default to true for test endpoint
      excludeTags: options.excludeTags,
      actions: options.actions,
      
      // Anti-bot options (can be explicitly set in test requests)
      enableAntiBot: options.enableAntiBot,
      maxRetries: options.maxRetries,
      retryDelay: options.retryDelay,
      humanBehavior: options.humanBehavior,
      captchaHandling: options.captchaHandling,
      
      // Legacy options
      waitForSelector: options.waitForSelector,
      includeContent: options.includeContent,
      includeLinks: true,
      includeImages: true,
      customHeaders: options.customHeaders,
      userAgent: options.userAgent,
      viewport: options.viewport,
      requireVpn: options.requireVpn
    };

    const result = await scrapingServiceFactory.scrapePage(url, unifiedOptions);

    logger.info('Test scrape request completed', {
      url,
      processingTime: result.responseTime,
      statusCode: result.statusCode,
      antiBotMode: result.antiBotMode,
      stealthMetrics: result.stealthMetrics,
    });

    res.json({
      success: true,
      data: result,
    });
    
  } catch (error) {
    logger.error('Test scrape request failed', {
      url: req.body.url,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      processingTime: Date.now() - startTime,
    });

    res.status(500).json({
      success: false,
      error: 'Scraping failed',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
      processingTime: Date.now() - startTime,
    });
  }
});

export default router;