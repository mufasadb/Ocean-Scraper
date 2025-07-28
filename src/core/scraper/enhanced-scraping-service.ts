import { Page, BrowserContext } from 'playwright';
import { StealthBrowserManager } from './stealth-browser-manager';
import { CaptchaSolver } from './captcha-solver';
import { ContentExtractor } from './content-extractor';
import logger from '@/utils/logger';
import { randomInt } from 'crypto';

export interface EnhancedScrapeOptions {
  formats: string[];
  waitForTimeout?: number;
  includeMetadata?: boolean;
  excludeTags?: string[];
  actions?: BrowserAction[];
  enableAntiBot?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  humanBehavior?: HumanBehaviorOptions;
  captchaHandling?: boolean;
}

export interface BrowserAction {
  type: 'click' | 'fill' | 'wait' | 'scroll' | 'hover' | 'select' | 'key' | 'mouse_move';
  selector?: string;
  value?: string;
  timeout?: number;
  x?: number;
  y?: number;
  key?: string;
  humanLike?: boolean;
}

export interface HumanBehaviorOptions {
  enableMouseMovement?: boolean;
  enableRandomScrolling?: boolean;
  enableTypingDelay?: boolean;
  enableReadingPauses?: boolean;
  minReadingTime?: number;
  maxReadingTime?: number;
}

export interface EnhancedScrapeResult {
  title: string;
  content: any;
  metadata?: any;
  links?: string[];
  images?: string[];
  timestamp: Date;
  responseTime: number;
  stealthMetrics: {
    fingerprintRotated: boolean;
    captchaSolved: boolean;
    humanBehaviorApplied: boolean;
    retryCount: number;
  };
}

export class EnhancedScrapingService {
  private stealthBrowserManager: StealthBrowserManager;
  private captchaSolver: CaptchaSolver;
  private contentExtractor: ContentExtractor;

  constructor(
    stealthBrowserManager: StealthBrowserManager,
    captchaSolver: CaptchaSolver,
    contentExtractor: ContentExtractor
  ) {
    this.stealthBrowserManager = stealthBrowserManager;
    this.captchaSolver = captchaSolver;
    this.contentExtractor = contentExtractor;
  }

  async scrapePage(url: string, options: EnhancedScrapeOptions): Promise<EnhancedScrapeResult> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = options.maxRetries || 3;
    
    const stealthMetrics = {
      fingerprintRotated: false,
      captchaSolved: false,
      humanBehaviorApplied: false,
      retryCount: 0
    };

    while (retryCount <= maxRetries) {
      let page: Page | null = null;
      let browserId: string | null = null;

      try {
        logger.info('Starting enhanced scrape', { 
          url, 
          attempt: retryCount + 1, 
          maxRetries: maxRetries + 1,
          enableAntiBot: options.enableAntiBot 
        });

        // Get stealth browser instance
        const browserInfo = await this.stealthBrowserManager.createStealthPage();
        page = browserInfo.page;
        browserId = browserInfo.browserId;

        // Apply human behavior patterns before navigation
        if (options.humanBehavior?.enableMouseMovement) {
          await this.simulateMouseActivity(page);
          stealthMetrics.humanBehaviorApplied = true;
        }

        // Navigate with realistic timing
        await this.navigateWithRealTiming(page, url, options);

        // Handle CAPTCHAs if enabled
        if (options.captchaHandling !== false) {
          const captchaSolved = await this.captchaSolver.handleCaptchaOnPage(page);
          if (captchaSolved) {
            stealthMetrics.captchaSolved = true;
            logger.info('CAPTCHA solved successfully', { url });
          }
        }

        // Wait for initial load with human-like reading time
        await this.waitWithHumanBehavior(page, options);

        // Perform custom actions if specified
        if (options.actions && options.actions.length > 0) {
          await this.performEnhancedActions(page, options.actions);
        }

        // Simulate human reading behavior
        if (options.humanBehavior?.enableReadingPauses) {
          await this.simulateReadingBehavior(page, options.humanBehavior);
        }

        // Extract content using existing content extractor
        const extractionResult = await this.contentExtractor.extractContent(page, {
          formats: options.formats,
          includeMetadata: options.includeMetadata || false,
          excludeTags: options.excludeTags || []
        });

        const responseTime = Date.now() - startTime;
        stealthMetrics.retryCount = retryCount;

        // Clean up
        if (browserId) {
          await this.stealthBrowserManager.releaseBrowser(browserId);
        }

        logger.info('Enhanced scrape completed successfully', { 
          url, 
          responseTime, 
          retryCount,
          stealthMetrics 
        });

        return {
          title: extractionResult.title,
          content: extractionResult.content,
          metadata: extractionResult.metadata,
          links: extractionResult.links,
          images: extractionResult.images,
          timestamp: new Date(),
          responseTime,
          stealthMetrics
        };

      } catch (error) {
        retryCount++;
        stealthMetrics.retryCount = retryCount;

        logger.warn('Enhanced scrape attempt failed', { 
          url, 
          attempt: retryCount, 
          maxRetries: maxRetries + 1, 
          error: error.message 
        });

        // Clean up on error
        if (browserId) {
          await this.stealthBrowserManager.releaseBrowser(browserId);
        }

        // If we've exhausted retries, throw the error
        if (retryCount > maxRetries) {
          logger.error('Enhanced scrape failed after all retries', { url, retryCount, error });
          throw error;
        }

        // Wait before retry with exponential backoff
        const retryDelay = (options.retryDelay || 1000) * Math.pow(2, retryCount - 1);
        logger.info('Waiting before retry', { url, retryDelay, nextAttempt: retryCount + 1 });
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    throw new Error('Maximum retries exceeded');
  }

  private async navigateWithRealTiming(page: Page, url: string, options: EnhancedScrapeOptions): Promise<void> {
    // Add realistic pre-navigation delay
    await this.stealthBrowserManager.humanLikeDelay(500, 1500);

    // Navigate to page
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.waitForTimeout || 30000
    });

