import { config } from '@/config';
import { ScrapingService } from './scraping-service';
import { EnhancedScrapingService } from './enhanced-scraping-service';
import { StealthBrowserManager } from './stealth-browser-manager';
import { CaptchaSolver } from './captcha-solver';
import { ContentExtractor } from './content-extractor';
import logger from '@/utils/logger';

export interface UnifiedScrapeOptions {
  formats: string[];
  waitForTimeout?: number;
  includeMetadata?: boolean;
  excludeTags?: string[];
  actions?: any[];
  
  // Enhanced/Anti-bot options
  enableAntiBot?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  humanBehavior?: {
    enableMouseMovement?: boolean;
    enableRandomScrolling?: boolean;
    enableTypingDelay?: boolean;
    enableReadingPauses?: boolean;
    minReadingTime?: number;
    maxReadingTime?: number;
  };
  captchaHandling?: boolean;
  
  // Legacy options for backward compatibility
  waitForSelector?: string;
  includeContent?: boolean;
  includeLinks?: boolean;
  includeImages?: boolean;
  customHeaders?: Record<string, string>;
  userAgent?: string;
  viewport?: { width: number; height: number };
  requireVpn?: boolean;
}

export interface UnifiedScrapeResult {
  url: string;
  title?: string;
  content: {
    markdown?: string;
    html?: string;
    json?: any;
    screenshot?: string;
    pdf?: string;
  };
  metadata?: any;
  links?: string[];
  images?: string[];
  statusCode?: number;
  responseTime: number;
  timestamp: string;
  vpnStatus?: {
    enabled: boolean;
    connected: boolean;
    publicIp?: string;
  };
  
  // Enhanced scraping metrics
  stealthMetrics?: {
    fingerprintRotated: boolean;
    captchaSolved: boolean;
    humanBehaviorApplied: boolean;
    retryCount: number;
  };
  antiBotMode?: boolean;
}

export class ScrapingServiceFactory {
  private static instance: ScrapingServiceFactory;
  private regularService: ScrapingService;
  private enhancedService: EnhancedScrapingService | null = null;
  private stealthBrowserManager: StealthBrowserManager | null = null;
  private captchaSolver: CaptchaSolver | null = null;
  private contentExtractor: ContentExtractor;

  private constructor() {
    // Always initialize regular service for backward compatibility
    this.regularService = new ScrapingService();
    this.contentExtractor = new ContentExtractor();

    // Initialize enhanced services if anti-bot is enabled
    if (config.antiBot.enabled) {
      this.initializeEnhancedServices();
    }
  }

  private initializeEnhancedServices(): void {
    try {
      logger.info('Initializing enhanced anti-bot scraping services');

      // Initialize stealth browser manager
      this.stealthBrowserManager = new StealthBrowserManager({
        enableFingerprinting: config.antiBot.fingerprintRotation,
        rotateContexts: config.antiBot.fingerprintRotation,
        randomizeTimings: config.antiBot.humanBehavior,
        simulateHumanBehavior: config.antiBot.humanBehavior,
        useResidentialHeaders: config.antiBot.stealthMode
      });

      // Initialize CAPTCHA solver
      this.captchaSolver = new CaptchaSolver({
        apiKey: config.captcha.apiKey,
        timeout: config.captcha.timeout,
        pollingInterval: config.captcha.pollingInterval,
        maxRetries: config.captcha.maxRetries
      });

      // Initialize enhanced scraping service
      this.enhancedService = new EnhancedScrapingService(
        this.stealthBrowserManager,
        this.captchaSolver,
        this.contentExtractor
      );

      logger.info('Enhanced anti-bot scraping services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize enhanced scraping services', { error });
      // Fall back to regular service
      this.enhancedService = null;
    }
  }

  public static getInstance(): ScrapingServiceFactory {
    if (!ScrapingServiceFactory.instance) {
      ScrapingServiceFactory.instance = new ScrapingServiceFactory();
    }
    return ScrapingServiceFactory.instance;
  }

  public async scrapePage(url: string, options: UnifiedScrapeOptions): Promise<UnifiedScrapeResult> {
    const shouldUseAntiBot = this.shouldUseEnhancedScraping(options);
    
    logger.info('Starting page scrape', { 
      url, 
      antiBotMode: shouldUseAntiBot,
      enableAntiBot: options.enableAntiBot 
    });

    if (shouldUseAntiBot && this.enhancedService) {
      return await this.scrapeWithEnhancedService(url, options);
    } else {
      return await this.scrapeWithRegularService(url, options);
    }
  }

