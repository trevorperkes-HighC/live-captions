const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server: IOServer } = require('socket.io');

const rooms = require('./rooms');
const { translate } = require('./translate/mymemory');
const { summarizeRoom } = require('./summary/extractive');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: '*' },
});

// Behind Render/Fly/etc. — trust the platform's proxy headers so req.protocol /
// req.ip / etc. reflect the real client.
app.set('trust proxy', true);

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ---------- helpers ----------

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function publicBaseUrl() {
  // Cloud-mode wins if either env var is set. Falls back to LAN mode.
  // PUBLIC_URL: user-set explicit override (custom domain, etc.)
  // RENDER_EXTERNAL_URL: auto-injected by Render. Other platforms differ —
  //   set PUBLIC_URL manually on Fly.io / Railway / etc.
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  const lan = getLanIp() || 'localhost';
  return `http://${lan}:${PORT}`;
}

function buildJoinUrl(roomId) {
  return `${publicBaseUrl()}/join/${encodeURIComponent(roomId)}`;
}

function publicRoomShape(room) {
  if (!room) return null;
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
    endedAt: room.endedAt,
    hostLang: room.hostLang,
    joinUrl: buildJoinUrl(room.id),
    lanIp: getLanIp(),
    port: PORT,
    mode: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL) ? 'cloud' : 'lan',
  };
}

// Includes the host token. Only returned by POST /api/rooms (room creation),
// so attendees joining via QR never see it. The host page caches the token in
// localStorage and uses it to fetch the stats report.
function privateRoomShape(room) {
  return { ...publicRoomShape(room), hostToken: room.hostToken };
}

// ---------- HTML routes ----------

app.get('/host/:roomId', (_req, res) => {
  // Static page; client JS validates the room with /api/rooms/:roomId.
  res.sendFile(path.join(PUBLIC_DIR, 'host.html'));
});

app.get('/join/:roomId', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'join.html'));
});

app.get('/notes/:roomId', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'notes.html'));
});

app.get('/handout/:roomId', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'handout.html'));
});

app.get('/pitch', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pitch.html'));
});

// ---------- API ----------

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post('/api/rooms', (_req, res) => {
  const room = rooms.createRoom();
  res.status(201).json(privateRoomShape(room));
});

