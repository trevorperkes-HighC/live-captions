// Demo-mode translation client: MyMemory Translation API.
//
//   Endpoint: https://api.mymemory.translated.net/get
//   Auth:     none. Optionally pass `de=<email>` to raise daily quota from
//             5,000 chars/day (anonymous) to 50,000 chars/day. Set the email
//             via the MYMEMORY_EMAIL env var.
//   Docs:     https://mymemory.translated.net/doc/spec.php
//
// MyMemory returns HTTP 200 even when over quota; the real status lives in
// responseStatus. We treat anything non-200 there as a translation failure
// and let the caller fall back to "(no translation available)".
//
// Production swap: server/translate/google.js (Google Cloud Translate).

const CACHE_MAX = 5000;
const cache = new Map(); // `${from}|${to}|${text}` -> translatedText

function key(text, from, to) {
  return `${from}|${to}|${text}`;
}

function remember(k, v) {
  if (cache.has(k)) return;
  if (cache.size >= CACHE_MAX) {
    // Simple FIFO eviction; long meetings won't grow unbounded.
    cache.delete(cache.keys().next().value);
  }
  cache.set(k, v);
}

async function translate(text, from, to) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (from === to) return t;

  const k = key(t, from, to);
  if (cache.has(k)) return cache.get(k);

  const params = new URLSearchParams({
    q: t,
    langpair: `${from}|${to}`,
  });
  if (process.env.MYMEMORY_EMAIL) {
    params.set('de', process.env.MYMEMORY_EMAIL);
  }

  const url = `https://api.mymemory.translated.net/get?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const err = new Error(`MyMemory HTTP ${res.status}`);
    err.code = res.status;
    throw err;
  }

  const data = await res.json();

  const status = Number(data.responseStatus);
  if (status !== 200) {
    const err = new Error(data.responseDetails || `MyMemory responseStatus ${status}`);
    err.code = status;
    throw err;
  }

  const translated = data?.responseData?.translatedText;
  if (typeof translated !== 'string' || !translated) {
    throw new Error('MyMemory returned no translatedText');
  }

  remember(k, translated);
  return translated;
}

function cacheSize() {
  return cache.size;
}

module.exports = { translate, cacheSize };
