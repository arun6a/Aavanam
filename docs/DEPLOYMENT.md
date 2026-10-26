# Aavanam — Deployment Guide

This document covers deploying Aavanam to Google Cloud Run per BRD §8
(M8 — Cloud deployment and hardening).

---

## Prerequisites

1. Google Cloud account with billing enabled
2. `gcloud` CLI installed + authenticated (`gcloud auth login`)
3. Docker installed (for local testing)
4. GitHub repo cloned locally

## Architecture on GCP

```
                    ┌─────────────────────────────────┐
                    │   Cloud Load Balancer (HTTPS)    │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │   Cloud Run service: aavanam    │
                    │   (Next.js standalone build)    │
                    │   - Port 3000                    │
                    │   - Tesseract OCR (Alpine apk)   │
                    │   - Auto-scale 0→10 instances    │
                    └────────┬───────────────┬────────┘
                             │               │
              ┌──────────────┴──┐    ┌───────┴──────────┐
              │  Cloud SQL       │    │  Cloud Storage    │
              │  PostgreSQL 16  │    │  - originals/    │
              │  (managed DB)    │    │  - exports/      │
              └─────────────────┘    └──────────────────┘
                             │
              ┌──────────────┴──┐
              │ Secret Manager   │
              │ - DATABASE_URL   │
              │ - NEXTAUTH_SECRET│
              │ - OPENAI_API_KEY │
              └─────────────────┘
```

---

## Step 1 — Create GCP resources

```bash
# Set variables
export PROJECT_ID="your-gcp-project"
export REGION="asia-south1"  # Mumbai (closest to India)
export APP_NAME="aavanam"

# Create project (if needed)
gcloud projects create $PROJECT_ID
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  sql.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com

# Create Cloud SQL PostgreSQL instance
gcloud sql instances create $APP_NAME-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=$REGION

# Create database + user
gcloud sql databases create aavanam --instance=$APP_NAME-db
gcloud sql users create aavanam \
  --instance=$APP_NAME-db \
  --password="$(openssl rand -base64 24)"

# Create GCS buckets
gsutil mb -l $REGION gs://$APP_NAME-originals
gsutil mb -l $REGION gs://$APP_NAME-exports

# Create secrets
echo -n "postgresql://aavanam:$(openssl rand -base64 24)@/$REGION:$APP_NAME-db/aavanam" | \
  gcloud secrets create DATABASE_URL --data-file=-
echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create NEXTAUTH_SECRET --data-file=-
echo -n "sk-your-openai-key" | \
  gcloud secrets create OPENAI_API_KEY --data-file=-
```

## Step 2 — Switch to PostgreSQL schema

```bash
# In your local clone:
cp prisma/schema.postgres.prisma prisma/schema.prisma

# Generate Prisma client for PostgreSQL
bun run db:generate

# Create a migration (will be applied on container start via prisma migrate deploy)
bun run db:migrate --name init
```

## Step 3 — Build + deploy to Cloud Run

### Option A: Deploy from source (easiest)

```bash
gcloud run deploy $APP_NAME \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --add-cloudsql-instances $PROJECT_ID:$REGION:$APP_NAME-db \
  --set-env-vars "STORAGE_PROVIDER=gcs,GCS_BUCKET_ORIGINALS=$APP_NAME-originals,GCS_BUCKET_EXPORTS=$APP_NAME-exports,NEXTAUTH_URL=https://$APP_NAME-xyz.run.app" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,NEXTAUTH_SECRET=NEXTAUTH_SECRET:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest" \
  --service-account $APP_NAME-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 300
```

### Option B: Deploy pre-built Docker image

```bash
# Build
docker build -t gcr.io/$PROJECT_ID/$APP_NAME .

# Push
docker push gcr.io/$PROJECT_ID/$APP_NAME

# Deploy
gcloud run deploy $APP_NAME \
  --image gcr.io/$PROJECT_ID/$APP_NAME \
  --region $REGION \
  --allow-unauthenticated \
  --add-cloudsql-instances $PROJECT_ID:$REGION:$APP_NAME-db \
  --set-env-vars "STORAGE_PROVIDER=gcs,GCS_BUCKET_ORIGINALS=$APP_NAME-originals" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,NEXTAUTH_SECRET=NEXTAUTH_SECRET:latest" \
  --memory 1Gi \
  --timeout 300
```

