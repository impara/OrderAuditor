# Order Auditor - Shopify Duplicate Order Detection App

## Overview
Order Auditor is a Shopify app that automatically detects and flags duplicate orders from the same customer using configurable detection rules. It processes orders via Shopify webhooks, analyzes them for duplicates based on email, shipping address, and other criteria, and automatically tags suspicious orders in Shopify for merchant review.

## Current State
**Status**: MVP Complete & Production Ready
**Last Updated**: November 22, 2025

### Implemented Features
- ✅ Shopify webhook listener endpoint for order creation events with HMAC verification
- ✅ **Automatic webhook registration via Shopify Admin API**
- ✅ Duplicate detection logic matching orders by customer email, shipping address, and configurable time window
- ✅ **Auto-initialization of detection settings** - Settings are automatically created on first webhook
- ✅ Automatic order tagging via Shopify Admin API to flag duplicates for review
- ✅ Dashboard with flagged orders list displaying customer info, order details, and duplicate match reasoning
- ✅ **Real-time dashboard updates** - Auto-refreshes every 30 seconds to show latest flagged orders
- ✅ **Order Details Modal** - View comprehensive order information including duplicate detection metadata, customer details, shipping address, and direct link to Shopify admin
- ✅ **Enhanced customer name extraction** - Fallback to billing address fields when customer fields are unavailable
- ✅ Stats cards showing total flagged orders, potential duplicate value, and recent activity metrics
- ✅ Settings page for configuring detection rules (time window, matching criteria) and notification preferences
- ✅ PostgreSQL database storing order data, detection rules, and audit history
- ✅ MVC architecture with separated routes, services, and storage layers

## Project Architecture

### Tech Stack
- **Frontend**: React + TypeScript with Wouter routing
- **UI Components**: Shadcn UI (inspired by Shopify Polaris design)
- **Styling**: Tailwind CSS with Inter font
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **External APIs**: Shopify Admin API for order tagging

### Directory Structure
```
├── client/
│   ├── src/
│   │   ├── components/ui/      # Reusable UI components (Shadcn)
│   │   ├── pages/              # Page components (Dashboard, Settings)
│   │   ├── lib/                # Utilities (React Query client, utils)
│   │   └── App.tsx             # Main app with routing
├── server/
│   ├── services/               # Business logic services
│   │   ├── duplicate-detection.service.ts
│   │   └── shopify.service.ts
│   ├── db.ts                   # Database connection
│   ├── storage.ts              # Data access layer
│   └── routes.ts               # API routes
└── shared/
    └── schema.ts               # Shared TypeScript types and Drizzle schema
```

### Database Schema

#### Tables
1. **orders**: Stores order data from Shopify webhooks
   - Tracks flagged status, duplicate match info, and confidence scores
   
2. **detection_settings**: Configuration for duplicate detection rules
   - Single-row table (enforced by app logic)
   - Configures time windows, matching criteria, notifications
   
3. **audit_logs**: Tracks all duplicate detection events
   - Records flagging, tagging, and review actions

## Configuration

### Required Environment Variables
```
DATABASE_URL=<PostgreSQL connection string>
SHOPIFY_SHOP_DOMAIN=<yourstore.myshopify.com>
SHOPIFY_ACCESS_TOKEN=<Admin API access token>
SHOPIFY_WEBHOOK_SECRET=<Webhook verification secret>
```

### Shopify Setup
1. Create a custom app in Shopify Admin → Settings → Apps and sales channels → Develop apps
2. Grant permissions:
   - `read_orders` - To receive order webhooks
   - `write_orders` - To tag orders as duplicates
3. Install the app and copy the Admin API access token
4. **Automatic Webhook Registration** (Recommended):
   - Set environment variables: `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`
   - Call `POST /api/webhooks/register` to automatically register the webhook
   - The system will automatically use the correct production URL from `REPLIT_DOMAINS`
   - Duplicate detection prevents creating multiple webhooks
5. **Manual Webhook Configuration** (Alternative):
   - Endpoint: `https://your-domain.com/api/webhooks/shopify/orders/create`
   - Event: Order creation
   - Format: JSON
   - Copy the webhook signing secret

## API Endpoints

### Dashboard
- `GET /api/dashboard/stats` - Fetch dashboard statistics
- `GET /api/orders/flagged` - Get list of flagged orders

### Settings
- `GET /api/settings` - Get detection settings (initializes if not exists)
- `PATCH /api/settings` - Update detection settings

### Webhook Management
- `GET /api/webhooks/status` - Check webhook registration status
  - Returns current webhook registration details
  - Shows all registered webhooks
