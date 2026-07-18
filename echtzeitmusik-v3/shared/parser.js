// ─────────────────────────────────────────────────────────────────────────
//  echtzeitmusik · parser (logic only)
//  Word lists live in dictionaries.js (CONNECTORS, NOISE_WORDS, GENRE_SET,
//  INSTRUMENT_SET, EXTRA_KW_SET, INSTRUMENT_ABBREV, VENUE_WORDS,
//  foldDiacritics) — load it first. Artist/instrument/genre extraction is
//  delegated to the structure-first engine in extractor.js (load it before
//  this file too).
// ─────────────────────────────────────────────────────────────────────────

// Normalize year to 4-digit: "26" -> "2026", "2026" -> "2026", "99" -> "1999"
function normalizeYear(year) {
  const digits = String(year).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 4) return digits;
  if (digits.length === 2) {
    const n = parseInt(digits, 10);
    return n >= 50 ? `19${digits}` : `20${digits}`;
  }
  return digits.padStart(4, '0');
}

// Build a consistent DD.MM.YYYY date string from day, month, year parts
function buildDateStr(day, month, year) {
  const d = String(day).padStart(2, '0');
  const m = String(month).padStart(2, '0');
  const y = normalizeYear(year);
  return `${d}.${m}.${y}`;
}

