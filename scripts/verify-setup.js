#!/usr/bin/env node

/**
 * Ocean Scraper Setup Verification Script
 * 
 * This script verifies that Ocean Scraper is properly set up for Claude Code MCP integration.
 * Run with: node scripts/verify-setup.js
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🌊 Ocean Scraper Setup Verification\n');

const checks = [
  {
    name: 'Node.js Dependencies',
    check: () => fs.existsSync('node_modules'),
    fix: 'Run: npm install'
  },
  {
    name: 'Environment Configuration',
    check: () => fs.existsSync('.env'),
    fix: 'Run: cp .env.example .env'
  },
  {
    name: 'Playwright Browsers',
    check: async () => {
      return new Promise((resolve) => {
        exec('npx playwright --version', (error) => {
          resolve(!error);
        });
      });
    },
    fix: 'Run: npx playwright install'
  },
  {
    name: 'Docker Infrastructure',
    check: async () => {
      return new Promise((resolve) => {
        exec('docker-compose -f docker/docker-compose.mcp.yml ps --format json', (error, stdout) => {
          if (error) {
            resolve(false);
            return;
          }
          try {
            const services = JSON.parse(`[${stdout.trim().split('\n').join(',')}]`);
            const running = services.filter(s => s.State === 'running').length;
            resolve(running >= 2); // Should have at least postgres and redis running
          } catch {
            resolve(false);
          }
        });
      });
    },
    fix: 'Run: npm run mcp:setup'
  },
  {
    name: 'MCP Server Executable',
    check: () => fs.existsSync('src/mcp-server.ts'),
    fix: 'File should exist in repository'
  }
];

async function runChecks() {
  let allPassed = true;
  
  for (const check of checks) {
    process.stdout.write(`Checking ${check.name}... `);
    
    try {
      const result = typeof check.check === 'function' ? await check.check() : check.check;
      
      if (result) {
        console.log('✅ PASS');
      } else {
        console.log('❌ FAIL');
        console.log(`  Fix: ${check.fix}`);
        allPassed = false;
      }
    } catch (error) {
      console.log('❌ ERROR');
      console.log(`  Error: ${error.message}`);
      console.log(`  Fix: ${check.fix}`);
      allPassed = false;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  
  if (allPassed) {
    console.log('🎉 All checks passed! Ocean Scraper is ready for Claude Code.');
    console.log('\nNext steps:');
    console.log('1. Add to Claude Code: claude mcp add ocean-scraper -s user -- npm run mcp:server');
    console.log('2. Test in Claude Code by asking: "Please check the health of the Ocean Scraper service"');
  } else {
    console.log('⚠️  Some checks failed. Please fix the issues above and run again.');
    console.log('\nQuick fixes:');
    console.log('- npm run setup (for dependencies and config)');
    console.log('- npm run mcp:setup (for Docker infrastructure)');
  }
}

// Test MCP server response if infrastructure is running
async function testMcpServer() {
  console.log('\n🧪 Testing MCP Server Response...');
  
  return new Promise((resolve) => {
    const testProcess = exec('echo \'{"method":"tools/list","jsonrpc":"2.0","id":1}\' | npm run mcp:server', 
      { timeout: 10000 }, 
      (error, stdout, stderr) => {
        if (error) {
          console.log('❌ MCP Server test failed');
          console.log('  This is normal if infrastructure is not running');
          console.log('  Run: npm run mcp:setup');
          resolve(false);
          return;
        }
        
        try {
          // Look for tools response in stdout
          if (stdout.includes('"tools"') || stdout.includes('scrape_page')) {
            console.log('✅ MCP Server responding correctly');
            resolve(true);
          } else {
            console.log('⚠️  MCP Server started but may not be fully ready');
            resolve(false);
          }
        } catch {
          console.log('⚠️  Could not parse MCP Server response');
          resolve(false);
        }
      }
    );
    
    // Kill process after timeout to prevent hanging
    setTimeout(() => {
      testProcess.kill();
      resolve(false);
    }, 10000);
  });
}

// Main execution
async function main() {
  await runChecks();
  
  // Only test MCP server if basic checks pass
  const basicChecks = checks.slice(0, 4); // Skip MCP server file check for now
  let canTestMcp = true;
  
  for (const check of basicChecks) {
    try {
      const result = typeof check.check === 'function' ? await check.check() : check.check;
      if (!result) {
        canTestMcp = false;
        break;
      }
    } catch {
      canTestMcp = false;
      break;
    }
  }
  
  if (canTestMcp) {
    await testMcpServer();
  }
  
  console.log('\n📚 For more help, see: README.md (Claude Code MCP Integration section)');
}

main().catch(console.error);