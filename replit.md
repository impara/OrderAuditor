# Order Auditor - Shopify Duplicate Order Detection App

## Overview
Order Auditor is a Shopify application designed to automatically detect and flag duplicate orders from the same customer. It integrates with Shopify via webhooks to process new orders, applies configurable detection rules based on customer email, shipping address, and time windows, and tags suspicious orders in Shopify for merchant review. The project aims to provide merchants with a robust tool to identify and manage potentially fraudulent or erroneous duplicate orders, enhancing order management efficiency and reducing financial discrepancies.

## User Preferences
I prefer detailed explanations. I want iterative development. Ask before making major changes.

## System Architecture

### Core Features and Design
The application is built on an MVC architecture, separating concerns into routes, services, and storage layers. It features a React-based frontend with Shadcn UI for a consistent user experience inspired by Shopify Polaris, and a Node.js/Express backend. Key features include automatic Shopify webhook registration, a dashboard for reviewing flagged orders, configurable duplicate detection rules, and an audit logging system. The application emphasizes real-time updates and provides comprehensive order details within the dashboard.

### Tech Stack
-   **Frontend**: React, TypeScript, Wouter, Shadcn UI, Tailwind CSS
-   **Backend**: Node.js, Express, TypeScript
-   **Database**: PostgreSQL with Drizzle ORM

### UI/UX Decisions
The design system utilizes Shopify Polaris-inspired aesthetics with Inter font, a green primary color (#008060), and clear visual indicators for different confidence levels of duplicate orders (red for critical, amber for medium). The dashboard employs a responsive two-column layout that adapts to single-column on mobile.

### Database Schema
-   **orders**: Stores order data, flagged status, duplicate match info, and confidence scores.
-   **detection_settings**: Manages configurable rules for duplicate detection (time window, matching criteria).
-   **audit_logs**: Records all duplicate detection events, including flagging and tagging actions.

### Duplicate Detection Logic
Duplicate detection calculates a confidence score based on:
-   **Email Match** (40 points)
-   **Address Match** (up to 40 points, based on sensitivity settings for address1, city, zip)
-   **Name Match** (20 points, case-insensitive)
Orders are flagged if the confidence score is >= 70%.

### Security Hardening
Production deployments include session-based authentication with HTTP-only cookies, protected API endpoints, bcrypt-hashed admin passwords, and robust session management. Rate limiting is applied to API endpoints and authentication attempts. Security headers are implemented via Helmet, including CSP, HSTS, and X-Frame-Options. CORS is configured to restrict origins in production. Error responses are sanitized to hide internal details.

## External Dependencies

-   **Shopify Admin API**: Used for automatic webhook registration, tagging duplicate orders, and retrieving order details.
-   **PostgreSQL**: Primary database for storing order data, detection settings, and audit logs.