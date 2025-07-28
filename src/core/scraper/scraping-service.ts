import { Page } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { config } from '@/config';
import browserManager from './browser-manager';
import contentExtractor, { ExtractedContent, ExtractionOptions } from './content-extractor';
import vpnService from '@/core/vpn/vpn-service';
import logger from '@/utils/logger';

export interface ScrapeOptions {
  waitForSelector?: string;
  waitForTimeout?: number;
  includeContent?: boolean;
  includeMetadata?: boolean;
  includeLinks?: boolean;
  includeImages?: boolean;
  excludeTags?: string[];
  customHeaders?: Record<string, string>;
  actions?: Array<{
    type: 'click' | 'fill' | 'scroll' | 'wait' | 'screenshot';
    selector?: string;
    value?: string;
    timeout?: number;
  }>;
  userAgent?: string;
  viewport?: { width: number; height: number };
  requireVpn?: boolean;
}

export interface ScrapeResult {
  url: string;
  title?: string;
  content: {
    markdown?: string;
    html?: string;
    json?: any;
    screenshot?: string;
    pdf?: string;
  };
  metadata?: ExtractedContent['metadata'];
  links?: ExtractedContent['links'];
  images?: ExtractedContent['images'];
  statusCode?: number;
  responseTime: number;
  timestamp: string;
  vpnStatus?: {
    enabled: boolean;
    connected: boolean;
    publicIp?: string;
  };
}

export class ScrapingService {
  async scrapePage(
    url: string, 
    formats: string[] = ['markdown'],
    options: ScrapeOptions = {}
  ): Promise<ScrapeResult> {
    const startTime = Date.now();
    let browserId: string | undefined;
    let page: Page | undefined;

    try {
      logger.info('Starting page scrape', { url, formats, options });

      // Check VPN requirements before proceeding
      await this.checkVpnRequirements(options);

      const { page: browserPage, browserId: id } = await browserManager.createPage();
      page = browserPage;
      browserId = id;

      if (options.customHeaders) {
        await page.setExtraHTTPHeaders(options.customHeaders);
      }

      if (options.userAgent) {
        await page.context().setExtraHTTPHeaders({ 'User-Agent': options.userAgent });
      }

      if (options.viewport) {
        await page.setViewportSize(options.viewport);
      }

      logger.debug('Navigating to URL', { url, browserId });
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options.waitForTimeout || config.scraping.defaultTimeout,
      });

