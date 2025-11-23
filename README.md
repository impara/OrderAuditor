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

## Local Development Setup

### Prerequisites

- Node.js (v20 or higher recommended)
- PostgreSQL database (local or cloud-hosted)
- Shopify store with admin access
- npm or yarn package manager

### Step 1: Clone and Install Dependencies

```bash
# Navigate to project directory
cd orderAuditor

# Install dependencies
npm install
```

**Note**: If you encounter Windows/WSL path issues during installation, try:

- Running npm from within WSL (not Windows)
- Using `npm install --no-optional` to skip optional dependencies
- Ensuring you're using the WSL Node.js installation, not Windows Node.js

### Step 2: Set Up Environment Variables

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and fill in your configuration:

```env
# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/orderauditor

# Shopify Configuration
SHOPIFY_SHOP_DOMAIN=yourstore.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_your_admin_api_access_token
SHOPIFY_WEBHOOK_SECRET=shpss_your_webhook_secret_key

# Application Configuration
PORT=5000
APP_URL=http://localhost:5000
LOG_LEVEL=debug

# Client-side Configuration (optional)
VITE_SHOPIFY_SHOP_DOMAIN=yourstore.myshopify.com
```

#### Obtaining Shopify Credentials

1. **Create a Custom App in Shopify**:

   - Go to Shopify Admin → Settings → Apps and sales channels → Develop apps
   - Click "Create an app"
   - Give it a name (e.g., "Order Auditor")

2. **Configure API Scopes**:

   - Click "Configure Admin API scopes"
   - Enable the following scopes:
     - `read_orders` - To receive order webhooks
     - `write_orders` - To tag orders as duplicates
     - `read_customers` - **REQUIRED** for accessing customer email/name in webhooks
   - Save the configuration

3. **Enable Protected Customer Data Access** (CRITICAL):

   **⚠️ Without this, customer data (email, name, phone) will NOT be available in webhooks!**

   **⚠️ PLAN REQUIREMENT**: API access to customer PII (email, name, phone) requires a **Shopify**, **Advanced**, or **Plus** plan. It is **NOT available on Basic/Free plans**.

   - In your app settings, go to **API Access** → **Protected Customer Data Access**
   - Click **Manage**
   - Under **Protected customer fields (optional)**, select:
     - ✅ `email`
     - ✅ `first_name`
     - ✅ `last_name`
     - ✅ `phone`
   - Provide a reason: "Duplicate order detection requires customer email and name to identify duplicate orders"
   - Click **Save**
   - **The merchant must approve this request** - they will see a notification in their Shopify admin

   **Note**:

   - Until Protected Customer Data Access is approved, the app will show "Unknown Customer" and "unknown@example.com" for all orders
   - If you're on a Basic/Free plan, customer data will not be available even with Protected Customer Data Access enabled
   - Development stores may have different restrictions - check your Shopify plan

4. **Install the App**:

   - Click "Install app"
   - Copy the **Admin API access token** (starts with `shpat_`)
   - This is your `SHOPIFY_ACCESS_TOKEN`

5. **Get Webhook Secret**:

   - In the app settings, go to "API credentials"
   - Copy the **API secret key** (starts with `shpss_`)
   - This is your `SHOPIFY_WEBHOOK_SECRET`

6. **Set Shop Domain**:
   - Your shop domain is in the format: `yourstore.myshopify.com`
   - This is your `SHOPIFY_SHOP_DOMAIN`

### Step 3: Set Up Database

#### Option A: Using Docker Compose (Recommended)

1. **Start PostgreSQL with Docker Compose**:

   ```bash
   docker-compose up -d
   ```

   This will start a PostgreSQL 16 container with:

   - Database: `orderauditor`
   - User: `orderauditor`
   - Password: `orderauditor`
   - Port: `5432`

2. **Update DATABASE_URL** in `.env`:

   ```env
   DATABASE_URL=postgresql://orderauditor:orderauditor@localhost:5432/orderauditor
   ```

3. **Push Database Schema**:

   ```bash
   npm run db:push
   ```

   This will create the necessary tables:

   - `orders` - Stores order data from Shopify webhooks
   - `detection_settings` - Configuration for duplicate detection rules
   - `audit_logs` - Tracks all duplicate detection events

**Useful Docker Commands**:

- Stop database: `docker-compose down`
- Stop and remove data: `docker-compose down -v`
- View logs: `docker-compose logs -f postgres`
- Restart: `docker-compose restart`

#### Option B: Manual PostgreSQL Installation

1. **Install PostgreSQL** (if not already installed):

   ```bash
   # Ubuntu/Debian
   sudo apt update && sudo apt install postgresql postgresql-contrib

   # macOS (using Homebrew)
   brew install postgresql@16
   brew services start postgresql@16
   ```

2. **Create a PostgreSQL Database**:

   ```bash
   # Using psql
   createdb orderauditor

   # Or using SQL
   psql -U postgres
   CREATE DATABASE orderauditor;
   ```

