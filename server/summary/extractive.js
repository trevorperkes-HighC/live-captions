// Demo-mode summarizer: classic extractive approach.
//   - tokenize, drop stopwords
//   - score each sentence by sum of its non-stopword word frequencies,
//     normalized by sqrt(length) so longer sentences don't auto-win
//   - small position boost for the opening 20% of the talk (people often
//     state purpose / context up front)
//   - return the top N sentences re-sorted by original order
//
// Production swap: server/summary/llm.js (OpenAI gpt-4o-mini or Anthropic Claude Haiku).

const EN_STOPWORDS = new Set('a an and are as at be been being but by can could did do does for from had has have having he her hers him his how i if in into is it its me might must my no nor not of on or our ours she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself ourselves himself herself itself themselves about above after again against all any because before below between both during each few further here just me more most off once only other own same down out over same too very am does did do done get got go goes going gone went s t d ll m o re ve y'.split(/\s+/));

const ES_STOPWORDS = new Set('a al algo algunas algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era erais eran eras eres es esa esas ese eso esos esta estaba estabais estaban estabas estad estada estadas estado estados estais estamos estan estando estar estaremos estare estaria estarian estarias estas este esto estos estoy etc fue fuera fuerais fueran fueras fueron fuese fueseis fuesen fueses fui fuimos fuiste fuisteis fuiston gracias ha habeis haber habia habiais habian habias habida habidas habido habidos habiendo habremos habre habrian habrias habrian habre han has hasta hay haya hayais hayamos hayan hayas he hemos hube hubieron hubieran hubieras hubiese hubiesen hubiste hubisteis hubo le les lo los me mi mis mucho muchos muy mas nada ni no nos nosotros nosotras o os otra otras otro otros para pero poco por porque que quien quienes se sea seais sean seas ser sera serais seran seras sere seremos seria seriais serian serias si sido siendo sin sobre sois solo somos son soy su sus suya suyas suyo suyos tambien tanto te tendra tendran tendre tendremos tendria tendrian tendrias tener tenga tengan tengas tengo tenida tenidas tenido tenidos teniendo tengo ti tiene tienen tienes todo todos tu tus tuvo un una unas uno unos vosotros vosotras vuestra vuestras vuestro vuestros y ya yo'.split(/\s+/));

function isStop(word, lang) {
  return (lang === 'es' ? ES_STOPWORDS : EN_STOPWORDS).has(word);
}

function tokenize(text) {
  const m = text.toLowerCase().match(/[a-záéíóúñü]+/g);
  return m || [];
}

function splitSentences(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  // Sentence-ish: . ! ? followed by space or end.
  return t.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑÜ¿¡])/u).map((s) => s.trim()).filter(Boolean);
}

function summarizeText(text, lang) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return '';

  // Aim for ~20% of sentences, clamped to [3, 10].
  const target = Math.max(3, Math.min(10, Math.round(sentences.length * 0.2)));
  if (sentences.length <= target) return sentences.join(' ');

  const freq = new Map();
  for (const s of sentences) {
    for (const w of tokenize(s)) {
      if (w.length < 3) continue;
      if (isStop(w, lang)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  const scored = sentences.map((s, i) => {
    const words = tokenize(s);
    let score = 0;
    for (const w of words) {
      if (isStop(w, lang)) continue;
      if (w.length < 3) continue;
      score += freq.get(w) || 0;
    }
    // sqrt-normalize so long sentences don't sweep, then add a small lead-in boost.
    const normalized = score / Math.max(1, Math.sqrt(words.length));
    const lead = i < sentences.length * 0.2 ? 1.15 : 1;
    return { i, s, score: normalized * lead };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, target)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(' ');
}

function transcriptFor(chunks, lang) {
  // Only include text actually in this language — don't silently mix English
  // into the Spanish transcript when translation was missing.
  return chunks
    .filter((c) => c.isFinal)
    .map((c) => c[lang] || '')
    .filter(Boolean)
    .join(' ');
}

function summarizeRoom(chunks) {
  const enText = transcriptFor(chunks, 'en');
  const esText = transcriptFor(chunks, 'es');
  return {
    transcripts: { en: enText, es: esText },
    summaries: {
      en: summarizeText(enText, 'en'),
      es: summarizeText(esText, 'es'),
    },
    generatedAt: Date.now(),
  };
}

module.exports = { summarizeRoom, summarizeText, splitSentences };
