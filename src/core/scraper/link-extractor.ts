import { URL } from 'url';
import logger from '@/utils/logger';

export interface Link {
  href: string;
  text: string;
  type: 'internal' | 'external';
  title?: string;
  rel?: string;
}

export interface LinkExtractionOptions {
  includePatterns?: string[];
  excludePatterns?: string[];
  respectRobotsTxt?: boolean;
  sameDomainOnly?: boolean;
  maxLinksPerPage?: number;
}

export class LinkExtractor {
  /**
   * Extract and classify links from scraped content
   */
  extractLinks(links: Link[], baseUrl: string, options: LinkExtractionOptions = {}): string[] {
    try {
      const baseUrlObj = new URL(baseUrl);
      const extractedLinks: string[] = [];

      for (const link of links || []) {
        try {
          const absoluteUrl = this.resolveUrl(link.href, baseUrl);
          if (!absoluteUrl) continue;

          const linkUrl = new URL(absoluteUrl);

          // Skip non-HTTP protocols
          if (!['http:', 'https:'].includes(linkUrl.protocol)) {
            continue;
          }

          // Check if link should be included
          if (this.shouldIncludeLink(absoluteUrl, baseUrlObj, options)) {
            extractedLinks.push(absoluteUrl);
          }

        } catch (error) {
          logger.debug('Failed to process link', { 
            href: link.href, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }

      // Apply max links limit
      const maxLinks = options.maxLinksPerPage || 50;
      const limitedLinks = extractedLinks.slice(0, maxLinks);

      logger.debug('Links extracted', { 
        total: links?.length || 0,
        extracted: extractedLinks.length,
        limited: limitedLinks.length,
        baseUrl 
      });

      return limitedLinks;

    } catch (error) {
      logger.error('Link extraction failed', { 
        baseUrl, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return [];
    }
  }

  /**
   * Filter links by include/exclude patterns
   */
  filterLinksByPatterns(links: string[], includePatterns: string[] = [], excludePatterns: string[] = []): string[] {
    let filteredLinks = [...links];

    // Apply include patterns (if any)
    if (includePatterns.length > 0) {
      filteredLinks = filteredLinks.filter(link => 
        includePatterns.some(pattern => this.matchesPattern(link, pattern))
      );
    }

    // Apply exclude patterns
    if (excludePatterns.length > 0) {
      filteredLinks = filteredLinks.filter(link => 
        !excludePatterns.some(pattern => this.matchesPattern(link, pattern))
      );
    }

    logger.debug('Links filtered by patterns', {
      original: links.length,
      filtered: filteredLinks.length,
      includePatterns,
      excludePatterns
    });

    return filteredLinks;
  }

  /**
   * Remove duplicate URLs and normalize
   */
  deduplicateLinks(links: string[]): string[] {
    const normalized = links.map(link => this.normalizeUrl(link));
    const unique = [...new Set(normalized)];
    
    logger.debug('Links deduplicated', {
      original: links.length,
      unique: unique.length
    });

    return unique;
  }

  /**
   * Check if URL should be crawled based on robots.txt
   */
  async respectsRobotsTxt(_url: string): Promise<boolean> {
    // TODO: Implement robots.txt checking
    // For now, return true (allow all)
    return true;
  }

  /**
   * Resolve relative URL to absolute URL
   */
  private resolveUrl(href: string, baseUrl: string): string | null {
    try {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        return href;
      }

      // Handle protocol-relative URLs
      if (href.startsWith('//')) {
        const baseUrlObj = new URL(baseUrl);
        return `${baseUrlObj.protocol}${href}`;
      }

      // Resolve relative URLs
      return new URL(href, baseUrl).href;

    } catch (error) {
      logger.debug('Failed to resolve URL', { href, baseUrl });
      return null;
    }
  }

  /**
   * Check if link should be included based on options
   */
  private shouldIncludeLink(url: string, baseUrl: URL, options: LinkExtractionOptions): boolean {
    try {
      const linkUrl = new URL(url);

      // Same domain only check
      if (options.sameDomainOnly && linkUrl.hostname !== baseUrl.hostname) {
        return false;
      }

      // Skip common file extensions that aren't pages
      const skipExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.css', '.js', '.xml', '.zip', '.doc', '.docx'];
      const pathname = linkUrl.pathname.toLowerCase();
      if (skipExtensions.some(ext => pathname.endsWith(ext))) {
        return false;
      }

      // Skip common non-content URLs
      const skipPatterns = [
        '/wp-admin',
        '/admin',
        '/login',
        '/logout',
        '/register',
        '/user/',
        '/profile/',
        '/account/',
        '#',
        'javascript:',
        'mailto:',
        'tel:',
        'ftp:'
      ];

      if (skipPatterns.some(pattern => url.includes(pattern))) {
        return false;
      }

      // Skip URLs with too many query parameters (likely dynamic/session URLs)
      if (linkUrl.search && linkUrl.search.split('&').length > 5) {
        return false;
      }

      return true;

    } catch (error) {
      return false;
    }
  }

  /**
   * Check if URL matches a pattern (supports wildcards)
   */
  private matchesPattern(url: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(url);
  }

  /**
   * Normalize URL for deduplication
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      
      // Remove fragment
      urlObj.hash = '';
      
      // Remove trailing slash from pathname (unless it's just '/')
      if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      
      // Sort query parameters for consistent ordering
      if (urlObj.searchParams) {
        const sortedParams = new URLSearchParams();
        const paramNames = Array.from(urlObj.searchParams.keys()).sort();
        for (const name of paramNames) {
          const values = urlObj.searchParams.getAll(name);
          for (const value of values) {
            sortedParams.append(name, value);
          }
        }
        urlObj.search = sortedParams.toString();
      }
      
      return urlObj.href;
    } catch (error) {
      return url;
    }
  }

  /**
   * Validate that a URL is crawlable
   */
  isValidCrawlUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      
      // Must be HTTP/HTTPS
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return false;
      }
      
      // Must have a valid hostname
      if (!urlObj.hostname || urlObj.hostname.length === 0) {
        return false;
      }
      
      // Must not be localhost/private IP in production
      const hostname = urlObj.hostname.toLowerCase();
      if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
        // Allow in development
        return process.env.NODE_ENV === 'development';
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }
}

export const linkExtractor = new LinkExtractor();
export default linkExtractor;