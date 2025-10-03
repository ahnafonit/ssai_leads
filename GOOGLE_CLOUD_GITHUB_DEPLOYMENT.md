# Google Cloud + GitHub Deployment Guide
## Lead Scraper Pro - Complete CI/CD Setup

This guide will walk you through deploying your Lead Scraper Pro application to Google Cloud Platform with automated deployments from your GitHub repository.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Google Cloud Setup](#google-cloud-setup)
3. [Backend Deployment (Cloud Run)](#backend-deployment-cloud-run)
4. [Frontend Deployment (Firebase Hosting)](#frontend-deployment-firebase-hosting)
5. [GitHub Actions CI/CD Setup](#github-actions-cicd-setup)
6. [Environment Configuration](#environment-configuration)
7. [Testing Your Deployment](#testing-your-deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts & Tools
- ✅ GitHub account (with repository: https://github.com/ahnafonit/ssai_leads.git)
- ✅ Google Cloud Platform account ([sign up here](https://cloud.google.com/))
- ✅ Your API Keys ready:
  - OpenAI API Key
  - Anthropic (Claude) API Key
  - Google Places API Key

### Install Required Tools

```bash
# Install Google Cloud SDK
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Verify installation
gcloud --version

# Install Firebase CLI
npm install -g firebase-tools

# Verify installation
firebase --version
```

---

## Google Cloud Setup

### Step 1: Create a New Project

```bash
# Login to Google Cloud
gcloud auth login

# Create a new project
gcloud projects create lead-scraper-pro --name="Lead Scraper Pro"

# Set as default project
gcloud config set project lead-scraper-pro

# Enable billing (required for Cloud Run)
# Go to: https://console.cloud.google.com/billing
# Link your billing account to the project
```

### Step 2: Enable Required APIs

```bash
# Enable Cloud Run API
gcloud services enable run.googleapis.com

# Enable Cloud Build API (for CI/CD)
gcloud services enable cloudbuild.googleapis.com

# Enable Container Registry API
gcloud services enable containerregistry.googleapis.com

# Enable Secret Manager API (for secure API keys)
gcloud services enable secretmanager.googleapis.com
```

### Step 3: Store API Keys Securely

```bash
# Store OpenAI API Key
echo -n "sk-proj-YOUR_OPENAI_KEY" | gcloud secrets create openai-api-key --data-file=-

# Store Anthropic API Key
echo -n "sk-ant-YOUR_ANTHROPIC_KEY" | gcloud secrets create anthropic-api-key --data-file=-

# Store Google Places API Key
echo -n "YOUR_GOOGLE_PLACES_KEY" | gcloud secrets create google-places-api-key --data-file=-

# Verify secrets were created
gcloud secrets list
```

---

## Backend Deployment (Cloud Run)

### Step 1: Create Dockerfile for Backend

Your backend needs a Dockerfile optimized for Cloud Run:

Create `lead-scraper-backend/Dockerfile`:

```dockerfile
FROM node:18-slim

# Install Chrome dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use installed Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose port (Cloud Run uses PORT env variable)
ENV PORT=8080
EXPOSE 8080

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "server.js"]
```

### Step 2: Update server.js for Cloud Run

Make sure your `lead-scraper-backend/server.js` uses the PORT environment variable:

```javascript
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
```

### Step 3: Build and Deploy Backend to Cloud Run

```bash
cd lead-scraper-backend

# Build the container image
gcloud builds submit --tag gcr.io/lead-scraper-pro/backend

# Deploy to Cloud Run
gcloud run deploy lead-scraper-backend \
  --image gcr.io/lead-scraper-pro/backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10 \
  --set-secrets="OPENAI_API_KEY=openai-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,GOOGLE_PLACES_API_KEY=google-places-api-key:latest"

# Get the backend URL (save this for later)
gcloud run services describe lead-scraper-backend --region us-central1 --format='value(status.url)'
```

**Your backend URL will look like**: `https://lead-scraper-backend-xxxx-uc.a.run.app`

---

## Frontend Deployment (Firebase Hosting)

### Step 1: Initialize Firebase

```bash
cd lead-scraper-pro

# Login to Firebase
firebase login

# Initialize Firebase project
firebase init hosting
```

When prompted:
- **Select project**: Create a new project or use existing "lead-scraper-pro"
- **Public directory**: Enter `build`
- **Single-page app**: Yes
- **Set up automatic builds with GitHub**: No (we'll do this manually with Actions)
- **Overwrite index.html**: No

### Step 2: Configure Environment for Production

Create `lead-scraper-pro/.env.production`:

```env
REACT_APP_API_URL=https://lead-scraper-backend-xxxx-uc.a.run.app
```

**Replace the URL with your actual Cloud Run backend URL from above**

### Step 3: Build and Deploy Frontend

```bash
# Build the production version
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting

# Get your deployed URL
firebase hosting:channel:deploy live
```

**Your frontend URL will look like**: `https://lead-scraper-pro.web.app`

---

## GitHub Actions CI/CD Setup

Now let's automate deployments whenever you push to GitHub.

### Step 1: Set up Google Cloud Service Account

```bash
# Create a service account
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions"

# Grant necessary permissions
gcloud projects add-iam-policy-binding lead-scraper-pro \
  --member="serviceAccount:github-actions@lead-scraper-pro.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding lead-scraper-pro \
  --member="serviceAccount:github-actions@lead-scraper-pro.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding lead-scraper-pro \
  --member="serviceAccount:github-actions@lead-scraper-pro.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding lead-scraper-pro \
  --member="serviceAccount:github-actions@lead-scraper-pro.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding lead-scraper-pro \
  --member="serviceAccount:github-actions@lead-scraper-pro.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Create and download a key
gcloud iam service-accounts keys create key.json \
  --iam-account=github-actions@lead-scraper-pro.iam.gserviceaccount.com

# Display the key (you'll add this to GitHub)
cat key.json
```

### Step 2: Add Secrets to GitHub

1. Go to your GitHub repository: https://github.com/ahnafonit/ssai_leads
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `GCP_PROJECT_ID` | `lead-scraper-pro` |
| `GCP_SA_KEY` | Paste the entire content of `key.json` |
| `FIREBASE_TOKEN` | Run `firebase login:ci` and paste the token |

### Step 3: Create GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Google Cloud

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

env:
  GCP_PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  BACKEND_SERVICE_NAME: lead-scraper-backend
  FRONTEND_PROJECT_ID: lead-scraper-pro
  REGION: us-central1

jobs:
  deploy-backend:
    name: Deploy Backend to Cloud Run
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v1
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v1

      - name: Configure Docker for GCR
        run: gcloud auth configure-docker

      - name: Build Backend Container
        working-directory: ./lead-scraper-backend
        run: |
          docker build -t gcr.io/${{ env.GCP_PROJECT_ID }}/backend:${{ github.sha }} .
          docker tag gcr.io/${{ env.GCP_PROJECT_ID }}/backend:${{ github.sha }} gcr.io/${{ env.GCP_PROJECT_ID }}/backend:latest

      - name: Push Backend Container to GCR
        run: |
          docker push gcr.io/${{ env.GCP_PROJECT_ID }}/backend:${{ github.sha }}
          docker push gcr.io/${{ env.GCP_PROJECT_ID }}/backend:latest

      - name: Deploy Backend to Cloud Run
        run: |
          gcloud run deploy ${{ env.BACKEND_SERVICE_NAME }} \
            --image gcr.io/${{ env.GCP_PROJECT_ID }}/backend:${{ github.sha }} \
            --platform managed \
            --region ${{ env.REGION }} \
            --allow-unauthenticated \
            --memory 2Gi \
            --cpu 2 \
            --timeout 300 \
            --max-instances 10 \
            --set-secrets="OPENAI_API_KEY=openai-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,GOOGLE_PLACES_API_KEY=google-places-api-key:latest"

      - name: Get Backend URL
        id: backend-url
        run: |
          URL=$(gcloud run services describe ${{ env.BACKEND_SERVICE_NAME }} --region ${{ env.REGION }} --format='value(status.url)')
          echo "url=$URL" >> $GITHUB_OUTPUT
          echo "Backend deployed to: $URL"

    outputs:
      backend_url: ${{ steps.backend-url.outputs.url }}

  deploy-frontend:
    name: Deploy Frontend to Firebase
    runs-on: ubuntu-latest
    needs: deploy-backend
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: lead-scraper-pro/package-lock.json

      - name: Install dependencies
        working-directory: ./lead-scraper-pro
        run: npm ci

      - name: Build frontend
        working-directory: ./lead-scraper-pro
        env:
          REACT_APP_API_URL: ${{ needs.deploy-backend.outputs.backend_url }}
        run: npm run build

      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.GCP_SA_KEY }}
          projectId: ${{ env.FRONTEND_PROJECT_ID }}
          channelId: live
          entryPoint: ./lead-scraper-pro

  test-deployment:
    name: Test Deployment
    runs-on: ubuntu-latest
    needs: [deploy-backend, deploy-frontend]
    
    steps:
      - name: Test Backend Health
        run: |
          response=$(curl -s -o /dev/null -w "%{http_code}" ${{ needs.deploy-backend.outputs.backend_url }}/api/health)
          if [ $response -eq 200 ]; then
            echo "✅ Backend health check passed"
          else
            echo "❌ Backend health check failed with status $response"
            exit 1
          fi

      - name: Test Backend AI Status
        run: |
          curl -s ${{ needs.deploy-backend.outputs.backend_url }}/api/ai-status | jq '.'
```

### Step 4: Commit and Push Workflow

```bash
# Add the workflow file
git add .github/workflows/deploy.yml

# Commit
git commit -m "Add Google Cloud + GitHub Actions CI/CD pipeline"

# Push to GitHub
git push origin main
```

Now every time you push to the `main` branch, GitHub Actions will automatically:
1. Build your backend Docker image
2. Deploy backend to Cloud Run
3. Build your React frontend
4. Deploy frontend to Firebase Hosting
5. Run health checks

---

## Environment Configuration

### Update Backend CORS Settings

Make sure your `lead-scraper-backend/server.js` allows your Firebase domain:

```javascript
const cors = require('cors');

const allowedOrigins = [
  'http://localhost:3000',
  'https://lead-scraper-pro.web.app',
  'https://lead-scraper-pro.firebaseapp.com'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
```

### Configure Custom Domain (Optional)

**For Backend:**
```bash
gcloud run domain-mappings create \
  --service lead-scraper-backend \
  --domain api.yourdomain.com \
  --region us-central1
```

**For Frontend:**
```bash
firebase hosting:channel:deploy production --only hosting
# Then add custom domain in Firebase Console
```

---

## Testing Your Deployment

### 1. Test Backend Directly

```bash
# Get your backend URL
BACKEND_URL=$(gcloud run services describe lead-scraper-backend --region us-central1 --format='value(status.url)')

# Test health endpoint
curl $BACKEND_URL/api/health

# Test AI status
curl $BACKEND_URL/api/ai-status

# Test scraping (example)
curl -X POST $BACKEND_URL/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"type":"google","query":"coffee shops","location":"New York, NY"}'
```

### 2. Test Frontend

Open your Firebase URL in a browser:
```bash
firebase hosting:channel:open live
```

### 3. Monitor Logs

**Backend logs:**
```bash
gcloud run logs read lead-scraper-backend --region us-central1 --limit 50
```

**Follow live logs:**
```bash
gcloud run logs tail lead-scraper-backend --region us-central1
```

---

## Troubleshooting

### Issue 1: Puppeteer Timeout Errors

**Solution:** Increase Cloud Run timeout and memory:
```bash
gcloud run services update lead-scraper-backend \
  --timeout 300 \
  --memory 2Gi \
  --cpu 2 \
  --region us-central1
```

### Issue 2: CORS Errors

**Solution:** Verify allowed origins in backend and redeploy:
```bash
cd lead-scraper-backend
gcloud builds submit --tag gcr.io/lead-scraper-pro/backend
gcloud run deploy lead-scraper-backend --image gcr.io/lead-scraper-pro/backend --region us-central1
```

### Issue 3: Environment Variables Not Loading

**Solution:** Check secrets are accessible:
```bash
gcloud secrets versions access latest --secret="openai-api-key"
```

### Issue 4: Build Failures in GitHub Actions

**Solution:** Check GitHub Actions logs and verify:
- Service account has correct permissions
- GCP_SA_KEY secret is properly formatted JSON
- Project ID is correct

### Issue 5: Out of Memory Errors

**Solution:** Increase memory allocation:
```bash
gcloud run services update lead-scraper-backend \
  --memory 4Gi \
  --region us-central1
```

---

## Monitoring & Cost Management

### Set Up Monitoring

```bash
# Enable Cloud Monitoring
gcloud services enable monitoring.googleapis.com

# Create uptime check
gcloud monitoring uptime-checks create https lead-scraper-backend \
  --hostname=lead-scraper-backend-xxxx-uc.a.run.app \
  --path=/api/health
```

### Cost Optimization Tips

1. **Cloud Run Pricing:**
   - Free tier: 2 million requests/month
   - After: ~$0.40 per million requests
   - Memory: ~$0.0000025 per GB-second

2. **Reduce Costs:**
   - Set `--min-instances 0` (default, scales to zero)
   - Set `--max-instances 10` to cap maximum cost
   - Use `--cpu 1` for lighter workloads

3. **Monitor Usage:**
```bash
# View current month costs
gcloud billing accounts list
```

### Set Budget Alerts

1. Go to: https://console.cloud.google.com/billing
2. Select your project
3. Go to **Budgets & alerts**
4. Create budget alert (e.g., $10/month)

---

## Deployment Checklist

- [ ] Google Cloud project created
- [ ] Billing enabled
- [ ] APIs enabled (Cloud Run, Cloud Build, Secret Manager)
- [ ] API keys stored in Secret Manager
- [ ] Backend Dockerfile created
- [ ] Backend deployed to Cloud Run
- [ ] Backend URL obtained
- [ ] Frontend .env.production configured
- [ ] Frontend deployed to Firebase
- [ ] GitHub secrets configured
- [ ] GitHub Actions workflow created
- [ ] First automated deployment successful
- [ ] Health checks passing
- [ ] CORS configured correctly
- [ ] Monitoring enabled
- [ ] Budget alerts set

---

## Quick Commands Reference

```bash
# View all services
gcloud run services list

# Delete a service
gcloud run services delete SERVICE_NAME --region us-central1

# View logs
gcloud run logs tail lead-scraper-backend --region us-central1

# SSH into Cloud Shell (for debugging)
gcloud cloud-shell ssh

# List all secrets
gcloud secrets list

# Update a secret
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-

# Rollback deployment
gcloud run services update-traffic lead-scraper-backend \
  --to-revisions=REVISION_NAME=100 \
  --region us-central1
```

---

## Next Steps

After successful deployment:

1. **Add Custom Domain:**
   - Purchase domain
   - Configure DNS
   - Add SSL certificate

2. **Implement Authentication:**
   - Use Firebase Auth
   - Add JWT tokens
   - Protect API endpoints

3. **Add Database:**
   - Use Cloud Firestore or Cloud SQL
   - Migrate from in-memory storage

4. **Set Up Analytics:**
   - Google Analytics
   - Firebase Analytics
   - Cloud Monitoring dashboards

5. **Implement Backup Strategy:**
   - Automated database backups
   - Code repository backups

---

## Support & Resources

- **Google Cloud Run Docs:** https://cloud.google.com/run/docs
- **Firebase Hosting Docs:** https://firebase.google.com/docs/hosting
- **GitHub Actions Docs:** https://docs.github.com/actions
- **Your Repository:** https://github.com/ahnafonit/ssai_leads

---

## Estimated Costs

For moderate usage (1000 requests/day):
- **Cloud Run Backend:** ~$5-10/month
- **Firebase Hosting:** Free (up to 10GB transfer)
- **Cloud Build:** Free (120 build minutes/day)
- **Secret Manager:** ~$0.06/month

**Total: ~$5-10/month**

---

**Your application is now live and automatically deployed! 🚀**

Every git push to `main` will trigger automatic deployment to Google Cloud.

**Backend URL:** `https://lead-scraper-backend-xxxx-uc.a.run.app`  
**Frontend URL:** `https://lead-scraper-pro.web.app`
