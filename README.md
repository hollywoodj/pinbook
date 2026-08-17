# Pinbook

A self-hosted Pinboard clone with local SQLite storage, Pinboard-compatible API, and JSON import.

## Features

- **Pinboard-faithful UI** — minimalist layout matching pinboard.in (606px main column, tag sidebar, bracketed action links, private/unread color coding)
- **Local SQLite database** — all data stored in `data/pinbook.db`
- **Pinboard API v1** — drop-in compatible with existing Pinboard clients and scripts
- **Modern REST API** — JSON endpoints for easier integration with modern stacks
- **JSON import** — import Pinboard exports or custom JSON via web UI or CLI

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:3000

On first run, an API token is printed to the console. Find it anytime at `/settings/`.

### Import sample data

```bash
npm run import
# or
npm run import -- path/to/export.json
```

## API

### Pinboard-compatible (GET)

All endpoints mirror [Pinboard API v1](https://pinboard.in/api/). Add `?format=json` for JSON responses.

Authenticate with `?auth_token=username:TOKEN` or HTTP Basic Auth.

```
GET /api/v1/posts/update          # last update time
GET /api/v1/posts/add?url=...     # add bookmark
GET /api/v1/posts/delete?url=...  # delete bookmark
GET /api/v1/posts/get?url=...     # get bookmark(s)
GET /api/v1/posts/recent          # recent bookmarks
GET /api/v1/posts/all             # all bookmarks
GET /api/v1/posts/dates           # dates with counts
GET /api/v1/posts/suggest?url=... # tag suggestions
GET /api/v1/tags/get              # all tags
```

### Modern REST (JSON)

```
GET    /api/v1/bookmarks              # list (supports ?tag=, ?toread=yes, ?shared=no)
POST   /api/v1/bookmarks              # create { url, description, extended, tags, shared, toread }
DELETE /api/v1/bookmarks?url=...      # delete
POST   /api/v1/import                 # bulk import JSON body
```

### Example

```bash
# List all bookmarks
curl "http://localhost:3000/api/v1/posts/all?auth_token=pinbook:YOUR_TOKEN&format=json"

# Add a bookmark
curl "http://localhost:3000/api/v1/posts/add?auth_token=pinbook:YOUR_TOKEN&url=https://example.com&description=Example&tags=demo"

# Modern API
curl -X POST http://localhost:3000/api/v1/bookmarks \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'pinbook:YOUR_TOKEN' | base64)" \
  -d '{"url":"https://example.com","description":"Example","tags":"demo"}'
```

## JSON Import Format

Supports Pinboard export format:

```json
{
  "posts": [
    {
      "href": "https://example.com",
      "description": "Title",
      "extended": "Notes about this bookmark",
      "tag": "tag1 tag2",
      "time": "2024-01-15T10:30:00Z",
      "shared": "yes",
      "toread": "no"
    }
  ]
}
```

Also accepts a plain array of bookmarks with `url`/`href`, `title`/`description`, `tags`/`tag`.

## Integration Options

| Method | Best for |
|--------|----------|
| **Pinboard API** | Existing Pinboard scripts, browser extensions, mobile apps |
| **REST JSON API** | Modern apps, serverless functions, TypeScript clients |
| **SQLite direct** | Local scripts needing zero-latency reads (`data/pinbook.db`) |
| **JSON import/export** | One-time migrations, backups |
| **Webhooks** | Event-driven stacks (set `PINBOOK_WEBHOOK_URL` env var) |

For most tech stacks, the **REST JSON API** is the simplest integration path. If you already have Pinboard tooling, use the **Pinboard-compatible API** for zero migration effort.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `PINBOOK_ALLOW_ANON` | unset | Set to `1` to allow API access without auth (dev only) |
| `PINBOOK_WEBHOOK_URL` | unset | POST bookmark events to this URL |

## License

MIT
