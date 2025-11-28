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
- ✅ **Order Resolution System** - Dismiss flagged orders from dashboard or automatically sync when tags are removed in Shopify
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
   - The response should show both `orders/create` and `orders/updated` webhooks were successfully registered
   - You can also check in Shopify Admin → Settings → Notifications → Webhooks
   - Both webhooks are required: `orders/create` for duplicate detection, `orders/updated` for automatic resolution

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
- `POST /api/orders/:orderId/dismiss` - Dismiss a flagged order (removes from flagged list and removes Shopify tag)

### Settings

- `GET /api/settings` - Get detection settings (initializes if not exists)
- `PATCH /api/settings` - Update detection settings

### Webhook Management

- `GET /api/webhooks/status` - Check webhook registration status (shows both orders/create and orders/updated)
- `POST /api/webhooks/register` - Automatically register both orders/create and orders/updated webhooks

### Webhooks

- `POST /api/webhooks/shopify/orders/create` - Shopify order creation webhook
- `POST /api/webhooks/shopify/orders/updated` - Shopify order update webhook (detects tag removal for auto-resolution)

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

## Order Resolution & Dismissal

Once orders are flagged as duplicates, merchants can resolve them in two ways:

### Manual Dismissal (Dashboard)

1. Click "View Details" on any flagged order in the dashboard
2. Click "Dismiss Order" button
3. Confirm the dismissal in the dialog
4. The order is removed from the flagged list and the "Merge_Review_Candidate" tag is removed from Shopify

### Automatic Resolution (Shopify Admin)

1. Merchant removes the "Merge_Review_Candidate" tag directly in Shopify admin
2. The system automatically detects the tag removal via the `orders/updated` webhook
3. The order is automatically resolved and removed from the flagged list
4. All resolution actions are logged in the audit logs for historical tracking

### Resolution Tracking

- All resolved orders are kept in the database with `isFlagged: false`
- `resolvedAt` timestamp tracks when the order was resolved
- `resolvedBy` field tracks the resolution method: `'manual_dashboard'` or `'shopify_tag_removed'`
- Audit logs record all dismissal and resolution events for compliance and analytics

## Email Notifications

The application can send email notifications when duplicate orders are detected. To enable this feature:

### 1. Configure SMTP Settings

Add SMTP configuration to your `.env` file:

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

### 2. Enable Notifications in Settings

1. Navigate to the Settings page in the dashboard
2. Enable "Notifications" toggle
3. Enter the email address where you want to receive alerts
4. Optionally adjust the notification threshold (default: 80% confidence)
5. Save settings

### 3. Common SMTP Providers

**Gmail:**

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587` (TLS) or `465` (SSL)
- Use an [App Password](https://support.google.com/accounts/answer/185833) instead of your regular password
- `SMTP_FROM` should match `SMTP_USER`

**SendGrid:**

- `SMTP_HOST=smtp.sendgrid.net`
- `SMTP_PORT=587`
- `SMTP_USER=apikey`
- `SMTP_PASS=your-sendgrid-api-key`
- `SMTP_FROM=your-verified-sender@example.com`

**Mailgun:**

- `SMTP_HOST=smtp.mailgun.org`
- `SMTP_PORT=587`
- `SMTP_USER=postmaster@your-domain.mailgun.org`
- `SMTP_PASS=your-mailgun-password`
- `SMTP_FROM=noreply@your-domain.com`

**Note**: For production deployments, see [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed SMTP configuration instructions.

## Environment Variables Reference

| Variable                 | Required | Description                          | Example                                              |
| ------------------------ | -------- | ------------------------------------ | ---------------------------------------------------- |
| `DATABASE_URL`           | Yes      | PostgreSQL connection string         | `postgresql://user:pass@localhost:5432/db`           |
| `SHOPIFY_API_KEY`        | Yes      | Shopify Client ID (Partner App)      | `your_client_id`                                     |
| `SHOPIFY_API_SECRET`     | Yes      | Shopify Client Secret (Partner App)  | `your_client_secret`                                 |
| `SHOPIFY_WEBHOOK_SECRET` | No\*\*\* | Legacy webhook secret (Custom Apps)  | `shpss_...` (legacy, not needed for Partner Apps)    |
| `PORT`                   | No       | Server port (default: 5000)          | `5000`                                               |
| `APP_URL`                | Yes\*    | Public URL for webhook registration  | `http://localhost:5000` or `https://your-domain.com` |
| `LOG_LEVEL`              | No       | Log verbosity level (default: debug) | `error`, `warn`, `info`, `debug`                     |
| `SMTP_HOST`              | No\*\*   | SMTP server hostname                 | `smtp.gmail.com`                                     |
| `SMTP_PORT`              | No\*\*   | SMTP server port                     | `587`                                                |
| `SMTP_USER`              | No\*\*   | SMTP authentication username         | `your-email@gmail.com`                               |
| `SMTP_PASS`              | No\*\*   | SMTP authentication password         | `your-app-password`                                  |
| `SMTP_FROM`              | No\*\*   | Email sender address                 | `your-email@gmail.com`                               |

\*Required for webhook registration. Use ngrok or similar tunneling service for local development.

\*\*Required for email notifications. See [Email Notifications](#email-notifications) section below.

\*\*\***For Partner Apps (multi-tenant embedded apps)**: `SHOPIFY_WEBHOOK_SECRET` is **NOT needed**. The app uses `SHOPIFY_API_SECRET` (Client Secret) for webhook verification. `SHOPIFY_WEBHOOK_SECRET` is only for legacy Custom Apps and should be removed.

### Shopify Credentials Mapping

**For Partner Apps (Current Setup):**

- **Client ID** → `SHOPIFY_API_KEY` and `VITE_SHOPIFY_API_KEY`
- **Client Secret** → `SHOPIFY_API_SECRET` (used for both OAuth and webhook verification)
- `SHOPIFY_WEBHOOK_SECRET` → **NOT NEEDED** (legacy, can be removed)

**For Legacy Custom Apps (Deprecated):**

- `SHOPIFY_WEBHOOK_SECRET` was a separate "API secret key"
- This is no longer used for Partner Apps

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running: `pg_isready`
- Check connection string format in `.env`
- Ensure database exists: `psql -l | grep orderauditor`

### Webhook Not Receiving Events

- Verify webhook is registered: `GET /api/webhooks/status`
- Check `APP_URL` is publicly accessible
- For Partner Apps: Verify `SHOPIFY_API_SECRET` matches your app's Client Secret
- For Legacy Custom Apps: Verify `SHOPIFY_WEBHOOK_SECRET` matches app credentials
- Check server logs for HMAC verification errors
- Check server logs for webhook verification errors and configuration issues

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
- ~~Email/Slack notifications when duplicates are detected~~ ✅ Implemented
- Detailed order comparison view showing side-by-side duplicate analysis
- Analytics dashboard with trends, patterns, and fraud risk scoring showing resolution metrics and ROI
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
