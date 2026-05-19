// Notes page — fetch the post-meeting transcript + summary, render in EN/ES.
// If the URL has `?host=<token>` matching the room's stored hostToken, the
// server also returns a stats report which we render in a card at the top.

(async function main() {
  const roomId = decodeURIComponent(window.location.pathname.split('/').pop() || '');
  const titleEl = document.getElementById('notes-title');
  const metaEl = document.getElementById('notes-meta');
  const bodyEl = document.getElementById('notes-body');
  const pendingEl = document.getElementById('notes-pending');
  const errEl = document.getElementById('err');
  const summaryEl = document.getElementById('summary-text');
  const transcriptEl = document.getElementById('transcript-text');
  const copySummaryBtn = document.getElementById('copy-summary');
  const copyTranscriptBtn = document.getElementById('copy-transcript');
  const downloadBtn = document.getElementById('download-transcript');
  const langBtns = Array.from(document.querySelectorAll('.lang-btn'));
  const statsCard = document.getElementById('stats-card');

  // Host token — preferred from URL (?host=...), falls back to localStorage
  // (so a reload of /notes/<id> on the host's laptop still shows stats).
  function readHostToken() {
    const fromUrl = new URLSearchParams(window.location.search).get('host');
    if (fromUrl) return fromUrl;
    try { return localStorage.getItem(`hostToken:${roomId}`); } catch { return null; }
  }
  const hostToken = readHostToken();

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  function defaultLang() {
    const persisted = localStorage.getItem('captionLang');
    if (persisted === 'en' || persisted === 'es') return persisted;
    return (navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en';
  }
  let lang = defaultLang();
  let data = null;

  function updateLangBtns() {
    for (const b of langBtns) {
      const active = b.dataset.lang === lang;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  function fmtDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return '';
    }
  }

  function render() {
    if (!data) return;
    updateLangBtns();

    const summary = data.summaries?.[lang] || '';
    const transcript = data.transcripts?.[lang] || '';

    summaryEl.textContent = summary || (lang === 'es' ? 'Resumen no disponible.' : 'No summary available.');
    transcriptEl.textContent = transcript || (lang === 'es' ? 'Transcripción no disponible en español.' : 'Transcript not available.');
  }

  async function copyToClipboard(text, btn, doneLabel = 'Copied') {
    const originalLabel = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
    }
    btn.textContent = doneLabel;
    setTimeout(() => (btn.textContent = originalLabel), 1500);
  }

  function downloadTranscript() {
    if (!data) return;
    const stamp = data.endedAt ? new Date(data.endedAt).toISOString().slice(0, 16).replace(/[T:]/g, '-') : 'meeting';
    const filename = `${data.code || roomId}-${stamp}-${lang}.txt`;
    const langLabel = lang === 'es' ? 'Español' : 'English';
    const out =
`Live Captions — ${data.code || roomId}
${langLabel}
${data.endedAt ? `Meeting ended: ${fmtDate(data.endedAt)}` : ''}

================================================================
SUMMARY
================================================================

${data.summaries?.[lang] || '(none)'}

================================================================
FULL TRANSCRIPT
================================================================

${data.transcripts?.[lang] || '(none)'}
`;
    const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  for (const b of langBtns) {
    b.addEventListener('click', () => {
      if (b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      localStorage.setItem('captionLang', lang);
      render();
    });
  }

  copySummaryBtn.addEventListener('click', () => {
    if (!data) return;
    copyToClipboard(data.summaries?.[lang] || '', copySummaryBtn);
  });
  copyTranscriptBtn.addEventListener('click', () => {
    if (!data) return;
    copyToClipboard(data.transcripts?.[lang] || '', copyTranscriptBtn);
  });
  downloadBtn.addEventListener('click', downloadTranscript);

  function renderStats(stats) {
    if (!stats || !statsCard) return;
    statsCard.hidden = false;
    document.getElementById('stat-unique').textContent = stats.totalUnique ?? 0;
    document.getElementById('stat-peak').textContent = stats.peakConcurrent ?? 0;
    document.getElementById('stat-lang-en').textContent = stats.languages?.en ?? 0;
    document.getElementById('stat-lang-es').textContent = stats.languages?.es ?? 0;
    const avg = stats.avgSessionMinutes ?? 0;
    document.getElementById('stat-avg').textContent =
      avg < 1 ? `${Math.round(avg * 60)}s` : `${avg.toFixed(1)} min`;
  }

  // ----- Fetch and render -----
  if (!roomId) {
    showError('No room ID in the URL.');
    return;
  }
  try {
    const url = `/api/rooms/${encodeURIComponent(roomId)}/notes`
      + (hostToken ? `?host=${encodeURIComponent(hostToken)}` : '');
    const res = await fetch(url);
    if (res.status === 404) {
      showError(`No meeting found with code ${roomId}.`);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    titleEl.textContent = `Notes for ${data.code || roomId}`;
    if (metaEl && data.endedAt) metaEl.textContent = fmtDate(data.endedAt);

    if (!data.endedAt) {
      pendingEl.hidden = false;
      // Even in-progress, the host can preview stats.
      if (data.stats) {
        bodyEl.hidden = false;
        renderStats(data.stats);
      }
      return;
    }

    bodyEl.hidden = false;
    renderStats(data.stats);
    render();
  } catch (err) {
    console.error(err);
    showError(`Could not load notes: ${err.message}`);
  }
})();
