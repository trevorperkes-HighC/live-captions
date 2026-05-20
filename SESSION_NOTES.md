# Live Captions — Session Notes

Hands-off handoff document. If you're picking this up in a new chat session, **read this top-to-bottom first** before making changes. Update it whenever a task lands.

---

## Project in one paragraph

**Live Captions** is a web app that puts live closed captions on every attendee's phone during in-person meetings, in English or Spanish, and produces a shareable transcript + summary when the meeting ends. Attendees scan a QR code on their phone and read along — no app install, no account, no cellular data needed.

**Primary intended use:** **Rexburg West Stake** LDS Stake Conference (~300–500 attendees). Goals: (a) read-along captions during the meeting (or just glance when you miss a word), (b) full notes from each speaker to share/take home after. Translation to Spanish is a secondary feature.

## Live URLs

- **Production (Render free tier):** https://live-captions-w8x0.onrender.com — auto-deploys from `main` on every push.
- **GitHub repo:** https://github.com/trevorperkes-HighC/live-captions (public).
- **Local LAN mode:** `npm start` in `live-captions/` — for chapel demos without internet.

---

## Architectural decisions (locked in)

These were debated and decided across the conversation. Don't re-litigate without explicit user direction.

1. **LAN mode is the deployment target.** App runs on the speaker's laptop; attendees connect to it over the chapel WiFi. Audience caption traffic stays inside the chapel router — never touches the public internet. Only the speaker's laptop calls cloud APIs (~50–100 KB/min for STT + translation).
2. **Audience phones do NOT need cellular data.** They connect over the venue WiFi. Inside the chapel/stake center, cellular signal is degraded by construction (concrete/steel), so we cannot rely on attendees having data plans.
3. **No third-party CDNs on audience-facing pages.** All assets served from our own origin. System font stacks only. Lets pages load even on locked-down networks.
4. **Plain JavaScript, no TypeScript.** Fast iteration trumps types for the prototype.
5. **In-memory room registry.** No database yet — `rooms.js` exposes a Map. Restarting the server loses any active meeting. Accepted for prototype scope.
6. **Demo-mode free APIs (Web Speech API + MyMemory translation + extractive summary).** Production stubs for Deepgram / Google Translate / OpenAI / Anthropic are *not yet wired* but the codebase is structured for that swap.
7. **Captions start at the join moment.** No backfill of earlier captions when a phone joins (or reconnects). If they missed something, it's in the post-meeting notes.
8. **Connection report visible to host only.** Gated by a `hostToken` returned at room creation, stored in host's localStorage, passed as `?host=<token>` URL param.

---

## Status

### ✅ Done

