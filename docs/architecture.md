# High-Level System Architecture

## Overview

**Duplicate Guard** (formerly Order Auditor) is a multi-tenant Shopify application that automatically detects and flags duplicate orders using configurable detection rules. The system processes orders via Shopify webhooks, analyzes them for duplicates based on email, shipping address, phone number, and SKU matching, and automatically tags suspicious orders in Shopify for merchant review.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Shopify Platform                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Shopify    │  │   Shopify    │  │   Shopify Admin API   │  │
│  │   Webhooks   │  │   OAuth      │  │   (Order Tagging)     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘  │
└─────────┼──────────────────┼─────────────────────┼───────────────┘
          │                  │                     │
          │                  │                     │
┌─────────▼──────────────────▼─────────────────────▼───────────────┐
│                    OrderAuditor Application                       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Frontend (React)                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │  │
│  │  │Dashboard │  │ Settings │  │Subscription│ │  Auth    │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Backend API (Express.js)                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │  Webhook     │  │  REST API     │  │  Auth Routes  │   │  │
│  │  │  Handlers   │  │  Endpoints    │  │  (OAuth)      │   │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬─────────┘   │  │
│  └─────────┼─────────────────┼─────────────────┼─────────────┘  │
│            │                 │                 │                  │
│  ┌─────────▼─────────────────▼─────────────────▼──────────────┐  │
│  │              Service Layer                                  │  │
│  │  ┌──────────────────┐  ┌──────────────────┐                │  │
│  │  │ Webhook         │  │ Duplicate        │                │  │
│  │  │ Processor       │  │ Detection        │                │  │
│  │  └────────┬────────┘  └────────┬─────────┘                │  │
│  │           │                    │                           │  │
│  │  ┌────────▼────────────────────▼─────────┐                │  │
│  │  │  Notification │ Subscription │ Queue  │                │  │
│  │  └────────────────────────────────────────┘                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Background Workers                           │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  Webhook Worker (pg-boss)                         │  │  │
│  │  │  - Processes orders/create webhooks asynchronously │  │  │
│  │  │  - Concurrency: 5 jobs                            │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   PostgreSQL Database │
                    │  ┌─────────────────┐ │
                    │  │  pg-boss Queue  │ │
                    │  │  (Job Storage)   │ │
                    │  └─────────────────┘ │
                    │  ┌─────────────────┐ │
                    │  │  Application    │ │
                    │  │  Tables         │ │
                    │  └─────────────────┘ │
                    └──────────────────────┘
