# Deploy to Google Cloud (Cloud Run)

This project can be deployed to Google Cloud Run using the Dockerfile in the repository.

## Prerequisites

1. Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install
2. Authenticate: `gcloud auth login`
3. Select your project: `gcloud config set project YOUR_PROJECT_ID`
4. Enable required APIs:
   - `gcloud services enable run.googleapis.com`
   - `gcloud services enable cloudbuild.googleapis.com`
   - `gcloud services enable artifactregistry.googleapis.com`

## Recommended deployment steps

```bash
cd /path/to/snake-multiplayer-main

gcloud builds submit --tag gcr.io/$GOOGLE_CLOUD_PROJECT/snake-multiplayer

gcloud run deploy snake-multiplayer \
  --image gcr.io/$GOOGLE_CLOUD_PROJECT/snake-multiplayer \
  --platform managed \
  --region asia-east1 \
  --allow-unauthenticated \
  --set-env-vars SESSION_SECRET=YOUR_SECRET
```

If you use Google OAuth, set additional environment variables for your OAuth client credentials:

```bash
--set-env-vars SESSION_SECRET=YOUR_SECRET,GOOGLE_CLIENT_ID=YOUR_CLIENT_ID,GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
```

## Notes

- The app listens on port `8080` via the Dockerfile.
- If you prefer App Engine, you can create an `app.yaml` instead, but Cloud Run is recommended for socket-based multiplayer apps.
- Make sure your OAuth callback URL is configured in the Google Cloud Console to match the deployed URL.

## Local test

Run locally first with:

```bash
npm install
npm start
```

Then visit `http://localhost:3000`.
