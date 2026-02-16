# Self-Volt Server

A self-hosted VoltChat backend server that allows you to host your own communities with complete privacy. Self-Volt stores all data locally on your server - messages, files, members, and handles encryption independently.

## Features

- **Complete Server Hosting**: Create and manage multiple servers
- **End-to-End Encryption**: Built-in E2E encryption support (AES-256-GCM)
- **Voice Channels**: Real-time voice chat with mute/deafen support
- **File Storage**: Upload and share files locally
- **Channel Management**: Text and voice channels with permissions
- **Role System**: Custom roles with granular permissions
- **Invite System**: Generate shareable invite links
- **Message Features**: Reactions, pins, editing, deletions
- **Flexible Storage**: JSON (default) with SQLite support

## Quick Start

### 1. Install Dependencies

```bash
cd self-volt
npm install
```

### 2. Configure (Optional)

Copy the example config and customize:

```bash
cp config.default.json config.json
```

Edit `config.json` to customize:
- Server name and port
- Storage type (json/sqlite)
- Voice channel settings
- File upload limits
- Main server connection (optional)

### 3. Start the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The server runs on `http://localhost:3001` by default.

## Configuration

### Server Settings

```json
{
  "server": {
    "name": "My Server",
    "port": 3001
  }
}
```

### Storage

```json
{
  "storage": {
    "type": "json",
    "json": {
      "directory": "./data"
    }
  }
}
```

For SQLite:
```json
{
  "storage": {
    "type": "database",
    "database": {
      "type": "sqlite",
      "filename": "./data/volt.db"
    }
  }
}
```

### Voice Channels

```json
{
  "voice": {
    "enabled": true,
    "bitrate": 64000,
    "maxUsersPerChannel": 25
  }
}
```

### File Storage

```json
{
  "files": {
    "enabled": true,
    "maxFileSize": 10485760,
    "allowedTypes": ["image/*", "video/*", "audio/*"]
  }
}
```

### Connecting to Main Server (Optional)

To show your self-volt on the main VoltChat server:

1. Go to **Settings** → **Self-Volt** on the main VoltChat website
2. Click **Add Self-Volt** 
3. Enter your server name (e.g., "My Home Server") and URL (e.g., `https://volt.mydomain.com:3001`)
4. Click **Add** - an API key will be generated
5. Copy the API key and add it to your `config.json`:

```json
{
  "mainServer": {
    "url": "https://voltchatapp.enclicainteractive.com",
    "apiKey": "volt_abc123...",
    "autoPing": true,
    "pingInterval": 60000
  }
}
```

6. Restart your self-volt server

Your self-volt will now show as "Online" on the main VoltChat website and other users can discover it.

**Note**: This is completely optional. Your self-volt works fully standalone without connecting to any main server.

## Environment Variables

Create a `.env` file (optional - config.json is preferred):

```env
PORT=3001
MAIN_SERVER_URL=https://voltchatapp.enclicainteractive.com
MAIN_SERVER_API_KEY=
```

## API Endpoints

### Server

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/config` | Get server config |
| POST | `/api/config` | Update server config |
| GET | `/api/storage-info` | Storage statistics |
| GET | `/api/servers` | List all servers |
| POST | `/api/servers` | Create server |
| GET | `/api/servers/:id` | Get server details |
| PUT | `/api/servers/:id` | Update server |

### Channels

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/channels` | List channels |
| POST | `/api/servers/:id/channels` | Create channel |
| PUT | `/api/channels/:id` | Update channel |
| DELETE | `/api/channels/:id` | Delete channel |

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/channels/:id/messages` | Get messages |
| GET | `/api/channels/:id/pins` | Get pinned messages |

### Members

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/members` | List members |
| POST | `/api/servers/:id/members` | Add member |
| DELETE | `/api/servers/:id/members/:userId` | Remove member |

### Roles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/roles` | List roles |
| POST | `/api/servers/:id/roles` | Create role |
| PUT | `/api/servers/:id/roles/:roleId` | Update role |
| DELETE | `/api/servers/:id/roles/:roleId` | Delete role |

### Encryption

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/e2e/status/:serverId` | Get encryption status |
| POST | `/api/e2e/enable/:serverId` | Enable encryption |
| POST | `/api/e2e/disable/:serverId` | Disable encryption |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload file(s) |
| DELETE | `/api/upload/:fileId` | Delete file |

## WebSocket Events

### Client → Server

| Event | Data | Description |
|-------|------|-------------|
| `authenticate` | `{serverId, userId, username, avatar}` | Authenticate user |
| `channel:join` | `channelId` | Join channel |
| `message:send` | `{channelId, content, attachments}` | Send message |
| `message:edit` | `{messageId, channelId, content}` | Edit message |
| `message:delete` | `{messageId, channelId}` | Delete message |
| `reaction:add` | `{messageId, channelId, emoji}` | Add reaction |
| `voice:join` | `{channelId, serverId}` | Join voice |
| `voice:leave` | `{channelId}` | Leave voice |

### Server → Client

| Event | Data | Description |
|-------|------|-------------|
| `authenticated` | `{user}` | Auth success |
| `message:new` | `message` | New message |
| `message:edited` | `message` | Message edited |
| `message:deleted` | `{messageId, channelId}` | Message deleted |
| `voice:joined` | `{channelId, users}` | Joined voice |
| `voice:user-joined` | `{channelId, user}` | User joined voice |
| `voice:user-left` | `{channelId, userId}` | User left voice |

## Creating a Server

```bash
curl -X POST http://localhost:3001/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Community",
    "description": "A great place to chat",
    "ownerId": "user123",
    "ownerUsername": "john"
  }'
```

## Integrating with Frontend

Point your frontend to your self-volt server:

```javascript
// In your frontend socket connection
const socket = io('http://localhost:3001', {
  auth: {
    token: 'user-token'
  }
})
```

## Data Storage

All data is stored in the `./data` directory:

- `volt-data.json` - All server, channel, message, and member data
- `uploads/` - Uploaded files

## Security

- Each server gets a unique encryption key
- Optional E2E encryption for messages
- CORS can be configured in config.json
- No external dependencies required

## Troubleshooting

### Server won't start

```bash
# Check if port is in use
lsof -i :3001

# Change port in config.json
```

### Can't connect

```bash
# Check server logs
cat logs/volt.log

# Verify CORS settings in config.json
```

### Upload issues

```bash
# Check uploads directory permissions
ls -la uploads/

# Verify maxFileSize in config.json
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use a reverse proxy (nginx, Apache)
3. Enable SSL/TLS
4. Set appropriate CORS origins
5. Configure log rotation

Example nginx config:
```nginx
server {
    listen 443 ssl;
    server_name volt.mydomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

## License

MIT