// Normalize a watched artist name for consistent storage
function normalizeArtistName(name) {
  return name
    .trim()
    .replace(/[:;,.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i');  // Turkish dotless ı → i
}

// Check if a word is a known noise word (instrument, descriptor, etc.)
// Word list lives in NOISE_WORDS (dictionaries.js). We fold the input to plain
// ASCII and strip non-letters so accented/umlaut variants still match.
function isNoiseWord(w) {
  const n = foldDiacritics(w).replace(/[^a-z]/g, '');
  return NOISE_WORDS.has(n);
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

  // Single word names - only allow if it's a known artist mononym (rare) or looks like a surname
  // For safety, require at least 2 words for person names
  if (words.length === 1) {
    if (trimmed.length < 5) return false;  // Require at least 5 chars for mononyms
    if (trimmed === trimmed.toUpperCase()) return false;
    if (isNoiseWord(trimmed)) return false;
    // Reject common German nouns that look like names but aren't
    const commonGermanNouns = new Set([
      'kultur','kunst','musik','modus','sounds','capriccio','experimentik',
      'facebook','youtube','instagram','website','webseite','homepage',
      'programm','program','ablauf','reihenfolge','folge','teil','parts',
      'start','beginn','ende','pause','schluss','finale','intro','outro',
      'klang','sound','klange','gerausch','ton','lange','laenge','stueck',
      'zusammenhalt','sozial','community','preisverleihung','jazzpreis',
      'eintritt','frei','kostenlos','spendenbasis','donation','hutkasse',
      'kasse','karten','tickets','ticket','vorverkauf','vvk','ak','abendkasse',
      'vorverkaufsstellen','reservierung','reservation','anmeldung','registration',
      'kulturamt','kulturbuero','veranstalter','organizer','foerderer','sponsor',
      'gefördert von','gefoerdert von','supported by','presented by','in kooperation',
      'in zusammenarbeit','kooperation','collaboration','kuratiert','curated by',
      'curation','curation:','veranstaltung','event','reihe','series','season',
      'spielzeit','saison','jubiläum','jubiläums','anniversary',
      'special','special guest','special guests','gast','gaeste','guests',
      'featuring','feat.','feat','with','mit','und','plus','&','+',
      'soundcheck','sound check','line check','linecheck','aufbau','abbau',
      'technik','technician','tontechnik','light','licht','video','projektion',
      'stream','streaming','live stream','livestream','online','digital',
      'hybrid','on site','on-site','vor ort','vor-ort',
      'montag','dienstag','mittwoch','donnerstag','freitag','samstag','sonntag',
      'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
      'heute','morgen','gestern','uebermorgen','heute abend','morgen abend',
      'uhr','time','zeit','datum','date','tag','wooche','woche','monat','jahr',
      'regie','sopran','soprano','alt','tenor','bass','bariton',
      'mezzo','countertenor','dirigent','conductor','leitung','director',
      'dj','contagious','imperfect','butoh','dead','leaf','butterfly','intense',
      'palace','helicopter','immersive','triloka','bueningen','klappstuhl',
      'tag','offenen','tur','langenacht','nacht','jazzfest','jazznacht',
      'tanztheater','elektronische','initiativkreis','talks','audiovisionen',
      'india','europa','performance','syrian','soli','kufa','einlass',
      'admission','entrance','doors','kasse','opener','band','inside',
      'access','via','restaurant','mokja','floating','university','ohrenhoch',
      'silent','green','kuppelhalle','betonhalle','kulturraum','zwinglikirche',
      'studio','uferstudios','villa','kuriosum','tropez','sommerbad','humboldthain',
      'neue','zukunft','galiläakirche','galilaakirche','genezarethkirche',
      'sankt','hedwigs','kathedrale','konzerthaus','berlin','akademieder',
      'künste','kunsite','kunste','radialsystem','exploratoriumberlin',
      'alter','schwede','schwedes','social','club','kühlspot','kuehlspot',
      'hosek','art','galerie','raum','halle','bühne','buehne','theater',
      'kirche','klub','cafe','bar','shop','keller','dach','hof','garten',
      'park','strasse','platz','weg','ufer','insel','bruecke','tor','haus',
      'bau','werk','schloss','burg','turm','mauer','feld','wald','see','fluss',
      'berg','tal','dorf','stadt','land','markt','rathaus','schule','klinik',
      'bahnhof','flughafen','hafen','stadion','arena','museum','bibliothek',
      'universitat','institut','labor','zentrum','forum','kultur','musik',
      'tanz','oper','ballett','konzert','festival','woche','tage','nacht',
      'abend','morgen','mittag','vormittag','nachmittag','frueh','spaet'
    ]);
    if (commonGermanNouns.has(trimmed.toLowerCase())) return false;
    return !isNoiseWord(trimmed);
  }

  // Must have at least 2 words that look like proper names (capitalized)
  if (/\d/.test(trimmed)) return false;

  const capped = words.filter(w => /^[A-Z\u00C0-\u024F]/.test(w));
  if (capped.length < 2) return false;

  // Check each word: lowercase words must be connectors (van, de, von, etc.)
  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z\u00C0-\u024F]/g, '');
    if (clean.length > 0 && clean === clean.toLowerCase() && !CONNECTORS.has(clean)) {
      if (/^[a-z]\./i.test(w)) continue;
      return false;
    }
  }

  // Check for noise words anywhere in the name
  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z\u00C0-\u024F]/g, '');
    if (clean.length > 0 && isNoiseWord(clean)) return false;
  }

  // Filter out event/location markers in middle positions
  const eventMarkers = ['zu','am','im','aus'];
  const weakLocationMarkers = ['of','in','at','for','by','to','the','a','an','on'];
  if (words.length >= 3) {
    const middle = words.slice(1, -1);
    for (const w of middle) {
      const lower = w.toLowerCase();
      if ((eventMarkers.includes(lower) || weakLocationMarkers.includes(lower)) && lower === w) return false;
    }
  }

  // Reject all-caps names that are too long (likely project/band titles)
  if (trimmed === trimmed.toUpperCase()) {
    if (trimmed.length > 20 && !trimmed.includes('&')) return false;
  }

// NEW: Must look like a Western person name pattern (Firstname Lastname...)
  // At least first and last word should be capitalized and not all-lowercase
  // Allow hyphens in names (e.g., "Han-earl", "Jean-Pierre")
  // Allow "Mc/Mac" prefixes with internal capitals (e.g., "McVinnie", "MacArthur")
  const first = words[0];
  const last = words[words.length - 1];
  // Allow capitalized parts separated by hyphens, and Mc/Mac prefixes with internal capitals
  const namePartRegex = /^[A-Z\u00C0-\u024F][a-z\u00C0-\u024F']*(?:-[A-Za-z\u00C0-\u024F][a-z\u00C0-\u024F']*)*$/;
  const mcPrefixRegex = /^(?:Mc|Mac)[A-Z\u00C0-\u024F][a-z\u00C0-\u024F']+$/i;
  const allCapsRegex = /^[A-Z]{3,}$/;
  const validNamePart = (part) => namePartRegex.test(part) || mcPrefixRegex.test(part) || allCapsRegex.test(part);
  
  if (!validNamePart(first)) return false;
  if (!validNamePart(last)) return false;

  // Middle words (if any) should be either capitalized or connectors
  for (let i = 1; i < words.length - 1; i++) {
    const w = words[i];
    if (!validNamePart(w) && !CONNECTORS.has(w.toLowerCase())) {
      return false;
    }
  }

  return true;
}


