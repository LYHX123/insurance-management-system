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

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

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

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
