# Ofelia Scheduler Integration for Duplicate Guard

## Quick Start

The cleanup service now runs **automatically every day at 3 AM** via Ofelia.

### What Was Added

1. **Ofelia service** in `docker-compose.prod.yml`:
   - Lightweight cron-like scheduler for Docker
   - Runs inside your Docker network
   - Zero maintenance required

2. **Internal cleanup endpoint** `/api/internal/cleanup`:
   - Triggered by Ofelia scheduler
   - Returns count of deleted records
   - Logs all cleanup operations

### How It Works

```
Ofelia (3 AM daily)
    ↓
Calls: POST /api/internal/cleanup
    ↓
CleanupService.cleanupOldWebhookDeliveries()
    ↓
Deletes webhook_deliveries > 7 days old
    ↓
Logs result
```

### Testing Manually

```bash
# Test the cleanup endpoint
curl -X POST http://localhost:5000/api/internal/cleanup

# Response:
{
  "success": true,
  "deletedCount": 42,
  "message": "Cleaned up 42 old webhook delivery records"
}
```

### Customizing the Schedule

Edit `docker-compose.prod.yml`:

```yaml
# Current: Daily at 3 AM
ofelia.job-exec.cleanup-webhooks.schedule: "0 0 3 * * *"

# Weekly on Sunday at 2 AM:
# ofelia.job-exec.cleanup-webhooks.schedule: "0 0 2 * * 0"

# Every 6 hours:
# ofelia.job-exec.cleanup-webhooks.schedule: "0 0 */6 * * *"
```

Cron format: `seconds minutes hours day month weekday`

### Viewing Logs

```bash
# Check Ofelia scheduler logs
docker logs duplicate-guard-scheduler

# Check if cleanup ran
docker logs duplicate-guard-app-prod | grep Cleanup
```

---

**That's it!** No cron configuration, no external services needed. Ofelia handles everything automatically. 🎉