| # | Step | Notes |
|---|---|---|
| 1 | Skeleton | Express + Socket.io + qrcode + nanoid; server prints LAN IP on boot |
| 2 | Landing + room creation | POST /api/rooms returns id + hostToken; QR generated server-side as PNG data URL |
| 3 | Host transcription | Web Speech API (`webkitSpeechRecognition`), continuous + interim, emits over Socket.io |
| 4 | Audience live view | `/join/:roomId` renders live captions, auto-scroll |
| 5 | MyMemory translation | Translates only finalized chunks, caches, broadcasts both langs. Audience EN/ES toggle persists in localStorage. Fixed ordering bug via per-room serial queue. |
| 6 | Host language selector | Host can speak English or Spanish; recognizer rebuilds on toggle; bidirectional translation already supported |
| 7 | Notes page | End meeting → drains in-flight translations (20s safety) → extractive summary (word-freq × sqrt-length × position boost, top ~20% of sentences) → broadcasts `meeting_ended`. Notes page has EN/ES toggle, copy + download `.txt`. |
| 8 (essentials) | Catch-up, dedupe, late-joiner notes link | Catch-up later removed per user direction (see #7 above). Reconnect dedupe by chunk id kept defensively. Audience that joins after meeting ended gets the notes link automatically. |
| 8 (extra) | Speaker connection report | Tracks per-room: unique attendees, peak concurrent, language counts, avg session minutes. Keyed by `deviceId` (UUID stored in phone's localStorage). Gated by `hostToken`. |
| 8 (extra) | Prominent meeting-ended audience UI | Captions card transforms into a centered "Meeting ended" card with a primary "View notes & transcript" button. |
| 10 | README + chapel-day checklist | Run instructions, two-phone smoke test, pre-conference WiFi check (esp. AP isolation), conference-day checklist. |
| — | Full polish pass | Brand wordmark + favicon, design system in `styles.css`, refined copy throughout. Landing copy: "Don't miss a word." |
| — | **Mic level meter on host page** | Web Audio API + getUserMedia (separate stream from Web Speech). Shows live RMS-based level bar with too-quiet / good / too-loud zones, peak indicator. "Test mic" button. Helps verify chapel PA tap is feeding audio before pressing Start. |
| — | **Printable "How to Join" handout** | `/handout/:roomId` — clean white print-friendly page with big QR, room code, join URL, 4-step instructions. Linked from host page; user can print and pass out at conference. Print stylesheet hides chrome, removes shadows. |
| — | **Sales sheet for Stake President** | `/pitch` — multi-page proposal doc with: cover composition (laptop + 2 phones showing real UI mockups), who benefits grid, 5-step flow with mini device screenshots, bandwidth-comparison chart proving the broadcast feed isn't impacted, privacy section, cost section, pre-conference test plan, and 3-item approval ask. Inline SVG icons, no external images. Optimized for print or save-as-PDF. |

### ⏳ Pending

- **Microphone source** (operational, **critical for chapel use**). A laptop's built-in mic can't pick up a speaker at the pulpit 30 ft away. User needs to confirm with stake sound operator that they can tap the chapel PA's "record out" jack via a USB audio interface (~$20) so the speaker's pulpit mic feeds the laptop as its audio source.
- **Chapel WiFi test** (operational, not code). Bring laptop + 2 phones to stake center on a normal Sunday and verify (a) phones can reach laptop over chapel WiFi (no AP isolation), (b) the network handles ~500 simultaneous clients.
- **Revoke the temporary GitHub PAT** `live-captions-deploy` at https://github.com/settings/tokens?type=beta — was used once for the initial push (osxkeychain conflict workaround); Render's GitHub App auth handles all future deploys, so this PAT is no longer needed. Optional cleanup; token auto-expires Aug 16, 2026 either way.
- **Step 9 — Production API stubs.** `server/stt/deepgram.js`, `server/translate/google.js`, `server/summary/llm.js`. **Deferred** — free APIs cover the first run.

### Decisions made but not yet acted on

- **Step 9 will become two pieces** when picked up: production stubs + a cloud deployment story (Render or Fly.io, NOT Vercel — Socket.io needs long-running server). Cloud mode kept as a fallback for venues without working LAN peer-to-peer. Code should be portable between the two with no app-logic changes.

---

## Important files

```
live-captions/
├── server/
│   ├── index.js               Express + Socket.io entrypoint, REST endpoints, room/host token logic
│   ├── rooms.js               In-memory room registry, attendee tracking, stats computation
│   ├── translate/mymemory.js  Free EN↔ES translation with in-memory cache
│   └── summary/extractive.js  Extractive summarizer (no LLM)
├── public/
│   ├── index.html             Landing
│   ├── host.html              Speaker's view
│   ├── join.html              Audience caption view
│   ├── notes.html             Post-meeting transcript + summary + (host-only) stats card
│   ├── styles.css             Design system
│   ├── favicon.svg
│   └── js/
│       ├── host.js            Web Speech API, host_chunk emit, end-meeting flow
│       ├── join.js            Audience: deviceId, audience_join/lang, caption render, meeting_ended UI
│       └── notes.js           Fetches notes payload, renders EN/ES, gates stats card by hostToken
├── package.json
├── README.md                  User-facing run instructions
└── SESSION_NOTES.md           (this file)
```

---

## Known issues / gotchas (caught and fixed during build)

These are scars, useful to know about when changing related code:

1. **Out-of-order translations** — early implementation translated chunks in parallel, which let shorter phrases overtake longer earlier ones in the audience feed. **Fix:** per-room serial work queue (`room.workQueue` chain) in `server/index.js`. Don't parallelize translation per room without preserving order.
2. **Dropped final chunk on End meeting** — the last sentence's translation could still be in-flight when END was POSTed; the summary was generated without it. **Fix:** END handler awaits `room.workQueue` (20s timeout) before summarizing. Watch this if you ever change the queue model.
3. **Spanish transcript silently mixed English** — `transcriptFor(chunks, 'es')` originally fell back to `c.original`, which is English when host speaks English and translation failed. **Fix:** drop the fallback in `server/summary/extractive.js`. Cross-language transcripts only include text actually in that language.
4. **iOS Safari mic on LAN IP fails** — `getUserMedia` / Web Speech blocked on non-HTTPS, non-localhost. **Workaround:** host always opens `http://localhost:3000` on the laptop, even though attendee phones use the LAN IP for joining. Documented in host page warning + README.
5. **MyMemory rate limit** — 5K chars/day anonymous, 50K with email. **Workaround:** set `MYMEMORY_EMAIL` env var. On rate-limit failure, chunk ships with `translationError: true` and audience sees "(translation unavailable)" tag.

---

## How to resume in a new session

1. **Read this file first.** Then `README.md` for user-facing context.
2. Check memory: this project has memory files at `~/.claude/projects/-Users-trevorperkes-Downloads-AI-Programs-High-Council/memory/` covering:
   - Audience devices: no cellular dependency, no third-party CDNs
   - Primary use case (Stake Conference accessibility)
   - Session notes maintenance rule (this file)
3. Verify the app still runs:
   ```bash
   cd "/Users/trevorperkes/Downloads/AI Programs/High Council/live-captions"
   npm install
   npm start
   # http://localhost:3000 → "Start a meeting" → speak → "End meeting"
   ```
4. Check git status (not currently in a git repo as of this writing — user may have init'd one later).

## Two-phone test (5 minutes)

1. `npm start` on laptop, open <http://localhost:3000> in Chrome → **Start a meeting**.
2. Phone 1 on same WiFi → scan QR → English.
3. Phone 2 on same WiFi → scan QR → Español.
4. Click **Start speaking**, talk for 30s.
5. Click **End meeting**. Both phones get the notes link. Laptop redirects to `/notes/<id>?host=<token>` and shows the speaker's report at the top.

If any of those steps don't work, that's a regression to investigate first.

---

## Open questions / future direction (not blocking)

- **Step 9 timing** — wait until after chapel test? Or do before? User leaning "after" since free APIs are sufficient for the first real run.
- **Recording / persistent audio** — Web Speech API gives text only; can't re-transcribe later or improve accuracy from a recording. If we ever want a backup, parallel `MediaRecorder` capture would be needed. Out of scope for now.
- **Print/email the notes link** — could be useful to send the post-meeting URL to attendees who weren't on the app, or print a QR for the notes specifically. Not asked for.
- **Spanish stake-conference attendance** — confirmed Spanish translation stays in, user hasn't pinned down whether Spanish speakers will actually use it at their stake. No code change needed either way.
- **Persistence** — currently rooms vanish on server restart. If the laptop ever crashes mid-conference, the room is gone. A SQLite write-behind would solve this; deferred until needed.

---

## Changelog

Append a line each time something material lands.

- **2026-05-17** — Session start. Project spec pasted by user.
- **2026-05-17** — Step 1 (skeleton) → Step 5 (translation + EN/ES toggle) built and verified end-to-end.
- **2026-05-17** — Full visual polish pass (brand wordmark, design system, refined copy).
- **2026-05-17** — Landing copy reframed around "Don't miss a word" / dual use mode (read-along OR background notes). LAN-only constraint clarified.
- **2026-05-17** — Architectural debate: stake-conference scale + cellular dead inside building → confirmed chapel WiFi is the only network; LAN mode preferred, cloud mode kept as planned fallback.
- **2026-05-17** — Step 6 (host language selector) + Step 7 (notes page + extractive summary + drain fix) + Step 8 essentials (catch-up later removed) + Step 10 (README) all landed.
- **2026-05-18** — Captions changed to "start at join moment" (catch-up backfill removed). Speaker connection report added: unique / peak / language / avg session, gated by host token. Meeting-ended audience UI promoted to a prominent "View notes" CTA card.
- **2026-05-18** — `SESSION_NOTES.md` created. Memory rule added: update this file on every completed task.
- **2026-05-18** — Surfaced the **mic-source question** as a critical operational pending item — must be solved (PA tap via USB audio interface) before any real chapel use, otherwise captions are garbage.
- **2026-05-18** — Built three artifacts for the stake-president conversation: (a) **mic level meter** on host page so user can verify audio before pressing Start, (b) **`/handout/:roomId`** printable "How to Join" page per room (linked from host), (c) **`/pitch`** multi-page sales sheet with inline device-frame mockups, bandwidth-impact chart, privacy/cost/test-plan sections, and approval ask.
- **2026-05-18** — Exported `Live-Captions-Proposal.pdf` and `Live-Captions-Handout-Sample.pdf` to `~/Downloads/` via headless Chrome for offline sharing with the Stake President.
- **2026-05-18** — **Cloud-ready.** Added `PUBLIC_URL` / `RENDER_EXTERNAL_URL` support so the QR codes encode the public URL when deployed. Server logs "mode: CLOUD" vs "mode: LAN" on boot. Created `render.yaml` blueprint, `.env.example`, and `DEPLOY.md` walkthrough. Initialized git repo (branch `main`, initial commit `da905b4`).
- **2026-05-20** — **Deployed.** Public URL live at https://live-captions-w8x0.onrender.com (Render free tier, Oregon region, Blueprint-managed from `render.yaml`). Auto-redeploys on every push to `main`. Push to GitHub required a custom credential-helper workaround because Xcode's bundled git ships with `osxkeychain` as a system-level helper that intercepted credentials before our URL-embedded token could be used — wrote a one-shot helper to `/tmp/lc-git-helper.sh` that returned the PAT directly, bypassing keychain. Post-deploy smoke check: healthz OK, room creation in CLOUD mode (joinUrl uses public URL), QR PNG correct, all 5 routes (host/join/notes/handout/pitch) HTTP 200, Socket.io client served.
- **2026-05-20** — **First real end-to-end test passed** (English + Spanish) on the deployed Render instance. Issue surfaced: the audience meeting-ended card only had a "View notes & transcript" link — no direct download. **Fixed:** audience meeting-ended UI now includes (a) a prominent "Download notes (.txt)" button that fires a client-side blob download in the user's selected language with no navigation required, (b) an inline summary preview right on the audience screen so attendees see useful content immediately, (c) a secondary "View full transcript" link to the notes page, (d) language toggle now re-renders the inline summary after meeting end. Commit `5199672`, deployed and verified live.
- **2026-05-20** — **Long-term deploy workflow set up.** User authorized future sessions to push fixes/updates on their behalf. PAT stored at `~/.config/live-captions/deploy-token` (chmod 600), helper script at `~/.config/live-captions/git-helper.sh`. New `reference_deploy_workflow.md` memory documents the bypass for the osxkeychain conflict. Standard push from now on: `git -c credential.helper= -c credential.helper=$HOME/.config/live-captions/git-helper.sh push`. PAT expires 2026-08-16; rotation is just overwriting the token file.
- **2026-05-20** — **Persistence gap exposed in real use.** User tested again (phone host + wife audience) and hit `Server: room_not_found` mid-meeting. Root cause: I pushed two redeploys earlier in the session; each Render redeploy restarts the container and wipes in-memory rooms. Audience captions kept showing (browser-side state) but the server lost the room, so the meeting couldn't end properly → no `meeting_ended` event → no download CTA → no stats redirect. Same root cause blocked all 3 issues the user reported. **Mitigation pushed (commit `3b88a74`):** friendly `room_not_found` handling — clear "Meeting no longer active" card on both host and audience pages, plus a "Save captions so far" rescue button on audience pages with buffered finals.
- **2026-05-20** — **Supabase persistence implemented and locally verified.** User authorized; created `live-captions` project in their existing "Perkes International" Supabase org (West US Oregon, free tier, RLS enabled). Two tables: `rooms` (with summary + attendees inline JSONB) and `chunks` (per-row inserts indexed by room_id + ts). New `server/db.js` exposes safe-no-op functions when SUPABASE env vars unset; `rooms.js` now write-through and has `getRoomAsync()` that hydrates on cache miss. Socket handlers (`host_join`, `audience_join`) and REST endpoints (`/api/rooms/:id`, `/api/rooms/:id/end`, `/api/rooms/:id/notes`, `/api/rooms/:id/qr`) now use async hydration. Required adding `ws` package — Supabase Realtime's client demands a WebSocket constructor even though we never subscribe (Node < 22 has no native one). Smoke test passed: created room, sent chunks, killed the server entirely, restarted, the same room hydrates from Supabase and a fresh client can join without `room_not_found`. Supabase credentials saved at `~/.config/live-captions/env` (chmod 600) for future sessions.
- **2026-05-20** — **Persistence live in production.** User added `SUPABASE_URL` + `SUPABASE_KEY` to the live-captions service env on Render (`dashboard.render.com/web/srv-d86vnu3eo5us73cep0lg/env`). Render auto-redeployed. Smoke check confirms: production room creation returns `mode: cloud`, the row appears in Supabase immediately (queried via REST API with service_role). The `room_not_found` bug from earlier in the day is no longer reproducible — server restarts now transparently hydrate rooms from Supabase.
