// Progetto Lumiere official venue adapter (progettolumiere.it/mexico, /palestrina).
// Scrapes the weekly KleverMedia schedule tabs (#thu..#wed) on home.php, enriches
// runtimes/special dates from linked <film>.php pages + contact.php tariffs, and
// includes Thursday cineforum screenings from single-moviecin.php + season PDF.
import { inflateSync } from 'node:zlib';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const BLOCK_RE = /captcha|cloudflare|attention required|verify you are human|enable javascript and cookies|just a moment|checking your browser|access denied|403 forbidden/i;

const MONTHS_IT = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

const DAY_KEYS = ['thu', 'fri', 'sat', 'sun', 'mon', 'tue', 'wed'];

const SKIP_PHP = new Set(['home.php', 'contact.php', 'card.php', 'single-moviecin.php', 'index.php']);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISO(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function weekdayUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}

function parseEuro(str) {
  if (!str) return null;
  const n = Number(String(str).replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

function cleanTitle(raw) {
  return String(raw || '')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCaseItalian(allCaps) {
  const raw = cleanTitle(allCaps);
  if (!raw) return raw;
  const letters = raw.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return raw;
  const lowerWords = new Set(['a', 'ad', 'al', 'alla', 'alle', 'ai', 'agli', 'con', 'da', 'dal', 'dalla', 'dalle', 'dei', 'del', 'della', 'delle', 'degli', 'di', 'e', 'ed', 'gli', 'i', 'il', 'in', 'la', 'le', 'lo', 'nel', 'nella', 'nelle', 'nei', 'non', 'o', 'per', 'su', 'sul', 'sulla', 'tra', 'un', 'una', 'uno']);
  let firstWord = true;
  return raw.toLowerCase().replace(/([a-zà-öø-ÿ]+(?:'[a-zà-öø-ÿ]+)?)/gi, (word, _g, offset) => {
    const prev = raw.slice(0, offset);
    const afterDashOrColon = /[-:]\s*$/.test(prev);
    if (word.includes("'")) {
      const [prefix, rest] = word.split("'");
      const p = (firstWord || afterDashOrColon) ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : prefix;
      firstWord = false;
      return `${p}'${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
    }
    if (firstWord || afterDashOrColon || !lowerWords.has(word)) {
      firstWord = false;
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  });
}

function detectBlock(resp, bodySample, hasPasswordInput) {
  const st = resp ? resp.status() : 0;
  if (st === 401 || st === 403 || st === 429) {
    return `HTTP ${st} block/auth response`;
  }
  const hit = String(bodySample || '').slice(0, 4000).match(BLOCK_RE);
  if (hit) return `bot/challenge detected: "${hit[0]}"`;
  if (hasPasswordInput) return 'login form required';
  return null;
}

export function parseWeekDatesFromHeader(text) {
  const norm = String(text || '').replace(/\s+/g, ' ');
  const m = norm.match(
    /Programmazione\s+da\s+gioved[iì]\s+(\d{1,2})(?:\s+([a-zà-ú]+))?(?:\s+(\d{4}))?\s+a\s+mercoled[iì]\s+(\d{1,2})\s+([a-zà-ú]+)\s+(\d{4})/i
  );
  if (!m) return null;
  const endDay = Number(m[4]);
  const endMonth = MONTHS_IT[m[5].toLowerCase()];
  const endYear = Number(m[6]);
  if (!endMonth) return null;
  const endISO = toISO(endYear, endMonth, endDay);
  if (!endISO) return null;

  const map = {};
  DAY_KEYS.forEach((k, idx) => {
    map[k] = addDaysISO(endISO, idx - 6);
  });
  return map;
}

export function parseSingleProgramDate(text) {
  const norm = String(text || '').replace(/\s+/g, ' ');
  const m = norm.match(
    /IN\s+PROGRAMMAZIONE\s+(?:domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)\s+(\d{1,2})\s+([a-zà-ú]+)\s+(\d{4})/i
  );
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS_IT[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month) return null;
  return toISO(year, month, day);
}

export function parseTariffs(text) {
  const norm = String(text || '').replace(/\s+/g, ' ');
  const interoM = norm.match(/Intero\s*€?\s*(\d+(?:[.,]\d+)?)\s*€?/i);
  const mercM = norm.match(/Mercoled[iì]\s+feriale\s*€?\s*(\d+(?:[.,]\d+)?)\s*€?/i);
  const pomM = norm.match(/Pomeridiano\s+feriale\s*€?\s*(\d+(?:[.,]\d+)?)\s*€?/i);
  return {
    intero: interoM ? parseEuro(interoM[1]) : null,
    mercolediFeriale: mercM ? parseEuro(mercM[1]) : null,
    pomeridianoFeriale: pomM ? parseEuro(pomM[1]) : null,
  };
}

export function resolveRegularPrice(tariffs, date, time, filmPriceOverride = null) {
  if (typeof filmPriceOverride === 'number') return filmPriceOverride;
  if (!tariffs || typeof tariffs.intero !== 'number') return null;
  const wd = weekdayUTC(date); // 0=Sun..6=Sat
  const hour = Number(String(time).slice(0, 2));

  if (typeof tariffs.mercolediFeriale === 'number' && typeof tariffs.pomeridianoFeriale !== 'number') {
    return wd === 3 ? tariffs.mercolediFeriale : tariffs.intero;
  }
  if (typeof tariffs.pomeridianoFeriale === 'number') {
    if (wd === 0 || wd === 6 || hour >= 20) return tariffs.intero;
    if (hour < 17) return tariffs.pomeridianoFeriale;
    if (wd === 3 && typeof tariffs.mercolediFeriale === 'number') return tariffs.mercolediFeriale;
    return null; // weekday 17:00-19:59 cutoff not explicitly stated on contact.php
  }
  return tariffs.intero;
}

// ---- Minimal pure-Node PDF text extractor (FlateDecode + ToUnicode + WinAnsi) ----

const WIN_ANSI_HIGH = {
  0x80: '€', 0x85: '…', 0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"', 0x96: '-', 0x97: '-',
};

function decodePdfLiteralBytes(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    if (ch === 0x5c /* \ */ && i + 1 < raw.length) {
      const nx = raw[i + 1];
      if (nx >= '0' && nx <= '7') {
        let oct = nx;
        i++;
        if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
        if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
        bytes.push(parseInt(oct, 8) & 0xff);
      } else {
        i++;
        const escMap = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
        if (nx === '\r' || nx === '\n') {
          if (nx === '\r' && raw[i + 1] === '\n') i++;
        } else {
          bytes.push(escMap[nx] ?? nx.charCodeAt(0));
        }
      }
    } else {
      bytes.push(ch & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function bytesToWinAnsi(buf) {
  let out = '';
  for (const b of buf) {
    if (WIN_ANSI_HIGH[b]) out += WIN_ANSI_HIGH[b];
    else out += String.fromCharCode(b);
  }
  return out;
}

function hexToUtf16OrLatin(hex) {
  const clean = hex.replace(/\s+/g, '');
  if (!clean) return '';
  const padded = clean.length % 2 ? clean + '0' : clean;
  const buf = Buffer.from(padded, 'hex');
  if (buf.length >= 2 && buf.length % 2 === 0) {
    let u = '';
    for (let i = 0; i < buf.length; i += 2) {
      u += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
    }
    return u;
  }
  return bytesToWinAnsi(buf);
}

function parseCMap(cmapText) {
  const map = new Map();
  let codeBytes = 2;
  for (const m of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      if (pair[1].length === 2) codeBytes = 1;
      map.set(parseInt(pair[1], 16), hexToUtf16OrLatin(pair[2]));
    }
  }
  for (const m of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = m[1];
    for (const r of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      if (r[1].length === 2) codeBytes = 1;
      const lo = parseInt(r[1], 16);
      const hi = parseInt(r[2], 16);
      if (r[3] !== undefined) {
        let base = parseInt(r[3], 16);
        const hexLen = r[3].length;
        for (let c = lo; c <= hi && c - lo < 1024; c++, base++) {
          map.set(c, hexToUtf16OrLatin(base.toString(16).padStart(hexLen, '0')));
        }
      } else if (r[4] !== undefined) {
        const items = [...r[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexToUtf16OrLatin(x[1]));
        for (let c = lo; c <= hi && c - lo < items.length; c++) {
          map.set(c, items[c - lo]);
        }
      }
    }
  }
  return map.size ? { map, codeBytes } : null;
}

function decodeWithCMap(buf, cmap) {
  if (!cmap) return bytesToWinAnsi(buf);
  const { map, codeBytes } = cmap;
  if (codeBytes === 2 && buf.length % 2 === 0) {
    let out = '';
    for (let i = 0; i < buf.length; i += 2) {
      const code = (buf[i] << 8) | buf[i + 1];
      out += map.get(code) ?? (code >= 32 && code < 127 ? String.fromCharCode(code) : '');
    }
    return out;
  }
  let out = '';
  for (const b of buf) {
    out += map.get(b) ?? (WIN_ANSI_HIGH[b] || String.fromCharCode(b));
  }
  return out;
}

export function extractPdfText(pdfBuffer) {
  const rawLatin = Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('latin1') : String(pdfBuffer || '');
  if (!rawLatin.startsWith('%PDF')) return '';

  // Parse indirect objects and inflate streams where possible.
  const objText = new Map();
  const objStream = new Map();
  const objRe = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
  for (const m of rawLatin.matchAll(objRe)) {
    const objNum = Number(m[1]);
    const body = m[3];
    const sIdx = body.indexOf('stream');
    if (sIdx === -1) {
      objText.set(objNum, body);
      continue;
    }
    const dict = body.slice(0, sIdx);
    objText.set(objNum, dict);
    let dataStart = sIdx + 6;
    if (body[dataStart] === '\r' && body[dataStart + 1] === '\n') dataStart += 2;
    else if (body[dataStart] === '\n' || body[dataStart] === '\r') dataStart += 1;
    const eIdx = body.lastIndexOf('endstream');
    if (eIdx <= dataStart) continue;
    let slice = body.slice(dataStart, eIdx);
    if (slice.endsWith('\r\n')) slice = slice.slice(0, -2);
    else if (slice.endsWith('\n') || slice.endsWith('\r')) slice = slice.slice(0, -1);
    const bytes = Buffer.from(slice, 'latin1');
    if (/\/FlateDecode\b/.test(dict) && !/\/Subtype\s*\/Image\b/.test(dict)) {
      try {
        objStream.set(objNum, inflateSync(bytes).toString('latin1'));
      } catch {
        // Ignore non-standard/corrupt compressed stream.
      }
    } else if (!/\/Filter\b/.test(dict) && !/\/Subtype\s*\/Image\b/.test(dict)) {
      objStream.set(objNum, slice);
    }
  }

  // Also decompress ObjStm containers if any exist (PDF 1.5+ object streams).
  for (const [num, dict] of objText.entries()) {
    if (!/\/Type\s*\/ObjStm\b/.test(dict)) continue;
    const s = objStream.get(num);
    const firstM = dict.match(/\/First\s+(\d+)/);
    const nM = dict.match(/\/N\s+(\d+)/);
    if (!s || !firstM || !nM) continue;
    const first = Number(firstM[1]);
    const header = s.slice(0, first).trim().split(/\s+/).map(Number);
    const count = Number(nM[1]);
    for (let i = 0; i < count && i * 2 + 1 < header.length; i++) {
      const subObj = header[i * 2];
      const off = first + header[i * 2 + 1];
      const nextOff = i + 1 < count && (i + 1) * 2 + 1 < header.length ? first + header[(i + 1) * 2 + 1] : s.length;
      if (!objText.has(subObj)) objText.set(subObj, s.slice(off, nextOff));
    }
  }

  // Build ToUnicode CMap per font object number, then map font resource names (/F1, /C2_0, ...).
  const cmapsByObj = new Map();
  for (const [num, s] of objStream.entries()) {
    if (s.includes('beginbfchar') || s.includes('beginbfrange')) {
      const parsed = parseCMap(s);
      if (parsed) cmapsByObj.set(num, parsed);
    }
  }
  const fontObjToCMap = new Map();
  for (const [num, dict] of objText.entries()) {
    const tu = dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (tu && cmapsByObj.has(Number(tu[1]))) {
      fontObjToCMap.set(num, cmapsByObj.get(Number(tu[1])));
    }
  }
  const globalFontMap = new Map();
  for (const dict of objText.values()) {
    for (const fm of dict.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fObj = Number(fm[2]);
      if (fontObjToCMap.has(fObj)) globalFontMap.set(fm[1], fontObjToCMap.get(fObj));
    }
  }

  // Extract text from content streams containing BT..ET blocks.
  const lines = [];
  for (const [, streamStr] of objStream.entries()) {
    if (!streamStr.includes('BT') || !streamStr.includes('ET')) continue;
    if (streamStr.includes('beginbfchar') || streamStr.includes('beginbfrange')) continue;

    for (const btMatch of streamStr.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
      const block = btMatch[1];
      let curFont = null;
      let curLine = '';
      let lastY = null;

      const tokenRe = /\/([A-Za-z0-9_.+-]+)\s+[-+\d.]+\s+Tf\b|([-+\d.]+)\s+([-+\d.]+)\s+T[dD]\b|([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+Tm\b|\bT\*\b|\[((?:\\.|[^\]])*)\]\s*TJ\b|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|')\b|<([0-9A-Fa-f\s]+)>\s*Tj\b/g;

      for (const tok of block.matchAll(tokenRe)) {
        if (tok[1] !== undefined) {
          curFont = globalFontMap.get(tok[1]) ?? null;
        } else if (tok[2] !== undefined) {
          const dy = Number(tok[3]);
          if (Math.abs(dy) > 1.5 && curLine.trim()) {
            lines.push(curLine);
            curLine = '';
          } else if (Number(tok[2]) > 20 && curLine && !curLine.endsWith(' ')) {
            curLine += ' ';
          }
        } else if (tok[4] !== undefined) {
          const y = Number(tok[9]);
          if (lastY !== null && Math.abs(y - lastY) > 1.5 && curLine.trim()) {
            lines.push(curLine);
            curLine = '';
          } else if (curLine && !curLine.endsWith(' ')) {
            curLine += ' ';
          }
          lastY = y;
        } else if (tok[0] === 'T*') {
          if (curLine.trim()) {
            lines.push(curLine);
            curLine = '';
          }
        } else if (tok[10] !== undefined) {
          const arr = tok[10];
          for (const sub of arr.matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>|([-+]?\d+(?:\.\d+)?)/g)) {
            if (sub[1] !== undefined) {
              curLine += decodeWithCMap(decodePdfLiteralBytes(sub[1]), curFont);
            } else if (sub[2] !== undefined) {
              const h = sub[2].replace(/\s+/g, '');
              if (h) curLine += decodeWithCMap(Buffer.from(h.length % 2 ? h + '0' : h, 'hex'), curFont);
            } else if (sub[3] !== undefined && Number(sub[3]) < -180 && curLine && !curLine.endsWith(' ')) {
              curLine += ' ';
            }
          }
        } else if (tok[11] !== undefined) {
          curLine += decodeWithCMap(decodePdfLiteralBytes(tok[11]), curFont);
        } else if (tok[12] !== undefined) {
          const h = tok[12].replace(/\s+/g, '');
          if (h) curLine += decodeWithCMap(Buffer.from(h.length % 2 ? h + '0' : h, 'hex'), curFont);
        }
      }
      if (curLine.trim()) lines.push(curLine);
    }
  }

  return lines.join('\n');
}

// Parse Thursday cineforum schedule text from Mexico (cinefomex.pdf) and Palestrina (cineforum.pdf).
export function parseCineforumPdfSchedule(pdfText, { from, to }) {
  if (!pdfText) return [];
  const normText = pdfText
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ');

  // Season years (e.g. "2026/2027" or "2026 - 2027"): months 9..12 -> startYear, 1..7 -> endYear.
  const seasonM = normText.match(/\b(20\d{2})\s*[/-]\s*(20\d{2})\b/);
  const startYear = seasonM ? Number(seasonM[1]) : Number(String(from).slice(0, 4));
  const endYear = seasonM ? Number(seasonM[2]) : startYear + 1;
  const yearForMonth = (m) => (m >= 9 ? startYear : endYear);

  const results = [];

  // Format A — Mexico "Immagini e Immaginari":
  // e.g. "12/11 - TUNER L'ACCORDATORE (109') di Daniel Roher"
  // Exception note: "(solo nei giorni 15/10, 5/11, 3/12, 18/02, 6/5 ore 20.30)"
  const earlyEveningDates = new Set();
  const soloM = normText.match(/solo\s+nei\s+giorni\s+([^)]*?)\s+ore\s+(\d{1,2})[.:](\d{2})/i);
  const altEveningTime = soloM ? `${pad2(soloM[2])}:${soloM[3]}` : '20:30';
  if (soloM) {
    for (const dm of soloM[1].matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})/g)) {
      const d = Number(dm[1]), m = Number(dm[2]);
      const iso = toISO(yearForMonth(m), m, d);
      if (iso) earlyEveningDates.add(iso);
    }
  }

  const mexEntryRe = /(?:^|\n)\s*(\d{1,2})\/(\d{1,2})\s*-\s*([^\n(]+?)\s*\((\d{2,3})'\)/g;
  for (const m of normText.matchAll(mexEntryRe)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const iso = toISO(yearForMonth(month), month, day);
    if (!iso || iso < from || iso > to) continue;
    const rawTitle = cleanTitle(m[3]);
    if (/film\s+a\s+sorpresa/i.test(rawTitle)) continue;
    const title = toTitleCaseItalian(rawTitle);
    const runtime = Number(m[4]);
    const eveTime = earlyEveningDates.has(iso) ? altEveningTime : '21:00';
    results.push(
      { title, runtime_min: runtime, date: iso, time: '16:00', language: 'ita', price_eur: 5 },
      { title, runtime_min: runtime, date: iso, time: eveTime, language: 'ita', price_eur: 6 }
    );
  }
  if (results.length) return results;

  // Format B — Palestrina "Cineforum":
  // Summary lines on page 2: "12 novembre*: Norimberga"
  // Detailed blurbs on page 1: "12 NOVEMBRE*: NORIMBERGA (USA 148') ... *orari: 17.00 - 21.00"
  // Footnote: "(* 1 e 8 ottobre ore 17.00 - 20.30, 12 novembre, 10 dicembre e 15 aprile ore 17.00 - 21.00 )"
  const starTimesByDate = new Map();
  const starFootnote = normText.match(/\(\*\s*([^)]+)\)/);
  if (starFootnote) {
    // Parse clauses like "1 e 8 ottobre ore 17.00 - 20.30" and "12 novembre, 10 dicembre e 15 aprile ore 17.00 - 21.00"
    for (const seg of starFootnote[1].matchAll(/([^o]+?)\bore\s+(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/gi)) {
      const datesPart = seg[1];
      const t1 = `${pad2(seg[2])}:${seg[3]}`;
      const t2 = `${pad2(seg[4])}:${seg[5]}`;
      // Match "1 e 8 ottobre" or "12 novembre"
      for (const dm of datesPart.matchAll(/(\d{1,2})(?:\s*e\s*(\d{1,2}))?\s+([a-zà-ú]+)/gi)) {
        const mon = MONTHS_IT[dm[3].toLowerCase()];
        if (!mon) continue;
        for (const dStr of [dm[1], dm[2]].filter(Boolean)) {
          const iso = toISO(yearForMonth(mon), mon, Number(dStr));
          if (iso) starTimesByDate.set(iso, [t1, t2]);
        }
      }
    }
  }

  // Extract runtime lookup from page 1 blurbs: e.g. "12 NO VEMBRE*: NORIMBERGA (USA 148')"
  const runtimeByDate = new Map();
  const compact = normText.replace(/NO\s+VEMBRE/gi, 'NOVEMBRE').replace(/\s+/g, ' ');
  for (const bm of compact.matchAll(/\b(\d{1,2})\s*(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s*\*?\s*:\s*[^()]{2,80}\([A-Z.\s]+?(\d[\d\s]{1,3})'\)/gi)) {
    const mon = MONTHS_IT[bm[2].toLowerCase()];
    const rt = Number(bm[3].replace(/\s+/g, ''));
    const iso = mon ? toISO(yearForMonth(mon), mon, Number(bm[1])) : null;
    if (iso && Number.isFinite(rt) && rt >= 40 && rt <= 300) {
      runtimeByDate.set(iso, rt);
    }
    // Check inline "*orari: HH.MM - HH.MM" right after blurb
    const after = compact.slice(bm.index, bm.index + 240);
    const om = after.match(/\*?\s*orari\s*:\s*(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/i);
    if (iso && om) {
      starTimesByDate.set(iso, [`${pad2(om[1])}:${om[2]}`, `${pad2(om[3])}:${om[4]}`]);
    }
  }

  // Match summary calendar lines ("12 novembre*: Norimberga") first; fall back to blurb headers.
  const seenDates = new Set();
  const summaryRe = /(?:^|\n)\s*(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s*(\*)?\s*:\s*([^\n(]+?)(?:\s*\([A-Z.\s]+\d+'\)|\s*$)/gi;
  for (const sm of normText.matchAll(summaryRe)) {
    const day = Number(sm[1]);
    const mon = MONTHS_IT[sm[2].toLowerCase()];
    if (!mon) continue;
    const iso = toISO(yearForMonth(mon), mon, day);
    if (!iso || iso < from || iso > to || seenDates.has(iso)) continue;
    const rawTitle = cleanTitle(sm[4]);
    if (!rawTitle || /film\s+a\s+sorpresa/i.test(rawTitle)) continue;
    // Prefer mixed-case summary line if present; convert ALL-CAPS blurb title if needed.
    const title = toTitleCaseItalian(rawTitle);
    const starred = Boolean(sm[3]) || starTimesByDate.has(iso);
    const runtime = runtimeByDate.get(iso) ?? null;
    const slots = starred
      ? (starTimesByDate.get(iso) || ['17:00', '21:00']).map((t) => ({
          time: t,
          price_eur: Number(t.slice(0, 2)) >= 20 ? 6 : 5,
        }))
      : [
          { time: '16:00', price_eur: 5 },
          { time: '18:30', price_eur: 5 },
          { time: '21:00', price_eur: 6 },
        ];
    seenDates.add(iso);
    for (const sl of slots) {
      results.push({
        title,
        runtime_min: runtime,
        date: iso,
        time: sl.time,
        language: 'ita',
        price_eur: sl.price_eur,
      });
    }
  }

  return results;
}

export async function scrapeProgettoLumiere(browser, { slug, url, cineforumPdfUrl, from, to }) {
  const homeUrl = url || `https://www.progettolumiere.it/${slug}/home.php`;
  const baseDirUrl = new URL('.', homeUrl).href;

  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  });

  try {
    const page = await ctx.newPage();
    const resp = await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = resp ? resp.status() : 0;
    if (status === 401 || status === 403 || status === 429) {
      throw new Error(`BLOCKED: progettolumiere ${homeUrl} returned HTTP ${status}`);
    }
    if (status >= 500 || status === 404) {
      throw new Error(`progettolumiere: ${homeUrl} returned HTTP ${status}`);
    }

    const homeData = await page.evaluate(({ dayKeys, skipPhpList }) => {
      const skipSet = new Set(skipPhpList);
      const bodyText = (document.body?.innerText || document.body?.textContent || '');
      const hasPw = Boolean(document.querySelector('input[type="password"]'));

      const isVosColor = (el) => {
        if (!el || typeof window.getComputedStyle !== 'function') return false;
        const cls = String(el.className || '').toLowerCase();
        if (/\b(vo|vos|red|green|sub)\b/.test(cls)) return true;
        const m = window.getComputedStyle(el).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return false;
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        return (r > 165 && g < 85 && b < 85) || (g > 125 && r < 95 && b < 95);
      };

      const extractTimesFromContainer = (root) => {
        const out = [];
        const timeSpans = [...root.querySelectorAll('span.time, .viewing-times span')].filter(
          (el) => /\b([01]?\d|2[0-3])[:.][0-5]\d\b/.test(el.textContent || '')
        );
        if (timeSpans.length) {
          for (const sp of timeSpans) {
            const txt = (sp.textContent || '').replace(/\s+/g, ' ').trim();
            for (const tm of txt.matchAll(/(?:(\bV\.?O\.?(?:S\.?)?\b|\*)\s*)?\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/gi)) {
              const hhmm = `${String(tm[2]).padStart(2, '0')}:${tm[3]}`;
              const vos = Boolean(tm[1]) || isVosColor(sp);
              out.push({ time: hhmm, language: vos ? 'vos' : 'ita' });
            }
          }
          return out;
        }

        const full = (root.textContent || '').replace(/\s+/g, ' ');
        const idx = full.toLowerCase().indexOf('orario spettacoli');
        const slice = idx >= 0 ? full.slice(idx + 17) : full;
        for (const tm of slice.matchAll(/(?:(\bV\.?O\.?(?:S\.?)?\b|\*)\s*)?\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/gi)) {
          out.push({
            time: `${String(tm[2]).padStart(2, '0')}:${tm[3]}`,
            language: tm[1] ? 'vos' : 'ita',
          });
        }
        return out;
      };

      const baseDir = new URL('.', location.href).href;
      const resolveDetailPhp = (root) => {
        for (const a of root.querySelectorAll('a[href]')) {
          const rawHref = a.getAttribute('href') || '';
          if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) continue;
          try {
            const u = new URL(rawHref, location.href);
            u.hash = '';
            if (!u.href.startsWith(baseDir) || !u.pathname.endsWith('.php')) continue;
            const file = u.pathname.split('/').pop();
            if (skipSet.has(file)) continue;
            return u.href;
          } catch {}
        }
        return null;
      };

      const days = {};
      for (const dk of dayKeys) {
        const panel = document.getElementById(dk);
        if (!panel) continue;
        const cards = [];
        for (const h3 of panel.querySelectorAll('h3')) {
          const title = (h3.textContent || '').replace(/\s+/g, ' ').trim();
          if (!title) continue;
          let card = h3;
          while (
            card.parentElement &&
            card.parentElement !== panel &&
            card.parentElement.querySelectorAll('h3').length === 1
          ) {
            card = card.parentElement;
          }
          const detailUrl = resolveDetailPhp(card);
          const times = extractTimesFromContainer(card);
          if (times.length) cards.push({ title, detailUrl, times });
        }
        days[dk] = cards;
      }

      // Collect all local film .php pages linked anywhere on home.php (incl. Prossimamente).
      const extraPhpUrls = new Set();
      for (const a of document.querySelectorAll('a[href]')) {
        const rawHref = a.getAttribute('href') || '';
        if (!rawHref || rawHref.startsWith('#')) continue;
        try {
          const u = new URL(rawHref, location.href);
          u.hash = '';
          if (!u.href.startsWith(baseDir) || !u.pathname.endsWith('.php')) continue;
          const file = u.pathname.split('/').pop();
          if (!skipSet.has(file)) extraPhpUrls.add(u.href);
        } catch {}
      }

      return {
        bodySample: bodyText.slice(0, 4000),
        fullText: bodyText,
        hasPw,
        days,
        detailUrls: [...extraPhpUrls],
      };
    }, { dayKeys: DAY_KEYS, skipPhpList: [...SKIP_PHP] });

    const blockReason = detectBlock(resp, homeData.bodySample, homeData.hasPw && !Object.keys(homeData.days).length);
    if (blockReason) {
      throw new Error(`BLOCKED: progettolumiere ${homeUrl} (${blockReason})`);
    }

    const weekDates = parseWeekDatesFromHeader(homeData.fullText);

    // Fetch contact.php tariffs (non-fatal if absent).
    let tariffs = { intero: null, mercolediFeriale: null, pomeridianoFeriale: null };
    try {
      const cResp = await page.goto(new URL('contact.php', baseDirUrl).href, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      if (cResp && cResp.ok()) {
        const cText = await page.evaluate(() => document.body?.innerText || document.body?.textContent || '');
        tariffs = parseTariffs(cText);
      }
    } catch {}

    // Visit each unique film detail .php page for runtime, explicit ticket override, and single-date events.
    const detailMetaByUrl = new Map();
    const detailMetaByTitle = new Map();
    const singleEventShowings = [];

    for (const dUrl of homeData.detailUrls) {
      try {
        const dResp = await page.goto(dUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (!dResp || !dResp.ok()) continue;
        const info = await page.evaluate(() => {
          const text = document.body?.innerText || document.body?.textContent || '';
          const h = document.querySelector('h3') || document.querySelector('h1');
          const title = (h?.textContent || '').replace(/\s+/g, ' ').trim();
          const durM = text.match(/Durata\s*:?\s*(\d{2,3})\s*min/i);
          const priceM = text.match(/Ingresso[^€\d\n]{0,45}(?:€\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*€)/i);

          // Extract schedule bullets under "IN PROGRAMMAZIONE" if this is a single-date event.
          const schedItems = [];
          for (const li of document.querySelectorAll('li')) {
            const lt = (li.textContent || '').replace(/\s+/g, ' ').trim();
            if (/^(domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)(?=$|[^a-zà-ú])/i.test(lt)) {
              for (const tm of lt.matchAll(/(?:(\bV\.?O\.?(?:S\.?)?\b|\*)\s*)?\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/gi)) {
                schedItems.push({
                  time: `${String(tm[2]).padStart(2, '0')}:${tm[3]}`,
                  language: tm[1] ? 'vos' : 'ita',
                });
              }
            }
          }
          return {
            title,
            text,
            runtime_min: durM ? Number(durM[1]) : null,
            priceRaw: priceM ? (priceM[1] || priceM[2]) : null,
            schedItems,
          };
        });

        const meta = {
          title: cleanTitle(info.title),
          runtime_min: info.runtime_min,
          price_eur: parseEuro(info.priceRaw),
          url: dUrl,
        };
        detailMetaByUrl.set(dUrl, meta);
        if (meta.title) detailMetaByTitle.set(meta.title.toLowerCase(), meta);

        const singleDate = parseSingleProgramDate(info.text);
        if (singleDate && singleDate >= from && singleDate <= to && meta.title && info.schedItems.length) {
          for (const sl of info.schedItems) {
            singleEventShowings.push({
              title: meta.title,
              original_title: null,
              year: null,
              runtime_min: meta.runtime_min,
              date: singleDate,
              time: sl.time,
              language: sl.language,
              format: null,
              price_eur: resolveRegularPrice(tariffs, singleDate, sl.time, meta.price_eur),
              booking_url: dUrl,
            });
          }
        }
      } catch {}
    }

    const rawShowings = [];

    if (weekDates) {
      for (const dk of DAY_KEYS) {
        const date = weekDates[dk];
        if (!date || date < from || date > to) continue;
        const cards = homeData.days[dk] || [];
        for (const card of cards) {
          const cTitle = cleanTitle(card.title);
          const meta =
            (card.detailUrl && detailMetaByUrl.get(card.detailUrl)) ||
            detailMetaByTitle.get(cTitle.toLowerCase()) ||
            null;
          const bookingUrl = card.detailUrl || meta?.url || homeUrl;
          // Prefer the official film scheda title on single-date series pages if card uses generic series header,
          // or keep home.php card title (both normalize cleanly).
          const title = cTitle;
          for (const sl of card.times) {
            rawShowings.push({
              title,
              original_title: null,
              year: null,
              runtime_min: meta?.runtime_min ?? null,
              date,
              time: sl.time,
              language: sl.language,
              format: null,
              price_eur: resolveRegularPrice(tariffs, date, sl.time, meta?.price_eur ?? null),
              booking_url: bookingUrl,
            });
          }
        }
      }
    }

    rawShowings.push(...singleEventShowings);

    // Scrape Thursday Cineforum page (single-moviecin.php) + linked season PDF brochure.
    const cineforumPageUrl = new URL('single-moviecin.php', baseDirUrl).href;
    let discoveredPdfUrl = cineforumPdfUrl || null;
    try {
      const cfResp = await page.goto(cineforumPageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (cfResp && cfResp.ok()) {
        const cfData = await page.evaluate(() => {
          const text = document.body?.innerText || document.body?.textContent || '';
          const h3 = document.querySelector('h3');
          const title = (h3?.textContent || '').replace(/\s+/g, ' ').trim();
          const durM = text.match(/Durata\s*:?\s*(\d{2,3})\s*min/i);
          const times = [];
          for (const li of document.querySelectorAll('li')) {
            const lt = (li.textContent || '').replace(/\s+/g, ' ').trim();
            if (/^gioved[iì](?=$|[^a-zà-ú])/i.test(lt)) {
              for (const tm of lt.matchAll(/(?:(\bV\.?O\.?(?:S\.?)?\b|\*)\s*)?\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/gi)) {
                times.push({
                  time: `${String(tm[2]).padStart(2, '0')}:${tm[3]}`,
                  language: tm[1] ? 'vos' : 'ita',
                });
              }
            }
          }
          let pdfHref = null;
          for (const a of document.querySelectorAll('a[href]')) {
            const href = a.getAttribute('href') || '';
            if (/cinefo.*\.pdf$/i.test(href) || /\/pdf\/.*\.pdf$/i.test(href)) {
              pdfHref = new URL(href, location.href).href;
              break;
            }
          }
          return { title, text, runtime_min: durM ? Number(durM[1]) : null, times, pdfHref };
        });

        if (cfData.pdfHref) discoveredPdfUrl = cfData.pdfHref;

        const cfDate = parseSingleProgramDate(cfData.text);
        if (cfDate && cfDate >= from && cfDate <= to && cfData.title && cfData.times.length) {
          for (const sl of cfData.times) {
            const hour = Number(sl.time.slice(0, 2));
            rawShowings.push({
              title: cleanTitle(cfData.title),
              original_title: null,
              year: null,
              runtime_min: cfData.runtime_min,
              date: cfDate,
              time: sl.time,
              language: sl.language,
              format: null,
              price_eur: hour >= 20 ? 6 : 5,
              booking_url: cineforumPageUrl,
            });
          }
        }
      }
    } catch {}

    if (discoveredPdfUrl) {
      try {
        const pdfResp = await page.request.get(discoveredPdfUrl, { timeout: 20000 });
        if (pdfResp.ok()) {
          const pdfBuf = await pdfResp.body();
          const pdfText = extractPdfText(pdfBuf);
          const pdfShowings = parseCineforumPdfSchedule(pdfText, { from, to });
          for (const ps of pdfShowings) {
            rawShowings.push({
              title: ps.title,
              original_title: null,
              year: null,
              runtime_min: ps.runtime_min,
              date: ps.date,
              time: ps.time,
              language: ps.language,
              format: null,
              price_eur: ps.price_eur,
              booking_url: cineforumPageUrl,
            });
          }
        }
      } catch {}
    }

    // Deduplicate by normalized title + date + time, preferring entries with runtime_min populated.
    const byKey = new Map();
    for (const s of rawShowings) {
      if (!s.title || !s.date || !s.time || s.date < from || s.date > to) continue;
      const key = `${s.title.toLowerCase()}|${s.date}|${s.time}`;
      const prev = byKey.get(key);
      if (!prev || (!prev.runtime_min && s.runtime_min)) {
        byKey.set(key, s);
      }
    }

    const showings = [...byKey.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'it')
    );

    return showings;
  } finally {
    await ctx.close();
  }
}