    // Post-navigation delay to simulate reading start
    await this.stealthBrowserManager.humanLikeDelay(1000, 2000);
  }

  private async waitWithHumanBehavior(page: Page, options: EnhancedScrapeOptions): Promise<void> {
    const waitTime = options.waitForTimeout || 3000;
    
    // Wait in smaller chunks to simulate human activity
    const chunks = Math.ceil(waitTime / 1000);
    for (let i = 0; i < chunks; i++) {
      await page.waitForTimeout(1000);
      
      // Occasionally move mouse or scroll slightly
      if (Math.random() < 0.3) {
        await this.simulateMinorActivity(page);
      }
    }
  }

  private async simulateMouseActivity(page: Page): Promise<void> {
    try {
      // Get viewport size
      const viewport = page.viewportSize() || { width: 1280, height: 720 };
      
      // Generate realistic mouse movements
      const movements = randomInt(3, 8);
      
      for (let i = 0; i < movements; i++) {
        const x = randomInt(100, viewport.width - 100);
        const y = randomInt(100, viewport.height - 100);
        
        // Move mouse with human-like curves
        await page.mouse.move(x, y, { steps: randomInt(10, 30) });
        await this.stealthBrowserManager.humanLikeDelay(100, 500);
      }
    } catch (error) {
      logger.debug('Mouse simulation failed', { error: error.message });
    }
  }

  private async simulateMinorActivity(page: Page): Promise<void> {
    const activities = ['mouse_move', 'small_scroll'];
    const activity = activities[randomInt(0, activities.length)];

    try {
      switch (activity) {
        case 'mouse_move':
          const viewport = page.viewportSize() || { width: 1280, height: 720 };
          const x = randomInt(200, viewport.width - 200);
          const y = randomInt(200, viewport.height - 200);
          await page.mouse.move(x, y, { steps: randomInt(5, 15) });
          break;

        case 'small_scroll':
          const scrollAmount = randomInt(-100, 100);
          await page.mouse.wheel(0, scrollAmount);
          break;
      }
    } catch (error) {
      logger.debug('Minor activity simulation failed', { error: error.message });
    }
  }

  private async simulateReadingBehavior(page: Page, humanBehavior: HumanBehaviorOptions): Promise<void> {
    const minTime = humanBehavior.minReadingTime || 2000;
    const maxTime = humanBehavior.maxReadingTime || 10000;
    const readingTime = randomInt(minTime, maxTime);

    logger.debug('Simulating reading behavior', { readingTime });

    // Simulate reading with occasional scrolls and mouse movements
    const endTime = Date.now() + readingTime;
    
    while (Date.now() < endTime) {
      const actionType = Math.random();
      
      if (actionType < 0.4) {
        // Scroll down slowly
        await page.mouse.wheel(0, randomInt(50, 200));
      } else if (actionType < 0.7) {
        // Small mouse movement
        const viewport = page.viewportSize() || { width: 1280, height: 720 };
        const x = randomInt(100, viewport.width - 100);
        const y = randomInt(100, viewport.height - 100);
        await page.mouse.move(x, y, { steps: randomInt(5, 15) });
      }
      // 30% of the time, just wait
      
      await this.stealthBrowserManager.humanLikeDelay(800, 2000);
    }
  }

  private async performEnhancedActions(page: Page, actions: BrowserAction[]): Promise<void> {
    logger.debug('Performing enhanced browser actions', { count: actions.length });

    for (const action of actions) {
      try {
        // Add human-like delay before each action
        if (action.humanLike !== false) {
          await this.stealthBrowserManager.humanLikeDelay(300, 800);
        }

        switch (action.type) {
          case 'click':
            if (action.selector) {
              await this.humanLikeClick(page, action.selector);
            }
            break;

          case 'fill':
            if (action.selector && action.value) {
              await this.humanLikeType(page, action.selector, action.value);
            }
            break;

          case 'hover':
            if (action.selector) {
              await page.hover(action.selector);
            }
            break;

          case 'scroll':
            if (action.selector) {
              await page.locator(action.selector).scrollIntoViewIfNeeded();
            } else {
              const scrollAmount = action.y || randomInt(200, 500);
              await page.mouse.wheel(0, scrollAmount);
            }
            break;

          case 'wait':
            const waitTime = action.timeout || 1000;
            await page.waitForTimeout(waitTime);
            break;

          case 'key':
            if (action.key) {
              await page.keyboard.press(action.key);
            }
            break;

          case 'mouse_move':
            if (action.x !== undefined && action.y !== undefined) {
              await page.mouse.move(action.x, action.y, { steps: randomInt(10, 30) });
            }
            break;

          case 'select':
            if (action.selector && action.value) {
              await page.selectOption(action.selector, action.value);
            }
            break;
        }

        // Post-action delay
        if (action.humanLike !== false) {
          await this.stealthBrowserManager.humanLikeDelay(200, 600);
        }

      } catch (error) {
        logger.warn('Action failed', { action: action.type, selector: action.selector, error: error.message });
      }
    }
  }

  private async humanLikeClick(page: Page, selector: string): Promise<void> {
    // Wait for element and scroll to it naturally
    await page.waitForSelector(selector, { timeout: 10000 });
    
    const element = page.locator(selector);
    await element.scrollIntoViewIfNeeded();
    
    // Add small delay to simulate user finding the element
    await this.stealthBrowserManager.humanLikeDelay(200, 500);
    
    // Get element position for realistic mouse movement
    const box = await element.boundingBox();
    if (box) {
      // Move to a random point within the element
      const x = box.x + randomInt(10, box.width - 10);
      const y = box.y + randomInt(10, box.height - 10);
      
      await page.mouse.move(x, y, { steps: randomInt(5, 15) });
      await this.stealthBrowserManager.humanLikeDelay(100, 300);
    }
    
    await element.click();
  }

  private async humanLikeType(page: Page, selector: string, text: string): Promise<void> {
    await page.waitForSelector(selector, { timeout: 10000 });
    
    const element = page.locator(selector);
    await element.scrollIntoViewIfNeeded();
    
    // Click to focus first
    await this.humanLikeClick(page, selector);
    
    // Clear existing content
    await page.keyboard.press('Control+a');
    await this.stealthBrowserManager.humanLikeDelay(50, 150);
    
    // Type with human-like speed and occasional mistakes
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Occasionally add typing mistakes and corrections (5% chance)
      if (Math.random() < 0.05 && i > 0) {
        // Type wrong character
        const wrongChar = String.fromCharCode(char.charCodeAt(0) + randomInt(-5, 5));
        await page.keyboard.type(wrongChar);
        await this.stealthBrowserManager.humanLikeDelay(100, 300);
        
        // Backspace to correct
        await page.keyboard.press('Backspace');
        await this.stealthBrowserManager.humanLikeDelay(200, 400);
      }
      
      await page.keyboard.type(char);
      
      // Variable typing speed
      const delay = randomInt(50, 200);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  async getStealthStats() {
    return {
      browserManager: this.stealthBrowserManager.getStats(),
      captchaSolver: this.captchaSolver.getStatus()
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const browserHealthy = await this.stealthBrowserManager.healthCheck();
      return browserHealthy;
    } catch (error) {
      logger.error('Enhanced scraping service health check failed', { error });
      return false;
    }
  }

  async cleanup(): Promise<void> {
    await this.stealthBrowserManager.closeAllBrowsers();
  }
}

export default EnhancedScrapingService;