// Detect free-admission events. Matches the common German/English phrasings on
// echtzeitmusik ("Eintritt frei", "freier Eintritt", "free entry", "no entry
// fee") while avoiding "Eintritt: 10€" style priced lines and the word "frei"
// inside unrelated compounds.
function detectFreeEntry(text) {
  const f = ' ' + foldDiacritics(String(text || '')).replace(/\s+/g, ' ') + ' ';
  if (/\beintritt frei\b|\bfreier eintritt\b|\beintritt ist frei\b|\bfree entry\b|\bfree admission\b|\badmission free\b|\bfree of charge\b|\bno entry fee\b|\bkostenlos(?:er)? eintritt\b|\beintritt kostenlos\b/.test(f)) return true;
  return false;
}

// Pattern-based junk detector for catalogue hygiene. Replaces the old
// enumerate-the-world NON_ARTIST_NAMES list: instead of listing every city and
// university, flag entries whose NAME ITSELF carries institutional/venue/
// logistics markers. Used to purge legacy catalogue entries collected by the
// pre-v3 parser.
function looksLikeNonArtist(name) {
  const f = ' ' + foldDiacritics(String(name || '')) + ' ';
  if (f.trim().length < 2) return true;
  const MARKERS = [
    'university', 'universitat', 'universiteit', 'universite', 'hochschule',
    'kirche', 'kathedrale', 'akademie', 'institut', 'museum', 'galerie', 'studio ',
    'festival', 'konzert', 'concert', 'jazzclub', ' club', 'theater', 'buhne',
    'eintritt', 'tickets', 'vorverkauf', 'abendkasse', 'admission', 'donation',
    'workshop', 'vernissage', 'ausstellung', 'exhibition', 'gottesdienst',
    'bezirksamt', 'rathaus', 'kulturamt', 'senat', ' e.v', ' gmbh', ' records',
    'open air', 'openair', 'soundcheck', 'einlass', 'doors', 'newsletter',
    'flea market', 'flohmarkt', 'market table', 'food', 'drinks', 'bar ',
    // series-title tails observed in the wild ("Frictive Frequencies",
    // "FUTURE NOW Musical Diaries") — clean these out of legacy catalogues
    'frequencies', 'diaries', 'sessions', 'broadcasts', 'chronicles',
  ];
  if (MARKERS.some(m => f.includes(m))) return true;
  if (/^[\d\s.:-]+$/.test(String(name))) return true;
  return false;
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

// Extract URLs from text (bandcamp, soundcloud, website links)
function extractUrls(text) {
  if (!text) return [];
  const urls = [];
  // Match bandcamp, soundcloud, and other music-related URLs
  const urlRegex = /(https?:\/\/[^\s)>\]]+(?:bandcamp|soundcloud|youtube|spotify|vimeo|myspace|myspace|instagram|facebook|twitter|x\.com|music\.apple|soundcloud|mixcloud|reverbnation|hearthis|bandcamp)[^\s)>\]]*)/gi;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    urls.push(match[1]);
  }
  // Also catch generic http/https URLs in parentheses
  const parenUrlRegex = /\((https?:\/\/[^)\s]+)\)/g;
  while ((match = parenUrlRegex.exec(text)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function parseEventDateTime(dateStr, time) {
  const parts = dateStr.replace(/\.\s*/g, '.').split('.').filter(Boolean);
  if (parts.length < 3) return null;
  const [day, month, year] = parts;
  const [hour, minute] = time.split('.').map(s => parseInt(s, 10));
  const fullYear = parseInt(normalizeYear(year), 10);
  return new Date(fullYear, parseInt(month) - 1, parseInt(day), hour || 0, minute || 0);
}

function downloadICS(event) {
  if (typeof document === 'undefined') return;
  const [day, month, year] = event.dateStr.replace(/\.\s*/g, '.').split('.').filter(Boolean);
  const [hour, minute] = event.time.split('.');
  const fullYear = normalizeYear(year);
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
// Render untrusted HTML (fetched from echtzeitmusik.de) into `target`,
// keeping only harmless formatting tags and http(s) links.
function renderSanitizedHtml(target, html) {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') return;
  const ALLOWED = new Set(['BR', 'B', 'I', 'EM', 'STRONG', 'U', 'P', 'SPAN', 'A']);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Turn bare URLs inside text nodes into clickable links.
  const appendLinkified = (dst, text) => {
    const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;
    let last = 0, m;
    while ((m = URL_RE.exec(text)) !== null) {
      if (m.index > last) dst.appendChild(document.createTextNode(text.slice(last, m.index)));
      const raw = m[0].replace(/[.,;:)\]]+$/, '');   // strip trailing punctuation
      const a = document.createElement('a');
      a.setAttribute('href', raw.startsWith('http') ? raw : 'https://' + raw);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.textContent = raw;
      dst.appendChild(a);
      last = m.index + raw.length;
    }
    if (last < text.length) dst.appendChild(document.createTextNode(text.slice(last)));
  };
  (function walk(src, dst) {
    for (const node of src.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (dst.tagName === 'A') dst.appendChild(document.createTextNode(node.nodeValue));
        else appendLinkified(dst, node.nodeValue);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (ALLOWED.has(node.tagName)) {
          const el = document.createElement(node.tagName.toLowerCase());
          if (node.tagName === 'A') {
            let href = node.getAttribute('href') || '';
            if (href.startsWith('/')) href = 'https://echtzeitmusik.de' + href;
            if (/^https?:\/\//i.test(href)) {
              el.setAttribute('href', href);
              el.setAttribute('target', '_blank');
              el.setAttribute('rel', 'noopener noreferrer');
            }
          }
          dst.appendChild(el);
          walk(node, el);
        } else {
          walk(node, dst); // drop the tag, keep its text content
        }
      }
    }
  })(doc.body, target);
}

