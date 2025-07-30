import { chromium, firefox, webkit, Browser, Page, BrowserContext, BrowserType } from 'playwright';
// import { addExtra } from 'playwright-extra';
// import StealthPlugin from 'playwright-extra-plugin-stealth';
import { config } from '@/config';
import logger from '@/utils/logger';
import UserAgent from 'fake-useragent';
import { randomInt } from 'crypto';

// Temporarily disable stealth plugin due to compatibility issues
// const chromiumStealth = addExtra(chromium).use(StealthPlugin());
const chromiumStealth = chromium;

interface StealthBrowserInstance {
  browser: Browser;
  context: BrowserContext;
  fingerprint: BrowserFingerprint;
  inUse: boolean;
  createdAt: Date;
  lastUsed: Date;
  contextRotationCount: number;
}

interface BrowserFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  timezone: string;
  platform: string;
  deviceMemory: number;
  hardwareConcurrency: number;
  colorDepth: number;
  screenResolution: { width: number; height: number };
  cookiesEnabled: boolean;
  webgl: {
    vendor: string;
    renderer: string;
  };
}

export interface StealthOptions {
  enableFingerprinting: boolean;
  rotateContexts: boolean;
  randomizeTimings: boolean;
  simulateHumanBehavior: boolean;
  useResidentialHeaders: boolean;
}

export class StealthBrowserManager {
  private instances: Map<string, StealthBrowserInstance> = new Map();
  private maxInstances = config.browser.maxInstances;
  private instanceTimeout = config.browser.timeout;
  private maxContextRotations = 10; // Rotate context after 10 uses
  private stealthOptions: StealthOptions;

  constructor(stealthOptions: Partial<StealthOptions> = {}) {
    this.stealthOptions = {
      enableFingerprinting: true,
      rotateContexts: true,
      randomizeTimings: true,
      simulateHumanBehavior: true,
      useResidentialHeaders: true,
      ...stealthOptions
    };
  }

  private generateRandomFingerprint(): BrowserFingerprint {
    const userAgent = UserAgent();
    
    // Common screen resolutions and viewports
    const resolutions = [
      { screen: { width: 1920, height: 1080 }, viewport: { width: 1366, height: 768 } },
      { screen: { width: 1366, height: 768 }, viewport: { width: 1280, height: 720 } },
      { screen: { width: 1440, height: 900 }, viewport: { width: 1440, height: 900 } },
      { screen: { width: 1536, height: 864 }, viewport: { width: 1536, height: 864 } },
      { screen: { width: 1280, height: 1024 }, viewport: { width: 1024, height: 768 } },
      { screen: { width: 2560, height: 1440 }, viewport: { width: 1920, height: 1080 } },
    ];

    const resolution = resolutions[randomInt(0, resolutions.length)];
    
    // Common locales
    const locales = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'pt-BR', 'ru-RU', 'ja-JP'];
    
    // Common timezones
    const timezones = [
      'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Denver',
      'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid',
      'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney'
    ];

    // Platforms that match common user agents
    const platforms = ['Win32', 'MacIntel', 'Linux x86_64'];
    
    // WebGL vendors and renderers
    const webglVendors = [
      'Google Inc. (Intel)', 'Google Inc. (NVIDIA)', 'Google Inc. (AMD)',
      'Google Inc. (Apple)', 'Google Inc. (Microsoft)'
    ];
    
    const webglRenderers = [
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple GPU',
      'Intel Iris Pro OpenGL Engine'
    ];

