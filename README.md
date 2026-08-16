# Pinbook

Pinbook is a faithful Evernote-style notes app **without AI features**. It includes notebooks, stacks, tags, rich-text notes, attachments, reminders metadata, shortcuts, trash, note history, and full-text search.

Built for **macOS and Windows** (Tauri desktop), with a **REST API** and **CLI** for integrating with the rest of your stack. The architecture is API-first so an **iOS app** can be added later against the same endpoints.

## Features

| Feature | Status |
|---------|--------|
| Rich-text notes (TipTap editor) | ✅ |
| Notebooks & stacks | ✅ |
| Tags | ✅ |
| Full-text search (SQLite FTS5) | ✅ |
| Attachments | ✅ |
| Trash / restore / empty trash | ✅ |
| Note revision history | ✅ |
| Shortcuts | ✅ |
| Pin / archive notes | ✅ |
| REST API | ✅ |
| CLI (local + remote API) | ✅ |
| Desktop app (Mac/Windows via Tauri) | ✅ |
| AI assistant / AI search | ❌ intentionally omitted |

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│  Desktop (Tauri)    │     │  Your stack / CI    │
│  React + TipTap UI  │     │  scripts, services  │
└─────────┬───────────┘     └─────────┬───────────┘
          │                           │
          └───────────┬───────────────┘
                      │ HTTP (REST)
              ┌───────▼────────┐
              │  pinbook-api   │
              │  (Axum)        │
              └───────┬────────┘
                      │
              ┌───────▼────────┐
              │  pinbook-core  │
              │  SQLite + FTS5 │
              └────────────────┘
```

Data is stored locally in SQLite:

- **macOS:** `~/Library/Application Support/pinbook/pinbook.db`
- **Windows:** `%APPDATA%/pinbook/pinbook.db`
- **Linux:** `~/.local/share/pinbook/pinbook.db`

Attachments live alongside the database in an `attachments/` directory.

## Quick start

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+ (desktop UI)

### Run the API server

```bash
cargo run -p pinbook-api
```

The API listens on `http://127.0.0.1:8787` by default.

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PINBOOK_HOST` | `127.0.0.1` | Bind address |
| `PINBOOK_PORT` | `8787` | Port |
| `PINBOOK_DB` | OS app data dir | SQLite database path |

### Use the CLI

Local mode (talks directly to SQLite):

```bash
cargo run -p pinbook-cli -- notebook list
cargo run -p pinbook-cli -- note create --notebook <UUID> --title "Meeting notes"
cargo run -p pinbook-cli -- search "meeting"
```

Remote mode (talks to the REST API):

```bash
export PINBOOK_API=http://127.0.0.1:8787
cargo run -p pinbook-cli -- note list
cargo run -p pinbook-cli -- note create --notebook <UUID> --title "From CI" --tags "work,urgent"
```

JSON output for automation:

```bash
pinbook --api http://127.0.0.1:8787 note list --output json
pinbook --api http://127.0.0.1:8787 search "invoice" --output json
```

Install the CLI binary:

```bash
cargo install --path crates/pinbook-cli
```

### Run the desktop app (dev)

Terminal 1 — API (embedded automatically in production builds; for pure web dev):

```bash
cargo run -p pinbook-api
```

Terminal 2 — UI:

```bash
cd apps/desktop
npm install
npm run dev
```

Open `http://localhost:1420`.

### Build desktop installers (Mac / Windows)

```bash
cd apps/desktop
npm install
npm run tauri build
```

Installers are written to `apps/desktop/src-tauri/target/release/bundle/`.

CI also builds Mac and Windows artifacts on every push (see `.github/workflows/ci.yml`).

## REST API reference

Base URL: `http://127.0.0.1:8787`

### Health

- `GET /health`

### Notebooks

