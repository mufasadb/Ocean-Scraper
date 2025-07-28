#!/usr/bin/env node

/**
 * Simple Multi-Page Crawler Demo
 * This demonstrates basic crawling functionality for Ocean Scraper
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const API_BASE = 'http://localhost:3000/api/v1/test';
const OUTPUT_DIR = './experimental/outputs/crawler';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapePage(url, outputPath) {
  try {
    console.log(`🔍 Scraping: ${url}`);
    
    const response = await axios.post(`${API_BASE}/scrape`, {
      url: url,
      formats: ['markdown', 'json'],
      options: {
        waitForTimeout: 3000,
        includeMetadata: true,
        includeLinks: true,
        excludeTags: ['script', 'style', 'nav', 'footer', 'ad']
      }
    });

    if (response.data.success) {
      // Save the full response
      await fs.writeFile(
        path.join(outputPath, 'response.json'), 
        JSON.stringify(response.data, null, 2)
      );

      // Save just the markdown content
      if (response.data.data.content.markdown) {
        await fs.writeFile(
          path.join(outputPath, 'content.md'),
          response.data.data.content.markdown
        );
      }

      // Extract internal links for potential crawling
      const links = response.data.data.links || [];
      const internalLinks = links
        .filter(link => link.type === 'internal')
        .map(link => link.href)
        .slice(0, 5); // Limit to 5 links per page

      console.log(`✅ Scraped: ${url} (${internalLinks.length} internal links found)`);
      return { success: true, links: internalLinks, data: response.data.data };
    }
  } catch (error) {
    console.error(`❌ Failed to scrape ${url}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function crawlMultiPage(startUrl, maxDepth = 2, maxPages = 10) {
  console.log(`🚀 Starting multi-page crawl from: ${startUrl}`);
  console.log(`📊 Max depth: ${maxDepth}, Max pages: ${maxPages}`);
  
  const crawled = new Set();
  const toCrawl = [{ url: startUrl, depth: 0 }];
  const results = [];

  // Create output directory with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const crawlDir = path.join(OUTPUT_DIR, `crawl_${timestamp}`);
  await fs.mkdir(crawlDir, { recursive: true });

  let pageCount = 0;

  while (toCrawl.length > 0 && pageCount < maxPages) {
    const { url, depth } = toCrawl.shift();
    
    // Skip if already crawled or too deep
    if (crawled.has(url) || depth > maxDepth) {
      continue;
    }

    crawled.add(url);
    pageCount++;

    // Create directory for this page
    const pageDir = path.join(crawlDir, `page_${pageCount}_depth_${depth}`);
    await fs.mkdir(pageDir, { recursive: true });

    // Scrape the page
    const result = await scrapePage(url, pageDir);
    
    if (result.success) {
      results.push({
        url,
        depth,
        pageNumber: pageCount,
        timestamp: new Date().toISOString(),
        ...result
      });

      // Add found links to crawl queue (next depth level)
      if (depth < maxDepth && result.links) {
        for (const link of result.links) {
          if (!crawled.has(link) && !toCrawl.some(item => item.url === link)) {
            toCrawl.push({ url: link, depth: depth + 1 });
          }
        }
      }
    }

    // Be polite - delay between requests
    await delay(2000);
  }

  // Save crawl summary
  const summary = {
    startUrl,
    maxDepth,
    maxPages,
    totalPagesCrawled: results.length,
    crawlStarted: new Date().toISOString(),
    results: results.map(r => ({
      url: r.url,
      depth: r.depth,
      pageNumber: r.pageNumber,
      success: r.success,
      linksFound: r.links ? r.links.length : 0,
      title: r.data ? r.data.title : null
    }))
  };

  await fs.writeFile(
    path.join(crawlDir, 'crawl_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(`🏁 Crawl completed!`);
  console.log(`📁 Results saved to: ${crawlDir}`);
  console.log(`📊 Pages crawled: ${results.length}`);
  console.log(`📈 Success rate: ${(results.filter(r => r.success).length / results.length * 100).toFixed(1)}%`);

  return summary;
}

// Run the crawler if this file is executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const startUrl = args[0] || 'https://en.wikipedia.org/wiki/Web_scraping';
  const maxDepth = parseInt(args[1]) || 2;
  const maxPages = parseInt(args[2]) || 8;

  crawlMultiPage(startUrl, maxDepth, maxPages)
    .then(summary => {
      console.log('✨ Crawl Summary:');
      console.log(`   Start URL: ${summary.startUrl}`);
      console.log(`   Pages: ${summary.totalPagesCrawled}`);
      console.log(`   Max Depth: ${summary.maxDepth}`);
    })
    .catch(error => {
      console.error('💥 Crawl failed:', error);
      process.exit(1);
    });
}

module.exports = { crawlMultiPage, scrapePage };