- `POST /api/webhooks/register` - Automatically register orders/create webhook
  - Checks for existing webhooks to prevent duplicates
  - Uses production URL from environment
  - Returns registration success/failure details

### Webhooks
- `POST /api/webhooks/shopify/orders/create` - Shopify order creation webhook
  - Verifies HMAC signature
  - Detects duplicates based on settings
  - Tags orders in Shopify
  - Creates audit logs

## Duplicate Detection Logic

### Matching Criteria
The system calculates a confidence score (0-100%) based on:
- **Email Match** (40 points): Same customer email
- **Address Match** (up to 40 points): Similar shipping address based on sensitivity setting
  - High sensitivity: Exact match required (address1, city, zip)
  - Medium sensitivity: Two of three must match
  - Low sensitivity: One match sufficient
- **Name Match** (20 points): Same customer name (case-insensitive)

### Threshold
Orders are flagged as duplicates if confidence >= 70%

## Running the Project

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Start development server
npm run dev
```

The app runs on http://localhost:5000

## Design System

### Colors
- **Primary**: Green (#008060) - Shopify brand color for CTAs
- **Destructive**: Red - Critical alerts and high confidence duplicates
- **Chart-4**: Amber - Medium confidence warnings

### Typography
- **Font**: Inter (Shopify Polaris standard)
- **Page Titles**: 20px semibold
- **Section Headers**: 16px semibold
- **Body Text**: 14px regular
- **Data Labels**: 12px medium
- **Stats Numbers**: 24px bold

### Layout
- Dashboard: Two-column layout (flagged orders table + stats cards)
- Responsive: Stacks to single column on mobile/tablet
- Spacing: Polaris 4px base unit system

## Future Enhancements (Planned)
- Bulk actions for reviewing and resolving flagged orders
- Email/Slack notifications when duplicates are detected
- Detailed order comparison view showing side-by-side duplicate analysis
- Analytics dashboard with trends, patterns, and fraud risk scoring
- OAuth flow for multi-store Shopify app distribution

## Known Limitations
- **Address-only matching**: Detection requires at least email OR phone matching to be enabled. If both are disabled but address matching is enabled, duplicate detection will not function. This is a known limitation that will be addressed in a future update.
- Single detection settings profile (no multi-store support yet)
- Average resolution time in dashboard stats is currently a placeholder value

---

## Production Deployment

### Security Hardening

The application includes comprehensive production security measures:

#### Authentication & Authorization
- **Session-based authentication** with secure, HTTP-only cookies
- **Protected API endpoints** - All admin routes require authentication
- **Password security** - Production requires bcrypt-hashed admin passwords
- **Session management** - 24-hour sessions with automatic expiration

#### Rate Limiting
- **API endpoints**: 100 requests per 15 minutes per IP
- **Authentication**: 5 login attempts per 15 minutes per IP (failed attempts only)
- **Webhooks**: 60 requests per minute (separate from general API limits)

#### Security Headers (Helmet)
- **Content Security Policy (CSP)** - Prevents XSS attacks (strict in production)
- **HSTS** - Forces HTTPS connections (enabled in production)
- **X-Frame-Options** - Prevents clickjacking attacks
- **Referrer-Policy** - Controls referrer information leakage

#### CORS Configuration
- **Development**: Allows all origins for local testing
- **Production**: Restricts to allowed origins via `ALLOWED_ORIGINS` environment variable

#### Error Handling
- **Sanitized error responses** - Internal details hidden from clients in production
- **Structured logging** - All errors logged with timestamps and context
- **4xx vs 5xx handling** - Client errors show specific messages, server errors are generic

### Required Environment Variables

#### Core Application (Required)
```bash
DATABASE_URL=<PostgreSQL connection string from Replit database>
SHOPIFY_SHOP_DOMAIN=<yourstore.myshopify.com>
SHOPIFY_ACCESS_TOKEN=<Admin API access token>
SHOPIFY_WEBHOOK_SECRET=<Webhook verification secret from Shopify>
```

#### Security (Required for Production)
```bash
# Admin authentication password (MUST be bcrypt hash in production)
# Generate with: npx bcryptjs-cli <your-password>
ADMIN_PASSWORD=<bcrypt-hashed-password>

# Session secret for cookie signing (random string, 32+ characters)
SESSION_SECRET=<random-secure-string>
```

#### Optional Security Settings
```bash
# Comma-separated list of allowed origins for CORS
# Example: https://yourdomain.com,https://admin.yourdomain.com
ALLOWED_ORIGINS=<comma-separated-origins>

