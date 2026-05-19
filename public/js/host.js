// Host page — Step 3: Web Speech API capture + Socket.io emit.

(async function main() {
  const roomId = decodeURIComponent(window.location.pathname.split('/').pop() || '');
  const qrImg = document.getElementById('qr-img');
  const codeEl = document.getElementById('room-code');
  const urlEl = document.getElementById('join-url');
  const errEl = document.getElementById('err');
  const warnEl = document.getElementById('warn');
  const copyBtn = document.getElementById('copy-url');

  const startBtn = document.getElementById('start-btn');
  const endBtn = document.getElementById('end-btn');
  const statusEl = document.getElementById('listen-status');
  const finalEl = document.getElementById('transcript-final');
  const interimEl = document.getElementById('transcript-interim');
  const emptyEl = document.getElementById('transcript-empty');

  const connBadge = document.getElementById('host-status');
  const connText = document.getElementById('host-status-text');

  const micTestBtn = document.getElementById('mic-test-btn');
  const micBarFill = document.getElementById('mic-bar-fill');
  const micBarPeak = document.getElementById('mic-bar-peak');
  const micLevelLabel = document.getElementById('mic-level-label');

  function setConn(state, label) {
    if (!connBadge) return;
    connBadge.classList.remove('connected', 'live', 'disconnected');
    if (state) connBadge.classList.add(state);
    if (label && connText) connText.textContent = label;
  }

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }
  function showWarn(msg) {
    warnEl.textContent = msg;
    warnEl.hidden = false;
  }

  if (!roomId) {
    showError('No room ID in the URL.');
    return;
  }

  // ----- 1. Load room info + QR -----
  let room;
  try {
    const [roomRes, qrRes] = await Promise.all([
      fetch(`/api/rooms/${encodeURIComponent(roomId)}`),
      fetch(`/api/rooms/${encodeURIComponent(roomId)}/qr`),
    ]);
    if (roomRes.status === 404) {
      showError(`Room ${roomId} does not exist (it may have ended or never started). Go back and host a new one.`);
      return;
    }
    if (!roomRes.ok) throw new Error(`room fetch HTTP ${roomRes.status}`);
    if (!qrRes.ok) throw new Error(`qr fetch HTTP ${qrRes.status}`);

    room = await roomRes.json();
    const qr = await qrRes.json();

    codeEl.textContent = room.code;
    urlEl.textContent = qr.joinUrl;
    qrImg.src = qr.dataUrl;

    const handoutLink = document.getElementById('handout-link');
    if (handoutLink) handoutLink.href = `/handout/${encodeURIComponent(room.id)}`;

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(qr.joinUrl);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy link'), 1500);
      } catch {
        const range = document.createRange();
        range.selectNode(urlEl);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      }
    });
  } catch (err) {
    console.error(err);
    showError(`Could not load room info: ${err.message}`);
    return;
  }

  // ----- 2. Feature-detect Web Speech API -----
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (!SpeechRecognition) {
    showError('This browser does not support the Web Speech API. Open this host page in Chrome or Edge on a laptop.');
    return;
  }
  if (isIOS) {
    showWarn('Heads-up: iOS Safari speech recognition is flaky and may stop after a few seconds. For a reliable demo, host from Chrome or Edge on a laptop.');
  }
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    showWarn('Microphone access usually requires HTTPS or localhost. If the mic prompt does not appear, host this page from localhost on the same machine running the server.');
  }

  // ----- 3. Socket.io: host_join -----
  // eslint-disable-next-line no-undef
  const socket = io();
  socket.on('connect', () => {
    setConn('connected', 'Connecting…');
    socket.emit('host_join', { roomId });
  });
  socket.on('host_joined', () => {
    setConn('connected', 'Connected');
    statusEl.textContent = 'Ready when you are.';
  });
  socket.on('error_msg', (msg) => {
    showError(`Server: ${msg.error}`);
  });
  socket.on('disconnect', () => {
    setConn('disconnected', 'Reconnecting…');
    statusEl.textContent = 'Disconnected from server.';
  });

  // ----- 4. Wire Web Speech API -----
  let hostLang = localStorage.getItem('hostLang') || room.hostLang || 'en';
  if (hostLang !== 'en' && hostLang !== 'es') hostLang = 'en';

  // Reflect the persisted choice in the UI.
  const hostLangBtns = Array.from(document.querySelectorAll('.host-lang-btn'));
  function updateHostLangUI() {
    for (const b of hostLangBtns) {
      const active = b.dataset.lang === hostLang;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }
  updateHostLangUI();

  let recognition = null;
  let wantListening = false; // user intent: true between Start and Stop clicks
  let finalText = '';
  const MAX_FINAL_DISPLAY = 4000; // keep DOM light during long meetings

  // Switching language mid-meeting: stop current recognizer, rebuild for the
  // new locale, restart if we were listening.
  for (const b of hostLangBtns) {
    b.addEventListener('click', () => {
      if (b.dataset.lang === hostLang) return;
      hostLang = b.dataset.lang;
      localStorage.setItem('hostLang', hostLang);
      updateHostLangUI();
      const wasListening = wantListening;
      if (recognition) {
        try { recognition.onend = null; recognition.stop(); } catch (_) {}
        recognition = null;
      }
      if (wasListening) {
        recognition = buildRecognizer(hostLang);
        try { recognition.start(); } catch (_) {}
      }
    });
  }

  function appendFinal(text) {
    finalText += (finalText ? ' ' : '') + text.trim();
    if (finalText.length > MAX_FINAL_DISPLAY) {
      finalText = '…' + finalText.slice(-MAX_FINAL_DISPLAY);
    }
    finalEl.textContent = finalText;
    emptyEl.hidden = true;
  }

  function buildRecognizer(lang) {
    const r = new SpeechRecognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang === 'es' ? 'es-ES' : 'en-US';

    r.onresult = (event) => {
      let interimText = '';
      let newFinal = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) newFinal += text + ' ';
        else interimText += text;
      }
      if (newFinal.trim()) {
        appendFinal(newFinal);
        socket.emit('host_chunk', {
          original: newFinal.trim(),
          lang,
          isFinal: true,
          ts: Date.now(),
        });
      }
      interimEl.textContent = interimText;
      if (interimText) emptyEl.hidden = true;
      if (interimText.trim()) {
        socket.emit('host_chunk', {
          original: interimText.trim(),
          lang,
          isFinal: false,
          ts: Date.now(),
        });
      }
    };

    r.onerror = (event) => {
      // 'no-speech' fires on silence — harmless, recognizer recovers.
      // 'aborted' fires when we intentionally stop.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed') {
        wantListening = false;
        startBtn.textContent = 'Start speaking';
        startBtn.classList.remove('live');
        statusEl.textContent = '';
        setConn('connected', 'Connected');
        showError('Microphone permission denied. Reload the page and allow microphone access.');
        return;
      }
      console.error('SpeechRecognition error', event);
      statusEl.textContent = `Speech error: ${event.error}`;
    };

    r.onend = () => {
      // Chrome auto-stops every ~60s; restart if the user still wants to listen.
      if (wantListening) {
        try { r.start(); }
        catch (_) { /* benign race when stop() and end fire together */ }
      } else {
        statusEl.textContent = 'Stopped.';
      }
    };

    return r;
  }

  startBtn.addEventListener('click', () => {
    if (wantListening) {
      wantListening = false;
      try { recognition && recognition.stop(); } catch (_) {}
      startBtn.textContent = 'Start speaking';
      startBtn.classList.remove('live');
      statusEl.textContent = 'Stopping…';
      setConn('connected', 'Connected');
    } else {
      if (!recognition) recognition = buildRecognizer(hostLang);
      wantListening = true;
      try {
        recognition.start();
        startBtn.textContent = 'Stop';
        startBtn.classList.add('live');
        statusEl.textContent = 'Listening…';
        setConn('live', 'Live');
      } catch (err) {
        if (err && err.name !== 'InvalidStateError') {
          showError(`Could not start recognition: ${err.message}`);
          wantListening = false;
        }
      }
    }
  });

  // ----- Mic level meter -----
  // Independent of Web Speech — opens its own getUserMedia stream so the host
  // can verify the chapel PA is feeding audio BEFORE clicking Start speaking.
  let micCtx = null;
  let micStream = null;
  let micRAF = null;
  let peak = 0;
  let peakHoldUntil = 0;

  function setMicLevel(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    micBarFill.style.width = clamped + '%';

    const now = performance.now();
    if (clamped > peak || now > peakHoldUntil) {
      peak = clamped;
      peakHoldUntil = now + 600; // hold the peak indicator briefly
    }
    micBarPeak.style.left = peak + '%';

    let label = 'Too quiet';
    let cls = 'mic-low';
    if (clamped >= 80) { label = 'Too loud'; cls = 'mic-hot'; }
    else if (clamped >= 33) { label = 'Good'; cls = 'mic-good'; }
    micLevelLabel.textContent = label;
    micLevelLabel.className = 'mic-level-label ' + cls;
  }

  async function startMicMeter() {
    if (micStream) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      micLevelLabel.textContent = 'Mic blocked';
      micLevelLabel.className = 'mic-level-label mic-error';
      console.error('mic meter getUserMedia failed', err);
      return;
    }
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = micCtx.createMediaStreamSource(micStream);
    const analyser = micCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    function tick() {
      analyser.getByteTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / data.length);
      // Map RMS (~0..0.5 for speech) → 0..100 with a curve that gives a usable
      // range for typical PA-fed input levels.
      const db = 20 * Math.log10(rms || 1e-6); // -inf .. 0
      const pct = ((db + 60) / 60) * 100; // -60 dB → 0%, 0 dB → 100%
      setMicLevel(pct);
      micRAF = requestAnimationFrame(tick);
    }
    tick();
    micTestBtn.textContent = 'Stop test';
    micTestBtn.classList.add('mic-testing');
  }

  function stopMicMeter() {
    if (micRAF) cancelAnimationFrame(micRAF);
    micRAF = null;
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (micCtx) {
      micCtx.close();
      micCtx = null;
    }
    setMicLevel(0);
    peak = 0;
    micLevelLabel.textContent = 'Not testing';
    micLevelLabel.className = 'mic-level-label';
    micTestBtn.textContent = 'Test mic';
    micTestBtn.classList.remove('mic-testing');
  }

  micTestBtn.addEventListener('click', () => {
    if (micStream) stopMicMeter();
    else startMicMeter();
  });

  // End meeting → notes (with host token in the URL so the host sees the stats report)
  endBtn.addEventListener('click', async () => {
    if (!confirm('End the meeting and generate notes for everyone? Captions will stop.')) return;
    endBtn.disabled = true;
    endBtn.textContent = 'Ending…';
    wantListening = false;
    if (recognition) {
      try { recognition.onend = null; recognition.stop(); } catch (_) {}
    }
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/end`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let target = data.notesUrl;
      const token = localStorage.getItem(`hostToken:${roomId}`);
      if (token) target += `?host=${encodeURIComponent(token)}`;
      window.location.href = target;
    } catch (err) {
      showError(`Could not end the meeting: ${err.message}`);
      endBtn.disabled = false;
      endBtn.textContent = 'End meeting';
    }
  });
  endBtn.disabled = false;

  startBtn.disabled = false;
  statusEl.textContent = 'Connecting…';
})();
