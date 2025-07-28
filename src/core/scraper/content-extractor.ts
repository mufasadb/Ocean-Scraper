import { Page } from 'playwright';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import logger from '@/utils/logger';

export interface ExtractedContent {
  title?: string;
  content?: string;
  markdown?: string;
  html?: string;
  json?: any;
  metadata?: {
    description?: string;
    keywords?: string[];
    author?: string;
    publishedDate?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    canonicalUrl?: string;
    language?: string;
  };
  links?: Array<{
    text: string;
    href: string;
    type: 'internal' | 'external';
  }>;
  images?: Array<{
    src: string;
    alt?: string;
    title?: string;
  }>;
}

export interface ExtractionOptions {
  includeContent?: boolean;
  includeMetadata?: boolean;
  includeLinks?: boolean;
  includeImages?: boolean;
  excludeTags?: string[];
  onlyText?: boolean;
  structuredData?: boolean;
}

export class ContentExtractor {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
    });

    this.turndownService.addRule('removeScripts', {
      filter: ['script', 'style', 'noscript'],
      replacement: () => '',
    });
  }

  async extractContent(
    page: Page, 
    options: ExtractionOptions = {}
  ): Promise<ExtractedContent> {
    const {
      includeContent = true,
      includeMetadata = true,
      includeLinks = false,
      includeImages = false,
      excludeTags = ['script', 'style', 'noscript', 'nav', 'footer'],
      onlyText = false,
      structuredData = false,
    } = options;

    const result: ExtractedContent = {};

    try {
      const htmlContent = await page.content();
      const $ = cheerio.load(htmlContent);

      excludeTags.forEach(tag => $(tag).remove());

      if (includeContent) {
        result.html = $.html();
        
        if (!onlyText) {
          result.content = $('body').text().replace(/\s+/g, ' ').trim();
          result.markdown = this.turndownService.turndown(result.html);
        } else {
          result.content = $('body').text().replace(/\s+/g, ' ').trim();
        }

        if (structuredData) {
          result.json = await this.extractStructuredData(page);
        }
      }

      result.title = await this.extractTitle(page, $);

      if (includeMetadata) {
        result.metadata = await this.extractMetadata(page, $);
      }

      if (includeLinks) {
        result.links = this.extractLinks($, page.url());
      }

      if (includeImages) {
        result.images = this.extractImages($);
      }

      logger.debug('Content extracted successfully', {
        url: page.url(),
        titleLength: result.title?.length || 0,
        contentLength: result.content?.length || 0,
        linksCount: result.links?.length || 0,
        imagesCount: result.images?.length || 0,
      });

      return result;
    } catch (error) {
      logger.error('Content extraction failed', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        url: page.url()
      });
      throw error;
    }
  }

  private async extractTitle(page: Page, $: cheerio.CheerioAPI): Promise<string> {
    let title = $('title').text().trim();
    
    if (!title) {
      title = $('h1').first().text().trim();
    }
    
    if (!title) {
      title = $('meta[property="og:title"]').attr('content') || '';
    }
    
    if (!title) {
      try {
        title = await page.title();
      } catch (error) {
        logger.debug('Failed to get page title', error);
      }
    }

    return title || 'Untitled';
  }

  private async extractMetadata(page: Page, $: cheerio.CheerioAPI) {
    const metadata: ExtractedContent['metadata'] = {};

    metadata.description = $('meta[name="description"]').attr('content') ||
                          $('meta[property="og:description"]').attr('content') ||
                          '';

    const keywordsContent = $('meta[name="keywords"]').attr('content');
    if (keywordsContent) {
      metadata.keywords = keywordsContent.split(',').map(k => k.trim());
    }

    metadata.author = $('meta[name="author"]').attr('content') ||
                     $('meta[property="article:author"]').attr('content') ||
                     '';

    metadata.publishedDate = $('meta[property="article:published_time"]').attr('content') ||
                            $('meta[name="date"]').attr('content') ||
                            '';

    metadata.ogTitle = $('meta[property="og:title"]').attr('content') || '';
    metadata.ogDescription = $('meta[property="og:description"]').attr('content') || '';
    metadata.ogImage = $('meta[property="og:image"]').attr('content') || '';

    metadata.canonicalUrl = $('link[rel="canonical"]').attr('href') || '';
    metadata.language = $('html').attr('lang') || $('meta[http-equiv="content-language"]').attr('content') || '';

    return metadata;
  }

  private extractLinks($: cheerio.CheerioAPI, baseUrl: string) {
    const links: ExtractedContent['links'] = [];
    const baseDomain = new URL(baseUrl).hostname;

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      
      if (href && text) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          const linkDomain = new URL(absoluteUrl).hostname;
          
          links.push({
            text,
            href: absoluteUrl,
            type: linkDomain === baseDomain ? 'internal' : 'external',
          });
        } catch (error) {
          logger.debug('Invalid link URL', { href, error });
        }
      }
    });

    return links.slice(0, 100);
  }

  private extractImages($: cheerio.CheerioAPI) {
    const images: ExtractedContent['images'] = [];

    $('img[src]').each((_, element) => {
      const src = $(element).attr('src');
      const alt = $(element).attr('alt');
      const title = $(element).attr('title');
      
      if (src) {
        images.push({
          src,
          alt: alt || '',
          title: title || '',
        });
      }
    });

    return images.slice(0, 50);
  }

  private async extractStructuredData(page: Page): Promise<any> {
    try {
      const structuredData = await page.evaluate(() => {
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        const data: any[] = [];
        
        jsonLdScripts.forEach(script => {
          try {
            const parsed = JSON.parse(script.textContent || '');
            data.push(parsed);
          } catch (error) {
            console.warn('Failed to parse JSON-LD', error);
          }
        });

        const microdata = {};
        const microdataElements = document.querySelectorAll('[itemscope]');
        
        microdataElements.forEach((element) => {
          const itemType = element.getAttribute('itemtype');
          if (itemType) {
            const properties = {};
            const propertyElements = element.querySelectorAll('[itemprop]');
            
            propertyElements.forEach((propElement) => {
              const propName = propElement.getAttribute('itemprop');
              const content = propElement.getAttribute('content') || 
                            propElement.textContent || 
                            propElement.getAttribute('href');
              
              if (propName && content) {
                properties[propName] = content;
              }
            });
            
            if (Object.keys(properties).length > 0) {
              microdata[itemType] = properties;
            }
          }
        });

        return {
          jsonLd: data,
          microdata: Object.keys(microdata).length > 0 ? microdata : null,
        };
      });

      return structuredData;
    } catch (error) {
      logger.debug('Failed to extract structured data', error);
      return null;
    }
  }

  async extractMainContent(page: Page): Promise<string> {
    try {
      const mainContent = await page.evaluate(() => {
        const selectors = [
          'main',
          '[role="main"]',
          '.main-content',
          '.content',
          '#content',
          '.post-content',
          '.entry-content',
          'article',
          '.article-body'
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            return element.textContent?.trim() || '';
          }
        }

        const bodyElement = document.body;
        if (bodyElement) {
          const scripts = bodyElement.querySelectorAll('script, style, nav, footer, header, aside');
          scripts.forEach(script => script.remove());
          return bodyElement.textContent?.trim() || '';
        }

        return '';
      });

      return mainContent;
    } catch (error) {
      logger.error('Failed to extract main content', error);
      return '';
    }
  }
}

export const contentExtractor = new ContentExtractor();
export default contentExtractor;