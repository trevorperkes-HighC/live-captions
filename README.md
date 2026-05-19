# Live Captions

Live closed captions on every attendee's phone, with a shareable transcript and summary at the end of the meeting. English and Spanish.

Built for in-person meetings — particularly large gatherings (e.g. Stake Conference, ~300–500 attendees) where some people want to read along live and others mostly want the notes after.

---

## How it works

```
Speaker's laptop (Chrome/Edge)            Attendee phones (any browser)
  ┌────────────────────────────┐          ┌──────────────────────────┐
  │  Web Speech API → captions │  ─QR─▶   │  Open URL → see captions │
  │  Node server (Express +    │  ──◀───  │  EN / ES toggle          │
  │   Socket.io) on port 3000  │   text   │  Auto-scroll, big text   │
  │  MyMemory translation      │          └──────────────────────────┘
  │  Extractive summary on end │                  ↓
  └────────────────────────────┘            Notes page after end
```

All audience traffic stays on the local WiFi. The only thing that needs internet is the speaker's laptop (for speech recognition and translation API calls).

---

## Quick start (local demo)

You need **Node 18 or newer** and **Chrome or Edge** on the host machine.

```bash
cd live-captions
npm install
npm start
```

You'll see something like:

```
Live Captions server is up.
  local:   http://localhost:3000
  lan:     http://192.168.1.7:3000    <-- scan from phones on same WiFi
```

1. On the laptop: open <http://localhost:3000> in Chrome or Edge. Click **Start a meeting**. The host page shows a QR code.
2. On any phone connected to the same WiFi: open the camera and scan the QR. It opens the join page.
3. On the laptop: click **Start speaking** and allow microphone access.
4. Speak. Captions appear on the phone within ~1 second.
5. When done: click **End meeting**. Everyone gets a link to the notes page (summary + full transcript, copy or download in either language).

---

## Two-phone smoke test

The smallest test that proves the whole flow works:

1. `npm start` on your laptop.
2. Laptop in Chrome → `http://localhost:3000` → **Start a meeting** → **Start speaking**.
3. Phone A on the same WiFi → scan QR → tap **English**.
4. Phone B on the same WiFi → scan QR → tap **Español**.
5. Speak. Phone A sees English captions live; Phone B sees Spanish captions ~half a second behind (translation).
6. Click **End meeting**. Both phones get the notes link. The notes page has the summary and full transcript in both languages.

If both phones show captions within 1–2 seconds of you speaking, the app works on this network.

---

## Running this at Stake Conference (or any large gathering)

The architecture is **LAN-only**: the laptop hosts the server, attendees connect to it over WiFi, no traffic ever leaves the building. That keeps things free, simple, and independent of the chapel's internet bandwidth — but it depends on a few things being true about the venue WiFi.

### Pre-conference WiFi check (do this at least one Sunday before)

Bring your laptop and **two phones** to the chapel on a normal Sunday and run the full smoke test above. Specifically verify:

1. **Both the laptop and the phones can join the chapel WiFi** (you may need a password from the stake's technology specialist).
2. **The phones can reach the laptop.** This is the make-or-break check — many guest/secure WiFi networks have **"AP isolation"** turned on, which silently blocks phone-to-laptop traffic. If captions don't show up on the phones even though both are connected to the same WiFi, that's the symptom.
3. **The chapel WiFi can hold ~500 simultaneous clients.** Most stake centers have commercial-grade WiFi sized for this, but it's worth confirming the count with whoever maintains it.

If (2) fails, escalate to the stake tech specialist — there's usually a way to either enable peer-to-peer on the existing network, or set up a separate SSID that allows it.

### Conference day checklist

- [ ] Laptop charged + power cable.
- [ ] Laptop connected to the chapel WiFi.
- [ ] `npm start` in this directory; confirm the `lan:` line shows the chapel's LAN IP (something like `http://10.x.x.x:3000` or `http://192.168.x.x:3000`).
- [ ] Open <http://localhost:3000>, click **Start a meeting**, verify the QR code's URL uses the chapel's LAN IP.
- [ ] Test from one phone first; confirm captions arrive.
- [ ] **Project the QR code or print it on the program** so attendees can scan from their seats.
- [ ] Show a slide or printed handout with the 3-step join instructions:
  1. Connect to `<chapel WiFi name>`
  2. Scan the QR code (or visit `http://<lan-ip>:3000`)
  3. Tap your language
- [ ] When conference ends, click **End meeting** — everyone gets a notes link.

### Tips

- **The host must be on Chrome or Edge.** iOS Safari's speech recognition stops randomly. Use the laptop.
- **Mic access requires either HTTPS or `localhost`.** On the host laptop, always open <http://localhost:3000> (not the LAN IP) so the browser allows the microphone.
- **The laptop's LAN IP can change if it reconnects to WiFi.** If you swap networks after creating a meeting, reload the host page to regenerate the QR.
- **The laptop needs internet** for Google's speech recognition and MyMemory translation. ~50–100 KB/min — basically nothing.
- **Translation has a free daily quota** of 5,000 characters/day (anonymous). To raise it to 50,000, set `MYMEMORY_EMAIL=you@example.com` before `npm start`. For one 90-minute conference, anonymous is usually enough; for repeated days, use the email.

---

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `MYMEMORY_EMAIL` | Optional. Raises MyMemory translation quota from 5K → 50K chars/day. | unset |

Future production swap (Step 9, not yet wired):

| Variable | Purpose |
|---|---|
| `DEEPGRAM_API_KEY` | If set, route speech recognition through Deepgram instead of the browser's Web Speech API. |
| `GOOGLE_TRANSLATE_KEY` | If set, route translation through Google Cloud Translate. |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | If set, route end-of-meeting summary through gpt-4o-mini or Claude Haiku. |

---

## Project layout

```
live-captions/
├── server/
│   ├── index.js               Express + Socket.io entrypoint, routes
│   ├── rooms.js               In-memory room registry
│   ├── translate/
│   │   └── mymemory.js        Free translation, EN↔ES
│   └── summary/
│       └── extractive.js      Extractive summarizer (no LLM needed)
├── public/
│   ├── index.html             Landing page
│   ├── host.html              Speaker's page (QR + transcribe)
│   ├── join.html              Audience caption view
│   ├── notes.html             Post-meeting notes
│   ├── styles.css
│   ├── favicon.svg
│   └── js/
│       ├── host.js
│       ├── join.js
│       └── notes.js
├── package.json
└── README.md
```

---

## Known limits (prototype scope)

- **State is in-memory.** Room data lives in the Node process. Restarting the server loses any active meeting or stored notes. Fine for one-off events; not for a persistent service.
- **No auth.** Anyone with a host URL can host; anyone with a room code can join. Acceptable for prototype scope.
- **Web Speech API requires internet on the host's laptop.** Captions stop if the laptop loses connection.
- **MyMemory daily quota** is 5K chars/day anonymous, 50K with an email. A long conference can exceed this — captions still flow, but Spanish translations fall back to original English with a "(translation unavailable)" tag.
- **The audience tab needs to stay open** for captions to keep rendering. Closing it and reopening triggers a fresh join with a 10-chunk catch-up.
