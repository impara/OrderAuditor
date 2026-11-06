# Multi-stage Dockerfile for Duplicate Guard production deployment

# Stage 1: Build
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json .npmrc ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
# Copy source code
COPY . .

# Build the application
ARG VITE_SHOPIFY_API_KEY
ENV VITE_SHOPIFY_API_KEY=$VITE_SHOPIFY_API_KEY
RUN npm run build

# Stage 2: Production runtime
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS production

WORKDIR /app

# Copy package files
COPY package.json package-lock.json .npmrc ./

# Install production dependencies
RUN npm ci --only=production && npm cache clean --force

# Install drizzle-kit and TypeScript for database migrations (needed in production deploy one-off)
RUN npm install drizzle-kit@^0.31.7 typescript@^5.6.3 --no-save && npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/scripts/product-activation-report.mjs ./scripts/product-activation-report.mjs

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
  adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/ready', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "dist/index.js"]

