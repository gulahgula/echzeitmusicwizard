// ── Shared Artist Name Parser ──
// Used by both popup (popup.js) and analysis page (analysis.js)
// Ensures consistent name validation everywhere.

// Connector words that can appear in multi-word names (de/van/von/der etc.)
const CONNECTORS = new Set([
  'de', 'van', 'von', 'der', 'den', 'dem', 'des', 'la', 'le', 'da', 'del',
  'dos', 'du', 'di', 'el', 'las', 'los', 'al', 'il', 'lo', 'gli',
  'mac', 'mc', 'san', 'santa', 'santo',
]);

// Normalize a watched artist name for consistent storage
function normalizeArtistName(name) {
  return name
    .trim()
    .replace(/[:;,.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Check if a word is a known noise word (instrument, descriptor, etc.)
function isNoiseWord(w) {
  const noise = new Set([
    'online','live','solo','duo','trio','quartet','quintet','sextet',
    'quartett','quintett','quartette','quintette',
    'project','ensemble','orchestra','group','band','collective',
    'present','presents','special','guest','guests','featuring',
    'im','am','um','mit','von','und','oder','aber','fur','auf',
    'bei','aus','nach','vor','durch','uber','unter','neben','zwischen',
    'the','a','an','in','on','at','by','to','for','of','is',
    'e.v.','ev','gbr','ug','ltd','inc','gmbh',
    // Instruments and roles
    'piano','guitar','bass','drums','sax','saxophone','trumpet',
    'violin','cello','viola','flute','clarinet','percussion',
    'electronics','synth','synthesizer','voice','vocals','voc',
    'turntables','turntable','keyboard','keys','organ','harp','accordion',
    'trombone','horn','tuba','banjo','mandolin','ukelele',
    'double bass','modular synth','objects','prepared piano',
    'baritone sax','alto sax','tenor sax','soprano sax','bass clarinet',
    'contrabass','field recordings','barockvioline','cembalo','blockflote',
    'recorder','recorders','flutes','clarinets','saxes','strings',
    'daxophone','marimba','vibraphone','glockenspiel','xylophone',
    'bassoon','oboe','english horn','french horn',
    'dr','git','b','p','tb','trp',
    'composition','performance','dance','butoh','action','poetry',
    'movements','sound art','sounddesign','video','visuals','installation',
    'amplifier','konzept','percussions',
    'gitarre','klavier','schlagzeug','saxophon','trompete',
    'posaune','geige','bratsche','flote','klarinetten','violoncello',
    'schlagwerk','bassklarinette','stimme','gesang',
    'mixer','mischpult','effekte','sequenzer','sampler',
    'elektronik','akustik','verstarker','lautsprecher',
    // Descriptive words
    'improvised','experimental','electronic','electronics',
    'concert','concerts','records','record',
    'picnic','series','session','week',
    'music','sound','art','performance','performances',
    'program','programme','lineup',
    'donation','admission','entrance','entry','ticket','tickets',
    'registration','reservation',
    'curation','curated','curators',
    'wheelchair','accessible','accessibility',
    'newsletter','information','info',
    'direction','directions',
    'suggested','sliding',
    'early','final','release',
    'price','prices','preise',
    'hearing','seeing','plus','more',
    'open','start','begin','doors',
    'part','parts','set','sets',
    'presented','funded','supported','organized','sponsored',
    'cooperation','collaboration','association',
    'veranstaltung','zusammenarbeit',
    'rahmen','eintritt','kostenlos',
    'programminitiative','variationen',
    'gefordert','forderung',
    'directions','coordinates',
    'sign','email','contact',
    'admission','donations','suggested',
    'residency','residencies','edition','editions',
    'biennial','festival','summerfest',
    'installation','sound',
    'images','imagining','common','futures',
    'ceramic','objects','prepared',
    'action','poetry','movements','accessibility','barrierfree',
    'sonntage','durchgehend','loop-modus','loop',
    'lange','minuten','prasentation','prasentiert',
    'aufnahme','auffuhrung','stuckes',
    'soprano','nastro','magnetico',
    'workshop','ausstellungseroffnung',
    'eroffnungspanel','podiumsdiskussion',
    'konzert','konzerte','tanz','theater',
    'frei','sharp',
    'trigger','warning','riverbank','box','office',
    'dead','leaf','butterfly',
    'invisible','thread','drone','triloka','immersive',
    'ambient','journey','massive','schrage',
    'helicopter','palace','future','now','musical','diaries',
    'absolute','sweet','mary','zustand',
    'berlin','saxofon','dirigentin','keyboardpunk',
    'new','zealand','surprise','klavierstucke',
    'scubert','four',
    'blockflote','flote','lange','gefordert','forderung','schrage',
    'eroffnungspanel','klavierstucke','prasentation','prasentiert',
    'stuckes','ausstellungseroffnung','walden',
    'butoh','dance','act','grunge','singer','songwriter',
    'palace','nahmaschine',
    'quintett','quartett','duo','solo',
    'monitor','kopfhorer','mikrofon','kabel','pedal','effector',
  ]);
  const n = w.toLowerCase()
    .replace(/ö/g,'o').replace(/ü/g,'u').replace(/ä/g,'a')
    .replace(/é/g,'e').replace(/è/g,'e').replace(/ê/g,'e')
    .replace(/à/g,'a').replace(/â/g,'a').replace(/î/g,'i').replace(/ô/g,'o')
    .replace(/ù/g,'u').replace(/û/g,'u').replace(/ç/g,'c').replace(/ñ/g,'n')
    .replace(/ş/g,'s').replace(/ı/g,'i').replace(/ğ/g,'g')
    .replace(/[^a-z]/g,'');
  return noise.has(n);
}

// Validate whether a string looks like a person name
function looksLikePersonName(s) {
  const trimmed = s.trim().replace(/[:;,.\s]+$/, '');
  if (trimmed.length < 3) return false;
  if (!/[A-Za-z\u00C0-\u024F]/.test(trimmed)) return false;
  if (!/^[A-Z\u00C0-\u024F]/.test(trimmed)) return false;
  if (/[/]/.test(trimmed)) return false;
  if (/ [-–—>|]/.test(trimmed)) return false;
  if ((trimmed.match(/\./g) || []).length >= 3) return false;

  const words = trimmed.split(/\s+/);

  if (words.length === 1) {
    if (trimmed.length < 4) return false;
    if (trimmed === trimmed.toUpperCase()) return false;
    return !isNoiseWord(trimmed);
  }

  if (/\d/.test(trimmed)) return false;

  const capped = words.filter(w => /^[A-Z\u00C0-\u024F]/.test(w));
  if (capped.length < 2) return false;

  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z\u00C0-\u024F]/g, '');
    if (clean.length > 0 && clean === clean.toLowerCase() && !CONNECTORS.has(clean)) {
      if (/^[a-z]\./i.test(w)) continue;
      return false;
    }
  }

  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z\u00C0-\u024F]/g, '');
    if (clean.length > 0 && isNoiseWord(clean)) return false;
  }

  const eventMarkers = ['of','in','at','for','zu','am','im','aus'];
  if (words.length >= 3) {
    const middle = words.slice(1, -1);
    for (const w of middle) {
      if (eventMarkers.includes(w.toLowerCase()) && w.toLowerCase() === w) return false;
    }
  }

  if (trimmed === trimmed.toUpperCase()) {
    if (trimmed.length > 10 && !trimmed.includes('&')) return false;
  }

  return true;
}

