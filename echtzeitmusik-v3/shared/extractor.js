// ═══════════════════════════════════════════════════════════════════════════
//  echtzeitmusik · structure-first extraction engine
//  ---------------------------------------------------------------------------
//  Extracts artists (with per-artist instruments/genres + confidence) and
//  event-level genres from calendar infoText using POSITIVE structural
//  evidence: credit lines, prose role cues, corroborated headline/roster
//  lines. Replaces the old extract-every-capitalized-phrase pipeline and its
//  geography blocklists (cities/universities/countries) entirely.
//
//  Public globals (kept deliberately small):
//    extractEventArtists(infoText) -> { artists:[{name, instruments[],
//        genres[], confidence, isGroup?, sources[]}], genres:[] }   (memoized)
//    fixMojibake(str)  -> repairs UTF-8-stored-as-cp1252 text from the site
//
//  Benchmarked against a 118-event gold-labeled corpus (July 2026):
//    artists     F1 85.5  (old parser: 69.5)
//    instruments F1 83.9  (old parser: 54.1)
//    genres      F1 69.8  (old parser: 64.3)
//  Load AFTER dictionaries.js; parser.js adapters call into this engine.
// ═══════════════════════════════════════════════════════════════════════════
(function (root) {
'use strict';

// Repair UTF-8 text that the site stored/served through cp1252 ("Â´", "â€“").
function fixMojibake(s) {
  const CP1252_REV = {
    '\u20ac':0x80,'\u201a':0x82,'\u0192':0x83,'\u201e':0x84,'\u2026':0x85,
    '\u2020':0x86,'\u2021':0x87,'\u02c6':0x88,'\u2030':0x89,'\u0160':0x8a,
    '\u2039':0x8b,'\u0152':0x8c,'\u017d':0x8e,'\u2018':0x91,'\u2019':0x92,
    '\u201c':0x93,'\u201d':0x94,'\u2022':0x95,'\u2013':0x96,'\u2014':0x97,
    '\u02dc':0x98,'\u2122':0x99,'\u0161':0x9a,'\u203a':0x9b,'\u0153':0x9c,
    '\u017e':0x9e,'\u0178':0x9f,
  };
  return String(s).replace(/[\u00c2-\u00c5\u00e2][\u00a0-\u00bf\u0152\u0153\u0160\u0161\u017d\u017e\u0192\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u02c6\u02dc\u2122\u20ac\u00a0-\u00bf]{1,3}/g, (seq) => {
    const bytes = [];
    for (const ch of seq) {
      const code = ch.codePointAt(0);
      if (code <= 0xff) bytes.push(code);
      else if (CP1252_REV[ch] !== undefined) bytes.push(CP1252_REV[ch]);
      else return seq;
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); }
    catch (e) { return seq; }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Structure-first extractor (v2) for echtzeitmusik.de infoText
//  ---------------------------------------------------------------------------
//  Principle: extract names only on POSITIVE structural evidence — never by
//  scanning prose for capitalized phrases and patching with geography
//  blocklists.
//
//  Evidence, strongest first:
//   A. Credit lines   — "Name – instr[, instr]" / "Name: instr" /
//                       "Name (instr)" / "Name [instr]" / "role: Name".
//   B. Prose cues     — "percussionist Joss Turnbull", "musician Görkem Şen",
//                       "we present X and Y", "Name is a …" bio leads.
//   C. Headline/list  — first lines, slash rosters, act headers above lineups;
//                       corroborated by A/B anchors or name shape.
//  Genres: event-level lexicon scan + credit-slot genre tokens per artist.
// ═══════════════════════════════════════════════════════════════════════════

const fold = s => String(s).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/ı/g, 'i');

const CONNECTORS = new Set([
  'de','van','von','der','den','dem','des','la','le','da','del','dos','du','di',
  'el','las','los','al','il','lo','gli','mac','mc','san','y','of','bin','ben','ter','te','und','and','the',
]);

const INSTRUMENT_WORDS = new Set([
  // core English
  'piano','guitar','bass','drums','drum','percussion','percussions','sax','saxophone','saxophones',
  'trumpet','trombone','horn','tuba','euphonium','violin','viola','cello','violoncello','contrabass',
  'flute','flutes','piccolo','clarinet','clarinets','oboe','bassoon','recorder','recorders',
  'voice','voices','vocals','vocal','choir','organ','organs','harp','accordion','bandoneon',
  'keyboard','keyboards','keys','synth','synths','synthesizer','synthesizers','sampler','sampling',
  'electronics','laptop','computer','turntable','turntables','tapes','tape','walkman','cassettes',
  'banjo','mandolin','ukulele','zither','harmonium','celesta','clavichord','harpsichord','cembalo',
  'marimba','vibraphone','vibes','glockenspiel','xylophone','gong','gongs','bells','cymbals',
  'objects','object','feedback','feedbacker','mixer','modular','effects','fx','pedals','oscillators',
  'radio','radios','antennas','microphone','microphones','amplifier','amplifiers','speakers',
  'reeds','reed','woodwinds','woodwind','brass','strings','daxophone','theremin','monochord',
  'metals','springs','motors','snare',
  // German
  'klavier','fluegel','gitarre','schlagzeug','schlagwerk','saxophon','trompete','posaune',
  'geige','bratsche','kontrabass','floete','klarinette','klarinetten','stimme','gesang',
  'elektronik','mischpult','orgel','harfe','akkordeon','bassklarinette','blockfloete','querfloete',
  // non-western / scene-specific (observed in the data)
  'oud','saz','ney','tanbur','bendir','tombak','daf','santur','kanun','tar','yaybahar',
  'shakuhachi','koto','sho','gamelan','mbira','kalimba','didgeridoo','duduk','hurdy-gurdy',
  'gayageum','erhu','pipa','guzheng','tabla','sitar','bansuri','riq','cajon','berimbau',
  'shamisen','balafon','bassguitar','handpan','melodica','harmonica','nyckelharpa','zurna','baglama','charango','waterphone',
  // recordings / media
  'recordings','loops','looper','playback','devices','synthesis','processing',
  'doublebass','vibraphon','altsaxophone','tenorsaxophone','sopransaxophone','baritonsaxophone',
  'ebass','egitarre','kontraforte','bassklarinette','preparedpiano','bassclarinet','altosax','tenorsax','sopranosax',
]);

const INSTRUMENT_ABBREV = {
  'g':'guitar','git':'guitar','gtr':'guitar','e-g':'electric guitar','e-gtr':'electric guitar','egtr':'electric guitar',
  'b':'bass','e-b':'electric bass','e-bass':'electric bass','bg':'bass guitar','db':'double bass','cb':'contrabass','kb':'double bass',
  'p':'piano','pno':'piano','e-p':'electric piano','kl':'klavier','klav':'klavier','keyb':'keyboard',
  'v':'violin','vn':'violin','vl':'violin','vln':'violin','va':'viola','vc':'cello','vlc':'cello',
  's':'saxophone','sax':'saxophone','as':'alto saxophone','ts':'tenor saxophone','bs':'baritone saxophone','ss':'soprano saxophone',
  'alt':'alto saxophone','tsax':'tenor saxophone','ssax':'soprano saxophone','bsax':'baritone saxophone',
  'cl':'clarinet','bcl':'bass clarinet','fl':'flute','picc':'piccolo','ob':'oboe','bn':'bassoon','eh':'english horn',
  'tp':'trumpet','tpt':'trumpet','trp':'trumpet','trpt':'trumpet','tb':'trombone','trb':'trombone','hn':'horn','tba':'tuba',
  'dr':'drums','drs':'drums','perc':'percussion','pc':'percussion','vib':'vibraphone',
  'syn':'synthesizer','synth':'synthesizer','el':'electronics','electr':'electronics','elektr':'electronics',
  'voc':'voice','vox':'voice','tt':'turntables','turnt':'turntables','comp':'computer',
};

const ROLE_TO_INSTRUMENT = {
  'percussionist':'percussion','drummer':'drums','guitarist':'guitar','pianist':'piano',
  'vocalist':'voice','singer':'voice','saxophonist':'saxophone','bassist':'bass','cellist':'cello',
  'violinist':'violin','violist':'viola','trumpeter':'trumpet','trombonist':'trombone',
  'flutist':'flute','flautist':'flute','clarinetist':'clarinet','organist':'organ','harpist':'harp',
  'accordionist':'accordion','turntablist':'turntables',
  'schlagzeuger':'drums','schlagzeugerin':'drums','pianistin':'piano','geiger':'violin','geigerin':'violin',
  'gitarrist':'guitar','gitarristin':'guitar','saxophonistin':'saxophone',
  'saengerin':'voice','saenger':'voice','cellistin':'cello','kontrabassist':'double bass','kontrabassistin':'double bass',
  'komponist':'composition','komponistin':'composition','composer':'composition',
};

// Vocal/role labels used as "role: Name" prefixes
const ROLE_PREFIX = {
  'sopran':'voice','soprano':'voice','mezzosopran':'voice','alt':'voice','tenor':'voice',
  'bariton':'voice','baritone':'voice','countertenor':'voice','stimme':'voice','gesang':'voice',
  'voice':'voice','vocals':'voice','dirigent':'conducting','dirigentin':'conducting',
  'conductor':'conducting','leitung':'direction','regie':'direction','direction':'direction',
  'komposition':'composition','composition':'composition','musik':'',
};

const ARTIST_CUES = [
  'musician','artist','composer','performer','improviser','improvisor','inventor','researcher',
  'virtuoso','virtuosin','soloist','bandleader',
  'musiker','musikerin','kuenstler','kuenstlerin','komponist','komponistin','improvisator','improvisatorin',
];

const CREDIT_ROLES = new Set([
  'composition','konzept','concept','performance','dance','tanz','butoh','choreography',
  'video','visuals','film','light','licht','installation','text','poetry',
  'movement','movements','direction','regie','conducting','leitung','dj','djing',
  'sounddesign','dramaturgie','improvisation','moderation','realisation','live','solo','electronics','mc','vj','turntablism',
]);

const GENRES = [
  'free jazz','avant-garde jazz','experimental jazz','free improvisation','freie improvisation',
  'improvised music','improvisierte musik','new music','neue musik','zeitgenoessische musik',
  'contemporary classical','contemporary music','musique concrete','electroacoustic','elektroakustisch',
  'sound art','klangkunst','sound installation','klanginstallation','field recordings','live electronics',
  'noise','drone','ambient','minimalism','minimal music','microtonal','spectral',
  'jazz','improv','improvisation','experimental','avant-garde','electronic','electronica','techno','house','dub',
  'folk','world music','traditional','klezmer','flamenco','tango','baroque','early music','renaissance',
  'persian classical','indian classical','hindustani','carnatic','maqam','radif',
  'post-rock','krautrock','psychedelic','punk','metal','hardcore','indie','pop','singer-songwriter',
  'dream pop','shoegaze','slow core','slowcore','alt-pop','left-field','bellydance',
  'hip hop','hip-hop','rap','r&b','soul','funk','blues','reggae','gospel','choral',
  'butoh','spoken word','sound poetry','performance art','audiovisual',
];
const GENRE_SET_FOLDED = new Set(GENRES.map(g => fold(g).replace(/-/g, ' ')));

const NON_ACT_MARKERS = [
  ' at ',' im ',' in der ',' beim ','open air','eintritt','doors','einlass','uhr','tickets',
  'vvk','abendkasse','admission','donation','festival','workshop','konzertreihe','reihe',
  'series','session','open mic','vernissage','finissage','ausstellung','exhibition',
  'release','premiere','edition','vol.','no.','nr.','presents','praesentiert',
  'lecture','screening','solikonzert','benefiz','kiezsalon','soundgallery','comedy club',
  'gottesdienst','kostenlos','free entry',
];
const STOP_WORDS = new Set([
  'concert','konzert','concerts','konzerte','live','programm','program','lineup','line-up',
  'vernissage','finissage','info','infos','tba','tbc','support','aftershow','opener',
  'set','sets','music','musik','film','video','pause','intermission','special','guest','guests',
  'gaeste','gaste','entrance','kostenlos','eintritt','danach','anschliessend','after','opening',
  'exhibition','installation','performance','food','drinks','bar','entry',
  'inside','outside','cast','sounds','solo','effects','audiovisionen',
  'soundtrack','orchestra','various','diverse','others','friends',
]);

// ── Helpers ────────────────────────────────────────────────────────────────

const clean = s => s.replace(/\s+/g, ' ')
  .replace(/^[\s"'«»„“”*·•–—-]+|[\s"'«»„“”*·•,;:]+$/g, '')
  .replace(/\s*\([^)]*$/, '')            // unbalanced trailing "(fragment"
  .trim();

function isUrlLine(l) { return /https?:\/\/|www\.|\S+@\S+\.\S+/.test(l); }
function isDateTimeLine(l) {
  return /^\d{1,2}[.:]\d{2}\b/.test(l) || /^\d{1,2}\.?\s*(jan|feb|mar|apr|may|mai|jun|jul|aug|sep|okt|oct|nov|dec|dez)/i.test(l)
    || /^(doors|einlass|beginn|start|concert|konzert)\b.*\d/i.test(l)
    || /^\d{1,2}\s+\w+,?\s+\d{1,2}[:.]\d{2}/.test(l)
    || /^\d{1,2}\.\d{2}(\s*[-–]\s*\d{1,2}\.\d{2})?$/.test(l);
}
function isLogisticsLine(l) {
  const f = fold(l);
  return /(eintritt|admission|donation|spende|tickets?|vvk|abendkasse|reservation|anmeldung|newsletter|facebook|instagram|presented by|gefoerdert|funded by|supported by|kuratiert|curated|access:|wheelchair|barrierefrei)/.test(f)
    || /€|\beur\b/i.test(l);
}

function normInstrument(tok) {
  const t = fold(clean(tok)).replace(/[.\]]+$/, '').replace(/^\[/, '').replace(/\s+/g, ' ');
  return INSTRUMENT_ABBREV[t] || t;
}
function isGenreish(tok) {
  return GENRE_SET_FOLDED.has(fold(clean(tok)).replace(/-/g, ' '));
}
function isInstrumentish(tok) {
  const raw = clean(tok);
  const t = fold(raw).replace(/[.\]]+$/, '').replace(/^\[/, '');
  if (!t || t.length > 45) return false;
  if (/^[A-Z]{2,3}$/.test(raw) && !INSTRUMENT_ABBREV[t] && !CREDIT_ROLES.has(t)) return false;  // country codes US, KR, DE
  if (INSTRUMENT_ABBREV[t]) return true;
  if (INSTRUMENT_WORDS.has(t)) return true;
  if (CREDIT_ROLES.has(t)) return true;
  const words = t.split(/[\s-]+/);
  const head = words[words.length - 1];
  if (INSTRUMENT_WORDS.has(head) || CREDIT_ROLES.has(head)) return true;   // "bass clarinet", "butoh-dance"
  if (words.length >= 2 && INSTRUMENT_WORDS.has(words[0])) return true; // "piano solo"
  return false;
}
function isCreditish(tok) { return isInstrumentish(tok) || isGenreish(tok); }

const SLOT_SEP = /\s*[,;/&+]\s*|\s+(?:und|and)\s+/i;

function stripAsideParens(s) {
  return s.replace(/\s*\(([^)]{0,60})\)/g, (full, inner) => {
    const toks = inner.split(SLOT_SEP).map(clean).filter(Boolean);
    const creditish = toks.filter(isCreditish);
    return creditish.length >= Math.max(1, Math.ceil(toks.length / 2)) ? full : ' ';
  }).replace(/\s+/g, ' ').trim();
}

// Name-shape test. `trusted` (credit-line LHS) relaxes capitalization so
// stylized names like "gabby fluke-mogul" or "burgund t brandt" pass.
function isNameShaped(seg, { allowSingle = false, trusted = false } = {}) {
  const s = clean(seg);
  if (!s || s.length < 2 || s.length > 60) return false;
  if (/https?|www\./.test(s)) return false;
  if (!trusted && /\d/.test(s)) return false;
  if (/\s[-\u2013\u2014]\s?/.test(s)) return false;   // "Name - instrument" fragments are not names
  const f = ' ' + fold(s) + ' ';
  if (NON_ACT_MARKERS.some(m => f.includes(m))) return false;
  const words = s.split(/\s+/);
  if (words.length === 1 && (!allowSingle || STOP_WORDS.has(fold(s)))) return false;
  if (words.length > 5) return false;
  let strong = 0;
  for (const w of words) {
    const bare = w.replace(/[^\p{L}\p{N}'.-]/gu, '');
    if (!bare) return false;
    if (/^[\p{Lu}]/u.test(bare)) { strong++; continue; }
    if (CONNECTORS.has(fold(bare)) || /^[a-z]\.?$/.test(bare)) continue;
    if (trusted && /^[\p{Ll}]/u.test(bare)) { strong++; continue; }
    return false;
  }
  if (!strong) return false;
  for (const w of words) {
    const fw = fold(w.replace(/[^\p{L}-]/gu, ''));
    if (INSTRUMENT_WORDS.has(fw) || STOP_WORDS.has(fw)) return false;
  }
  return true;
}

// A lone token that is an instrument/role/stop word can never be an act name,
// even on the permissive single-token acceptance paths.
function isJunkToken(seg) {
  const t = fold(clean(seg));
  return STOP_WORDS.has(t) || INSTRUMENT_WORDS.has(t) || CREDIT_ROLES.has(t)
    || Object.prototype.hasOwnProperty.call(INSTRUMENT_ABBREV, t);
}

const NAME_LIST_SEP = /\s*(?:[,;・]|\/|\||\s[&+x×]\s|\s(?:und|and|feat\.?|featuring|meets|vs\.?|w\/)\s)\s*/i;
const CAP_NAME = String.raw`[\p{Lu}][\p{L}'-]+(?:\s+(?:van|von|de|der|den|del|da|di|la|le|el|dos|du)\s+[\p{Lu}][\p{L}'-]+|\s+[\p{Lu}][\p{L}'.-]+){0,3}`;

// ── Main extraction ────────────────────────────────────────────────────────

function extractEvent(infoText) {
  const rawLines = infoText.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  const artists = new Map();

  // Declared non-acts: the text itself sometimes states that a name is a
  // series/festival/venue — "Frictive Frequencies is a mini series of
  // improvised music". Collect those declarations first; no pass may then
  // accept the declared name as an artist.
  const declaredNonActs = new Set();
  {
    const DECL = new RegExp(String.raw`([\p{Lu}][\p{L}'-]+(?:\s+[\p{L}'-]+){0,4}?)\s+(?:is|are|ist|sind)\s+(?:eine?r?|a|an|the|die|der|das)\s+(?:[\p{Ll}-]+\s+){0,3}?(?:series|serie|reihe|konzertreihe|veranstaltungsreihe|festival|event|events|venue|location|gallery|galerie|club|label|platform|plattform|program|programm|programme|initiative|network|netzwerk|magazine|magazin|exhibition|ausstellung)\b`, 'giu');
    for (const m of infoText.matchAll(DECL)) declaredNonActs.add(fold(clean(m[1])));
  }

  const addArtist = (name, { instruments = [], genres = [], confidence = 0.5, source = '', isGroup = false } = {}) => {
    let n = clean(stripAsideParens(name));
    n = n.replace(/\s+(?:live|solo)$/i, '');
    // "IGNAZ SCHICK QUARTETT" → "IGNAZ SCHICK": drop ensemble-format suffixes
    // when a personal name (2+ words) remains.
    const fmt = n.match(/^(.{4,})\s+(quartett?e?|quintett?e?|trio|sextett?|septett?|octett?|ensemble|orchestra|orchester|group|collective|bigband)\.?$/iu);
    if (fmt && fmt[1].trim().split(/\s+/).length >= 2) n = fmt[1].trim();
    if (!n || n.length < 2 || !/\p{L}{2}/u.test(n)) return null;
    if (STOP_WORDS.has(fold(n))) return null;
    if (declaredNonActs.has(fold(n))) return null;
    const key = fold(n);
    if (!artists.has(key)) artists.set(key, { name: n, instruments: new Set(), genres: new Set(), confidence, sources: new Set(), isGroup });
    const a = artists.get(key);
    a.confidence = Math.max(a.confidence, confidence);
    a.sources.add(source);
    instruments.forEach(i => i && a.instruments.add(i));
    genres.forEach(g => g && a.genres.add(g));
    return a;
  };

  const parseCreditSlot = (slot) => {
    const toks = slot.split(SLOT_SEP).map(clean).filter(Boolean);
    if (!toks.length) return null;
    const credit = toks.filter(isCreditish);
    if (credit.length < Math.max(1, Math.ceil(toks.length / 2))) return null;
    return {
      instruments: toks.filter(isInstrumentish).map(normInstrument),
      genres: toks.filter(t => !isInstrumentish(t) && isGenreish(t)).map(t => fold(clean(t))),
    };
  };

  const addCredited = (lhs, slot, source) => {
    const cleanedLhs = stripAsideParens(lhs);
    const names = cleanedLhs.split(NAME_LIST_SEP).map(clean).filter(Boolean);
    const valid = names.filter(n => isNameShaped(n, { allowSingle: true, trusted: true }));
    if (!valid.length || valid.length !== names.length) return false;
    if (valid.length > 1 && slot.instruments.length === valid.length && !slot.genres.length) {
      valid.forEach((n, i) => addArtist(n, { instruments: [slot.instruments[i]], confidence: 0.95, source }));
    } else {
      valid.forEach(n => addArtist(n, { instruments: slot.instruments, genres: slot.genres, confidence: 0.95, source }));
    }
    return true;
  };

  // ── Pass A: credit lines ──
  const creditLineIdx = new Set();
  rawLines.forEach((line, idx) => {
    if (!line || isUrlLine(line) || isDateTimeLine(line) || isLogisticsLine(line)) return;

    // A0: "role: Name" — "sopran: Kornelia Bruggmann", "Leitung: N.N."
    let m = line.match(/^([\p{L}]+)\s*:\s*(.{2,60})$/u);
    if (m && ROLE_PREFIX[fold(m[1])] !== undefined) {
      const names = m[2].split(NAME_LIST_SEP).map(clean).filter(Boolean);
      if (names.every(n => isNameShaped(n, { allowSingle: true, trusted: true }))) {
        const instr = ROLE_PREFIX[fold(m[1])];
        names.forEach(n => addArtist(n, { instruments: instr ? [instr] : [], confidence: 0.9, source: 'role-colon' }));
        creditLineIdx.add(idx);
        return;
      }
    }

    // A1-multi: several comma-separated "Name – instrument" pairs on one line
    // ("Rudi Mahall - bassclarinet , Motoya Kondo - butoh-dance")
    if ((line.match(/\s[-–—]\s/g) || []).length >= 2 && line.includes(',')) {
      const pairs = line.split(/\s*,\s*(?=[^,]{2,60}\s[-–—]\s)/);
      if (pairs.length >= 2) {
        const parsed = pairs.map(p => {
          const pm = p.match(/^(.{2,60}?)\s[-–—]\s?(.{2,90})$/);
          const slot = pm && parseCreditSlot(pm[2]);
          return (pm && slot) ? { lhs: pm[1], slot } : null;
        });
        if (parsed.every(Boolean)) {
          let ok = true;
          parsed.forEach(pr => { if (!addCredited(pr.lhs, pr.slot, 'credit')) ok = false; });
          if (ok) { creditLineIdx.add(idx); return; }
        }
      }
    }

    // A1: "LHS – RHS" or "LHS: RHS"
    m = line.match(/^(.{2,60}?)\s*(?:\s[-–—]\s?|[-–—]\s|:\s)\s*(.{2,90})$/);
    if (m) {
      const slot = parseCreditSlot(m[2]);
      if (slot && addCredited(m[1], slot, 'credit')) { creditLineIdx.add(idx); return; }
    }

    // A2: "LHS (instr, instr)" / "LHS [instr]" at line end — LHS may be a name list
    m = line.match(/^(.{2,70}?)\s*[([]([^)\]]{2,70})[)\]]\s*$/);
    if (m) {
      const slot = parseCreditSlot(m[2]);
      if (slot && addCredited(m[1], slot, 'credit-paren')) { creditLineIdx.add(idx); return; }
    }

    // A3: several "Name (instr)" groups inline. Only when the name sits at the
    // start of the line or right after a list separator — otherwise a title in
    // "Kristi G - Community Canvas (installation)" would be mistaken for the act.
    for (const pm of line.matchAll(new RegExp(String.raw`(${CAP_NAME})\s*[([]([^)\]]{2,60})[)\]]`, 'gu'))) {
      const before = line.slice(0, pm.index).replace(/\s+$/, '');
      if (before && !/[,;/&+]$/.test(before)) continue;   // mid-line (e.g. after "Name - ") → skip
      const slot = parseCreditSlot(pm[2]);
      if (slot && isNameShaped(pm[1], { allowSingle: true })) {
        addArtist(pm[1], { instruments: slot.instruments, genres: slot.genres, confidence: 0.95, source: 'credit-inline' });
        creditLineIdx.add(idx);
      }
    }
  });

  // ── Act headers: short non-prose line directly above credit lines → group/act ──
  rawLines.forEach((line, idx) => {
    if (!line || creditLineIdx.has(idx) || isUrlLine(line) || isDateTimeLine(line) || isLogisticsLine(line)) return;
    if (line.split(/\s+/).length > 6 || /[.!?]$/.test(line)) return;
    if (/\s[-–—]\s?/.test(line)) return;   // credit-shaped line whose slot failed to parse — not a band name
    {
      const ws = line.split(/\s+/);
      const caps = ws.filter(w => /^[\p{Lu}]{3,}$/u.test(w.replace(/[^\p{L}]/gu, ''))).length;
      const title = ws.filter(w => /^[\p{Lu}][\p{Ll}]/u.test(w)).length;
      if (caps >= 2 && title >= 1) return;   // "FUTURE NOW Musical Diaries" = event title
    }
    const f = ' ' + fold(line) + ' ';
    if (NON_ACT_MARKERS.some(mk => f.includes(mk))) return;
    // followed (within 3 lines, skipping blanks) by at least one credit line
    let credits = 0;
    for (let j = idx + 1, seen = 0; j < rawLines.length && seen < 4; j++) {
      if (!rawLines[j]) { seen++; continue; }
      seen++;
      if (creditLineIdx.has(j)) credits++;
      else break;
    }
    if (!credits) return;
    let name = clean(stripAsideParens(line.replace(/^(set|part|teil)\s*\d+\s*[:.-]\s*/i, '')));
    if (!name || /\d/.test(name)) return;
    const ch = name.match(/^([^:]{2,50}):\s+.+$/);           // "ULI JENNESSEN: IN THE MAIN" → LHS
    if (ch && isNameShaped(ch[1], { allowSingle: true })) name = clean(ch[1]);
    const segs = name.split(NAME_LIST_SEP).map(clean).filter(x => x && /\p{L}{2}/u.test(x) && !STOP_WORDS.has(fold(x)));
    if (!segs.length) return;
    for (const seg of segs) {
      if (isJunkToken(seg) || seg.split(/\s+/).length > 5) continue;
      // An act/band header is a proper name: capitalized or ALL-CAPS. A line of
      // lowercase common nouns ("flea market table") is a programme item, not an act.
      if (!isNameShaped(seg, { allowSingle: true })) continue;
      addArtist(seg, { confidence: 0.8, source: 'act-header', isGroup: seg.split(/\s+/).length === 1 || seg === seg.toUpperCase() });
    }
  });

  // ── Pass B: prose cues ──
  const prose = rawLines.join('\n');

  for (const m of prose.matchAll(new RegExp(String.raw`\b([\p{L}]+)\s+(${CAP_NAME})`, 'gu'))) {
    const role = fold(m[1]);
    if (ROLE_TO_INSTRUMENT[role]) addArtist(m[2], { instruments: [ROLE_TO_INSTRUMENT[role]], confidence: 0.85, source: 'role-prose' });
    else if (ARTIST_CUES.includes(role)) addArtist(m[2], { confidence: 0.75, source: 'cue-prose' });
  }
  for (const m of prose.matchAll(new RegExp(String.raw`\b(?:the\s+)?([\p{L}-]+)\s+(?:virtuoso|player|master|virtuosin)\s+(${CAP_NAME})`, 'gu'))) {
    const inst = fold(m[1]);
    if (INSTRUMENT_WORDS.has(inst)) addArtist(m[2], { instruments: [inst], confidence: 0.85, source: 'role-prose' });
  }
  // Verb alternation is case-tolerant per-word ("Featuring …" opens many lines);
  // a global /i flag would also case-fold \p{Lu} inside CAP_NAME and wreck the
  // capitalization test, so spell out the initials instead.
  for (const m of prose.matchAll(new RegExp(String.raw`\b(?:[Pp]resents?|[Pp]resenting|[Ww]elcomes?|[Ff]eatures?|[Ff]eaturing|[Ff]eat\.)\s+(?:[\p{Ll}][\p{L}-]*\s+){0,3}((?:${CAP_NAME})(?:\s*(?:,|&|\+|\band\b|\bund\b)\s*(?:${CAP_NAME}))*)`, 'gu'))) {
    for (const seg of m[1].split(NAME_LIST_SEP).map(clean).filter(Boolean)) {
      if (isNameShaped(seg, { allowSingle: false })) addArtist(seg, { confidence: 0.75, source: 'present-prose' });
    }
  }
  // B4: bio-lead — paragraph starts with "Name is/ist/was …" or "Name's work …"
  rawLines.forEach((line, idx) => {
    if (!line || creditLineIdx.has(idx)) return;
    const m = line.match(new RegExp(String.raw`^(${CAP_NAME})(?:['’]s)?\s*(?:\([^)]{0,30}\))?\s+(?:is|are|ist|sind|was|works|work|creates|explores|combines|plays|lives|moves|blends|brings|returns|joins)\b`, 'u'));
    if (m && isNameShaped(m[1], { allowSingle: true })) {
      addArtist(m[1], { confidence: 0.7, source: 'bio-lead' });
    }
  });

  // ── Pass C: headline & roster lines ──
  const anchorSurnames = new Map();
  const rebuildAnchors = () => {
    anchorSurnames.clear();
    for (const a of artists.values()) {
      const parts = fold(a.name).split(' ');
      if (parts.length > 1) anchorSurnames.set(parts[parts.length - 1], a);
    }
  };
  rebuildAnchors();

  const headIdxs = [];
  for (let i = 0; i < Math.min(rawLines.length, 8) && headIdxs.length < 3; i++) {
    const l = rawLines[i];
    if (!l || isUrlLine(l) || isDateTimeLine(l) || isLogisticsLine(l) || creditLineIdx.has(i)) continue;
    headIdxs.push(i);
  }
  rawLines.forEach((l, i) => {
    if (/^(set|part|teil)\s*\d+\s*[:.-]/i.test(l) && !headIdxs.includes(i)) headIdxs.push(i);
    // slash/list rosters anywhere: ≥2 segments, each short & capitalized-ish
    if (!headIdxs.includes(i) && !creditLineIdx.has(i) && l && l.length <= 70 && /[/&+]|,/.test(l)) {
      const segs = l.split(NAME_LIST_SEP).map(clean).filter(Boolean);
      if (segs.length >= 2 && segs.every(s => s.split(/\s+/).length <= 4 && /^[\p{Lu}]/u.test(s))) headIdxs.push(i);
    }
  });

  for (const i of headIdxs) {
    let line = rawLines[i].replace(/^(set|part|teil)\s*\d+\s*[:.-]\s*/i, '');
    line = stripAsideParens(line);
    if (!line) continue;
    const f = ' ' + fold(line) + ' ';
    if (NON_ACT_MARKERS.some(mk => f.includes(mk))) continue;
    if (line.split(/\s+/).length > 10) continue;

    // Mixed ALLCAPS + Titlecase headlines ("FUTURE NOW Musical Diaries") are
    // event titles, not act names.
    {
      const ws = line.split(/\s+/);
      const caps = ws.filter(w => /^[\p{Lu}]{3,}$/u.test(w.replace(/[^\p{L}]/gu, ''))).length;
      const title = ws.filter(w => /^[\p{Lu}][\p{Ll}]/u.test(w)).length;
      if (caps >= 2 && title >= 1) continue;
    }
    const colonHead = line.match(/^([^:]{2,50}):\s+(.+)$/);
    if (colonHead && isNameShaped(colonHead[1], { allowSingle: true })) {
      // "Artist: TITLE" is only trusted when the LHS is corroborated by a
      // credit anchor — otherwise event titles like "Pseudo-Archaeological
      // Translation: The Berlin Case" slip through.
      const lhsF = fold(clean(colonHead[1]));
      const corroborated = artists.has(lhsF)
        || [...artists.keys()].some(k => k.endsWith(' ' + lhsF) || lhsF.endsWith(' ' + k));
      const lhsRaw = clean(colonHead[1]);
      if (corroborated || lhsRaw === lhsRaw.toUpperCase()) line = colonHead[1];
      else continue;
    }

    // trailing instrument words without separator: "Görkem Şen Yaybahar"
    {
      const words = line.split(/\s+/);
      const trailingInstr = [];
      while (words.length > 1 && isInstrumentish(words[words.length - 1])) trailingInstr.unshift(words.pop());
      if (trailingInstr.length && words.length >= 2) {
        const cand = words.join(' ');
        if (isNameShaped(cand, { allowSingle: false })) {
          addArtist(cand, { instruments: trailingInstr.map(normInstrument), confidence: 0.8, source: 'headline-instr' });
          continue;
        }
      }
    }

    const listLine = /^[\p{Lu}\s–—-]+$/u.test(line) ? line.replace(/\s*[–—]\s*/g, ' / ') : line;
    const segs = listLine.split(NAME_LIST_SEP).map(clean).filter(x => x && /\p{L}{2}/u.test(x));
    if (!segs.length) continue;

    // smashed-surname alias: "SALVOJOWETTBANNERBRYANT" — skip if concatenation of anchors
    if (segs.length === 1 && /^[\p{Lu}]{8,}$/u.test(segs[0].replace(/[\s–—-]/g, ''))) {
      const token = fold(segs[0]).replace(/[\s–—-]/g, '');
      const covered = [...anchorSurnames.keys()].filter(s => token.includes(s));
      if (covered.length >= 2 && covered.join('').length >= token.length * 0.6) continue;
    }

    const segResults = segs.map(seg => {
      const fseg = fold(seg);
      if (artists.has(fseg)) return { seg, ok: true, why: 'anchor' };
      const words = fseg.split(' ');
      // "VON SCHLIPPENBACH" or "Schlippenbach" → anchor suffix match
      const suffixAnchor = [...artists.keys()].find(k => k !== fseg && k.endsWith(' ' + fseg));
      if (suffixAnchor) return { seg: artists.get(suffixAnchor).name, ok: true, why: 'suffix-anchor' };
      if (words.length === 1 && anchorSurnames.has(fseg)) return { seg: anchorSurnames.get(fseg).name, ok: true, why: 'surname-anchor' };
      if (isNameShaped(seg, { allowSingle: false })) return { seg, ok: true, why: 'name-shape' };
      if (words.length === 1 && /^[\p{Lu}][\p{L}\p{N}'-]+$/u.test(seg) && segs.length >= 2 && !isJunkToken(seg)) return { seg, ok: true, why: 'single-in-list' };
      if (words.length === 1 && segs.length === 1 && /^[\p{L}\p{N}][\p{L}\p{N}'-]{2,}$/u.test(seg) && !isJunkToken(seg) && !isLogisticsLine(seg)) return { seg, ok: true, why: 'solo-headline', low: true };
      return { seg, ok: false };
    });

    const okCount = segResults.filter(r => r.ok).length;
    if (okCount && okCount >= segResults.length - (segResults.length > 2 ? 1 : 0)) {
      segResults.filter(r => r.ok).forEach(r => addArtist(r.seg, {
        confidence: r.low ? 0.5 : (r.why.includes('anchor') ? 0.9 : 0.7),
        source: 'headline',
      }));
    }
  }

  // ── Merge: surname-only or suffix entries into full names ──
  for (const [key, a] of [...artists.entries()]) {
    const full = [...artists.entries()].find(([k2]) => k2 !== key && k2.length > key.length && k2.endsWith(' ' + key));
    if (full) {
      a.instruments.forEach(i => full[1].instruments.add(i));
      a.genres.forEach(g => full[1].genres.add(g));
      full[1].confidence = Math.max(full[1].confidence, a.confidence);
      artists.delete(key);
    }
  }

  // ── Genres: event-level lexicon scan ──
  const ftext = ' ' + fold(prose).replace(/[^\p{L}& -]/gu, ' ').replace(/\s+/g, ' ') + ' ';
  const genres = [];
  for (const g of GENRES) {
    const gf = fold(g).replace(/[-/]/g, ' ');
    if (ftext.includes(' ' + gf + ' ')) genres.push(g);
  }
  const artistGenres = [...artists.values()].flatMap(a => [...a.genres]);
  const merged = [...new Set([...genres, ...artistGenres])];
  const finalGenres = merged.filter(g => !merged.some(o => o !== g && fold(o).includes(fold(g))));

  return {
    artists: [...artists.values()].map(a => ({
      name: a.name,
      instruments: [...a.instruments],
      genres: [...a.genres],
      confidence: +a.confidence.toFixed(2),
      isGroup: a.isGroup || undefined,
      sources: [...a.sources],
    })),
    genres: finalGenres,
  };
}

// ── Memoized public API ────────────────────────────────────────────────────
const memo = new Map();
function extractEventArtists(infoText) {
  const key = String(infoText);
  if (memo.has(key)) return memo.get(key);
  const result = extractEvent(fixMojibake(key));
  if (memo.size > 300) memo.clear();
  memo.set(key, result);
  return result;
}

root.extractEventArtists = extractEventArtists;
root.fixMojibake = fixMojibake;
root.EXTRACTOR_GENRES = GENRES;
})(typeof self !== 'undefined' ? self : this);