```

## Core Components

### 1. Frontend Layer

**Technology**: React 18, TypeScript, Wouter (routing), Tailwind CSS, Shadcn UI

**Key Pages**:

- **Dashboard**: Displays flagged orders, statistics, and order details
- **Settings**: Configuration for duplicate detection rules and notifications
- **Subscription**: Manage subscription tiers and billing
- **Auth**: OAuth flow integration with Shopify

**Features**:

- Real-time dashboard updates (30-second auto-refresh)
- Order details modal with comprehensive information
- Responsive design with mobile support
- Shopify App Bridge integration for embedded app experience

### 2. Backend API Layer

**Technology**: Node.js, Express.js, TypeScript

**Key Responsibilities**:

- Webhook endpoint handlers with HMAC verification
- RESTful API endpoints for frontend
- OAuth authentication and session management
- Request validation and error handling
- Rate limiting and security middleware

**Main Routes**:

- `/api/webhooks/shopify/*` - Webhook endpoints
- `/api/dashboard/*` - Dashboard data endpoints
- `/api/settings` - Settings management
- `/api/subscription/*` - Subscription management
- `/api/auth/*` - OAuth authentication

### 3. Service Layer

#### Webhook Processor Service

- **Purpose**: Processes order creation webhooks asynchronously
- **Responsibilities**:
  - Idempotency checks (delivery ID tracking)
  - Order existence validation
  - Subscription quota verification
  - Customer data enhancement (API fallback)
  - Duplicate detection orchestration
  - Order persistence
  - Shopify order tagging
  - Notification triggering

#### Duplicate Detection Service

- **Purpose**: Core business logic for identifying duplicate orders
- **Matching Criteria**:
  - Email matching (50 points)
  - Phone matching (50 points, normalized)
  - Address matching (45 points full, 25 points partial)
  - Name matching (20 points, supporting evidence)
  - SKU matching (configurable)
- **Threshold**: 70+ points required for flagging
- **Time Window**: Configurable per shop (default: 24 hours)

#### Queue Service

- **Technology**: pg-boss (PostgreSQL-based job queue)
- **Purpose**: Asynchronous job processing
- **Features**:
  - Job persistence in PostgreSQL
  - Automatic retries on failure
  - Concurrency control
  - Health monitoring

#### Notification Service

- **Purpose**: Send alerts when duplicates are detected
- **Channels**: Email (SMTP), Slack (webhook)
- **Configurable**: Per-shop settings with confidence thresholds

#### Subscription Service

- **Purpose**: Manage subscription tiers and usage quotas
- **Tiers**: Free (50 orders/month), Paid (unlimited)
- **Features**: Grace period handling, billing period tracking

#### Shopify Service

- **Purpose**: Shopify Admin API integration
- **Operations**:
  - Order tagging/untagging
  - Webhook registration
  - Order and customer data fetching
  - Billing API integration

### 4. Background Workers

**Webhook Worker**:

- Processes jobs from `orders-create-processing` queue
- Concurrency: 5 parallel jobs
- Handles job failures and retries
- Delegates to Webhook Processor Service

### 5. Data Layer

**Technology**: PostgreSQL 16, Drizzle ORM

**Core Tables**:

#### `orders`

- Stores order data from Shopify webhooks
- Multi-tenant (scoped by `shopDomain`)
- Tracks duplicate detection results
- Resolution status and audit trail

#### `detection_settings`

- Per-shop configuration for duplicate detection
- Matching criteria toggles
- Time window configuration
- Notification preferences

#### `subscriptions`

- Subscription tier and status
- Usage tracking (monthly order count)
- Billing period management
- Shopify charge ID tracking

#### `webhook_deliveries`

- Idempotency tracking
- Prevents duplicate webhook processing
- Unique constraint on (shopDomain, deliveryId)

#### `shopify_sessions`

- OAuth session storage
- Access token management
- Multi-tenant session isolation

#### `audit_logs`

- Event tracking for compliance
- Resolution actions
- Dismissal history

#### `pgboss.*` (pg-boss tables)

- Job queue storage
- Job state management
- Retry tracking

## Data Flow

### Order Processing Flow

```
1. Shopify → Webhook Handler
   ├─ HMAC Verification
   ├─ Parse Payload
   └─ Enqueue Job (pg-boss)

2. Queue → Webhook Worker
   ├─ Poll Job
   └─ Delegate to Processor

3. Webhook Processor
   ├─ Check Delivery ID (Idempotency)
   ├─ Check Order Existence
   ├─ Check Subscription Quota
   ├─ Enhance Customer Data (if needed)
   ├─ Duplicate Detection Service
   │  ├─ Query Recent Orders
   │  ├─ Calculate Match Scores
   │  └─ Return Best Match (if ≥70 points)
   ├─ If Duplicate Detected:
   │  ├─ Tag Order in Shopify
   │  ├─ Send Notifications
   │  └─ Mark as Flagged
   └─ Save Order to Database

4. Frontend Dashboard
   ├─ Poll API for Flagged Orders
   ├─ Display Orders with Match Details
   └─ Allow Manual Resolution
```

### Webhook Types

1. **orders/create**: Main webhook for duplicate detection (async processing)
2. **orders/updated**: Detects tag removal for auto-resolution (sync processing)
3. **app/uninstalled**: Triggers shop data cleanup
4. **app_subscriptions/update**: Syncs subscription status
5. **customers/data_request**: GDPR compliance
6. **customers/redact**: GDPR compliance
7. **shop/redact**: GDPR compliance

## Deployment Architecture

### Production Deployment (Docker Compose)

**Services**:

- **PostgreSQL**: Database with persistent volumes
- **App (Blue/Green)**: Application containers for zero-downtime deployments
- **Network**: Isolated bridge network

**Features**:

- Blue/Green deployment strategy
- Health checks for all services
- Automatic restart policies
- Volume persistence for database

### CI/CD Pipeline

**GitHub Actions**:

1. **Build**: TypeScript compilation, Vite build
2. **Test**: Unit tests (Vitest)
3. **Docker Build**: Multi-stage build
4. **Push**: GitHub Container Registry
5. **Deploy**: Manual or automated deployment

## Security Architecture

### Authentication & Authorization

- **OAuth 2.0**: Shopify OAuth flow
- **Session Management**: PostgreSQL-backed session storage
- **Multi-tenant Isolation**: All queries scoped by `shopDomain`

### Webhook Security

- **HMAC Verification**: All webhooks verified using `SHOPIFY_API_SECRET`
- **Delivery ID Tracking**: Prevents replay attacks
- **Idempotency**: Database-level constraints prevent duplicate processing

### Data Protection

- **GDPR Compliance**: Data request and redaction webhooks
- **PII Handling**: Secure storage and redaction capabilities
- **Environment Variables**: Sensitive data in environment, never in code

### API Security

- **Rate Limiting**: Express rate limiting middleware
- **Helmet**: Security headers
- **Input Validation**: Zod schema validation
- **SQL Injection Prevention**: Drizzle ORM parameterized queries

## Scalability Considerations

### Horizontal Scaling

- **Stateless API**: Can run multiple instances behind load balancer
- **Database Connection Pooling**: Efficient connection management
- **Queue-based Processing**: Decouples webhook handling from processing

### Vertical Scaling

- **Worker Concurrency**: Configurable (default: 5)
- **Database Indexing**: Optimized queries with proper indexes
- **Caching**: Potential for Redis integration (future)

### Performance Optimizations

- **Async Processing**: Webhooks return immediately after enqueue
- **Batch Operations**: Efficient database queries
- **Connection Pooling**: Reuse database connections

## Integration Points

### External Services

1. **Shopify Platform**

   - Webhook delivery
   - Admin API (orders, customers, billing)
   - OAuth authentication
   - App Bridge (embedded app)

2. **Email Service (SMTP)**

   - Gmail, SendGrid, Mailgun support
   - Configurable per shop

3. **Slack (Optional)**
   - Webhook notifications
   - Configurable per shop

### Internal Integrations

- **PostgreSQL**: Primary data store and job queue
- **pg-boss**: Job queue implementation
- **Drizzle ORM**: Database abstraction

## Monitoring & Observability

### Health Checks

- **Application**: `/api/health` endpoint
- **Database**: Connection verification
- **Queue**: pg-boss health stats

### Logging

- **Structured Logging**: Custom logger with levels
- **Log Levels**: error, warn, info, debug
- **Request Logging**: API request/response logging

### Metrics (Future)

- Order processing rate
- Duplicate detection accuracy
- Queue depth and processing time
- Error rates

## Technology Stack Summary

| Layer                  | Technology                                            |
| ---------------------- | ----------------------------------------------------- |
| **Frontend**           | React 18, TypeScript, Wouter, Tailwind CSS, Shadcn UI |
| **Backend**            | Node.js, Express.js, TypeScript                       |
| **Database**           | PostgreSQL 16                                         |
| **ORM**                | Drizzle ORM                                           |
| **Queue**              | pg-boss                                               |
| **Authentication**     | Shopify OAuth 2.0                                     |
| **Deployment**         | Docker, Docker Compose                                |
| **CI/CD**              | GitHub Actions                                        |
| **Container Registry** | GitHub Container Registry                             |

## Multi-Tenancy

The system is designed as a multi-tenant application where:

- Each Shopify shop is a separate tenant
- All database queries are scoped by `shopDomain`
- Settings, subscriptions, and orders are isolated per shop
- OAuth sessions are shop-specific
- Webhook processing is tenant-aware

## Future Architecture Enhancements

1. **Caching Layer**: Redis for frequently accessed data
2. **Message Queue**: RabbitMQ/Kafka for higher throughput
3. **Microservices**: Split services for better scalability
4. **CDN**: Static asset delivery
5. **Monitoring**: Prometheus + Grafana
6. **Distributed Tracing**: OpenTelemetry
7. **API Gateway**: Rate limiting and routing
8. **Read Replicas**: Database read scaling