3. **Update DATABASE_URL** in `.env`:

   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/orderauditor
   ```

4. **Push Database Schema**:

   ```bash
   npm run db:push
   ```

### Step 4: Set Up Webhook Testing (Local Development)

For local development, you'll need to expose your local server to the internet so Shopify can send webhooks. Use one of these options:

#### Option A: Using ngrok (Recommended)

1. **Install ngrok**: https://ngrok.com/download

2. **Start your development server**:

   ```bash
   npm run dev
   ```

3. **In another terminal, start ngrok**:

   ```bash
   ngrok http 5000
   ```

4. **Update your `.env` file** with the ngrok URL:

   ```env
   APP_URL=https://your-ngrok-url.ngrok.io
   ```

5. **Register the webhook** (see Step 5)

#### Option B: Using Other Tunneling Services

Follow your tunneling service's instructions to expose port 5000, then update `APP_URL` in `.env`.

### Step 5: Register Shopify Webhook

Once your local server is accessible via a public URL:

1. **Start the development server**:

   ```bash
   npm run dev
   ```

2. **Register the webhook automatically**:

   ```bash
   curl -X POST http://localhost:5000/api/webhooks/register
   ```

   Or use the webhook status endpoint to check registration:

   ```bash
   curl http://localhost:5000/api/webhooks/status
   ```

3. **Verify webhook registration**:
   - The response should show the webhook was successfully registered
   - You can also check in Shopify Admin → Settings → Notifications → Webhooks

### Step 6: Run the Application

```bash
# Development mode (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

The app will be available at `http://localhost:5000`

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

## API Endpoints

### Dashboard

- `GET /api/dashboard/stats` - Fetch dashboard statistics
- `GET /api/orders/flagged` - Get list of flagged orders

### Settings

- `GET /api/settings` - Get detection settings (initializes if not exists)
- `PATCH /api/settings` - Update detection settings

### Webhook Management

- `GET /api/webhooks/status` - Check webhook registration status
- `POST /api/webhooks/register` - Automatically register orders/create webhook

### Webhooks

- `POST /api/webhooks/shopify/orders/create` - Shopify order creation webhook

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

## Environment Variables Reference

| Variable                   | Required | Description                          | Example                                              |
| -------------------------- | -------- | ------------------------------------ | ---------------------------------------------------- |
| `DATABASE_URL`             | Yes      | PostgreSQL connection string         | `postgresql://user:pass@localhost:5432/db`           |
| `SHOPIFY_SHOP_DOMAIN`      | Yes      | Your Shopify store domain            | `yourstore.myshopify.com`                            |
| `SHOPIFY_ACCESS_TOKEN`     | Yes      | Shopify Admin API access token       | `shpat_...`                                          |
| `SHOPIFY_WEBHOOK_SECRET`   | Yes      | Webhook verification secret          | `shpss_...`                                          |
| `PORT`                     | No       | Server port (default: 5000)          | `5000`                                               |
| `APP_URL`                  | Yes\*    | Public URL for webhook registration  | `http://localhost:5000` or `https://your-domain.com` |
| `LOG_LEVEL`                | No       | Log verbosity level (default: debug) | `error`, `warn`, `info`, `debug`                     |
| `VITE_SHOPIFY_SHOP_DOMAIN` | No       | Client-side Shopify domain           | `yourstore.myshopify.com`                            |

\*Required for webhook registration. Use ngrok or similar tunneling service for local development.

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running: `pg_isready`
- Check connection string format in `.env`
- Ensure database exists: `psql -l | grep orderauditor`

### Webhook Not Receiving Events

- Verify webhook is registered: `GET /api/webhooks/status`
- Check `APP_URL` is publicly accessible
- Verify `SHOPIFY_WEBHOOK_SECRET` matches Shopify app credentials
- Check server logs for HMAC verification errors

### npm Install Issues (Windows/WSL)

- Ensure you're using WSL Node.js, not Windows Node.js
- Try: `npm install --no-optional`
- Clear npm cache: `npm cache clean --force`
- Reinstall: `rm -rf node_modules package-lock.json && npm install`

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run check` - Type check TypeScript
- `npm run db:push` - Push database schema changes

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

## Known Limitations

- **Address-only matching**: Detection requires at least email OR phone matching to be enabled. If both are disabled but address matching is enabled, duplicate detection will not function.
- Single detection settings profile (no multi-store support yet)
- Average resolution time in dashboard stats is currently a placeholder value

## Future Enhancements (Planned)

- Bulk actions for reviewing and resolving flagged orders
- Email/Slack notifications when duplicates are detected
- Detailed order comparison view showing side-by-side duplicate analysis
- Analytics dashboard with trends, patterns, and fraud risk scoring
- OAuth flow for multi-store Shopify app distribution

## Production Deployment

For production deployment using Docker, see the detailed [DEPLOYMENT.md](./DEPLOYMENT.md) guide for complete instructions including:

- Server setup and Docker installation
- Environment configuration
- Database initialization
- Webhook registration
- Maintenance and troubleshooting
- Backup procedures

## License

MIT
