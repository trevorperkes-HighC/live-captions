// Supabase persistence layer for Live Captions.
//
// All functions here are SAFE to call regardless of whether Supabase is
// configured — if SUPABASE_URL or SUPABASE_KEY is not set, every function
// is a no-op and the app keeps working as pure in-memory.
//
// Writes are fire-and-forget (we don't block user-facing operations on the
// DB round-trip). Read functions return null on miss / error and let the
// caller fall back to in-memory state.

const { createClient } = require('@supabase/supabase-js');
// Node < 22 lacks native WebSocket. Supabase Realtime's client requires one to
// be constructable even though we never subscribe to anything; supply `ws` so
// initialization succeeds. Avoidable in Node 22+ but Render currently runs 20.
const ws = require('ws');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;

let client = null;
const ENABLED = !!(URL && KEY);

if (ENABLED) {
  client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
  console.log('[db] persistence enabled (Supabase)');
} else {
  console.log('[db] persistence disabled — set SUPABASE_URL and SUPABASE_KEY to enable');
}

// Supabase query builders are PromiseLike (thenable) but don't expose .catch
// directly. Use .then(onSuccess, onError) which both triggers the query and
// captures errors — either Postgres-level (result.error) or transport-level.
function fireAndForget(thenable, label) {
  if (!thenable || typeof thenable.then !== 'function') return;
  thenable.then(
    (result) => {
      if (result && result.error) {
        console.warn(`[db] ${label} failed: ${result.error.message || result.error}`);
      }
    },
    (err) => {
      console.warn(`[db] ${label} threw: ${err && err.message ? err.message : err}`);
    },
  );
}

// Serialize the in-memory attendees Map (with its activeSocketIds Set) into a
// plain JSON object the database can store. The Set is transient and isn't
// persisted — after a restart, no one has an active socket until they reconnect.
function serializeAttendees(attendeesMap) {
  const out = {};
  if (!attendeesMap) return out;
  for (const [deviceId, a] of attendeesMap.entries()) {
    out[deviceId] = {
      firstSeenAt: a.firstSeenAt,
      lastSeenAt: a.lastSeenAt,
      lang: a.lang,
    };
  }
  return out;
}

function deserializeAttendees(obj) {
  const m = new Map();
  if (!obj) return m;
  for (const [deviceId, a] of Object.entries(obj)) {
    m.set(deviceId, {
      firstSeenAt: a.firstSeenAt,
      lastSeenAt: a.lastSeenAt,
      lang: a.lang || 'en',
      activeSocketIds: new Set(),
    });
  }
  return m;
}

// ----- Room operations -----

async function saveNewRoom(room) {
  if (!ENABLED) return;
  fireAndForget(
    client.from('rooms').insert({
      id: room.id,
      code: room.code,
      created_at: new Date(room.createdAt).toISOString(),
      ended_at: null,
      host_lang: room.hostLang,
      host_token: room.hostToken,
      summary: null,
      attendees: {},
      peak_concurrent: 0,
    }),
    `saveNewRoom(${room.id})`,
  );
}

async function loadRoom(roomId) {
  if (!ENABLED) return null;
  try {
    const { data, error } = await client
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .maybeSingle();
    if (error) {
      console.warn(`[db] loadRoom(${roomId}) error: ${error.message}`);
      return null;
    }
    if (!data) return null;

    // Pull chunks in order
    const chunksRes = await client
      .from('chunks')
      .select('*')
      .eq('room_id', roomId)
      .order('ts', { ascending: true })
      .order('inserted_at', { ascending: true });
    const chunkRows = chunksRes.error ? [] : (chunksRes.data || []);
    if (chunksRes.error) {
      console.warn(`[db] loadRoom chunks(${roomId}) error: ${chunksRes.error.message}`);
    }

    return {
      id: data.id,
      code: data.code,
      createdAt: new Date(data.created_at).getTime(),
      endedAt: data.ended_at ? new Date(data.ended_at).getTime() : null,
      hostLang: data.host_lang,
      hostToken: data.host_token,
      summary: data.summary || null,
      attendees: deserializeAttendees(data.attendees),
      peakConcurrent: data.peak_concurrent || 0,
      chunks: chunkRows.map((c) => ({
        id: c.id,
        roomId: c.room_id,
        ts: Number(c.ts),
        original: c.original,
        lang: c.lang,
        en: c.en,
        es: c.es,
        isFinal: c.is_final,
        translationError: c.translation_error,
      })),
    };
  } catch (err) {
    console.warn(`[db] loadRoom(${roomId}) threw: ${err.message}`);
    return null;
  }
}

async function saveRoomEnd(roomId, endedAtMs, summary, peakConcurrent, attendeesMap) {
  if (!ENABLED) return;
  fireAndForget(
    client.from('rooms').update({
      ended_at: new Date(endedAtMs).toISOString(),
      summary,
      peak_concurrent: peakConcurrent,
      attendees: serializeAttendees(attendeesMap),
    }).eq('id', roomId),
    `saveRoomEnd(${roomId})`,
  );
}

async function saveAttendeesUpdate(roomId, peakConcurrent, attendeesMap) {
  if (!ENABLED) return;
  fireAndForget(
    client.from('rooms').update({
      attendees: serializeAttendees(attendeesMap),
      peak_concurrent: peakConcurrent,
    }).eq('id', roomId),
    `saveAttendeesUpdate(${roomId})`,
  );
}

// ----- Chunk operations -----

async function saveChunk(chunk) {
  if (!ENABLED) return;
  fireAndForget(
    client.from('chunks').insert({
      id: chunk.id,
      room_id: chunk.roomId,
      ts: chunk.ts,
      original: chunk.original,
      lang: chunk.lang,
      en: chunk.en,
      es: chunk.es,
      is_final: chunk.isFinal,
      translation_error: !!chunk.translationError,
    }),
    `saveChunk(${chunk.id})`,
  );
}

module.exports = {
  enabled: ENABLED,
  saveNewRoom,
  loadRoom,
  saveRoomEnd,
  saveAttendeesUpdate,
  saveChunk,
};