  private shouldUseEnhancedScraping(options: UnifiedScrapeOptions): boolean {
    // Use enhanced scraping if:
    // 1. Anti-bot is enabled globally AND
    // 2. Enhanced service is available AND
    // 3. Either explicitly requested OR auto-enabled for challenging domains
    
    if (!config.antiBot.enabled || !this.enhancedService) {
      return false;
    }

    // Explicitly requested
    if (options.enableAntiBot === true) {
      return true;
    }

    // Explicitly disabled
    if (options.enableAntiBot === false) {
      return false;
    }

    // Auto-detection based on domain patterns or previous failures
    // This could be expanded to include ML-based detection
    return config.antiBot.stealthMode;
  }

  private async scrapeWithEnhancedService(url: string, options: UnifiedScrapeOptions): Promise<UnifiedScrapeResult> {
    const enhancedOptions = {
      formats: options.formats,
      waitForTimeout: options.waitForTimeout,
      includeMetadata: options.includeMetadata,
      excludeTags: options.excludeTags,
      actions: options.actions,
      enableAntiBot: true,
      maxRetries: options.maxRetries || config.antiBot.retryAttempts,
      retryDelay: options.retryDelay || config.antiBot.retryDelay,
      humanBehavior: {
        enableMouseMovement: options.humanBehavior?.enableMouseMovement ?? config.humanBehavior.mouseMovement,
        enableRandomScrolling: options.humanBehavior?.enableRandomScrolling ?? config.humanBehavior.randomScrolling,
        enableTypingDelay: options.humanBehavior?.enableTypingDelay ?? config.humanBehavior.typingDelay,
        enableReadingPauses: options.humanBehavior?.enableReadingPauses ?? config.humanBehavior.readingPauses,
        minReadingTime: options.humanBehavior?.minReadingTime ?? config.humanBehavior.minReadingTime,
        maxReadingTime: options.humanBehavior?.maxReadingTime ?? config.humanBehavior.maxReadingTime,
      },
      captchaHandling: options.captchaHandling ?? config.captcha.enabled
    };

    const result = await this.enhancedService!.scrapePage(url, enhancedOptions);

    return {
      url,
      title: result.title,
      content: result.content,
      metadata: result.metadata,
      links: result.links,
      images: result.images,
      responseTime: result.responseTime,
      timestamp: result.timestamp.toISOString(),
      stealthMetrics: result.stealthMetrics,
      antiBotMode: true
    };
  }

  private async scrapeWithRegularService(url: string, options: UnifiedScrapeOptions): Promise<UnifiedScrapeResult> {
    // Convert unified options to legacy format
    const legacyOptions = {
      waitForSelector: options.waitForSelector,
      waitForTimeout: options.waitForTimeout,
      includeContent: options.includeMetadata !== false,
      includeMetadata: options.includeMetadata,
      includeLinks: true,
      includeImages: true,
      excludeTags: options.excludeTags,
      customHeaders: options.customHeaders,
      actions: options.actions,
      userAgent: options.userAgent,
      viewport: options.viewport,
      requireVpn: options.requireVpn
    };

    const result = await this.regularService.scrapePage(url, legacyOptions);

    return {
      ...result,
      antiBotMode: false
    };
  }

  public async getServiceStats() {
    const stats: any = {
      regularService: {
        available: true,
        type: 'regular'
      }
    };

    if (this.enhancedService) {
      try {
        stats.enhancedService = {
          available: true,
          type: 'enhanced',
          ...(await this.enhancedService.getStealthStats())
        };
      } catch (error) {
        stats.enhancedService = {
          available: false,
          error: error.message
        };
      }
    } else {
      stats.enhancedService = {
        available: false,
        reason: 'Anti-bot features disabled or failed to initialize'
      };
    }

    return stats;
  }

  public async healthCheck(): Promise<boolean> {
    try {
      // Check regular service (if it has a health check method)
      let regularHealthy = true;
      if (typeof this.regularService.healthCheck === 'function') {
        regularHealthy = await this.regularService.healthCheck();
      }

      // Check enhanced service
      let enhancedHealthy = true;
      if (this.enhancedService) {
        enhancedHealthy = await this.enhancedService.healthCheck();
      }

      return regularHealthy && enhancedHealthy;
    } catch (error) {
      logger.error('Scraping service factory health check failed', { error });
      return false;
    }
  }

  public async cleanup(): Promise<void> {
    logger.info('Cleaning up scraping services');

    // Cleanup enhanced service if available
    if (this.enhancedService) {
      await this.enhancedService.cleanup();
    }

    // Cleanup regular service if it has cleanup method
    if (typeof this.regularService.cleanup === 'function') {
      await this.regularService.cleanup();
    }
  }

  // Method to dynamically enable/disable anti-bot features
  public async toggleAntiBotMode(enabled: boolean): Promise<void> {
    if (enabled && !this.enhancedService) {
      this.initializeEnhancedServices();
    } else if (!enabled && this.enhancedService) {
      await this.enhancedService.cleanup();
      this.enhancedService = null;
    }
  }
}

// Export singleton instance
export const scrapingServiceFactory = ScrapingServiceFactory.getInstance();
export default scrapingServiceFactory;