# ATG Fleet Dashboard

Live tank monitoring dashboard for City of Raleigh OMNTEC Proteus ATG systems.

## Deployment

### Step 1 — Deploy to Render

1. Go to [render.com](https://render.com) and sign up with your GitHub account
2. Click **New → Web Service**
3. Connect your GitHub repo (`noobsidian/atg-dashboard` or whatever you named it)
4. Fill in:
   - **Name:** `atg-dashboard`
   - **Runtime:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app --bind 0.0.0.0:10000 --timeout 30 --workers 2`
5. Click **Create Web Service**
6. Wait for deployment — Render gives you a URL like `https://atg-dashboard.onrender.com`

### Step 2 — Update the proxy URL in dashboard.html

1. Open `dashboard.html`
2. Find this line near the top of the `<script>` section:
   ```
   const PROXY_URL = "https://atg-dashboard.onrender.com/api/tanks";
   ```
3. Replace `atg-dashboard.onrender.com` with your actual Render URL
4. Save and commit to GitHub

### Step 3 — Embed in SharePoint

1. Go to your SharePoint site
2. Create a new page or edit an existing one
3. Click **+** to add a web part
4. Search for and select **Embed**
5. Paste your Render URL: `https://atg-dashboard.onrender.com`
6. Resize the embed web part to fill the page
7. Publish the page
8. Share the SharePoint page URL with your team to bookmark

### Keep Render Awake (Free Tier)

Render's free tier spins down after 15 minutes of inactivity causing a ~30 second
wake-up delay. To prevent this, add a second scheduled flow or use a free uptime
monitor like [UptimeRobot](https://uptimerobot.com) to ping your `/health` endpoint
every 14 minutes:
- Monitor URL: `https://atg-dashboard.onrender.com/health`
- Interval: 14 minutes
- Type: HTTP(s)
