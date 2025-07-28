#!/usr/bin/env node

/**
 * Anti-Bot Evasion Test Script
 * 
 * This script tests the enhanced anti-bot evasion capabilities of Ocean-Scraper.
 * It compares regular scraping vs enhanced stealth scraping against various test sites.
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const OUTPUT_DIR = './experimental/outputs';

// Test sites with varying levels of bot protection
const TEST_SITES = [
  {
    name: 'Basic Test Site',
    url: 'https://httpbin.org/html',
    expectedContent: ['Herman Melville', 'Moby Dick'],
    protection: 'none'
  },
  {
    name: 'Bot Detection Test',
    url: 'https://bot.sannysoft.com/',
    expectedContent: ['WebDriver', 'Chrome'],
    protection: 'basic'
  },
  {
    name: 'Wikipedia (Real Content)',
    url: 'https://en.wikipedia.org/wiki/Web_scraping',
    expectedContent: ['Web scraping', 'data extraction'],
    protection: 'low'
  },
  {
    name: 'Quotes to Scrape',
    url: 'http://quotes.toscrape.com/',
    expectedContent: ['Albert Einstein', 'quotes'],
    protection: 'low'
  },
  {
    name: 'Browser Fingerprint Test',
    url: 'https://amiunique.org/fp',
    expectedContent: ['fingerprint', 'browser'],
    protection: 'medium'
  }
];

// Test configurations
const TEST_CONFIGS = {
  regular: {
    name: 'Regular Scraping',
    options: {
      enableAntiBot: false,
      waitForTimeout: 5000,
      includeMetadata: true
    }
  },
  stealth: {
    name: 'Stealth Mode',
    options: {
      enableAntiBot: true,
      waitForTimeout: 5000,
      includeMetadata: true,
      humanBehavior: {
        enableMouseMovement: true,
        enableRandomScrolling: true,
        enableReadingPauses: true,
        minReadingTime: 2000,
        maxReadingTime: 5000
      },
      captchaHandling: true,
      maxRetries: 2
    }
  },
  aggressive: {
    name: 'Aggressive Anti-Bot',
    options: {
      enableAntiBot: true,
      waitForTimeout: 8000,
      includeMetadata: true,
      humanBehavior: {
        enableMouseMovement: true,
        enableRandomScrolling: true,
        enableTypingDelay: true,
        enableReadingPauses: true,
        minReadingTime: 3000,
        maxReadingTime: 8000
      },
      captchaHandling: true,
      maxRetries: 3,
      retryDelay: 2000
    }
  }
};

class AntiBotTester {
  constructor() {
    this.results = {};
    this.startTime = Date.now();
  }

  async run() {
    console.log('🤖 Ocean-Scraper Anti-Bot Evasion Test Suite');
    console.log('=' * 50);
    console.log(`Testing ${TEST_SITES.length} sites with ${Object.keys(TEST_CONFIGS).length} configurations\n`);

    // Ensure output directory exists
    await this.ensureOutputDir();

    // Test each site with each configuration
    for (const site of TEST_SITES) {
      console.log(`\n🌐 Testing: ${site.name} (${site.protection} protection)`);
      console.log(`URL: ${site.url}`);
      console.log('-'.repeat(60));

      this.results[site.name] = {};

      for (const [configName, config] of Object.entries(TEST_CONFIGS)) {
        console.log(`\n  📋 ${config.name}:`);
        
        try {
          const result = await this.testSite(site, config);
          this.results[site.name][configName] = result;
          
          console.log(`    ✅ Success: ${result.success}`);
          console.log(`    ⏱️  Time: ${result.responseTime}ms`);
          console.log(`    🛡️  Anti-bot: ${result.antiBotMode ? 'Enabled' : 'Disabled'}`);
          
          if (result.stealthMetrics) {
            console.log(`    🔄 Fingerprint Rotated: ${result.stealthMetrics.fingerprintRotated}`);
            console.log(`    🧩 CAPTCHA Solved: ${result.stealthMetrics.captchaSolved}`);
            console.log(`    🤖 Human Behavior: ${result.stealthMetrics.humanBehaviorApplied}`);
            console.log(`    🔄 Retry Count: ${result.stealthMetrics.retryCount}`);
          }
          
          // Save content sample
          await this.saveResult(site.name, configName, result);
          
        } catch (error) {
          console.log(`    ❌ Failed: ${error.message}`);
          this.results[site.name][configName] = {
            success: false,
            error: error.message,
            responseTime: 0
          };
        }
        
        // Wait between tests to avoid rate limiting
        await this.sleep(2000);
      }
    }

    // Generate report
    await this.generateReport();
    console.log('\n✅ Test suite completed!');
    console.log(`📊 Full report saved to: ${OUTPUT_DIR}/anti-bot-test-report.json`);
  }

  async testSite(site, config) {
    const requestData = {
      url: site.url,
      formats: ['markdown', 'json'],
      options: config.options
    };

    const response = await axios.post(
      `${BASE_URL}/api/v1/test/scrape`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 second timeout
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Scraping failed');
    }

    const result = response.data.data;
    
    // Check if expected content is present
    const hasExpectedContent = this.checkExpectedContent(
      result.content.markdown || '', 
      site.expectedContent
    );

    return {
      ...result,
      hasExpectedContent,
      contentLength: (result.content.markdown || '').length,
      titlePresent: !!result.title,
      metadataPresent: !!result.metadata
    };
  }

  checkExpectedContent(content, expectedStrings) {
    const lowerContent = content.toLowerCase();
    return expectedStrings.some(str => lowerContent.includes(str.toLowerCase()));
  }

  async saveResult(siteName, configName, result) {
    const filename = `${siteName.replace(/[^a-zA-Z0-9]/g, '_')}_${configName}.md`;
    const filepath = path.join(OUTPUT_DIR, filename);
    
    const content = `# ${siteName} - ${configName}\n\n` +
                   `**URL:** ${result.url}\n` +
                   `**Timestamp:** ${new Date().toISOString()}\n` +
                   `**Response Time:** ${result.responseTime}ms\n` +
                   `**Anti-Bot Mode:** ${result.antiBotMode ? 'Enabled' : 'Disabled'}\n\n` +
                   `## Content\n\n${result.content.markdown || 'No markdown content'}`;
    
    await fs.writeFile(filepath, content);
  }

  async generateReport() {
    const report = {
      testSuite: 'Ocean-Scraper Anti-Bot Evasion',
      timestamp: new Date().toISOString(),
      duration: Date.now() - this.startTime,
      summary: this.generateSummary(),
      results: this.results
    };

    const reportPath = path.join(OUTPUT_DIR, 'anti-bot-test-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    // Generate summary table
    console.log('\n📊 Test Results Summary:');
    console.log('=' * 80);
    console.log('Site'.padEnd(20) + 'Regular'.padEnd(15) + 'Stealth'.padEnd(15) + 'Aggressive'.padEnd(15));
    console.log('-' * 80);

    for (const [siteName, siteResults] of Object.entries(this.results)) {
      const regular = siteResults.regular?.success ? '✅' : '❌';
      const stealth = siteResults.stealth?.success ? '✅' : '❌';
      const aggressive = siteResults.aggressive?.success ? '✅' : '❌';
      
      console.log(
        siteName.substring(0, 18).padEnd(20) +
        regular.padEnd(15) +
        stealth.padEnd(15) +
        aggressive.padEnd(15)
      );
    }
  }

  generateSummary() {
    const summary = {
      totalTests: 0,
      successful: 0,
      failed: 0,
      configurations: {}
    };

    for (const configName of Object.keys(TEST_CONFIGS)) {
      summary.configurations[configName] = {
        successful: 0,
        failed: 0,
        avgResponseTime: 0
      };
    }

    let totalResponseTime = {};
    Object.keys(TEST_CONFIGS).forEach(config => totalResponseTime[config] = 0);

    for (const siteResults of Object.values(this.results)) {
      for (const [configName, result] of Object.entries(siteResults)) {
        summary.totalTests++;
        
        if (result.success) {
          summary.successful++;
          summary.configurations[configName].successful++;
          totalResponseTime[configName] += result.responseTime || 0;
        } else {
          summary.failed++;
          summary.configurations[configName].failed++;
        }
      }
    }

    // Calculate average response times
    for (const configName of Object.keys(TEST_CONFIGS)) {
      const successCount = summary.configurations[configName].successful;
      if (successCount > 0) {
        summary.configurations[configName].avgResponseTime = 
          Math.round(totalResponseTime[configName] / successCount);
      }
    }

    return summary;
  }

  async ensureOutputDir() {
    try {
      await fs.access(OUTPUT_DIR);
    } catch {
      await fs.mkdir(OUTPUT_DIR, { recursive: true });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Performance test function
async function performanceTest() {
  console.log('\n🚀 Running Performance Comparison Test');
  console.log('-'.repeat(50));

  const testUrl = 'https://en.wikipedia.org/wiki/Artificial_intelligence';
  const iterations = 3;

  for (const [configName, config] of Object.entries(TEST_CONFIGS)) {
    console.log(`\n📊 Testing ${config.name} (${iterations} iterations):`);
    
    const times = [];
    for (let i = 0; i < iterations; i++) {
      try {
        const start = Date.now();
        const response = await axios.post(
          `${BASE_URL}/api/v1/test/scrape`,
          {
            url: testUrl,
            formats: ['markdown'],
            options: config.options
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000
          }
        );
        const time = Date.now() - start;
        times.push(time);
        console.log(`  Iteration ${i + 1}: ${time}ms`);
        
        // Wait between iterations
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.log(`  Iteration ${i + 1}: Failed - ${error.message}`);
      }
    }

    if (times.length > 0) {
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      const min = Math.min(...times);
      const max = Math.max(...times);
      console.log(`  Average: ${avg}ms | Min: ${min}ms | Max: ${max}ms`);
    }
  }
}

// Service status check
async function checkServiceStatus() {
  console.log('🔍 Checking Ocean-Scraper Service Status...\n');

  try {
    const healthResponse = await axios.get(`${BASE_URL}/api/v1/health`);
    console.log('✅ Health Check:', healthResponse.data.success ? 'PASSED' : 'FAILED');

    // Check for enhanced features
    const testResponse = await axios.post(
      `${BASE_URL}/api/v1/test/scrape`,
      {
        url: 'https://httpbin.org/html',
        formats: ['markdown'],
        options: { enableAntiBot: true }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );

    if (testResponse.data.success) {
      const result = testResponse.data.data;
      console.log('✅ Anti-Bot Features:', result.antiBotMode ? 'ENABLED' : 'DISABLED');
      
      if (result.stealthMetrics) {
        console.log('🛡️  Stealth Metrics Available: YES');
        console.log(`   - Fingerprint Support: ${result.stealthMetrics.fingerprintRotated !== undefined ? 'YES' : 'NO'}`);
        console.log(`   - CAPTCHA Support: ${result.stealthMetrics.captchaSolved !== undefined ? 'YES' : 'NO'}`);
        console.log(`   - Human Behavior: ${result.stealthMetrics.humanBehaviorApplied !== undefined ? 'YES' : 'NO'}`);
      } else {
        console.log('🛡️  Stealth Metrics Available: NO');
      }
    }
    
    console.log('\n');
  } catch (error) {
    console.log('❌ Service Check Failed:', error.message);
    console.log('Make sure Ocean-Scraper is running on', BASE_URL);
    process.exit(1);
  }
}

// Main execution
async function main() {
  await checkServiceStatus();

  const args = process.argv.slice(2);
  
  if (args.includes('--performance')) {
    await performanceTest();
  } else {
    const tester = new AntiBotTester();
    await tester.run();
    
    if (args.includes('--with-performance')) {
      await performanceTest();
    }
  }
}

// Export for use as module
module.exports = { AntiBotTester, performanceTest, checkServiceStatus };

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test suite failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
}