      const statusCode = response?.status() || 0;

      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, {
          timeout: options.waitForTimeout || 5000,
        });
      } else if (options.waitForTimeout) {
        await page.waitForTimeout(options.waitForTimeout);
      }

      if (options.actions) {
        await this.executeActions(page, options.actions);
      }

      const extractionOptions: ExtractionOptions = {
        includeContent: options.includeContent !== false,
        includeMetadata: options.includeMetadata !== false,
        includeLinks: options.includeLinks || false,
        includeImages: options.includeImages || false,
        excludeTags: options.excludeTags,
        structuredData: formats.includes('json'),
      };

      const extractedContent = await contentExtractor.extractContent(page, extractionOptions);

      // Get VPN status for result
      const vpnStatus = await vpnService.getVpnStatus();

      const result: ScrapeResult = {
        url,
        title: extractedContent.title,
        content: {},
        metadata: extractedContent.metadata,
        links: extractedContent.links,
        images: extractedContent.images,
        statusCode,
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        vpnStatus: {
          enabled: config.vpn.enabled,
          connected: vpnStatus.connected,
          publicIp: vpnStatus.publicIp,
        },
      };

      for (const format of formats) {
        switch (format) {
          case 'markdown':
            result.content.markdown = extractedContent.markdown;
            break;
          case 'html':
            result.content.html = extractedContent.html;
            break;
          case 'json':
            result.content.json = extractedContent.json || {
              title: extractedContent.title,
              content: extractedContent.content,
              metadata: extractedContent.metadata,
            };
            break;
          case 'screenshot':
            result.content.screenshot = await this.takeScreenshot(page, url);
            break;
          case 'pdf':
            result.content.pdf = await this.generatePdf(page, url);
            break;
        }
      }

      logger.info('Page scrape completed', { 
        url, 
        statusCode, 
        responseTime: result.responseTime,
        formats 
      });

      return result;

    } catch (error) {
      logger.error('Page scrape failed', { 
        url, 
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - startTime 
      });
      throw error;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (error) {
          logger.warn('Failed to close page', { error });
        }
      }
      if (browserId) {
        await browserManager.releaseBrowser(browserId);
      }
    }
  }

  private async executeActions(page: Page, actions: ScrapeOptions['actions']): Promise<void> {
    if (!actions) return;

    for (const action of actions) {
      try {
        logger.debug('Executing action', { action });

        switch (action.type) {
          case 'click':
            if (action.selector) {
              await page.click(action.selector, { timeout: action.timeout || 5000 });
            }
            break;

          case 'fill':
            if (action.selector && action.value) {
              await page.fill(action.selector, action.value, { timeout: action.timeout || 5000 });
            }
            break;

          case 'scroll':
            if (action.selector) {
              await page.locator(action.selector).scrollIntoViewIfNeeded();
            } else {
              await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            }
            break;

          case 'wait':
            if (action.selector) {
              await page.waitForSelector(action.selector, { timeout: action.timeout || 5000 });
            } else {
              await page.waitForTimeout(action.timeout || 1000);
            }
            break;

          case 'screenshot':
            await this.takeScreenshot(page, `action_${Date.now()}`);
            break;
        }

        await page.waitForTimeout(500);

      } catch (error) {
        logger.warn('Action execution failed', { 
          action, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
  }

  private async takeScreenshot(page: Page, identifier: string): Promise<string> {
    try {
      const screenshotDir = config.paths.screenshots;
      await fs.mkdir(screenshotDir, { recursive: true });

      const filename = `screenshot_${this.sanitizeFilename(identifier)}_${Date.now()}.png`;
      const filepath = path.join(screenshotDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: true,
        type: 'png',
      });

      logger.debug('Screenshot taken', { filepath });
      return filepath;

    } catch (error) {
      logger.error('Failed to take screenshot', { error, identifier });
      throw error;
    }
  }

  private async generatePdf(page: Page, identifier: string): Promise<string> {
    try {
      const downloadsDir = config.paths.downloads;
      await fs.mkdir(downloadsDir, { recursive: true });

      const filename = `pdf_${this.sanitizeFilename(identifier)}_${Date.now()}.pdf`;
      const filepath = path.join(downloadsDir, filename);

      await page.pdf({
        path: filepath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '1cm',
          right: '1cm',
          bottom: '1cm',
          left: '1cm',
        },
      });

      logger.debug('PDF generated', { filepath });
      return filepath;

    } catch (error) {
      logger.error('Failed to generate PDF', { error, identifier });
      throw error;
    }
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-z0-9.-]/gi, '_')
      .replace(/_{2,}/g, '_')
      .substring(0, 100);
  }

  private async checkVpnRequirements(options: ScrapeOptions): Promise<void> {
    try {
      // Check if VPN is required by configuration or request options
      const isVpnRequired = options.requireVpn || config.vpn.required;
      
      if (isVpnRequired) {
        logger.debug('VPN required for this request, checking connection');
        await vpnService.ensureVpnConnection();
        
        // Verify VPN is actually working
        const healthCheck = await vpnService.performHealthCheck();
        if (!healthCheck.isHealthy) {
          throw new Error(`VPN health check failed: ${healthCheck.errorMessage || 'Connection unhealthy'}`);
        }
        
        logger.info('VPN requirement satisfied', {
          vpnEnabled: config.vpn.enabled,
          ipChanged: healthCheck.ipChanged,
          latency: healthCheck.latency,
        });
      } else if (config.vpn.enabled) {
        // VPN enabled but not required - just log status
        const status = await vpnService.getVpnStatus();
        logger.debug('VPN status', { connected: status.connected, publicIp: status.publicIp });
      }
    } catch (error) {
      logger.error('VPN requirement check failed', { error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const browserHealthy = await browserManager.healthCheck();
      let vpnHealthy = true;
      
      // If VPN is enabled, check its health
      if (config.vpn.enabled) {
        const vpnHealthCheck = await vpnService.performHealthCheck();
        vpnHealthy = vpnHealthCheck.isHealthy;
        
        if (!vpnHealthy) {
          logger.warn('VPN health check failed during service health check', {
            errorMessage: vpnHealthCheck.errorMessage,
          });
        }
      }
      
      return browserHealthy && vpnHealthy;
    } catch (error) {
      logger.error('Scraping service health check failed', error);
      return false;
    }
  }

  async getStats() {
    const vpnStats = vpnService.getStats();
    
    return {
      browserStats: browserManager.getStats(),
      vpnStats,
      service: 'ready',
    };
  }
}

export const scrapingService = new ScrapingService();
export default scrapingService;