- `GET /api/v1/notebooks`
- `POST /api/v1/notebooks` — `{ "name": "Work", "stack_id": null }`
- `GET /api/v1/notebooks/:id`
- `PUT /api/v1/notebooks/:id`
- `DELETE /api/v1/notebooks/:id` (soft delete)
- `POST /api/v1/notebooks/:id/restore`

### Stacks

- `GET /api/v1/stacks`
- `POST /api/v1/stacks` — `{ "name": "Personal" }`
- `DELETE /api/v1/stacks/:id`

### Tags

- `GET /api/v1/tags`
- `POST /api/v1/tags` — `{ "name": "travel" }`
- `DELETE /api/v1/tags/:id`

### Notes

- `GET /api/v1/notes?notebook_id=&tag_id=&trash=&archived=`
- `POST /api/v1/notes` — `{ "notebook_id": "...", "title": "...", "content": "<p>…</p>", "tag_ids": [] }`
- `GET /api/v1/notes/:id`
- `PUT /api/v1/notes/:id`
- `DELETE /api/v1/notes/:id` (move to trash)
- `POST /api/v1/notes/:id/restore`
- `DELETE /api/v1/notes/:id/permanent`

### Search

- `GET /api/v1/search?q=keyword&notebook_id=&tag_id=&limit=50`

### Attachments

- `GET /api/v1/notes/:id/attachments`
- `POST /api/v1/notes/:id/attachments/upload` (multipart field `file`)
- `GET /api/v1/attachments/:id` (download)
- `DELETE /api/v1/attachments/:id`

### Shortcuts & trash

- `GET /api/v1/shortcuts`
- `POST /api/v1/shortcuts/:note_id`
- `DELETE /api/v1/shortcuts/:note_id`
- `POST /api/v1/trash/empty`

### Note history

- `GET /api/v1/notes/:id/revisions`
- `POST /api/v1/notes/:id/revisions/:revision_id/restore`

## Database schema

See `crates/pinbook-core/migrations/001_initial.sql` for the full schema. Core tables:

- `users`, `notebooks`, `stacks`, `tags`, `note_tags`
- `notes` (HTML content + plain-text index)
- `notes_fts` (FTS5 virtual table)
- `attachments`, `note_revisions`, `shortcuts`

## Import from Evernote

Evernote exports notes as **ENEX** files (XML). Pinbook imports these directly.

### Export from Evernote

In Evernote desktop: select notes or a notebook → **File → Export Notes** → save as `.enex`.

### CLI

```bash
pinbook import enex ~/Downloads/MyNotebook.enex
pinbook import enex export.enex --notebook-name "Work Archive"
pinbook import enex ~/EvernoteExports/          # directory of .enex files
pinbook --api http://127.0.0.1:8787 import enex export.enex
```

### API

```bash
curl -X POST "http://127.0.0.1:8787/api/v1/import/enex?notebook_name=Imported" \
  -F "file=@MyNotebook.enex"
```

### Desktop

Use **Import Evernote (.enex)** in the sidebar.

### Import mapping

| Evernote | Pinbook |
|----------|---------|
| Title, ENML body | Note title + HTML content |
| Tags | Tags (flat) |
| Created / updated | Preserved |
| Images & files | Inline images + attachments |
| Source URL, reminders | Preserved when present |
| Notebook structure | One Pinbook notebook per ENEX file |
| Encrypted notes | Placeholder (cannot decrypt) |
| Note links | Not preserved |

## iOS roadmap

The desktop app embeds the same API used by external clients. A future iOS app can:

1. Run against a self-hosted `pinbook-api` instance, or
2. Embed `pinbook-core` via FFI / a Rust mobile target, reusing the schema and search logic.

No AI dependencies are included anywhere in the stack.

## Development

```bash
# Build everything
cargo build --workspace

# Run tests / smoke
cargo build --release -p pinbook-api -p pinbook-cli
PINBOOK_DB=/tmp/test.db ./target/release/pinbook-api &
./target/release/pinbook notebook list --api http://127.0.0.1:8787
```

## License

MIT