## Step 4 — Create service account + grant permissions

```bash
# Create service account
gcloud iam service-accounts create $APP_NAME-sa

# Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$APP_NAME-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$APP_NAME-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$APP_NAME-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Bind to Cloud Run service
gcloud run services update $APP_NAME \
  --region $REGION \
  --service-account $APP_NAME-sa@$PROJECT_ID.iam.gserviceaccount.com
```

## Step 5 — Set up CI/CD with GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/setup-gcloud@v2
        with:
          service_account_key: ${{ secrets.GCP_SA_KEY }}
          project_id: ${{ secrets.GCP_PROJECT_ID }}
      - name: Deploy
        run: |
          gcloud run deploy aavanam \
            --source . \
            --region asia-south1 \
            --allow-unauthenticated
```

## Step 6 — Seed production database

After first deploy, the auto-seed hook will create the default org + admin
user. The credentials will be in the Cloud Run logs:

```bash
gcloud run services logs read aavanam --region $REGION | grep "Login:"
```

You'll see:
```
[seed] ✓ Complete. Login: admin@aavanam.local / aavanam123
```

**CHANGE THE DEFAULT PASSWORD IMMEDIATELY** after first login:
1. Sign in with admin@aavanam.local / aavanam123
2. Create a new admin account via the "Create account" flow
3. Sign in as the new admin, demote or delete the default admin

## Step 7 — Set up monitoring + alerts

```bash
# Create uptime check
gcloud monitoring uptime create $APP_NAME-uptime \
  --resource-type=uptime-url \
  --resource-labels=host=$APP_NAME.run.app,project_id=$PROJECT_ID

# Create alert policy for error rate > 5%
# (Configure via Cloud Monitoring UI — too complex for CLI in MVP)
```

## Step 8 — Set up backups

Cloud SQL has automated backups enabled by default. To configure:

```bash
gcloud sql instances patch $APP_NAME-db \
  --backup-start-time=02:00 \
  --enable-point-in-time-recovery
```

## Local testing with docker-compose

```bash
# Start PostgreSQL + app
docker compose up -d

# Wait for healthcheck
docker compose ps

# App available at http://localhost:3000
# PostgreSQL at localhost:5432 (user: aavanam, password: aavanam_dev_password)
```

## Environment variables reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | `postgresql://user:pass@host/db?schema=public` |
| `NEXTAUTH_SECRET` | ✅ | — | Random 32+ char string (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | ✅ | `http://localhost:3000` | Public URL of the app (for auth callbacks) |
| `OPENAI_API_KEY` | ❌ | — | For OpenAI LLM (optional — defaults to Z.ai LLM) |
| `STORAGE_PROVIDER` | ❌ | `local` | `local` or `gcs` |
| `GCS_BUCKET_ORIGINALS` | ❌ | — | GCS bucket for original document files |
| `GCS_BUCKET_EXPORTS` | ❌ | — | GCS bucket for export files |
| `GOOGLE_APPLICATION_CREDENTIALS` | ❌ | — | Path to GCP service account JSON (set automatically on Cloud Run) |

## Troubleshooting

### "JWEDecryptionFailed" error
The `NEXTAUTH_SECRET` changed. Clear browser cookies + sign in again.

### "Cannot read properties of undefined (reading 'findUnique')"
Prisma client not generated. Run `bun run db:generate` + restart server.

### OCR not working in Docker
Make sure `Dockerfile` includes `RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng`.

### Database connection timeout on Cloud Run
Verify the `--add-cloudsql-instances` flag matches your Cloud SQL instance.
The connection string should use `/cloudsql/<project>:<region>:<instance>` as the host.
