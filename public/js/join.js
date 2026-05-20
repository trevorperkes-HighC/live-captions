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

  // When the meeting has ended we hold the notes payload here so language
  // toggles can re-render the inline summary without re-fetching.
  let endedNotesData = null;

  for (const btn of langBtns) {
    btn.addEventListener('click', () => {
      if (btn.dataset.lang === displayLang) return;
      displayLang = btn.dataset.lang;
      localStorage.setItem('captionLang', displayLang);
      updateToggleUI();
      if (endedNotesData) {
        renderEndedSummary(endedNotesData);
      } else {
        renderFinals();
        interimEl.textContent = lastInterimChunk ? pickInterim(lastInterimChunk) : '';
      }
      // Tell the server so the host's stats report reflects the new choice.
      if (currentSocket && currentSocket.connected) {
        currentSocket.emit('audience_lang', { lang: displayLang });
      }
    });
  }
  updateToggleUI();

  function renderEndedSummary(data) {
    const summaryEl = document.getElementById('ended-summary');
    if (!summaryEl) return;
    const summary = (data.summaries && data.summaries[displayLang]) || '';
    if (summary) {
      summaryEl.textContent = summary;
      summaryEl.classList.remove('muted');
    } else {
      summaryEl.textContent = displayLang === 'es'
        ? 'Resumen no disponible en este idioma. Toca Descargar para obtener la transcripción completa.'
        : 'Summary not available in this language. Tap Download for the full transcript.';
      summaryEl.classList.add('muted');
    }
  }

  function downloadNotesFile(data) {
    const code = data.code || roomId;
    const stamp = data.endedAt
      ? new Date(data.endedAt).toISOString().slice(0, 16).replace(/[T:]/g, '-')
      : 'meeting';
    const filename = `${code}-${stamp}-${displayLang}.txt`;
    const langLabel = displayLang === 'es' ? 'Español' : 'English';
    const dateLine = data.endedAt ? `Meeting ended: ${new Date(data.endedAt).toLocaleString()}` : '';
    const body =
`Live Captions — ${code}
${langLabel}
${dateLine}

================================================================
SUMMARY
================================================================

${(data.summaries && data.summaries[displayLang]) || '(no summary available in this language)'}

================================================================
FULL TRANSCRIPT
================================================================

${(data.transcripts && data.transcripts[displayLang]) || '(no transcript available in this language)'}
`;
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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

  socket.on('meeting_ended', async ({ notesUrl }) => {
    setStatus('disconnected', 'Meeting ended');
    interimEl.textContent = '';
    captionsEl.classList.add('captions-ended');
    captionsEl.innerHTML = `
      <div class="ended-card">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <h2 class="ended-title">Meeting ended</h2>
        <p class="ended-sub">Save the notes to keep them — tap the button below.</p>

        <div class="ended-actions">
          <button id="ended-download" class="primary big ended-cta" disabled>Loading notes…</button>
          <a class="ghost ended-link" href="${notesUrl}">View full transcript →</a>
        </div>

        <div class="ended-preview">
          <p class="ended-preview-label">Summary preview</p>
          <p id="ended-summary" class="ended-summary muted">Loading…</p>
        </div>
      </div>
    `;

    // Fetch the notes payload so we can render a preview AND have the data
    // ready when the user taps Download (no extra round-trip).
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/notes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      endedNotesData = data;
      renderEndedSummary(data);
      const btn = document.getElementById('ended-download');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Download notes (.txt)';
        btn.addEventListener('click', () => {
          if (!endedNotesData) return;
          downloadNotesFile(endedNotesData);
          btn.textContent = 'Downloaded ✓';
          setTimeout(() => { btn.textContent = 'Download again'; }, 1500);
        });
      }
    } catch (err) {
      console.error('notes fetch failed', err);
      const summaryEl = document.getElementById('ended-summary');
      if (summaryEl) summaryEl.textContent = 'Notes could not be loaded — try the link above.';
      const btn = document.getElementById('ended-download');
      if (btn) btn.textContent = 'Unavailable';
    }
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
