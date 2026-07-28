# Deployment Guide — Insurance Management System

## Overview

| Item | Value |
|---|---|
| GitHub repository | https://github.com/LYHX123/insurance-management-system |
| Branch | `master` |
| Domain | https://insurance.enfbgroup.com |
| Server | `159.223.70.160` |
| Server directory | `/opt/insurance-management-system` |
| Deployment method | Docker Compose |
| Reverse proxy | Nginx (managed on the host, outside Docker Compose) |
| Production compose file | `docker-compose.yml` (run with `--profile production`) |
| Production env file | `.env.production` (create from `.env.production.example`; never committed) |
| Docker service names | `app` (Next.js runtime), `db` (PostgreSQL 16), `migrate` (one-off Prisma CLI tasks) |
| Host port | `3001` (bound to `127.0.0.1` only) |
| Container port | `3000` |
| Database | PostgreSQL 16, persisted in named volume `insurance-management-system_insurance_db_data` → `/var/lib/postgresql/data` |
| Upload storage | Bind mount `./uploads` (on the host, inside the server directory) → `/app/uploads` in the container |
| Underwriting document storage | Named volume `insurance-management-system_quotation_documents_data` → `/app-data/quotation-documents` |
| Motor policy document storage | Named volume `insurance-management-system_policy_documents_data` → `/app-data/policy-documents` |
| ORM / migrations | Prisma 7, versioned migrations in `prisma/migrations/` |

## 1. First-time server setup

```bash
# On the server
mkdir -p /opt/insurance-management-system
cd /opt/insurance-management-system
git clone https://github.com/LYHX123/insurance-management-system.git .
git checkout master

cp .env.production.example .env.production
# Edit .env.production and fill in real values:
#   - POSTGRES_PASSWORD (strong, unique)
#   - DATABASE_URL (must match POSTGRES_PASSWORD, host "db")
#   - NEXTAUTH_SECRET (generate with: openssl rand -base64 32)
#   - NEXTAUTH_URL=https://insurance.enfbgroup.com
nano .env.production

# Pre-create the uploads directory so Docker doesn't create it as root
mkdir -p uploads
```

## 2. First deployment command

```bash
cd /opt/insurance-management-system
docker compose --profile production up -d --build
```

This builds the `app` image, starts `db` (waits for its healthcheck), then starts `app`.
On a brand-new server the `db` volume is empty — no data exists yet, so the next
step (migration) is required before anyone can log in.

## 3. Database migration (exact command)

Migrations are **not** run automatically on container start — they are run
explicitly so the operator always sees and controls what changes before the
app comes up. The `migrate` service is built from the same Dockerfile's
`builder` stage (it has the full Prisma CLI, which is intentionally not
part of the slim `app` runtime image). Run this once after every deployment
that includes a schema change (safe to run even when there is nothing to
apply).

`--build` is required here (not just on the `app` service's `up --build`):
`docker compose run` does not rebuild an image that already exists under
that service's tag, so without `--build` this command can silently run
against a stale `migrate` image left over from a previous deployment —
missing whatever dependency/code changes came in with the latest `git
pull`. This is exactly how a fixed `package.json`/`prisma.config.ts` issue
can still fail in production even after the fix has been pulled:

```bash
docker compose --profile production run --rm --build migrate
```

This runs `npx prisma migrate deploy`, which only applies pending
migrations in `prisma/migrations/` in order. It never resets, drops, or
force-resets the database, so existing users, customers, projects, and
documents are never touched.

### First deployment only: create the initial admin account

The database starts with zero users. Seed the bootstrap admin once, using
the same `migrate` image with the command overridden:

```bash
docker compose --profile production run --rm --build migrate npx tsx prisma/seed.ts
```

This creates `admin` / `admin123` **only if no user named `admin` exists
yet** (it is a safe upsert with an empty update, so re-running it later
never touches an existing admin's password). **Log in immediately and
change the password** (Users → Reset Password), since this default is
public in the repository's seed script.

## 4. Subsequent update command

```bash
cd /opt/insurance-management-system
git pull origin master
docker compose --profile production up -d --build
docker compose --profile production run --rm --build migrate
```

Rebuilding and recreating the `app` container does not affect the `db`
container, its volume, or the `./uploads` bind mount — both persist across
`up`, `down` (without `-v`), rebuilds, and full server reboots.

## 5. Viewing logs

```bash
# Follow app logs
docker compose --profile production logs -f app

# Follow database logs
docker compose --profile production logs -f db

# Last 200 lines, both services
docker compose --profile production logs --tail 200
```

## 6. Rollback method

Application code rollback (no schema change involved):

```bash
cd /opt/insurance-management-system
git log --oneline -10          # find the last known-good commit
git checkout <previous-commit-or-tag>
docker compose --profile production up -d --build
```

If a migration must also be rolled back, write and apply a new forward
migration that reverses the change (`prisma migrate dev --name revert_x`
locally, commit it, deploy as in step 4). **Do not** use `prisma migrate
reset` or edit applied migration files in place — both are destructive to
production data.

Data-level rollback (only if a bad deploy corrupted data, not for routine
code rollbacks): restore the `insurance-management-system_insurance_db_data`
volume and `./uploads` directory from your backup/snapshot process. No
backup mechanism is set up as part of this change — set up periodic
`pg_dump` + uploads directory backups separately before relying on this
path.

## 7. Nginx reverse proxy (host-level, outside Docker Compose)

The app container only listens on `127.0.0.1:3001`. Point Nginx at that
address and forward the proxy headers NextAuth needs to trust the proxy:

```nginx
server {
    listen 443 ssl;
    server_name insurance.enfbgroup.com;

    client_max_body_size 25m; # keep in sync with MAX_UPLOAD_FILE_SIZE_MB

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

(TLS certificate configuration is not included here — use your existing
Nginx/Certbot setup for the domain.)

## 8. What is NOT included

- No real Dropbox credentials or `DropboxStorageProvider` — storage remains
  `LocalStorageProvider` (see `src/lib/storage/`) until that is explicitly
  requested.
- No automated backup job — set one up separately (`pg_dump` on a schedule,
  plus rsync/snapshot of `./uploads`).
- No CI/CD pipeline — deployment is manual via the commands above.
