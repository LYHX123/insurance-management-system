FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Explicit, pinned app UID/GID — every ownership decision below (chown
# statements, entrypoint self-heal, host deployment prep) must agree with
# these two numbers. `-G nodejs` is required: without it, Alpine's adduser
# gives nextjs its own auto-generated system group (observed as GID 65533,
# "nogroup") instead of joining nodejs/1001, so the process's actual runtime
# group silently didn't match what every `chown nextjs:nodejs` below
# intended — the root cause of the production uploads permission failure.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 -G nodejs nextjs

# su-exec: lets the entrypoint start as root just long enough to fix mount
# ownership, then drop to the unprivileged nextjs user for the app's entire
# actual runtime (never permanently root).
RUN apk add --no-cache su-exec

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# Both the Quotation (templates/quotation) and Invoice (templates/inovice)
# Excel template engines read their template file at runtime via
# path.join(process.cwd(), "templates/...") — a dynamic path Next.js's
# standalone-output file tracer cannot always resolve statically, so this
# directory is copied explicitly rather than relying on trace-based
# inclusion alone.
COPY --from=builder /app/templates ./templates

RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads

# Phase 2 underwriting documents — outside /app (the source tree) on
# purpose, per the storage design in src/lib/quotationDocuments/storage.ts.
# The named volume mounted here in docker-compose.yml (quotation_documents_data)
# takes over this directory at container start; this mkdir/chown only
# matters for the mount point's initial ownership.
RUN mkdir -p /app-data/quotation-documents && chown -R nextjs:nodejs /app-data/quotation-documents

# Phase 1B Motor policy documents — same reasoning as the quotation-documents
# directory above (see src/lib/policyDocuments/storage.ts). The named volume
# mounted here in docker-compose.yml (policy_documents_data) takes over this
# directory at container start.
RUN mkdir -p /app-data/policy-documents && chown -R nextjs:nodejs /app-data/policy-documents

# Phase 4A generated Invoice workbooks — same reasoning as the two
# directories above (see src/lib/invoiceDocuments/storage.ts). The named
# volume mounted here in docker-compose.yml (invoice_documents_data) takes
# over this directory at container start.
RUN mkdir -p /app-data/invoices && chown -R nextjs:nodejs /app-data/invoices

COPY --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh

# Deliberately no `USER nextjs` here — the container starts as root so the
# entrypoint can self-heal mount ownership (see docker-entrypoint.sh), then
# immediately execs into nextjs via su-exec for the app's entire actual
# runtime. The process that ends up serving traffic is never root.

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
