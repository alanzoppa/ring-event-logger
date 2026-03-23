# Ring Event Logger

Real-time event logger for Ring cameras, doorbells, and alarm systems using the unofficial `ring-client-api`.

## Features

- Capture all events: motion, person detection, doorbell presses, alarm sensor triggers
- Real-time push notifications via WebSocket
- SQLite storage with efficient querying
- Device registry with battery/signal tracking
- Webhook support for agent invocation and notifications
- Graceful shutdown and token persistence

## Quick Start

### 1. Get a Refresh Token

```bash
npm run auth
```

This will prompt for your Ring credentials and 2FA code, then output a refresh token.

### 2. Configure

```bash
cp .env.example .env
# Edit .env and add your refresh token
```

### 3. Install and Run

```bash
npm install
npm run build
npm start
```

## Webhook Configuration

Webhooks are configured in `webhooks.json` (in the project root).

```bash
cp webhooks.json.example webhooks.json
# Edit webhooks.json with your endpoints
```

### Webhook Options

| Option | Description |
|--------|-------------|
| `name` | Friendly name for logging |
| `url` | Webhook endpoint URL |
| `method` | HTTP method (default: POST) |
| `headers` | Custom headers |
| `eventTypes` | Filter by event types (e.g., `["person", "doorbell_pressed"]`) |
| `cameraIds` | Filter by camera IDs |
| `format` | `openclaw`, `discord`, or `custom` |

### Example: OpenClaw Agent Invocation

```json
{
  "name": "openclaw-agent",
  "url": "http://localhost:3000/api/trigger",
  "format": "openclaw",
  "eventTypes": ["person"],
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

Payload sent:

```json
{
  "event": "person",
  "source": "Front Door",
  "location": "Home",
  "timestamp": "2026-03-22T13:00:00Z",
  "dingId": "abc123",
  "prompt": "Person detected on Front Door camera at 1:00 PM. Location: Home."
}
```

### Example: Discord Notification

```json
{
  "name": "discord-alert",
  "url": "https://discord.com/api/webhooks/123456/abcdef",
  "format": "discord",
  "eventTypes": ["person", "doorbell_pressed"]
}
```

## Event Types

| Type | Description |
|------|-------------|
| `motion` | General motion detected |
| `person` | Person detected (Ring smart alert) |
| `ding` | Doorbell press |
| `doorbell_pressed` | Alternative doorbell event |
| `on_demand` | On-demand video started |
| `sensor_triggered` | Alarm sensor faulted |
| `sensor_cleared` | Alarm sensor cleared |

## Running as a Service

### Option 1: pm2 (Recommended)

```bash
npm install -g pm2
pm2 start dist/index.js --name ring-event-logger
pm2 save
pm2 startup  # Follow instructions to start on boot
```

### Option 2: tmux

```bash
tmux new -s ring-logger
npm start
# Detach: Ctrl+B, D
# Reattach: tmux attach -t ring-logger
```

## Database Schema

### Events Table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| timestamp | TEXT | When event occurred (ISO 8601) |
| received_at | TEXT | When we received it |
| source_type | TEXT | camera, doorbell, alarm_device, location, system |
| source_id | TEXT | Device/location ID |
| source_name | TEXT | Human-readable name |
| event_type | TEXT | motion, ding, doorbell_pressed, etc. |
| data | TEXT | Full JSON payload |

### Query Examples

```sql
-- Recent person detections
SELECT * FROM events 
WHERE event_type = 'person' 
ORDER BY timestamp DESC LIMIT 20;

-- Doorbell presses today
SELECT * FROM events 
WHERE event_type IN ('ding', 'doorbell_pressed')
  AND date(timestamp) = date('now');

-- Event counts by camera
SELECT source_name, event_type, COUNT(*) 
FROM events 
GROUP BY source_name, event_type;
```

## Important Notes

### Refresh Tokens

Ring refresh tokens expire shortly after use. This service automatically persists updated tokens. If you restart without the updated token, **push notifications will stop working**.

If this happens:
1. Delete the device from Ring Control Center
2. Re-run `npm run auth` to get a new token

### Person Detection

Person detection requires Ring Protect subscription and cameras that support smart alerts.

## License

MIT
