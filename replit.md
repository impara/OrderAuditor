# Order Auditor - Shopify Duplicate Order Detection App

## Overview
Order Auditor is a Shopify app that automatically detects and flags duplicate orders from the same customer using configurable detection rules. It processes orders via Shopify webhooks, analyzes them for duplicates based on email, shipping address, and other criteria, and automatically tags suspicious orders in Shopify for merchant review.

## Current State
**Status**: MVP Complete
**Last Updated**: November 21, 2025

### Implemented Features
- ✅ Shopify webhook listener endpoint for order creation events with HMAC verification
- ✅ **Automatic webhook registration via Shopify Admin API** (NEW)
- ✅ Duplicate detection logic matching orders by customer email, shipping address, and configurable time window
- ✅ Automatic order tagging via Shopify Admin API to flag duplicates for review
- ✅ Dashboard with flagged orders list displaying customer info, order details, and duplicate match reasoning
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