    return {
      userAgent,
      viewport: resolution.viewport,
      locale: locales[randomInt(0, locales.length)],
      timezone: timezones[randomInt(0, timezones.length)],
      platform: platforms[randomInt(0, platforms.length)],
      deviceMemory: [2, 4, 8, 16][randomInt(0, 4)],
      hardwareConcurrency: [2, 4, 6, 8, 12, 16][randomInt(0, 6)],
      colorDepth: [16, 24, 32][randomInt(0, 3)],
      screenResolution: resolution.screen,
      cookiesEnabled: true,
      webgl: {
        vendor: webglVendors[randomInt(0, webglVendors.length)],
        renderer: webglRenderers[randomInt(0, webglRenderers.length)]
      }
    };
  }

  private async applyBrowserFingerprint(context: BrowserContext, fingerprint: BrowserFingerprint): Promise<void> {
    if (!this.stealthOptions.enableFingerprinting) return;

    // Apply fingerprinting via page scripts
    await context.addInitScript(() => {
      // Override navigator properties
      Object.defineProperty(navigator, 'platform', {
        get: () => (window as any).__STEALTH_PLATFORM__ || navigator.platform
      });

      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => (window as any).__STEALTH_DEVICE_MEMORY__ || (navigator as any).deviceMemory
      });

      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => (window as any).__STEALTH_HARDWARE_CONCURRENCY__ || navigator.hardwareConcurrency
      });

      // Override screen properties
      Object.defineProperty(screen, 'width', {
        get: () => (window as any).__STEALTH_SCREEN_WIDTH__ || screen.width
      });

      Object.defineProperty(screen, 'height', {
        get: () => (window as any).__STEALTH_SCREEN_HEIGHT__ || screen.height
      });

      Object.defineProperty(screen, 'colorDepth', {
        get: () => (window as any).__STEALTH_COLOR_DEPTH__ || screen.colorDepth
      });

      // WebGL fingerprinting override
      if (typeof WebGLRenderingContext !== 'undefined') {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter: any) {
          if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
            return (window as any).__STEALTH_WEBGL_VENDOR__ || getParameter.call(this, parameter);
          }
          if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
            return (window as any).__STEALTH_WEBGL_RENDERER__ || getParameter.call(this, parameter);
          }
          return getParameter.call(this, parameter);
        };
      }

      // Canvas fingerprinting noise
      if (typeof HTMLCanvasElement !== 'undefined') {
        const toDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(...args: any[]) {
          const dataURL = toDataURL.apply(this, args);
          if ((window as any).__STEALTH_CANVAS_NOISE__) {
            // Add minimal noise to canvas fingerprint
            return dataURL + Math.random().toString(36).substring(7);
          }
          return dataURL;
        };
      }
    });

    // Set the fingerprint values via page evaluation
    await context.addInitScript((fingerprint) => {
      (window as any).__STEALTH_PLATFORM__ = fingerprint.platform;
      (window as any).__STEALTH_DEVICE_MEMORY__ = fingerprint.deviceMemory;
      (window as any).__STEALTH_HARDWARE_CONCURRENCY__ = fingerprint.hardwareConcurrency;
      (window as any).__STEALTH_SCREEN_WIDTH__ = fingerprint.screenResolution.width;
      (window as any).__STEALTH_SCREEN_HEIGHT__ = fingerprint.screenResolution.height;
      (window as any).__STEALTH_COLOR_DEPTH__ = fingerprint.colorDepth;
      (window as any).__STEALTH_WEBGL_VENDOR__ = fingerprint.webgl.vendor;
      (window as any).__STEALTH_WEBGL_RENDERER__ = fingerprint.webgl.renderer;
      (window as any).__STEALTH_CANVAS_NOISE__ = true;
    }, fingerprint);
  }

  private generateResidentialHeaders(): Record<string, string> {
    if (!this.stealthOptions.useResidentialHeaders) return {};

    const acceptLanguages = [
      'en-US,en;q=0.9',
      'en-US,en;q=0.9,de;q=0.8',
      'en-GB,en-US;q=0.9,en;q=0.8',
      'en-US,en;q=0.9,es;q=0.8',
      'en-US,en;q=0.9,fr;q=0.8'
    ];

    const acceptEncodings = [
      'gzip, deflate, br',
      'gzip, deflate',
      'gzip, deflate, br, zstd'
    ];

    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': acceptLanguages[randomInt(0, acceptLanguages.length)],
      'Accept-Encoding': acceptEncodings[randomInt(0, acceptEncodings.length)],
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    };
  }

  async createStealthBrowser(): Promise<string> {
    const browserId = `stealth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      logger.debug('Creating new stealth browser instance', { browserId });

      const fingerprint = this.generateRandomFingerprint();

      // Use stealth-enabled chromium
      const browser = await chromiumStealth.launch({
        headless: config.browser.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=TranslateUI,BlinkGenPropertyTrees',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-gpu',
          '--disable-accelerated-2d-canvas',
          '--disable-accelerated-jpeg-decoding',
          '--disable-accelerated-mjpeg-decode',
          '--disable-accelerated-video-decode',
          '--disable-background-networking',
          '--disable-background-downloads',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--disable-sync',
          '--no-pings',
          '--media-cache-size=1',
          '--disk-cache-size=1'
        ],
      });

      const residentialHeaders = this.generateResidentialHeaders();

      const context = await browser.newContext({
        userAgent: fingerprint.userAgent,
        viewport: fingerprint.viewport,
        locale: fingerprint.locale,
        timezoneId: fingerprint.timezone,
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
        extraHTTPHeaders: residentialHeaders,
        colorScheme: 'light',
        reducedMotion: 'no-preference',
        forcedColors: 'none'
      });

      // Apply browser fingerprint
      await this.applyBrowserFingerprint(context, fingerprint);

      this.instances.set(browserId, {
        browser,
        context,
        fingerprint,
        inUse: false,
        createdAt: new Date(),
        lastUsed: new Date(),
        contextRotationCount: 0
      });

      logger.info('Stealth browser instance created', { 
        browserId, 
        totalInstances: this.instances.size,
        fingerprint: {
          userAgent: fingerprint.userAgent.substring(0, 50) + '...',
          locale: fingerprint.locale,
          timezone: fingerprint.timezone,
          viewport: fingerprint.viewport
        }
      });

      return browserId;
    } catch (error) {
      logger.error('Failed to create stealth browser instance', { error, browserId });
      throw error;
    }
  }

  private async rotateContext(browserId: string): Promise<void> {
    const instance = this.instances.get(browserId);
    if (!instance || !this.stealthOptions.rotateContexts) return;

    logger.debug('Rotating browser context', { browserId, rotationCount: instance.contextRotationCount });

    // Close old context
    await instance.context.close();

    // Generate new fingerprint
    const fingerprint = this.generateRandomFingerprint();
    const residentialHeaders = this.generateResidentialHeaders();

    // Create new context with new fingerprint
    const newContext = await instance.browser.newContext({
      userAgent: fingerprint.userAgent,
      viewport: fingerprint.viewport,
      locale: fingerprint.locale,
      timezoneId: fingerprint.timezone,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      extraHTTPHeaders: residentialHeaders,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      forcedColors: 'none'
    });

    // Apply new fingerprint
    await this.applyBrowserFingerprint(newContext, fingerprint);

    // Update instance
    instance.context = newContext;
    instance.fingerprint = fingerprint;
    instance.contextRotationCount = 0;

    logger.info('Browser context rotated', { 
      browserId, 
      newFingerprint: {
        userAgent: fingerprint.userAgent.substring(0, 50) + '...',
        locale: fingerprint.locale,
        timezone: fingerprint.timezone
      }
    });
  }

  async getStealthBrowser(): Promise<{ browserId: string; context: BrowserContext }> {
    if (this.instances.size >= this.maxInstances) {
      await this.cleanupOldInstances();
    }

    for (const [browserId, instance] of this.instances.entries()) {
      if (!instance.inUse) {
        // Check if context needs rotation
        if (instance.contextRotationCount >= this.maxContextRotations) {
          await this.rotateContext(browserId);
        }

        instance.inUse = true;
        instance.lastUsed = new Date();
        instance.contextRotationCount++;
        
        logger.debug('Reusing existing stealth browser instance', { 
          browserId, 
          contextRotationCount: instance.contextRotationCount 
        });
        return { browserId, context: instance.context };
      }
    }

    if (this.instances.size < this.maxInstances) {
      const browserId = await this.createStealthBrowser();
      const instance = this.instances.get(browserId)!;
      instance.inUse = true;
      instance.contextRotationCount++;
      
      return { browserId, context: instance.context };
    }

    throw new Error('No available stealth browser instances and maximum limit reached');
  }

  async createStealthPage(browserId?: string): Promise<{ page: Page; browserId: string }> {
    let browser;
    let actualBrowserId;

    if (browserId && this.instances.has(browserId)) {
      const instance = this.instances.get(browserId)!;
      browser = instance.context;
      actualBrowserId = browserId;
      instance.lastUsed = new Date();
    } else {
      const browserInfo = await this.getStealthBrowser();
      browser = browserInfo.context;
      actualBrowserId = browserInfo.browserId;
    }

    try {
      const page = await browser.newPage();
      
      page.setDefaultTimeout(this.instanceTimeout);
      page.setDefaultNavigationTimeout(this.instanceTimeout);

      // Add human-like behavior simulation
      if (this.stealthOptions.simulateHumanBehavior) {
        await this.addHumanBehaviorSimulation(page);
      }

      page.on('console', (msg) => {
        logger.debug('Stealth browser console', { 
          type: msg.type(), 
          text: msg.text(),
          browserId: actualBrowserId 
        });
      });

      page.on('pageerror', (error) => {
        logger.warn('Stealth browser page error', { 
          error: error.message,
          browserId: actualBrowserId 
        });
      });

      logger.debug('Stealth page created', { browserId: actualBrowserId });
      
      return { page, browserId: actualBrowserId };
    } catch (error) {
      this.releaseBrowser(actualBrowserId);
      throw error;
    }
  }

  private async addHumanBehaviorSimulation(page: Page): Promise<void> {
    // Add realistic mouse movement and timing patterns
    await page.addInitScript(() => {
      // Override setTimeout and setInterval to add realistic delays
      const originalSetTimeout = (window as any).setTimeout;
      (window as any).setTimeout = function(callback: any, delay: any, ...args: any[]) {
        // Add small random variation to timeouts (±10%)
        const variation = delay * 0.1 * (Math.random() - 0.5);
        const newDelay = Math.max(0, delay + variation);
        return originalSetTimeout(callback, newDelay, ...args);
      };

      // Add human-like mouse movement simulation
      let lastMouseEvent = Date.now();
      if (typeof document !== 'undefined') {
        document.addEventListener('mousemove', () => {
          lastMouseEvent = Date.now();
        });
      }

      // Simulate realistic network timing
      const originalFetch = (window as any).fetch;
      (window as any).fetch = function(...args: any[]) {
        // Add small random delay to simulate network latency variation
        const delay = Math.random() * 50 + 10; // 10-60ms
        return new Promise(resolve => {
          setTimeout(() => resolve(originalFetch.apply(this, args)), delay);
        });
      };
    });
  }

  async humanLikeDelay(min: number = 100, max: number = 300): Promise<void> {
    if (!this.stealthOptions.randomizeTimings) return;
    
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async releaseBrowser(browserId: string): Promise<void> {
    const instance = this.instances.get(browserId);
    if (instance) {
      instance.inUse = false;
      instance.lastUsed = new Date();
      logger.debug('Stealth browser instance released', { browserId });
    }
  }

  async closeBrowser(browserId: string): Promise<void> {
    const instance = this.instances.get(browserId);
    if (instance) {
      try {
        await instance.context.close();
        await instance.browser.close();
        this.instances.delete(browserId);
        logger.info('Stealth browser instance closed', { browserId });
      } catch (error) {
        logger.error('Error closing stealth browser instance', { error, browserId });
      }
    }
  }

  async closeAllBrowsers(): Promise<void> {
    logger.info('Closing all stealth browser instances', { count: this.instances.size });
    
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
        logger.debug('Cleaning up old stealth browser instance', { browserId, age });
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
      stealthOptions: this.stealthOptions
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
          logger.warn('Stealth browser instance disconnected, removing', { browserId });
          this.instances.delete(browserId);
        }
      }

      return true;
    } catch (error) {
      logger.error('Stealth browser health check failed', error);
      return false;
    }
  }
}

export const stealthBrowserManager = new StealthBrowserManager({
  enableFingerprinting: true,
  rotateContexts: true,
  randomizeTimings: true,
  simulateHumanBehavior: true,
  useResidentialHeaders: true
});

export default stealthBrowserManager;