#!/bin/sh
set -e

# Self-heals ownership drift on the app's data mount points at every
# container start. /app/uploads is a host bind mount (docker-compose.yml) —
# its ownership reflects whatever the host directory had, not the image, so
# a server migration / backup restore can silently reintroduce a UID/GID
# mismatch (this is exactly what broke production uploads: host dir was
# 1000:1000, the app process was running as 1001:65533 because of a
# separate adduser bug, now fixed below in the Dockerfile). The named
# volumes are included too, since a freshly created volume on a new host
# takes root's default ownership until something chowns it.
#
# Ownership only — never chmod 777 — and only touched when it's actually
# wrong, so this is a no-op on every normal restart once corrected once.
APP_UID=1001
APP_GID=1001

for dir in /app/uploads /app-data/quotation-documents /app-data/policy-documents /app-data/invoices; do
  if [ -d "$dir" ]; then
    owner=$(stat -c '%u:%g' "$dir")
    if [ "$owner" != "$APP_UID:$APP_GID" ]; then
      chown -R "$APP_UID:$APP_GID" "$dir"
    fi
  fi
done

exec su-exec nextjs:nodejs "$@"
