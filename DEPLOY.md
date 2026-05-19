# Deploying Live Captions to Render (free tier)

This walks through getting a public cloud URL so the app works without your laptop being the server. About 15 minutes start to finish.

You only need to do this once. After it's deployed, anyone can host a meeting from the public URL on any device.

---

## What you'll end up with

- A public URL like `https://live-captions-rexburg.onrender.com`
- HTTPS by default (no cert work)
- $0/month on the free tier
- Auto-redeploys when you push code updates

## What you need before starting

- A free **GitHub** account ([github.com](https://github.com))
- A free **Render** account ([render.com](https://render.com)) — sign up with the same GitHub for the easiest path
- ~15 minutes

---

## Step 1 — Push this project to a GitHub repo

If git is already set up locally (a `.git` folder exists in the project), skip to **1b**.

### 1a. Initialize the project as a git repo

From inside the `live-captions/` folder:

```bash
git init
git add .
git commit -m "Initial commit: Live Captions chapel-ready build"
```

### 1b. Create an empty repo on GitHub

1. Go to [github.com/new](https://github.com/new).
2. Name it something like `live-captions`. **Public** is easiest for Render free tier.
3. Don't initialize with a README (we already have one).
4. Click **Create repository**.
5. On the next page, copy the two commands GitHub shows you under "…or push an existing repository from the command line". They'll look like:

   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/live-captions.git
   git branch -M main
   git push -u origin main
   ```

6. Run those in your terminal from inside `live-captions/`.

You'll get prompted to authenticate the first time — GitHub uses a Personal Access Token instead of your password, easiest path is to install [GitHub Desktop](https://desktop.github.com/) and use it as a credential helper.

---

## Step 2 — Connect Render to your repo

1. Sign in to [render.com](https://render.com) (recommend "Sign in with GitHub" for fewest steps).
2. From the dashboard, click **New +** → **Blueprint**.
3. Render will ask you to authorize access to your GitHub repos. Pick the `live-captions` repo.
4. Render detects the `render.yaml` in the repo and shows you the service it will create.
5. Click **Apply** / **Create New Resources**.

That's it for setup. Render will pull the code, run `npm install` and `npm start`, and give you a public URL.

The first deploy takes **2–4 minutes**. You'll see live logs in the Render UI.

---

## Step 3 — Verify it works

Once Render shows "Live", click the URL at the top of the service page. It opens the landing page — same as `http://localhost:3000` looks locally, just on HTTPS.

Now test the full flow:

1. On the URL → click **Start a meeting**.
2. You'll land at `https://your-app.onrender.com/host/MEET-XXXX`. Notice the **QR code now encodes the public URL**, not your laptop's LAN IP. ✅
3. From a phone — any phone, on cellular or any WiFi — scan the QR. Captions page opens.
4. Click **Start speaking** on the laptop, allow mic. Say a sentence.
5. Confirm the phone shows captions within ~1 second.
6. End the meeting → both devices land on `/notes/MEET-XXXX`.

If all of that works, you're deployed. Bookmark the URL.

---

## What's different about cloud mode vs LAN mode

| Concern | LAN mode (laptop hosts) | Cloud mode (Render hosts) |
|---|---|---|
| Server location | Your laptop | Render datacenter (Oregon) |
| Attendee internet | Not needed — uses chapel WiFi LAN | Needed — phones reach the public URL via internet |
| Cellular signal in building required? | No | If chapel WiFi doesn't have internet (rare), yes |
| Bandwidth on chapel internet | Tiny (~0.2 Mbps from speaker laptop only) | Modest (~4 Mbps total at peak for all attendees) |
| Setup before each conference | Run `npm start` on laptop | Just open the URL — already running |
| Survives laptop restart? | No | Yes |
| HTTPS / mic-anywhere on host? | Localhost only | Works from any device |
| Free tier cold-start? | N/A | First request after 15 min idle takes ~30 sec |

**Recommended posture for Stake Conference**: deploy this cloud version as the primary, keep LAN mode in your back pocket as a fallback in case the chapel internet is down on conference day.

---

## Cold-start tip

Render's free tier spins the server down after 15 minutes of zero traffic. The first request after that takes ~30 seconds while Render starts the container back up.

**To avoid this affecting your audience:**
- Open the host page on your laptop **5+ minutes before** the meeting starts. Once a Socket.io connection is active, the server stays warm.
- Or visit the URL once shortly before conference to warm it up.

Attendees joining mid-meeting will never see a cold start because the speaker's persistent connection keeps it warm.

---

## Optional: custom domain

If you ever want `https://livecaptions.yourdomain.com` instead of `*.onrender.com`:

1. Buy a domain (~$10–15/year — Cloudflare, Namecheap, Porkbun are all fine).
2. In Render → your service → Settings → Custom Domains → add the domain.
3. Render gives you a CNAME or ALIAS record to set at your domain registrar.
4. Wait ~10 minutes for DNS propagation.
5. **Important**: in Render's Environment tab, set `PUBLIC_URL=https://livecaptions.yourdomain.com` so QR codes use the custom domain. Redeploy.

(Skip this for the first run — the free `.onrender.com` URL works perfectly.)

---

## When you push code updates

Once connected, Render auto-deploys whenever you push to `main`:

```bash
git add .
git commit -m "Tweak summary algorithm"
git push
```

Render picks up the push, redeploys in ~2 minutes. Zero downtime for the audience if you push between meetings; brief disruption (~30s) if you push during a meeting.

---

## Troubleshooting

**"Mixed content" errors in browser console:**
Cloud mode is HTTPS, so any HTTP fetches will be blocked by browsers. The current code is HTTPS-clean — if you see this after a code change, look for any `http://` URLs you might have introduced.

**Captions arrive on the audience phone but slowly:**
Free Render tier has limited CPU. For typical meeting volume this is fine; if you ever see persistent lag at scale, the $7/mo Starter plan removes the cold-start and gives more headroom.

**MyMemory translation rate-limit hit:**
Anonymous quota is 5K chars/day across all visitors to the deployed service. For a single Stake Conference that's plenty. For repeated daily use, set `MYMEMORY_EMAIL` in Render's Environment tab (any valid email raises it to 50K/day, free).

**The deploy fails with "no Node version detected":**
The `render.yaml` pins Node 20. If Render somehow ignores it, manually set `NODE_VERSION=20` in the service's Environment tab.

---

## Bringing it back to LAN mode

Cloud and LAN are not exclusive. To run a local LAN session instead, just `npm start` on your laptop. Nothing on Render gets in the way — it's a separate copy of the app. Audience phones in the chapel scan whichever QR you show them (LAN-IP one or cloud-URL one).