# Node environment (automatically set by Replit)
NODE_ENV=production
```

### Pre-Deployment Checklist

Before deploying to production, verify:

- [ ] **Database**: PostgreSQL database provisioned and `DATABASE_URL` set
- [ ] **Shopify Integration**:
  - [ ] Custom app created in Shopify Admin
  - [ ] API permissions granted (read_orders, write_orders)
  - [ ] Admin API access token copied to `SHOPIFY_ACCESS_TOKEN`
  - [ ] Webhook secret copied to `SHOPIFY_WEBHOOK_SECRET`
  - [ ] Shop domain set in `SHOPIFY_SHOP_DOMAIN`
- [ ] **Security Configuration**:
  - [ ] `ADMIN_PASSWORD` generated as bcrypt hash (not plain text)
  - [ ] `SESSION_SECRET` set to random, secure string (32+ characters)
  - [ ] `ALLOWED_ORIGINS` configured if using custom domain
- [ ] **Database Schema**: Run `npm run db:push` to create tables
- [ ] **Webhook Registration**: Use admin dashboard to register webhook after deployment
- [ ] **Health Check**: Verify `/api/health` endpoint returns `{"status":"healthy"}`

### Generating Secure Passwords

Generate a bcrypt-hashed admin password:

```bash
# Install bcryptjs-cli globally (one-time)
npm install -g bcryptjs-cli

# Generate hash for your password
npx bcryptjs-cli "YourSecurePassword123!"

# Copy the hash (starts with $2a$ or $2b$) to ADMIN_PASSWORD
```

Generate a random session secret:

```bash
# On Linux/Mac
openssl rand -base64 32

# On Windows (PowerShell)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

### Post-Deployment Steps

After deploying the application:

1. **Access the Admin Dashboard**
   - Navigate to your deployed URL
   - You'll be redirected to `/login`
   - Enter your admin password

2. **Register Shopify Webhook**
   - Go to Settings page
   - The webhook registration endpoint will be available
   - Or call `POST /api/webhooks/register` via authenticated request

3. **Configure Detection Rules**
   - Navigate to Settings
   - Set detection rules (time window, matching criteria)
   - Enable notifications if desired

4. **Monitor Application**
   - Check `/api/health` endpoint periodically
   - Monitor logs for errors or security warnings
   - Review rate limiting headers in responses

### Security Best Practices

#### Production Environment

- **Always use HTTPS** - Never deploy without SSL/TLS
- **Use strong passwords** - Admin password should be 16+ characters, bcrypt-hashed
- **Rotate secrets regularly** - Change `SESSION_SECRET` and `ADMIN_PASSWORD` periodically
- **Monitor access logs** - Watch for suspicious login attempts or rate limit violations
- **Keep dependencies updated** - Regularly update npm packages for security patches

#### Database Security

- **Use least-privilege access** - Database user should only have necessary permissions
- **Enable SSL/TLS** - Database connections should be encrypted
- **Backup regularly** - Automated backups of order data and settings
- **Monitor query performance** - Watch for slow queries or unusual patterns

#### API Security

- **Verify webhook signatures** - Always validate Shopify HMAC signatures
- **Rate limit enforcement** - Monitor for rate limit violations
- **Input validation** - All user inputs validated via Zod schemas
- **Error handling** - Never expose internal errors or stack traces in production

### Monitoring & Maintenance

#### Health Check Endpoint

```bash
# Check application health
curl https://your-domain.com/api/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-11-22T01:54:23.000Z",
  "uptime": 123.45,
  "environment": "production"
}
```

#### Log Monitoring

Monitor application logs for:
- Authentication failures (potential brute force attempts)
- Rate limit violations (potential abuse)
- Webhook verification failures (potential security issue)
- Database connection errors
- Environment validation warnings

#### Performance Metrics

Track these metrics for production health:
- Response times for API endpoints
- Webhook processing latency
- Database query performance
- Memory and CPU usage
- Rate limit hit frequency

### Troubleshooting

#### Common Issues

**Authentication not working:**
- Verify `SESSION_SECRET` is set
- Check that `ADMIN_PASSWORD` is bcrypt hash in production
- Ensure cookies are enabled in browser
- Verify app is served over HTTPS in production

**Webhooks failing:**
- Check `SHOPIFY_WEBHOOK_SECRET` matches Shopify
- Verify webhook URL is publicly accessible
- Review rate limiting configuration
- Check HMAC signature verification logs

**Rate limiting too strict:**
- Adjust rate limits in `server/app.ts`
- Consider increasing limits for legitimate traffic patterns
- Monitor for unusual traffic spikes

**CORS errors:**
- Set `ALLOWED_ORIGINS` to include your frontend domain
- Verify origins include protocol (https://)
- Check that credentials are included in requests

For additional support, check application logs and the `/api/health` endpoint status.
