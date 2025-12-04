# Production Deployment Guide

This guide covers deploying Duplicate Guard to a production server using Docker.

## Prerequisites

- Docker and Docker Compose installed on your server
- Git repository access
- Shopify app credentials
- Public domain/URL for webhook registration (or use a tunneling service)

## Server Setup

### 1. Install Docker and Docker Compose

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Clone the Repository

```bash
git clone <your-repo-url> duplicate-guard
cd duplicate-guard
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
nano .env
```

Fill in all required variables (see `.env.example` for reference):

**Critical**: Use strong, unique passwords for production! Never use default values.

#### Log Level Configuration

The application supports configurable log levels via the `LOG_LEVEL` environment variable:

- `error` - Only errors (most restrictive)
- `warn` - Errors and warnings
- `info` - Errors, warnings, and info (default for production)
- `debug` - All logs including debug (default for development)

**Production Recommendation**: Set `LOG_LEVEL=info` in your `.env` file to reduce log verbosity while keeping important information. This will hide verbose debug logs (like full webhook payloads) but still show errors, warnings, and important info messages.

Example `.env` entry:

```env
LOG_LEVEL=info
```

#### SMTP Configuration for Email Notifications

To enable email notifications for duplicate order alerts, configure SMTP settings in your `.env` file:

```env
# SMTP Configuration (required for email notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

**Common SMTP Providers:**

- **Gmail**:

  - `SMTP_HOST=smtp.gmail.com`
  - `SMTP_PORT=587` (TLS) or `465` (SSL)
  - Use an [App Password](https://support.google.com/accounts/answer/185833) instead of your regular password
  - `SMTP_FROM` should match `SMTP_USER`

- **SendGrid**:

  - `SMTP_HOST=smtp.sendgrid.net`
  - `SMTP_PORT=587`
  - `SMTP_USER=apikey`
  - `SMTP_PASS=your-sendgrid-api-key`
  - `SMTP_FROM=your-verified-sender@example.com`

- **Mailgun**:
  - `SMTP_HOST=smtp.mailgun.org`
  - `SMTP_PORT=587`
  - `SMTP_USER=postmaster@your-domain.mailgun.org`
  - `SMTP_PASS=your-mailgun-password`
  - `SMTP_FROM=noreply@your-domain.com`

**Security Note**: Never commit SMTP credentials to version control. Store them securely in your `.env` file, which should be gitignored.

### 4. Create Production Docker Compose File

Create `docker-compose.prod.yml` in the project root with your production configuration.

**Important**: The `docker-compose.prod.yml` file is gitignored and should contain your production-specific configuration. Never commit it to version control.

## Deployment

### 1. Build and Start Services

```bash
# Build and start all services
docker-compose -f docker-compose.prod.yml up -d --build

# Check logs
docker-compose -f docker-compose.prod.yml logs -f

# Check service status
docker-compose -f docker-compose.prod.yml ps
```

### 2. Initialize Database Schema

```bash
# Run database migrations
docker-compose -f docker-compose.prod.yml exec app npm run db:migrate
```

### 3. Register Shopify Webhook

Once your application is accessible via a public URL:

```bash
# Register the webhook
curl -X POST https://your-domain.com/api/webhooks/register

# Check webhook status
curl https://your-domain.com/api/webhooks/status
```

## Maintenance

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f app
docker-compose -f docker-compose.prod.yml logs -f postgres
```

### Update Application

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose -f docker-compose.prod.yml up -d --build

# Run database migrations if needed
docker-compose -f docker-compose.prod.yml exec app npm run db:migrate
```

### Backup Database

```bash
# Create backup
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U duplicate-guard duplicate-guard > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
docker-compose -f docker-compose.prod.yml exec -T postgres psql -U duplicate-guard duplicate-guard < backup_file.sql
```

### Stop Services

```bash
# Stop all services
docker-compose -f docker-compose.prod.yml down

# Stop and remove volumes (⚠️ deletes data)
docker-compose -f docker-compose.prod.yml down -v
```

## Health Checks

The application includes health checks:

- **Application**: `GET /api/dashboard/stats` (returns 200 when healthy)
- **Database**: PostgreSQL health check via `pg_isready`

Check health status:

```bash
# Docker health status
docker-compose -f docker-compose.prod.yml ps

# Application health endpoint
curl https://your-domain.com/api/dashboard/stats
```

## Troubleshooting

### Application Won't Start

1. Check logs: `docker-compose -f docker-compose.prod.yml logs app`
2. Verify environment variables are set correctly
3. Ensure database is healthy: `docker-compose -f docker-compose.prod.yml ps postgres`

### Database Connection Issues

1. Verify `DATABASE_URL` uses the service name `postgres` (not `localhost`)
2. Check database logs: `docker-compose -f docker-compose.prod.yml logs postgres`
3. Verify database is healthy: `docker-compose -f docker-compose.prod.yml exec postgres pg_isready -U duplicate-guard`

### Webhook Not Receiving Events

1. Verify webhook is registered: `curl https://your-domain.com/api/webhooks/status`
2. **For Partner Apps**: Verify `SHOPIFY_API_SECRET` matches your app's Client Secret from Partner Dashboard
3. **For Legacy Custom Apps**: Check `SHOPIFY_WEBHOOK_SECRET` matches Shopify app credentials
4. Check server logs for webhook verification errors and configuration issues
5. Verify `APP_URL` is set correctly in `.env`
6. Check application logs for webhook errors

### Docker Compose ContainerConfig Error

If you see `KeyError: 'ContainerConfig'` or orphan container warnings:

This usually happens when containers are in a bad state or orphaned from previous deployments. Fix it with:

```bash
# Stop all containers (including orphans)
sudo docker-compose -f docker-compose.prod.yml down --remove-orphans

# Remove any broken containers manually if needed
sudo docker ps -a | grep duplicate-guard
sudo docker rm -f duplicate-guard-app-prod duplicate-guard-db-prod 2>/dev/null || true

# Clean up any broken containers
sudo docker container prune -f

# Now start fresh
sudo docker-compose -f docker-compose.prod.yml up -d --build
```

**Alternative**: If using Docker Compose v1 (older version), consider upgrading to Docker Compose v2:

```bash
# Check current version
docker-compose --version

# Upgrade to Docker Compose v2 (if using Docker 20.10+)
# Docker Compose v2 is included with Docker Desktop and newer Docker Engine installations
# Use: docker compose (without hyphen) instead of docker-compose
```

## Security Considerations

1. **Use strong passwords** for database and environment variables
2. **Keep `.env` file secure** - never commit it to Git
3. **Keep `docker-compose.prod.yml` secure** - it's gitignored, never commit it
4. **Never use default credentials** - always set strong, unique passwords
5. **Regular updates** - keep Docker images and dependencies updated
6. **Firewall** - only expose necessary ports
7. **Backups** - regularly backup your database
8. **Monitoring** - set up monitoring for application health

⚠️ **See `SECURITY.md` for important information about git history and credential management.**

## Production Checklist

- [ ] Docker and Docker Compose installed
- [ ] Repository cloned
- [ ] `.env` file configured with production values
- [ ] Strong passwords set for database
- [ ] Database schema initialized (`npm run db:migrate`)
- [ ] Application accessible via public URL
- [ ] Shopify webhook registered
- [ ] Health checks passing
- [ ] Backups configured
- [ ] Monitoring set up (optional)

## Support

For issues or questions, check:

- Application logs: `docker-compose -f docker-compose.prod.yml logs`
- Database logs: `docker-compose -f docker-compose.prod.yml logs postgres`
