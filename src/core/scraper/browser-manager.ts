import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { config } from '@/config';
import logger from '@/utils/logger';

interface BrowserInstance {
  browser: Browser;
  context: BrowserContext;
  inUse: boolean;
  createdAt: Date;
  lastUsed: Date;
}

export class BrowserManager {
  private instances: Map<string, BrowserInstance> = new Map();
  private maxInstances = config.browser.maxInstances;
  private instanceTimeout = config.browser.timeout;

  async createBrowser(): Promise<string> {
    const browserId = `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      logger.debug('Creating new browser instance', { browserId });

      const browser = await chromium.launch({
        headless: config.browser.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=TranslateUI',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-images',
          '--disable-javascript-harmony-shipping',
        ],
      });

      const context = await browser.newContext({
        userAgent: config.browser.userAgent,
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
      });

      this.instances.set(browserId, {
        browser,
        context,
        inUse: false,
        createdAt: new Date(),
        lastUsed: new Date(),
      });

      logger.info('Browser instance created', { 
        browserId, 
        totalInstances: this.instances.size 
      });

      return browserId;
    } catch (error) {
      logger.error('Failed to create browser instance', { error, browserId });
      throw error;
    }
  }

  async getBrowser(): Promise<{ browserId: string; context: BrowserContext }> {
    if (this.instances.size >= this.maxInstances) {
      await this.cleanupOldInstances();
    }

    for (const [browserId, instance] of this.instances.entries()) {
      if (!instance.inUse) {
        instance.inUse = true;
        instance.lastUsed = new Date();
        
        logger.debug('Reusing existing browser instance', { browserId });
        return { browserId, context: instance.context };
      }
    }

    if (this.instances.size < this.maxInstances) {
      const browserId = await this.createBrowser();
      const instance = this.instances.get(browserId)!;
      instance.inUse = true;
      
      return { browserId, context: instance.context };
    }

    throw new Error('No available browser instances and maximum limit reached');
  }

  async createPage(browserId?: string): Promise<{ page: Page; browserId: string }> {
    let browser;
    let actualBrowserId;

    if (browserId && this.instances.has(browserId)) {
      const instance = this.instances.get(browserId)!;
      browser = instance.context;
      actualBrowserId = browserId;
      instance.lastUsed = new Date();
    } else {
      const browserInfo = await this.getBrowser();
      browser = browserInfo.context;
      actualBrowserId = browserInfo.browserId;
    }

    try {
      const page = await browser.newPage();
      
      page.setDefaultTimeout(this.instanceTimeout);
      page.setDefaultNavigationTimeout(this.instanceTimeout);

      page.on('console', (msg) => {
        logger.debug('Browser console', { 
          type: msg.type(), 
          text: msg.text(),
          browserId: actualBrowserId 
        });
      });

      page.on('pageerror', (error) => {
        logger.warn('Browser page error', { 
          error: error.message,
          browserId: actualBrowserId 
        });
      });

      logger.debug('Page created', { browserId: actualBrowserId });
      
      return { page, browserId: actualBrowserId };
    } catch (error) {
      this.releaseBrowser(actualBrowserId);
      throw error;
    }
  }

  async releaseBrowser(browserId: string): Promise<void> {
    const instance = this.instances.get(browserId);
    if (instance) {
      instance.inUse = false;
      instance.lastUsed = new Date();
      logger.debug('Browser instance released', { browserId });
    }
  }

  async closeBrowser(browserId: string): Promise<void> {
    const instance = this.instances.get(browserId);
    if (instance) {
      try {
        await instance.browser.close();
        this.instances.delete(browserId);
        logger.info('Browser instance closed', { browserId });
      } catch (error) {
        logger.error('Error closing browser instance', { error, browserId });
      }
    }
  }

  async closeAllBrowsers(): Promise<void> {
    logger.info('Closing all browser instances', { count: this.instances.size });
    
    const closePromises = Array.from(this.instances.keys()).map(browserId => 
      this.closeBrowser(browserId)
    );
    
    await Promise.all(closePromises);
    this.instances.clear();
  }

  private async cleanupOldInstances(): Promise<void> {
    const now = new Date();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    for (const [browserId, instance] of this.instances.entries()) {
      const age = now.getTime() - instance.lastUsed.getTime();
      
      if (!instance.inUse && age > maxAge) {
        logger.debug('Cleaning up old browser instance', { browserId, age });
        await this.closeBrowser(browserId);
      }
    }
  }

  getStats() {
    const stats = {
      total: this.instances.size,
      inUse: 0,
      available: 0,
      maxInstances: this.maxInstances,
    };

    for (const instance of this.instances.values()) {
      if (instance.inUse) {
        stats.inUse++;
      } else {
        stats.available++;
      }
    }

    return stats;
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (this.instances.size === 0) {
        return true;
      }

      for (const [browserId, instance] of this.instances.entries()) {
        if (!instance.browser.isConnected()) {
          logger.warn('Browser instance disconnected, removing', { browserId });
          this.instances.delete(browserId);
        }
      }

      return true;
    } catch (error) {
      logger.error('Browser health check failed', error);
      return false;
    }
  }
}

export const browserManager = new BrowserManager();
export default browserManager;