-- Performance indexes for scalability
-- Created: 2025-12-04
-- Phase 1 Scalability Implementation

-- Orders: shop + created_at for time-based duplicate detection queries
-- This is the most critical index as duplicate detection runs on every webhook
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shop_created 
  ON orders(shop_domain, created_at DESC);

-- Orders: flagged orders query (dashboard) - partial index for efficiency
-- Only indexes flagged orders, saving space and improving performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shop_flagged 
  ON orders(shop_domain, is_flagged) WHERE is_flagged = true;

-- Orders: email lookup for duplicate detection
-- Critical for email-based matching which is the primary detection method
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shop_email 
  ON orders(shop_domain, customer_email);

-- Sessions: shop lookup for authentication
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_shop 
  ON shopify_sessions(shop);

-- Audit logs: shop + time for recent activity queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_shop_performed 
  ON audit_logs(shop_domain, performed_at DESC);

-- Webhook deliveries: cleanup by date (for periodic cleanup job)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_deliveries_processed 
  ON webhook_deliveries(processed_at);
