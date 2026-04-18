# Pocket Notes

Pocket Notes is a small server-rendered daily notes app built for constrained browsers and e-ink devices. It keeps the browser side simple, stores users and notes in a single SQLite database, and can back up exported SQLite snapshots to Google Drive with Duplicati.

## Features

- Works without browser JavaScript.
- Multi-user login backed by SQLite.
- One note per owner per day, with note sharing between users.
- Default editor page for writing one date at a time.
- Dedicated notes feed page with year and month filters plus simple pagination.
- Each feed card has separate View and Edit actions.
- Markdown stays plain in the editor and renders on the server in the notes feed.
- The editor includes a no-JavaScript Markdown help modal with basic syntax examples.
- Admin-only user registration and admin role management.
- Admins can download a fresh SQLite snapshot from the Admin page.
- Failed sign-in attempts are rate limited to slow password guessing.
- Users can change their own password from the Profile page.
- Responsive Flexbox layout aimed at narrow screens and e-ink readers.
- Docker setup with one mounted runtime directory.
- Optional Google Drive backup through Duplicati.

## Requirements

- Node.js 24 or newer.
- npm.
- Docker and Docker Compose if you want containerized deployment.

## Local Run

```bash
npm install
npm start
```

The app listens on `http://localhost:3000` by default.

On first start, the server creates `runtime-data/`, creates `runtime-data/backup-snapshots/`, and creates `runtime-data/pocket-notes.sqlite` with this temporary admin account:

- Username: `admin`
- Password: `changeme`

After signing in, open the Profile page to replace that default password.

Change that password before exposing the app anywhere beyond a trusted network.

## Admin Management

Admins can:

- Create new users from the Admin page.
- Grant or remove admin access for existing users.
- Share saved notes with other users from the editor page.
- Download a SQLite snapshot from the Admin page.

## Database Layout

The live database is stored at `runtime-data/pocket-notes.sqlite`.

## Data Layout

Runtime data lives under `runtime-data/` when running locally. That directory is created automatically on first start and is ignored by git.

```text
runtime-data/
  pocket-notes.sqlite
  backup-snapshots/
    pocket-notes-2026-04-18T20-00-00-000Z.sqlite
```

When you run with Docker Compose, the services use named Docker volumes instead: `notes`, `duplicati-config`, and `duplicati-storage`.

Saving an empty note clears the note row for that day.

## Docker

Build and run:

```bash
docker compose up --build
```

The container uses one mount:

- `notes:/app/runtime-data`

The app and snapshot-export services share the `notes` volume. If you enable backups, Duplicati also uses the `duplicati-config` and `duplicati-storage` volumes.

The default container port is `3000`. Override the host port with the `PORT` environment variable.

Failed-login protection defaults to 8 bad sign-in attempts per 15 minutes for each client IP. Override that with `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` and `LOGIN_RATE_LIMIT_WINDOW_SECONDS` if needed.

Snapshot exports default to every 15 minutes and keep the newest 14 files. Override that with `BACKUP_SNAPSHOT_INTERVAL_SECONDS` and `BACKUP_SNAPSHOT_KEEP_COUNT` if needed.

## Google Drive Backup With Duplicati

1. Set a Duplicati web UI password with `DUPLICATI_WEBSERVICE_PASSWORD` and a settings encryption key with `DUPLICATI_SETTINGS_ENCRYPTION_KEY`.
2. Start the backup profile:

```bash
docker compose --profile backup up -d
```

3. Open the Duplicati web UI at `http://localhost:8200` or your `DUPLICATI_PORT` override.
4. Create a new backup job in Duplicati and choose Google Drive as the destination.
5. Use `/source/backup-snapshots` as the source path inside Duplicati. That points to exported SQLite snapshots, not the live database files.

The `backup-snapshot` service creates timestamped SQLite snapshots in `runtime-data/backup-snapshots/` on the interval you configure. Duplicati then uploads those clean snapshots to Google Drive.

Duplicati stores its UI configuration in the `duplicati-config` Docker volume and any local backup storage it needs in the `duplicati-storage` Docker volume.

## PocketBook-Friendly Choices

- No browser JavaScript is required.
- The date input uses `YYYY-MM-DD` text input rather than relying on a native date picker.
- The notes feed uses normal links and full-page pagination.
- Markdown rendering happens on the server, so the browser only receives HTML.
- SQLite keeps backup simple because users, notes, and sharing live in one database file.
- Layout uses Flexbox and avoids animations.

## Next Hardening Steps

- Replace the default admin password.
- Set a strong `SESSION_SECRET`.
- Put the app behind HTTPS if accessed outside a trusted local network.
- Restrict network access if the device is only meant for personal use.
