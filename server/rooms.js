// Room registry. Authoritative copy lives in memory for low latency; if
// Supabase is configured (via SUPABASE_URL + SUPABASE_KEY), every state change
// is also written through to the DB so rooms survive server restarts (the
// Render free tier loses memory whenever the container spins down or
// redeploys, which has caused real mid-meeting failures).
//
// All mutating functions remain synchronous from the caller's perspective —
// DB writes are fire-and-forget. The one new entry point is getRoomAsync(),
// which on a cache miss queries Supabase and hydrates the room into memory.

const { customAlphabet } = require('nanoid');
const db = require('./db');

// Unambiguous alphabet: no 0/O, 1/I, etc. Reads cleanly when typed from a phone.
const codeId = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 4);
const tokenId = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 22);

const rooms = new Map(); // id -> Room
const pendingHydrations = new Map(); // id -> Promise<Room|null>

function newRoomId() {
  let id;
  do {
    id = `MEET-${codeId()}`;
  } while (rooms.has(id));
  return id;
}

function createRoom() {
  const id = newRoomId();
  const room = {
    id,
    code: id,
    createdAt: Date.now(),
    endedAt: null,
    hostLang: 'en',
    hostToken: tokenId(),
    chunks: [],
    summary: null,
    attendees: new Map(),
    peakConcurrent: 0,
  };
  rooms.set(id, room);
  db.saveNewRoom(room);
  return room;
}

function getRoom(id) {
  return rooms.get(id) || null;
}

// Async-aware getter. Checks memory; on miss, queries Supabase. If found,
// loads the room into memory (so subsequent lookups are fast) and returns it.
// Multiple concurrent hydrations for the same id share a single in-flight
// query — important after server restart when many sockets reconnect at once.
async function getRoomAsync(id) {
  const cached = rooms.get(id);
  if (cached) return cached;

  if (pendingHydrations.has(id)) {
    return pendingHydrations.get(id);
  }

  const promise = (async () => {
    const fromDb = await db.loadRoom(id);
    if (fromDb && !rooms.has(id)) {
      rooms.set(id, fromDb);
    }
    pendingHydrations.delete(id);
    return rooms.get(id) || null;
  })();
  pendingHydrations.set(id, promise);
  return promise;
}

function hasRoom(id) {
  return rooms.has(id);
}

function addChunk(roomId, chunk) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.chunks.push(chunk);
  db.saveChunk(chunk);
  return chunk;
}

function endRoom(roomId, summary) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.endedAt = Date.now();
  room.summary = summary;
  for (const a of room.attendees.values()) {
    if (a.activeSocketIds.size > 0) {
      a.lastSeenAt = room.endedAt;
    }
  }
  db.saveRoomEnd(room.id, room.endedAt, summary, room.peakConcurrent, room.attendees);
  return room;
}

function setHostLang(roomId, lang) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.hostLang = lang;
  return room;
}

// ----- Attendee tracking -----

function countActiveDevices(room) {
  let n = 0;
  for (const a of room.attendees.values()) {
    if (a.activeSocketIds.size > 0) n++;
  }
  return n;
}

function attendeeJoined(roomId, deviceId, socketId, lang) {
  const room = rooms.get(roomId);
  if (!room || !deviceId) return;
  const now = Date.now();
  let a = room.attendees.get(deviceId);
  if (!a) {
    a = {
      firstSeenAt: now,
      lastSeenAt: now,
      lang: lang === 'es' ? 'es' : 'en',
      activeSocketIds: new Set(),
    };
    room.attendees.set(deviceId, a);
  } else {
    a.lastSeenAt = now;
    if (lang === 'es' || lang === 'en') a.lang = lang;
  }
  a.activeSocketIds.add(socketId);
  const concurrent = countActiveDevices(room);
  if (concurrent > room.peakConcurrent) room.peakConcurrent = concurrent;
  db.saveAttendeesUpdate(roomId, room.peakConcurrent, room.attendees);
}

function attendeeSetLang(roomId, deviceId, lang) {
  const room = rooms.get(roomId);
  if (!room || !deviceId) return;
  const a = room.attendees.get(deviceId);
  if (!a) return;
  if (lang === 'en' || lang === 'es') a.lang = lang;
  db.saveAttendeesUpdate(roomId, room.peakConcurrent, room.attendees);
}

function attendeeSocketLeft(roomId, deviceId, socketId) {
  const room = rooms.get(roomId);
  if (!room || !deviceId) return;
  const a = room.attendees.get(deviceId);
  if (!a) return;
  a.activeSocketIds.delete(socketId);
  if (a.activeSocketIds.size === 0) {
    a.lastSeenAt = Date.now();
    db.saveAttendeesUpdate(roomId, room.peakConcurrent, room.attendees);
  }
}

function attendeeStats(room) {
  if (!room) return null;
  const totalUnique = room.attendees.size;
  const langs = { en: 0, es: 0 };
  let totalMs = 0;
  let withDuration = 0;
  for (const a of room.attendees.values()) {
    if (a.lang === 'es') langs.es++;
    else langs.en++;
    const span = a.lastSeenAt - a.firstSeenAt;
    if (span > 0) {
      totalMs += span;
      withDuration++;
    }
  }
  return {
    totalUnique,
    peakConcurrent: room.peakConcurrent,
    languages: langs,
    avgSessionMinutes: withDuration > 0 ? Math.round((totalMs / withDuration) / 60000 * 10) / 10 : 0,
  };
}

module.exports = {
  createRoom,
  getRoom,
  getRoomAsync,
  hasRoom,
  addChunk,
  endRoom,
  setHostLang,
  attendeeJoined,
  attendeeSetLang,
  attendeeSocketLeft,
  attendeeStats,
};
