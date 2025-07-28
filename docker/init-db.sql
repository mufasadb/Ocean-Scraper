-- Ocean Scraper Database Initialization

-- Create database if not exists (this runs in docker-entrypoint-initdb.d)
-- The database 'ocean_scraper' is already created by POSTGRES_DB

-- Connect to ocean_scraper database
\c ocean_scraper;

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create enum types
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE job_type AS ENUM ('scrape', 'crawl', 'search');
CREATE TYPE output_format AS ENUM ('markdown', 'html', 'json', 'screenshot', 'pdf');

-- Jobs table for tracking scrape/crawl operations
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type job_type NOT NULL,
    status job_status NOT NULL DEFAULT 'pending',
    url TEXT NOT NULL,
    options JSONB DEFAULT '{}',
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    progress INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    -- Crawl progress tracking
    current_url TEXT,
    pages_crawled INTEGER DEFAULT 0,
    max_depth_reached INTEGER DEFAULT 0
);

-- Pages table for storing scraped content
CREATE TABLE pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    content TEXT,
    markdown_content TEXT,
    html_content TEXT,
    json_data JSONB,
    screenshot_path TEXT,
    pdf_path TEXT,
    metadata JSONB DEFAULT '{}',
    status_code INTEGER,
    error_message TEXT,
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processing_time_ms INTEGER,
    -- Crawl-specific fields
    depth INTEGER DEFAULT 0,
    parent_url TEXT,
    links_found INTEGER DEFAULT 0,
    discovered_from TEXT
);

-- URLs table for crawl queue management
CREATE TABLE crawl_urls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    parent_url TEXT,
    depth INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

-- API keys table for authentication
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    rate_limit_per_hour INTEGER DEFAULT 1000,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE
);

-- Usage stats table for monitoring
CREATE TABLE usage_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    endpoint TEXT NOT NULL,
    requests_count INTEGER DEFAULT 1,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_created_at ON jobs(created_at);
CREATE INDEX idx_pages_job_id ON pages(job_id);
CREATE INDEX idx_pages_url ON pages(url);
CREATE INDEX idx_pages_job_depth ON pages(job_id, depth);
CREATE INDEX idx_pages_status_code ON pages(status_code);
CREATE INDEX idx_crawl_urls_job_id ON crawl_urls(job_id);
CREATE INDEX idx_crawl_urls_status ON crawl_urls(status);
CREATE INDEX idx_crawl_urls_depth ON crawl_urls(depth);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_usage_stats_date ON usage_stats(date);
CREATE INDEX idx_usage_stats_api_key ON usage_stats(api_key_id);

-- Create GIN indexes for JSONB columns
CREATE INDEX idx_jobs_options ON jobs USING GIN(options);
CREATE INDEX idx_pages_metadata ON pages USING GIN(metadata);
CREATE INDEX idx_pages_json_data ON pages USING GIN(json_data);

-- Create text search indexes
CREATE INDEX idx_pages_content_search ON pages USING GIN(to_tsvector('english', content));
CREATE INDEX idx_pages_title_search ON pages USING GIN(to_tsvector('english', title));

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for jobs table
CREATE TRIGGER update_jobs_updated_at 
    BEFORE UPDATE ON jobs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert a default API key for development (hash of 'dev-key-123')
INSERT INTO api_keys (key_hash, name, rate_limit_per_hour) 
VALUES (
    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 
    'Development Key', 
    10000
);

-- Create views for common queries
CREATE VIEW active_jobs AS
SELECT * FROM jobs 
WHERE status IN ('pending', 'processing');

CREATE VIEW job_summary AS
SELECT 
    j.id,
    j.type,
    j.status,
    j.url,
    j.created_at,
    j.progress,
    j.total_pages,
    COUNT(p.id) as pages_scraped,
    AVG(p.processing_time_ms) as avg_processing_time
FROM jobs j
LEFT JOIN pages p ON j.id = p.job_id
GROUP BY j.id;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ocean_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ocean_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ocean_user;