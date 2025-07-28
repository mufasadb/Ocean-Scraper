# Experimental Directory

This directory contains tools, demos, and test results for Ocean Scraper development and validation.

## 📁 Directory Structure

```
experimental/
├── tools/               # Development and testing tools
│   └── simple-crawler.js   # Multi-page crawler demonstration
├── demos/               # Demo scripts and examples  
├── test-results/        # Real-world scraping test results
│   ├── SCRAPING_RESULTS_SUMMARY.md  # Comprehensive test summary
│   ├── wikipedia/       # Wikipedia scraping results
│   ├── pathofexile/     # Gaming forum scraping results
│   └── crawler/         # Multi-page crawling results
└── README.md           # This file
```

## 🛠️ Tools

### Multi-Page Crawler (`tools/simple-crawler.js`)
A demonstration crawler that shows multi-page scraping capabilities:

```bash
# Basic usage
node experimental/tools/simple-crawler.js "https://example.com" 2 5

# Arguments: URL, max-depth, max-pages
```

**Features**:
- Depth-based crawling (follows links to specified depth)
- Polite crawling with delays
- Link extraction and filtering
- Comprehensive result tracking
- JSON and Markdown output

**Example Results**:
- ✅ Path of Exile forums: 6 pages, 2 depths, 100% success
- ✅ Wikipedia articles: 5 pages, 2 depths, 100% success

## 📊 Test Results

### Real-World Website Testing
Our test results demonstrate Ocean Scraper working successfully on:

- **Wikipedia**: Complex articles with multilingual support
- **Gaming Forums**: Dynamic content and user-generated content
- **Documentation Sites**: Technical content with structured data
- **JavaScript-Heavy Sites**: Properly rendered dynamic content

### Performance Metrics
- **Success Rate**: 100% across all tested sites
- **Response Times**: 4-7 seconds average
- **Content Quality**: Perfect HTML→Markdown conversion
- **Multi-Page**: Successful depth-based crawling

See `test-results/SCRAPING_RESULTS_SUMMARY.md` for complete details.

## 🧪 Demos

This directory is reserved for demonstration scripts and examples showing Ocean Scraper capabilities.

## 🔧 Development Guidelines

### Adding New Tools
1. Create focused, single-purpose tools
2. Include clear documentation and usage examples
3. Follow the naming convention: `tool-purpose.js`
4. Add error handling and logging

### Test Result Storage
- Store real scraping results in `test-results/`
- Include both raw API responses and extracted content
- Document test parameters and outcomes
- Create summary files for analysis

### Cleanup Policy
- Keep tools that demonstrate functionality
- Archive old test results with timestamps
- Remove temporary or debugging files
- Maintain working examples for future reference

## 🚀 Usage Examples

### Testing New Websites
```bash
# Test single page
curl -X POST http://localhost:3000/api/v1/test/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'

# Test multi-page crawling
node experimental/tools/simple-crawler.js "https://example.com" 2 5
```

### Validating Functionality
```bash
# Run health check
curl http://localhost:3000/api/v1/health

# Check queue statistics
curl http://localhost:3000/api/v1/health/queues
```

## 📈 Evolution

This experimental directory will evolve with Ocean Scraper development:

1. **Phase 1** ✅: Basic scraping validation (completed)
2. **Phase 2** ✅: Multi-page crawling demo (completed)
3. **Phase 3**: VPN integration testing
4. **Phase 4**: Performance and scale testing
5. **Phase 5**: Advanced feature demonstrations

## 🎯 Purpose

The experimental directory serves to:

- **Validate** Ocean Scraper functionality on real websites
- **Demonstrate** advanced capabilities like multi-page crawling
- **Preserve** test results for analysis and comparison
- **Provide** tools for development and debugging
- **Document** real-world performance and compatibility

All tools and tests here are designed to be non-destructive and respectful of target websites.