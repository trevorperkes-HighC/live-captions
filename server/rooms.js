// In-memory room registry for the demo build.
// Swap this module for a Supabase-backed implementation later — same shape.

const { customAlphabet } = require('nanoid');

// Unambiguous alphabet: no 0/O, 1/I, etc. Reads cleanly when typed from a phone.
const codeId = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 4);
const tokenId = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 22);

const rooms = new Map(); // id -> Room

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
    hostToken: tokenId(), // soft secret: held by the host; gates the stats view
    chunks: [],
    summary: null,
    // Audience analytics. Keyed by deviceId so reconnects don't double-count.
    attendees: new Map(), // deviceId -> { firstSeenAt, lastSeenAt, lang, activeSocketIds:Set }
    peakConcurrent: 0,
    // workQueue is set lazily on first host_chunk (see server/index.js).
  };
  rooms.set(id, room);
  return room;
}

function getRoom(id) {
  return rooms.get(id) || null;
}

function hasRoom(id) {
  return rooms.has(id);
}

function addChunk(roomId, chunk) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.chunks.push(chunk);
  return chunk;
}

function endRoom(roomId, summary) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.endedAt = Date.now();
  room.summary = summary;
  // Cap any still-open sessions at the meeting's end.
  for (const a of room.attendees.values()) {
    if (a.activeSocketIds.size > 0) {
      a.lastSeenAt = room.endedAt;
    }
  }
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
}

function attendeeSetLang(roomId, deviceId, lang) {
  const room = rooms.get(roomId);
  if (!room || !deviceId) return;
  const a = room.attendees.get(deviceId);
  if (!a) return;
  if (lang === 'en' || lang === 'es') a.lang = lang;
}

function attendeeSocketLeft(roomId, deviceId, socketId) {
  const room = rooms.get(roomId);
  if (!room || !deviceId) return;
  const a = room.attendees.get(deviceId);
  if (!a) return;
  a.activeSocketIds.delete(socketId);
  if (a.activeSocketIds.size === 0) {
    a.lastSeenAt = Date.now();
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
  hasRoom,
  addChunk,
  endRoom,
  setHostLang,
  attendeeJoined,
  attendeeSetLang,
  attendeeSocketLeft,
  attendeeStats,
};