// Extract person names from inside parentheses, split by & , ;
// e.g. "Project (Antti Virtaranta & Rieko Okuda)" → ["Antti Virtaranta", "Rieko Okuda"]
function extractNamesFromParens(line) {
  const results = [];
  const regex = /\(([^)]+)\)/g;
  let m;
  while ((m = regex.exec(line)) !== null) {
    const inner = m[1];
    const parts = inner.split(/[&,;]\s*/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (looksLikePersonName(trimmed)) results.push(trimmed);
    }
  }
  return results.length > 0 ? results : null;
}

function parseEventDateTime(dateStr, time) {
  const parts = dateStr.replace(/\.\s*/g, '.').split('.').filter(Boolean);
  if (parts.length < 3) return null;
  const [day, month, year] = parts;
  const [hour, minute] = time.split('.').map(s => parseInt(s, 10));
  const fullYear = year.length === 2 ? 2000 + parseInt(year) : parseInt(year);
  return new Date(fullYear, parseInt(month) - 1, parseInt(day), hour || 0, minute || 0);
}

function downloadICS(event) {
  const [day, month, year] = event.dateStr.replace(/\.\s*/g, '.').split('.').filter(Boolean);
  const [hour, minute] = event.time.split('.');
  const fullYear = year.length === 2 ? '20' + year : year;
  const dtStart = `${fullYear}${month.padStart(2,'0')}${day.padStart(2,'0')}T${hour.padStart(2,'0')}${minute.padStart(2,'0')}00`;
  const endH = String(parseInt(hour) + 2).padStart(2, '0');
  const dtEnd = `${fullYear}${month.padStart(2,'0')}${day.padStart(2,'0')}T${endH}${minute.padStart(2,'0')}00`;
  const ics = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//echtzeitmusik-extension//EN',
    'BEGIN:VEVENT',`DTSTART:${dtStart}`,`DTEND:${dtEnd}`,
    `SUMMARY:${event.venueName}`,`LOCATION:${event.address}`,
    'END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `echtzeitmusik-${event.dateStr.replace(/\.\s*/g, '')}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}