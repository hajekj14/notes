# Pocket Notes

Pocket Notes is a small server-rendered daily notes app built for constrained browsers and e-ink devices. It keeps the browser side simple, stores users and notes in a single SQLite database, and can back up that runtime data to Google Drive with rclone.

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
- Optional Google Drive backup through rclone.

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

On first start, the server creates `runtime-data/`, copies `runtime-data/sync/rclone.conf.example`, and creates `runtime-data/pocket-notes.sqlite` with this temporary admin account:

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
  sync/
    rclone.conf
    rclone.conf.example
```

Saving an empty note clears the note row for that day.

## Docker

Build and run:

```bash
docker compose up --build
```

The container uses one mount:

- `./runtime-data:/app/runtime-data`

That one mount holds the SQLite database and the sync config.

The default container port is `3000`. Override the host port with the `PORT` environment variable.

Failed-login protection defaults to 8 bad sign-in attempts per 15 minutes for each client IP. Override that with `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` and `LOGIN_RATE_LIMIT_WINDOW_SECONDS` if needed.

## Google Drive Backup With rclone

1. Start the app once so it creates `runtime-data/` and `runtime-data/sync/rclone.conf.example`.
2. Copy `runtime-data/sync/rclone.conf.example` to `runtime-data/sync/rclone.conf`.
3. Replace the placeholder values with your real rclone Google Drive remote config.
4. Start the sync profile:

```bash
docker compose --profile sync up -d
```

The sync container mirrors `runtime-data` to `gdrive:pocket-notes` every 15 minutes by default, excluding the local `sync` configuration directory.

Override the interval with `RCLONE_SYNC_INTERVAL`, measured in seconds.

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