// Word-boundary artist match (accent-insensitive) — avoids "Anna" matching "Annabelle"
function matchesArtist(infoText, artistName) {
  const strip = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const name = strip(artistName).trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(strip(infoText));
}

// When both a surname ("Schwarz") and a full name ("Ulrike Schwarz") exist,
// drop the surname-only entry so only the full name is kept.
function collapseSurnameOnly(names) {
  const result = new Set(names);
  const single = [...result].filter(n => !n.includes(' '));
  const multi = [...result].filter(n => n.includes(' '));
  for (const surname of single) {
    const low = surname.toLowerCase();
    if (multi.some(full => full.toLowerCase().endsWith(' ' + low))) {
      result.delete(surname);
    }
  }
  return [...result];
}

// Human-readable lead time, e.g. "1 hour", "3 days"
function formatLead(diffMs) {
  const hours = Math.max(1, Math.round(diffMs / 3600000));
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// Dictionaries GENRE_SET, INSTRUMENT_SET, EXTRA_KW_SET live in dictionaries.js

// Normalize a date string from "DD. MM. YY" to "YYYY-MM-DD"
function catNormalizeDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.replace(/\.\s*/g, '.').split('.').filter(Boolean);
  if (parts.length < 3) return dateStr;
  const [day, month, year] = parts;
  const fullYear = normalizeYear(year);
  return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function fixVenueSpacing(name) {
  if (!name) return name;
  let fixed = name.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Insert spaces before common German articles/prepositions only when preceded by 4+ letters
  // (avoids splitting words like "Akademie" where "dem" appears as a substring)
  fixed = fixed.replace(/([a-zäöüàâéèêîôùûçşığ]{4,})(der|die|das|und|von|zum|zur|über|unter|zwischen)/gi, '$1 $2');
  fixed = fixed.replace(/([a-zäöüàâéèêîôùûçşığ0-9])([A-ZÄÖÜÀÂÉÈÊÎÔÙÛÇŞİĞ])/g, '$1 $2');
  for (const word of VENUE_WORDS) {
    const regex = new RegExp(`([a-zäöüàâéèêîôùûçşığ])(${word})`, 'g');
    fixed = fixed.replace(regex, '$1 $2');
  }
  return fixed;
}

// ── Extraction adapters ────────────────────────────────────────────────────
// The extraction engine lives in shared/extractor.js (structure-first,
// benchmarked). These wrappers keep the long-standing call signatures used by
// popup.js, analysis.js, data-analysis and the background worker.

// All performing artists of the event, grouped into performance blocks.
// Set/Part markers split blocks; otherwise one block for the whole event.
function extractPerformanceBlocks(infoText) {
  if (!infoText) return [];
  const segments = infoText.split(/^\s*-?(?:set|part|teil)\s*\d+\s*[:.\-]?\s*$/gim);
  const blocks = [];
  const source = segments.length > 1 ? segments : [infoText];
  for (const seg of source) {
    if (!seg || !seg.trim()) continue;
    const names = extractEventArtists(seg).artists.map(a => a.name);
    if (names.length) blocks.push(names);
  }
  if (!blocks.length) {
    const names = extractEventArtists(infoText).artists.map(a => a.name);
    if (names.length) blocks.push(names);
  }
  return blocks;
}

// Instruments credited to one artist within the event text.
function catExtractInstruments(artistName, infoText) {
  if (!infoText || !artistName) return [];
  const want = foldDiacritics(artistName);
  const wantLast = want.split(' ').pop();
  const { artists } = extractEventArtists(infoText);
  const hit = artists.find(a => foldDiacritics(a.name) === want)
    || artists.find(a => foldDiacritics(a.name).split(' ').pop() === wantLast && wantLast.length >= 4);
  return hit ? [...hit.instruments] : [];
}

// Genres — artist-scoped when artistName is given (falling back to
// event-level), event-level otherwise.
function extractGenres(infoText, artistName) {
  if (!infoText) return [];
  const result = extractEventArtists(infoText);
  if (artistName) {
    const want = foldDiacritics(artistName);
    const hit = result.artists.find(a => foldDiacritics(a.name) === want);
    if (hit && hit.genres.length) return [...hit.genres];
    // Fall back to event-level genres only for small (≤2 artist) events —
    // in festival listings one act's genre must not bleed onto every artist.
    return result.artists.length <= 2 ? [...result.genres] : [];
  }
  return [...result.genres];
}

function expandInstrumentAbbreviations(instruments) {
  // Abbreviation table lives in INSTRUMENT_ABBREV (dictionaries.js).
  return instruments.map(inst => {
    const lower = inst.toLowerCase().trim();
    return INSTRUMENT_ABBREV[lower] || inst;
  });
}

// Expand a single instrument name using the abbreviation map
function expandSingleInstrument(name) {
  if (!name) return name;
  return expandInstrumentAbbreviations([name])[0];
}


function extractArtistLinks(html, text) {
  const combined = {};

  if (!html) return combined;
  if (typeof DOMParser === 'undefined') return combined;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const excludeDomains = ['facebook.com', 'google.com/maps', 'echtzeitmusik.de'];

  doc.querySelectorAll('a[href^="http"]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (!href || excludeDomains.some(d => href.includes(d))) return;

    const type = href.includes('bandcamp.com') ? 'bandcamp'
      : href.includes('soundcloud.com') ? 'soundcloud'
      : href.includes('youtube.com') || href.includes('youtu.be') ? 'youtube'
      : href.includes('spotify.com') ? 'spotify'
      : 'website';

    // Try to extract artist name from bandcamp URL (artistname.bandcamp.com)
    let urlArtistName = '';
    if (type === 'bandcamp') {
      const bcMatch = href.match(/https?:\/\/([^.]+)\.bandcamp\.com/);
      if (bcMatch) urlArtistName = bcMatch[1].replace(/-/g, ' ');
    } else if (type === 'soundcloud') {
      const scMatch = href.match(/soundcloud\.com\/([^.\/]+)/);
      if (scMatch) urlArtistName = scMatch[1].replace(/-/g, ' ');
    }

    // Try to match this link to an artist name by checking nearby text
    const linkText = a.textContent.trim().toLowerCase();
    let matchedName = null;

    // First: try to match by URL-derived artist name against text lines
    if (urlArtistName) {
      const urlNameLower = urlArtistName.toLowerCase();
      for (const line of text.split('\n')) {
        const m = line.match(/^(.+?)\s*[-–—:]\s*(.+)$/);
        if (!m) continue;
        const name = m[1].trim();
        if (name.toLowerCase().includes(urlNameLower) || urlNameLower.includes(name.toLowerCase())) {
          matchedName = name;
          break;
        }
      }
    }

    // Second: try to match by link text against text lines
    if (!matchedName) {
      for (const line of text.split('\n')) {
        const m = line.match(/^(.+?)\s*[-–—:]\s*(.+)$/);
        if (!m) continue;
        const name = m[1].trim();
        const clean = line.toLowerCase();
        if (clean.includes(linkText) || linkText.includes(clean.split(/[-–—:]/)[0].trim())) {
          matchedName = name;
          break;
        }
      }
    }

    // Third: for platform links with no text match, use URL-derived name
    if (!matchedName && urlArtistName && type !== 'website') {
      // Capitalize words for display
      matchedName = urlArtistName.replace(/\b\w/g, c => c.toUpperCase());
    }

    if (!matchedName) matchedName = linkText || type;

    if (!combined[matchedName]) combined[matchedName] = { bandcamp: '', soundcloud: '', youtube: '', spotify: '', website: '' };
    if (!combined[matchedName][type] || combined[matchedName][type].includes('/search')) {
      combined[matchedName][type] = href;
    }
  });

  const textLinks = extractLinksFromText(text);
  for (const [name, url] of Object.entries(textLinks)) {
    const type = url.includes('bandcamp.com') ? 'bandcamp'
      : url.includes('soundcloud.com') ? 'soundcloud'
      : url.includes('youtube.com') || url.includes('youtu.be') ? 'youtube'
      : url.includes('spotify.com') ? 'spotify'
      : 'website';
    if (!combined[name]) combined[name] = { bandcamp: '', soundcloud: '', youtube: '', spotify: '', website: '' };
    if (!combined[name][type]) combined[name][type] = url;
  }

  return combined;
}