app.get('/api/rooms/:roomId', async (req, res) => {
  const room = await rooms.getRoomAsync(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  res.json(publicRoomShape(room));
});

// End a meeting: drain in-flight translations, run summary, broadcast meeting_ended.
app.post('/api/rooms/:roomId/end', async (req, res) => {
  const room = await rooms.getRoomAsync(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (room.endedAt) {
    // Idempotent — return existing notes URL if already ended.
    return res.json({
      roomId: room.id,
      endedAt: room.endedAt,
      notesUrl: `/notes/${encodeURIComponent(room.id)}`,
    });
  }

  // Drain any pending translations so the last sentence the speaker said
  // makes it into the transcript and summary. 20s safety net — generous
  // because translate() itself has an 8s per-call timeout, and the queue
  // is serial. If the safety net trips, we summarize whatever made it.
  if (room.workQueue) {
    try {
      await Promise.race([
        room.workQueue,
        new Promise((_, rj) => setTimeout(() => rj(new Error('drain_timeout')), 20000)),
      ]);
    } catch (err) {
      console.warn(`[end] ${room.id} drain warning: ${err.message}`);
    }
  }

  const notes = summarizeRoom(room.chunks);
  rooms.endRoom(room.id, notes);

  const notesUrl = `/notes/${encodeURIComponent(room.id)}`;
  io.to(room.id).emit('meeting_ended', { roomId: room.id, notesUrl });
  console.log(`[room] ${room.id} ended; ${room.chunks.length} chunks, EN ${notes.transcripts.en.length} chars / ES ${notes.transcripts.es.length} chars`);

  res.json({ roomId: room.id, endedAt: room.endedAt, notesUrl });
});

// Notes payload for the post-meeting page. Returns transcript + summary in both
// languages. Available before the meeting ends too, with `endedAt: null` so the
// client knows the meeting is still live.
// Pass `?host=<hostToken>` to also receive the attendee stats report (host-only).
app.get('/api/rooms/:roomId/notes', async (req, res) => {
  const room = await rooms.getRoomAsync(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  const isHost = req.query.host && req.query.host === room.hostToken;

  if (!room.endedAt) {
    return res.json({
      roomId: room.id,
      code: room.code,
      endedAt: null,
      message: 'Meeting still in progress.',
      stats: isHost ? rooms.attendeeStats(room) : undefined,
    });
  }
  res.json({
    roomId: room.id,
    code: room.code,
    endedAt: room.endedAt,
    generatedAt: room.summary?.generatedAt,
    transcripts: room.summary?.transcripts || { en: '', es: '' },
    summaries: room.summary?.summaries || { en: '', es: '' },
    stats: isHost ? rooms.attendeeStats(room) : undefined,
  });
});

// QR code for the join URL, as a PNG data URL. Server-side render means audience
// phones never need to fetch a QR library from the internet.
app.get('/api/rooms/:roomId/qr', async (req, res) => {
  const room = await rooms.getRoomAsync(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  const joinUrl = buildJoinUrl(room.id);
  try {
    const dataUrl = await QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 360,
      color: { dark: '#0f1115', light: '#ffffff' },
    });
    res.json({ joinUrl, dataUrl });
  } catch (err) {
    console.error('[qr] failed', err);
    res.status(500).json({ error: 'qr_failed' });
  }
});

// ---------- Socket.io ----------

function chunkId() {
  // Short id, fine for in-memory; if we move to Supabase we'll use its row IDs.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

io.on('connection', (socket) => {
  console.log(`[socket] connected ${socket.id}`);

  // Host claims a room and starts streaming chunks. No auth — anyone with the
  // host URL is treated as a host (prototype scope per spec). After a server
  // restart, the in-memory room is gone; getRoomAsync hydrates it from Supabase.
  socket.on('host_join', async ({ roomId }) => {
    const room = await rooms.getRoomAsync(roomId);
    if (!room) {
      socket.emit('error_msg', { error: 'room_not_found', roomId });
      return;
    }
    socket.join(roomId);
    socket.data.role = 'host';
    socket.data.roomId = roomId;
    console.log(`[socket] ${socket.id} hosting ${roomId}`);
    socket.emit('host_joined', { roomId });
  });

  // Audience joins the room. Per project rule: captions start from the moment
  // they join — no history backfill. If they missed the start, it's in the
  // post-meeting notes. The only event pushed on join is meeting_ended (if the
  // room is already over) so they land on the notes link.
  socket.on('audience_join', async ({ roomId, deviceId, lang }) => {
    const room = await rooms.getRoomAsync(roomId);
    if (!room) {
      socket.emit('error_msg', { error: 'room_not_found', roomId });
      return;
    }
    socket.join(roomId);
    socket.data.role = 'audience';
    socket.data.roomId = roomId;
    socket.data.deviceId = deviceId || socket.id;

    rooms.attendeeJoined(roomId, socket.data.deviceId, socket.id, lang);

    if (room.endedAt) {
      socket.emit('meeting_ended', {
        roomId: room.id,
        notesUrl: `/notes/${encodeURIComponent(room.id)}`,
      });
    }
  });

  // Audience toggled their caption language. Track for the stats report.
  socket.on('audience_lang', ({ lang }) => {
    if (socket.data.role !== 'audience') return;
    rooms.attendeeSetLang(socket.data.roomId, socket.data.deviceId, lang);
  });

  // Host streams transcript chunks.
  //   - Interim chunks: broadcast immediately, no translation (would be wasted).
  //   - Final chunks:   translate to the other language, then broadcast and store.
  //                     Translation runs on a per-socket FIFO queue so finals
  //                     reach the audience in the order the host spoke them.
  socket.on('host_chunk', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role !== 'host') return;
    const room = rooms.getRoom(roomId);
    if (!room || room.endedAt) return;

    const lang = payload.lang === 'es' ? 'es' : 'en';
    const text = String(payload.original || '').trim();
    if (!text) return;

    const chunk = {
      id: chunkId(),
      roomId,
      ts: Number(payload.ts) || Date.now(),
      original: text,
      lang,
      en: lang === 'en' ? text : null,
      es: lang === 'es' ? text : null,
      isFinal: !!payload.isFinal,
      translationError: false,
    };

    if (!chunk.isFinal) {
      io.to(roomId).emit('caption', chunk);
      return;
    }

    const otherLang = lang === 'en' ? 'es' : 'en';
    // Per-room serial queue (lives on the room state) so the End-meeting
    // handler can drain in-flight translations before summarizing.
    room.workQueue = (room.workQueue || Promise.resolve()).then(async () => {
      try {
        chunk[otherLang] = await translate(text, lang, otherLang);
      } catch (err) {
        chunk.translationError = true;
        console.warn(`[translate] ${roomId} ${lang}->${otherLang} failed: ${err.message}${err.code ? ` (code ${err.code})` : ''}`);
      }
      rooms.addChunk(roomId, chunk);
      console.log(`[chunk] ${roomId} final (${chunk.lang}): ${text}${chunk.translationError ? ' [no translation]' : ''}`);
      io.to(roomId).emit('caption', chunk);
    }).catch((err) => {
      console.error('[workQueue] unhandled', err);
    });
  });

  socket.on('disconnect', (reason) => {
    if (socket.data.role === 'audience' && socket.data.roomId) {
      rooms.attendeeSocketLeft(socket.data.roomId, socket.data.deviceId, socket.id);
    }
    console.log(`[socket] disconnected ${socket.id} (${reason})`);
  });
});

// ---------- boot ----------

server.listen(PORT, '0.0.0.0', () => {
  const lan = getLanIp();
  const cloud = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  console.log('');
  console.log('  Live Captions server is up.');
  if (cloud) {
    console.log(`    mode:    CLOUD`);
    console.log(`    public:  ${cloud}    <-- QR codes will encode this`);
  } else {
    console.log(`    mode:    LAN`);
    console.log(`    local:   http://localhost:${PORT}`);
    if (lan) {
      console.log(`    lan:     http://${lan}:${PORT}    <-- scan from phones on same WiFi`);
    } else {
      console.log('    lan:     (no non-internal IPv4 interface detected)');
    }
  }
  console.log('');
});
