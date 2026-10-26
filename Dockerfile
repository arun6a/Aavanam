# Dockerfile for Aavanam — AI Document Extraction Platform
# Multi-stage build: install deps → build → run (small image)
#
# Per BRD §4 — deploy to Google Cloud Run with this Dockerfile.
#
# Build:
#   docker build -t aavanam .
# Run:
#   docker run -p 3000:3000 -e DATABASE_URL=postgresql://... -e NEXTAUTH_SECRET=... -e OPENAI_API_KEY=... aavanam
#
# Deploy to Cloud Run:
#   gcloud run deploy aavanam --source . --region asia-south1 --allow-unauthenticated

FROM node:20-alpine AS deps
WORKDIR /app
# Install bun for faster installs
RUN npm install -g bun
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g bun
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client
RUN bun run db:generate
# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Install system tesseract for OCR (per /lib/ocr/index.ts)
# apk add tesseract-ocr tesseract-ocr-data-eng for OCR support
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng

# Copy build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Auto-run migrations on container start
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run Prisma migrations + start server
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