// Extract URLs from plain text and match to nearby artist names
// Extract URLs from plain text and match to nearby artist names
function extractLinksFromText(text) {
  const links = {};
  if (!text) return links;

  // Find all URLs in text
  const urlRegex = /(https?:\/\/[^\s)>\]]+(?:bandcamp|soundcloud|youtube|spotify|vimeo|myspace|instagram|facebook|twitter|x\.com|music\.apple|mixcloud|reverbnation|hearthis|bandcamp)[^\s)>\]]*)/gi;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[1];
    // Find the nearest artist name before this URL
    const beforeUrl = text.substring(0, match.index);
    const lines = beforeUrl.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const nameMatch = line.match(/^(.+?)\s*[-–—:]\s*(.+)$/);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        if (looksLikePersonName(name)) {
          links[name] = url;
          break;
        }
      }
    }
  }
  return links;
}
function createMusicSearchLinks(artistName, artistLinks = {}) {
  if (typeof document === 'undefined') return null;
  const name = encodeURIComponent(artistName);
  const listenUrl = artistLinks.bandcamp || artistLinks.soundcloud || artistLinks.youtube || artistLinks.spotify || `https://bandcamp.com/search?q=${name}&item_type=a`;
  const profileUrl = artistLinks.website || `https://www.google.com/search?q=${name}+musician`;
  const platforms = [
    ['bandcamp', artistLinks.bandcamp || `https://bandcamp.com/search?q=${name}&item_type=a`, 'Bandcamp'],
    ['soundcloud', artistLinks.soundcloud || `https://soundcloud.com/search?q=${name}`, 'SoundCloud'],
    ['youtube', artistLinks.youtube || `https://www.youtube.com/results?search_query=${name}`, 'YouTube'],
  ];

  const container = document.createElement('span');
  container.className = 'artist-actions';
  const makeLink = (href, className, title) => {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = className;
    link.title = title;
    return link;
  };
  container.appendChild(makeLink(listenUrl, 'artist-listen', artistLinks.bandcamp || artistLinks.soundcloud || artistLinks.youtube || artistLinks.spotify ? 'Open artist link from the programme' : 'Search Bandcamp'));
  container.appendChild(makeLink(profileUrl, 'artist-about', artistLinks.website ? 'Open artist website' : 'Search artist information'));
  const platformSet = document.createElement('span');
  platformSet.className = 'artist-platforms';
  platforms.forEach(([id, href, title]) => {
    const link = makeLink(href, 'artist-platform', title);
    link.dataset.platform = id;
    platformSet.appendChild(link);
  });
  container.appendChild(platformSet);
  return container;
}

// Escape for BOTH element-content and attribute contexts. The old
// textContent→innerHTML trick escaped only & < > (never quotes), so any
// `attr="${escapeHtml(value)}"` sink could be broken out of by a site-derived
// value containing a double quote. Escape all five, as a pure string op so it
// also works in the service-worker scope (where `document` is undefined and the
// old guard silently returned the input UNescaped).
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeUrl(href) {
  if (href.startsWith('/')) return 'https://echtzeitmusik.de' + href;
  if (!href.startsWith('http')) return 'https://' + href;
  return href;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
