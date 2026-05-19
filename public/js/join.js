// Audience page — Socket.io connect, EN/ES toggle, render live captions.
// Captions start from the moment this device joins — no backfill.
// (If they missed earlier content, it's all in the post-meeting notes.)

(async function main() {
  const roomId = decodeURIComponent(window.location.pathname.split('/').pop() || '');

  // Stable per-browser ID so reconnects don't double-count in the host's stats.
  function getDeviceId() {
    let id = null;
    try { id = localStorage.getItem('deviceId'); } catch (_) {}
    if (!id) {
      id = (crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('deviceId', id); } catch (_) {}
    }
    return id;
  }
  const deviceId = getDeviceId();
  const titleEl = document.getElementById('room-title');
  const statusBadge = document.getElementById('status');
  const statusTextEl = document.getElementById('status-text');
  const errEl = document.getElementById('err');
  const finalsEl = document.getElementById('finals');
  const interimEl = document.getElementById('interim');
  const emptyEl = document.getElementById('captions-empty');
  const captionsEl = document.getElementById('captions');
  const langBtns = Array.from(document.querySelectorAll('.lang-btn'));

  function setStatus(state, label) {
    if (!statusBadge) return;
    statusBadge.classList.remove('connected', 'live', 'disconnected');
    if (state) statusBadge.classList.add(state);
    if (statusTextEl) statusTextEl.textContent = label;
  }

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  if (!roomId) {
    titleEl.textContent = 'No room code';
    setStatus('disconnected', 'No room');
    showError('Go back to the home page and enter a room code.');
    return;
  }

  // ----- 1. Display language: persisted choice, with smart default -----
  function defaultLang() {
    const persisted = localStorage.getItem('captionLang');
    if (persisted === 'en' || persisted === 'es') return persisted;
    // If the user's browser prefers Spanish, default to Spanish.
    const nav = (navigator.language || '').toLowerCase();
    return nav.startsWith('es') ? 'es' : 'en';
  }
  let displayLang = defaultLang();

  function updateToggleUI() {
    for (const btn of langBtns) {
      const active = btn.dataset.lang === displayLang;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  for (const btn of langBtns) {
    btn.addEventListener('click', () => {
      if (btn.dataset.lang === displayLang) return;
      displayLang = btn.dataset.lang;
      localStorage.setItem('captionLang', displayLang);
      updateToggleUI();
      renderFinals();
      interimEl.textContent = lastInterimChunk ? pickInterim(lastInterimChunk) : '';
      // Tell the server so the host's stats report reflects the new choice.
      if (currentSocket && currentSocket.connected) {
        currentSocket.emit('audience_lang', { lang: displayLang });
      }
    });
  }
  updateToggleUI();

  // ----- 2. Validate the room exists -----
  let room;
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
    if (res.status === 404) {
      titleEl.textContent = 'Room not found';
      setStatus('disconnected', 'Not found');
      showError(`No active meeting with code ${roomId}.`);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    room = await res.json();
    titleEl.textContent = room.code;
    setStatus(null, 'Connecting…');
  } catch (err) {
    console.error(err);
    setStatus('disconnected', 'Offline');
    showError(`Could not connect: ${err.message}`);
    return;
  }

  // ----- 3. Render state -----
  const MAX_FINALS_IN_DOM = 50;
  const finals = []; // full chunks
  const seenIds = new Set(); // dedupe across reconnects + catch-up
  let lastInterimChunk = null;

  function addFinal(chunk) {
    if (chunk.id && seenIds.has(chunk.id)) return false;
    if (chunk.id) seenIds.add(chunk.id);
    finals.push(chunk);
    while (finals.length > MAX_FINALS_IN_DOM) {
      const dropped = finals.shift();
      if (dropped.id) seenIds.delete(dropped.id);
    }
    return true;
  }

  function pickFinal(chunk) {
    const t = chunk[displayLang];
    if (t) return { text: t, fallback: false };
    return { text: chunk.original || '', fallback: chunk.lang !== displayLang };
  }

  function pickInterim(chunk) {
    // Interim chunks only carry the host's original. Show it regardless of the
    // user's selected language — they at least see that something is being said.
    return chunk.original || '';
  }

  function renderFinals() {
    finalsEl.innerHTML = '';
    for (const f of finals) {
      const picked = pickFinal(f);
      const p = document.createElement('p');
      p.className = 'caption-line' + (picked.fallback ? ' caption-fallback' : '');
      p.textContent = picked.text;
      if (picked.fallback) {
        const tag = document.createElement('span');
        tag.className = 'fallback-tag';
        tag.textContent = ' (translation unavailable)';
        p.appendChild(tag);
      }
      finalsEl.appendChild(p);
    }
  }

  function autoScroll() {
    captionsEl.scrollTop = captionsEl.scrollHeight;
  }

  // ----- 4. Socket.io: audience_join + caption stream -----
  // eslint-disable-next-line no-undef
  const socket = io({ reconnection: true });
  let currentSocket = socket;

  socket.on('connect', () => {
    setStatus('connected', 'Connected');
    socket.emit('audience_join', { roomId, deviceId, lang: displayLang });
  });

  socket.on('disconnect', () => {
    setStatus('disconnected', 'Reconnecting…');
  });

  socket.on('error_msg', (msg) => {
    showError(`Server: ${msg.error}`);
  });

  socket.on('meeting_ended', ({ notesUrl }) => {
    setStatus('disconnected', 'Meeting ended');
    interimEl.textContent = '';
    // Replace the captions card with a clear "Meeting ended" surface containing
    // a primary action: view & download the notes everyone gets.
    captionsEl.innerHTML = '';
    captionsEl.classList.add('captions-ended');
    const wrap = document.createElement('div');
    wrap.className = 'ended-card';
    wrap.innerHTML = `
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
      <h2 class="ended-title">Meeting ended</h2>
      <p class="ended-sub">The notes and full transcript are ready.</p>
      <a class="primary big ended-cta" href="${notesUrl}">View notes &amp; transcript</a>
    `;
    captionsEl.appendChild(wrap);
  });

  socket.on('caption', (chunk) => {
    if (emptyEl) emptyEl.hidden = true;
    setStatus('live', 'Live');

    if (chunk.isFinal) {
      const added = addFinal(chunk);
      lastInterimChunk = null;
      interimEl.textContent = '';
      if (added) {
        renderFinals();
        autoScroll();
      }
    } else {
      lastInterimChunk = chunk;
      const t = pickInterim(chunk);
      if (t !== interimEl.textContent) {
        interimEl.textContent = t;
        autoScroll();
      }
    }
  });
})();
