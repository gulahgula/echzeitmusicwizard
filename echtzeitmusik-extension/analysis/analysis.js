document.addEventListener('DOMContentLoaded', () => {
  const filterButtons = document.querySelectorAll('.filter-bar button');
  const loading = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const main = document.querySelector('main');
  const artistList = document.getElementById('artist-list');
  const artistFilter = document.getElementById('artist-filter');
  const overviewText = document.getElementById('overview-text');
  const kwContainer = document.getElementById('kw-container');
  const followList = document.getElementById('follow-list');
  const followCount = document.getElementById('follow-count');

  // Response cache (5 min TTL)
  const responseCache = {};

  function getCached(url) {
    const entry = responseCache[url];
    if (entry && Date.now() - entry.time < 5 * 60 * 1000) return entry.data;
    return null;
  }

  function setCache(url, data) {
    responseCache[url] = { data, time: Date.now() };
  }

  // Collapsible following section
  document.getElementById('following-header').addEventListener('click', () => {
    const header = document.getElementById('following-header');
    const content = document.getElementById('following-content');
    header.classList.toggle('collapsed');
    content.classList.toggle('collapsed');
  });

  let events = [];
  let artistMap = {};
  let fullArtistMap = {};
  let watchedArtists = [];
  let currentFilter = 'month';
  let keywordFilter = null;
  let expandedArtist = null;
  let calDate = new Date();
  

  chrome.storage.local.get(['watchedArtists'], (result) => {
    watchedArtists = [...new Set((result.watchedArtists || []).map(n => normalizeArtistName(n)))];
    if (watchedArtists.join(',') !== (result.watchedArtists || []).join(',')) {
      chrome.storage.local.set({ watchedArtists });
    }
    renderArtistTable();
    renderFollowing();
    if (currentFilter === 'calendar') renderCalendar();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.watchedArtists) {
      watchedArtists = changes.watchedArtists.newValue || [];
      renderFollowing();
      if (currentFilter === 'calendar') renderCalendar();
    }
  });

  function parseEventDateTime(dateStr, time) {
    const parts = dateStr.replace(/\.\s*/g, '.').split('.').filter(Boolean);
    if (parts.length < 3) return null;
    const [day, month, year] = parts;
    const [hour, minute] = time.split('.').map(s => parseInt(s, 10));
    const fullYear = year.length === 2 ? 2000 + parseInt(year) : parseInt(year);
    return new Date(fullYear, parseInt(month) - 1, parseInt(day), hour || 0, minute || 0);
  }

  function renderFollowing() {
    followCount.textContent = `(${watchedArtists.length})`;
    if (watchedArtists.length === 0) {
      followList.innerHTML = '';
      document.getElementById('no-follows').classList.remove('hidden');
      return;
    }
    document.getElementById('no-follows').classList.add('hidden');

    followList.innerHTML = watchedArtists.map(name => {
      const data = artistMap[name];
      const nextEv = data ? data.events[0] : null;
      const nextInfo = nextEv ? `${nextEv.dateStr} ${nextEv.time} · ${nextEv.venueName}` : 'No upcoming concerts found';
      return `<div class="follow-row">
        <div>
          <div class="follow-name">${escapeHtml(name)}</div>
          <div class="follow-meta">${escapeHtml(nextInfo)}</div>
        </div>
        <span class="follow-toggle followed" data-artist="${escapeHtml(name)}">✓ Following</span>
      </div>`;
    }).join('');

    followList.querySelectorAll('.follow-toggle').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const name = el.dataset.artist;
        watchedArtists = watchedArtists.filter(a => a !== name);
        chrome.storage.local.set({ watchedArtists });
        renderFollowing();
        renderArtistTable();
      });
    });
  }

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      loadAndAnalyze(currentFilter);
    });
  });

  artistFilter.addEventListener('input', () => renderArtistTable());

  document.getElementById('export-data').addEventListener('click', e => {
    e.preventDefault();
    exportAnalysisData();
  });

  document.getElementById('open-about').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('about/about.html') });
  });

  async function loadAndAnalyze(filter) {
    loading.classList.remove('hidden');
    errorEl.classList.add('hidden');
    main.classList.add('hidden');
    document.getElementById('top-artists').classList.remove('hidden');
    expandedArtist = null;

    const isCalendar = filter === 'calendar';
    const isFollowing = filter === 'following';
    const fetchFilter = (isFollowing || isCalendar) ? 'all' : filter;
    const url = `https://echtzeitmusik.de/index.php?page=calendar&filter=${fetchFilter}`;

    try {
      let html = getCached(url);
      if (!html) {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const dec = new TextDecoder('iso-8859-1');
        html = dec.decode(buf);
        setCache(url, html);
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const allParseEvents = parseEvents(doc);

      if (isCalendar) {
        renderCalendar();
        main.classList.remove('hidden');
        return;
      }

      if (isFollowing && watchedArtists.length > 0) {
        events = allParseEvents.filter(ev =>
          watchedArtists.some(a => ev.infoText.toLowerCase().includes(a.trim().toLowerCase()))
        );
        artistMap = buildArtistMap(events);
        const filteredMap = {};
        watchedArtists.forEach(name => {
          if (artistMap[name]) filteredMap[name] = artistMap[name];
        });
        artistMap = filteredMap;
      } else if (isFollowing) {
        events = [];
        artistMap = {};
      } else {
        events = allParseEvents;
        artistMap = buildArtistMap(allParseEvents);
      }

      // Build full artist map for detail view (all upcoming events)
      if (isCalendar) {
        fullArtistMap = {};
      } else if (fetchFilter === 'all') {
        fullArtistMap = buildArtistMap(allParseEvents);
      } else {
        try {
          const fullUrl = `https://echtzeitmusik.de/index.php?page=calendar&filter=all`;
          let fullHtml = getCached(fullUrl);
          if (!fullHtml) {
            const res = await fetch(fullUrl);
            const buf = await res.arrayBuffer();
            const dec = new TextDecoder('iso-8859-1');
            fullHtml = dec.decode(buf);
            setCache(fullUrl, fullHtml);
          }
          const fullDoc = new DOMParser().parseFromString(fullHtml, 'text/html');
          fullArtistMap = buildArtistMap(parseEvents(fullDoc));
        } catch (e) {
          fullArtistMap = {};
        }
      }

      renderOverview(events, artistMap);
      renderArtistTable();
      renderFollowing();

      document.getElementById('calendar-section').classList.add('hidden');
      document.querySelectorAll('#overview, #keywords-section, #top-artists, #following-section').forEach(el => el.classList.remove('hidden'));
      main.classList.remove('hidden');
    } catch (err) {
      showError('Failed to load: ' + err.message);
    } finally {
      loading.classList.add('hidden');
    }
  }

  /* -------- EVENT PARSING -------- */

  function parseEvents(doc) {
    const anchors = doc.querySelectorAll('a[name^="centry."]');
    const result = [];

    for (const anchor of anchors) {
      const tr1 = anchor.parentElement?.parentElement;
      if (!tr1 || tr1.tagName !== 'TR') continue;
      const tr2 = tr1.nextElementSibling;
      const tr3 = tr2?.nextElementSibling;
      if (!tr2 || !tr3) continue;

      const day   = (tr1.querySelector('td.datum:nth-child(2)')?.textContent || '').trim();
      const month = (tr1.querySelector('td.datum:nth-child(3)')?.textContent || '').trim();
      const year  = (tr1.querySelector('td.datum:nth-child(4)')?.textContent || '').trim();
      const dateStr = `${day}.${month}.${year ? '20' + year : ''}`;

      const addressDiv = tr1.querySelector('.calender-entry-address');
      const address = addressDiv?.textContent?.replace(/\s+/g, ' ').trim() || '';

      const timeTable = tr2.querySelector('table');
      let dayOfWeek = '', time = '';
      if (timeTable) {
        dayOfWeek = timeTable.querySelector('td:first-child')?.textContent?.trim() || '';
        time = timeTable.querySelector('td:last-child')?.textContent?.trim() || '';
      }

      const venueTd = tr3.querySelector('.name-box');
      let venueName = '', venueHref = '';
      if (venueTd) {
        const link = venueTd.querySelector('a');
        if (link) {
          venueName = link.textContent?.replace(/\s+/g, ' ').trim() || '';
          venueHref = link.getAttribute('href') || '';
        } else {
          venueName = venueTd.textContent?.replace(/\s+/g, ' ').trim() || '';
        }
      }

      const infoDiv = tr3.querySelector('.calender-entry-info');
      const rawText = infoDiv ? (infoDiv.textContent || '') : '';
      const infoText = rawText
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .trim();

      result.push({ dateStr, dayOfWeek, time, address, venueName, venueHref, infoText });
    }

    return result;
  }

  /* -------- ARTIST EXTRACTION -------- */

  function isNoiseLine(line) {
    const l = line.toLowerCase().trim();
    if (l.length < 2) return true;

    // Lines starting with noise words (prepositions, articles, pronouns, etc.)
    const STARTER_NOISE = [
      'in', 'on', 'at', 'by', 'from', 'with', 'for', 'the', 'a', 'an', 'of', 'to',
      'as', 'is', 'are', 'was', 'were', 'be', 'been', 'been', 'this', 'that', 'these', 'those',
      'its', 'their', 'our', 'your', 'his', 'her', 'all', 'each', 'every', 'some', 'any',
      'no', 'not', 'only', 'just', 'also', 'very', 'more', 'most', 'less', 'few',
      'such', 'same', 'other', 'another', 'between', 'through', 'during', 'before', 'after',
      'above', 'below', 'under', 'over', 'out', 'off', 'up', 'down', 'into', 'onto', 'upon',
      'within', 'without', 'along', 'among', 'about', 'around', 'behind', 'beyond', 'inside',
      'outside', 'toward', 'across', 'against', 'beneath', 'beside', 'besides', 'past',
      'throughout', 'und', 'die', 'der', 'das', 'ein', 'eine', 'einen', 'einer', 'eines',
      'dem', 'den', 'des', 'mit', 'nach', 'bei', 'aus', 'vor', 'seit', 'bis', 'durch',
      'für', 'gegen', 'ohne', 'um', 'her', 'hin', 'auf', 'ab', 'an', 'ausser', 'innerhalb',
      'ausserhalb', 'trotz', 'während', 'wegen', 'statt', 'zum', 'zur', 'vom', 'beim', 'im',
      'am', 'ins', 'ans', 'hinter', 'neben', 'zwischen', 'oben', 'unten', 'vorn', 'hinten',
      'there', 'here', 'where', 'when', 'why', 'how', 'what', 'which', 'who', 'whether',
      'if', 'while', 'although', 'though', 'because', 'since', 'unless', 'until', 'so',
      'than', 'including', 'excluding', 'regarding', 'concerning', 'considering',
      'following', 'regardless', 'apart', 'except',
    ];
    const firstW = l.split(/[\s,;:]+/)[0];
    if (STARTER_NOISE.includes(firstW)) return true;

    // URLs
    if (/https?:\/\//i.test(l)) return true;

    // Dates, times
    if (/^\d{1,2}\.?\s*\d{1,2}\.?\s*\d{2,4}/.test(l)) return true;
    if (/^\d{1,2}:\d{2}/.test(l)) return true;

    // Prices / currencies
    if (/[€$£¥]/.test(l)) return true;
    if (/^\d+[.,]\d{2}/.test(l)) return true;

    // Quoted text (song titles, etc.)
    if (/^["''']/.test(l)) return true;

    // Lines with 4-digit years not part of a name range
    if (/^\d{4}/.test(l)) return true;

    // Common non-artist phrases (substring match)
    const PHRASES = [
      'doors', 'door ', 'admission', 'donation', 'ticket', 'tickets', 'entry',
      'start at', 'begins at', 'music at', 'doors at',
      'presented by', 'funded by', 'supported by', 'organized by',
      'part of', 'in cooperation', 'in collaboration', 'in association',
      'an event by', 'an event of', 'a program by', 'a programme by',
      'im rahmen', 'eine veranstaltung', 'in zusammenarbeit',
      'eintritt frei', 'eintritt:', 'kostenlos', 'free entrance', 'free entry',
      'admission free', 'suggested donation', 'sliding scale',
      'sign up', 'newsletter', 'more info', 'more information',
      'record release', 'album release', 'debut album',
      'this venue', 'wheelchair', 'not wheelchair',
      'direction:', 'directions:', 'how to get',
      'curation:', 'curated by', 'curators',
      'registration', 'reservation', 'please register',
      'doors open', 'box office',
      'live at', 'live from', 'live in',
      'featuring', 'feat.', 'special guests', 'with special',
      'durchgehend', 'sonntage', 'loop-modus', 'loop mode',
      'program', 'programme', 'lineup', 'schedule',
      'price:', 'prices:', 'early bird', 'final release',
      'funded by', 'gefördert', 'gef. von', 'mit freundlicher',
      'tickets:', 'tickets ',
      'info artists', 'info musicians',
      'set 1:', 'set 2:', 'set 3:', 'first part:', 'second part:',
      '-set 1-', '-set 2-', '-set 3-',
      'duo:', 'solo:', 'trio:',
      'doors at', 'doors:', 'music at',
      'admission:', 'entry:', 'donations',
      'und mehr', '+ guest', '+tba', 'tba -',
    ];
    for (const p of PHRASES) {
      if (l.includes(p)) return true;
    }

    // Line is purely a dash character (section break)
    if (/^\s*[–—]\s*$/.test(l)) return true;

    // Lines ending with common domain extensions (URLs without protocol)
    if (/\.(org|com|de|net|eu|berlin|it|fr|uk|ch)\s*$/.test(l)) return true;

    // Lines that are mostly numbers, punctuation, or special chars
    const alphaRatio = (l.match(/[a-z\u00C0-\u024F]/g) || []).length / l.length;
    if (alphaRatio < 0.3 && l.length > 3) return true;

    return false;
  }

  function isFeaturingHeader(line) {
    return /^(featuring|with|special guests?|including|presenting?|contributors?|line[- ]up|info artists|info musicians):?\s*$/i.test(line);
  }

  function looksLikePersonName(s) {
    // Strip trailing punctuation (colons, semicolons, commas, periods)
    const trimmed = s.trim().replace(/[:;,.\s]+$/, '');
    if (trimmed.length < 3) return false;
    if (!/[A-Za-z\u00C0-\u024F]/.test(trimmed)) return false;

    // Must start with uppercase letter
    if (!/^[A-Z\u00C0-\u024F]/.test(trimmed)) return false;

    // Reject names containing separators that aren't person names
    if (/[/]/.test(trimmed)) return false;

    // Reject names with structural separators mid-string (dash, >, | used in listings)
    if (/ [-–—>|]/.test(trimmed)) return false;

    // Reject names with ≥3 dots (abbreviations like "M.i.p.v.")
    if ((trimmed.match(/\./g) || []).length >= 3) return false;

    const words = trimmed.split(/\s+/);

    // Mononym: single capitalized word, >=4 chars, not a noise word
    if (words.length === 1) {
      if (trimmed.length < 4) return false;
      if (trimmed === trimmed.toUpperCase()) return false;
      return !isNoiseWord(trimmed);
    }

    // Reject names with numbers
    if (/\d/.test(trimmed)) return false;

    // Require at least 2 words starting with uppercase
    const capped = words.filter(w => /^[A-Z\u00C0-\u024F]/.test(w));
    if (capped.length < 2) return false;

    // Reject if any word is all-lowercase (unless it's a known connector)
    for (const w of words) {
      const clean = w.replace(/[^a-zA-Z\u00C0-\u024F]/g, '');
      if (clean.length > 0 && clean === clean.toLowerCase() && !CONNECTORS.has(clean)) {
        if (/^[a-z]\./i.test(w)) continue;
        return false;
      }
    }

    // Reject if ANY word is a known noise word (instrument, descriptor, etc.)
    for (const w of words) {
      const clean = w.replace(/[^a-zA-Z\u00C0-\u024F]/g, '');
      if (clean.length > 0 && isNoiseWord(clean)) return false;
    }

    // Reject if the middle word is a known article/preposition indicating an event title
    const eventMarkers = ['of', 'in', 'at', 'for', 'zu', 'am', 'im', 'aus'];
    if (words.length >= 3) {
      const middle = words.slice(1, -1);
      for (const w of middle) {
        if (eventMarkers.includes(w.toLowerCase()) && w.toLowerCase() === w) return false;
      }
    }

    // Reject if it's an all-caps word that isn't a typical name
    // Band names like "RCHTN25" or "SWAZZOU" have specific patterns
    if (trimmed === trimmed.toUpperCase()) {
      // All-caps with length > 10 and no & → likely band name abbreviation
      if (trimmed.length > 10 && !trimmed.includes('&')) return false;
    }

    return true;
  }

  function isNoiseWord(w) {
    const noise = new Set([
      'online', 'live', 'solo', 'duo', 'trio', 'quartet', 'quintet', 'sextet',
      'quartett', 'quintett', 'quartette', 'quintette',
      'project', 'ensemble', 'orchestra', 'group', 'band', 'collective',
      'present', 'presents', 'special', 'guest', 'guests', 'featuring',
      'im', 'am', 'um', 'mit', 'von', 'und', 'oder', 'aber', 'für', 'auf',
      'bei', 'aus', 'nach', 'vor', 'durch', 'über', 'unter', 'neben', 'zwischen',
      'the', 'a', 'an', 'in', 'on', 'at', 'by', 'to', 'for', 'of', 'is',
      'e.v.', 'ev', 'gbr', 'ug', 'ltd', 'inc', 'gmbh',
      // Instruments and roles (merged from INSTRUMENT_WORDS)
      'piano', 'guitar', 'bass', 'drums', 'sax', 'saxophone', 'trumpet',
      'violin', 'cello', 'viola', 'flute', 'clarinet', 'percussion',
      'electronics', 'synth', 'synthesizer', 'voice', 'vocals', 'voc',
      'turntables', 'turntable', 'keyboard', 'keys', 'organ', 'harp', 'accordion',
      'trombone', 'horn', 'tuba', 'banjo', 'mandolin', 'ukelele',
      'double bass', 'modular synth', 'objects', 'prepared piano',
      'baritone sax', 'alto sax', 'tenor sax', 'soprano sax', 'bass clarinet',
      'contrabass', 'field recordings', 'barockvioline', 'cembalo', 'blockflöte',
      'recorder', 'recorders', 'flutes', 'clarinets', 'saxes', 'strings',
      'daxophone', 'marimba', 'vibraphone', 'glockenspiel', 'xylophone',
      'bassoon', 'oboe', 'english horn', 'french horn',
      'dr', 'git', 'b', 'p', 'tb', 'trp',
      'composition', 'performance', 'dance', 'butoh', 'action', 'poetry',
      'movements', 'sound art', 'sounddesign', 'video', 'visuals', 'installation',
      'amplifier', 'konzept', 'percussions',
      'gitarre', 'klavier', 'schlagzeug', 'saxophon', 'trompete',
      'posaune', 'geige', 'bratsche', 'flöte', 'klarinetten', 'violoncello',
      'schlagwerk', 'bassklarinette', 'stimme', 'gesang',
      'mixer', 'mischpult', 'effekte', 'sequenzer', 'sampler',
      'elektronik', 'akustik', 'verstärker', 'lautsprecher',
      'monitor', 'kopfhörer', 'mikrofon', 'kabel', 'pedal', 'effector',
      // Common descriptive words that are NOT artist names
      'improvised', 'experimental', 'electronic', 'electronics',
      'concert', 'concerts', 'records', 'record',
      'picnic', 'series', 'session', 'week',
      'music', 'sound', 'art', 'performance', 'performances',
      'program', 'programme', 'lineup',
      'donation', 'admission', 'entrance', 'entry', 'ticket', 'tickets',
      'registration', 'reservation',
      'curation', 'curated', 'curators',
      'wheelchair', 'accessible', 'accessibility',
      'newsletter', 'information', 'info',
      'direction', 'directions',
      'suggested', 'sliding',
      'early', 'final', 'release',
      'price', 'prices', 'preise',
      'hearing', 'seeing',
      'plus', 'more',
      'open', 'start', 'begin', 'doors',
      'part', 'parts', 'set', 'sets',
      'presented', 'funded', 'supported', 'organized', 'sponsored',
      'cooperation', 'collaboration', 'association',
      'veranstaltung', 'zusammenarbeit',
      'rahmen', 'eintritt', 'kostenlos',
      'programminitiative', 'variationen',
      'funded', 'gefördert', 'förderung',
      'directions', 'coordinates',
      'sign', 'email', 'contact',
      'admission', 'donations', 'suggested',
      'residency', 'residencies', 'edition', 'editions',
      'biennial', 'festival', 'summerfest',
      'installation', 'sound',
      'images', 'imagining', 'common', 'futures',
      'ceramic', 'objects', 'prepared',
      'action', 'poetry', 'movements', 'accessibility', 'barrierfree',
      // German / English mixed
      'sonntage', 'durchgehend', 'loop-modus', 'loop',
      'länge', 'minuten', 'präsentation', 'präsentiert',
      'aufnahme', 'aufführung', 'stückes',
      'soprano', 'nastro', 'magnetico',
      'workshop', 'ausstellungseröffnung',
      'eröffnungspanel', 'podiumsdiskussion',
      'konzert', 'konzerte', 'tanz', 'theater',
      'frei', 'sharp',
      'trigger', 'warning', 'riverbank', 'box', 'office',
      'dead', 'leaf', 'butterfly',
      'invisible', 'thread', 'drone', 'triloka', 'immersive',
      'ambient', 'journey', 'massive', 'schräge',
      'helicopter', 'palace', 'future', 'now', 'musical', 'diaries',
      'absolute', 'sweet', 'mary',
      'zustand',
      // Additional noise words from latest output
      'berlin', 'saxofon', 'dirigentin', 'keyboardpunk',
      'new', 'zealand', 'surprise', 'klavierstücke',
      'scubert', 'four',
      // ASCII-normalized duplicates for accented words
      'blockflote', 'flote', 'lange', 'gefordert', 'forderung', 'schrage',
      'eroffnungspanel', 'klavierstucke', 'prasentation', 'prasentiert',
      'stuckes', 'ausstellungseroffnung', 'walden',
      'butoh', 'dance',
      'act', 'grunge', 'singer', 'songwriter',
      'palace', 'palace',
      'nahmaschine',
      'quintett', 'quartett', 'duo', 'solo',
    ]);
    // Normalize: convert accented chars to ASCII base + strip non-alpha
    const n = w.toLowerCase()
      .replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ä/g, 'a')
      .replace(/é/g, 'e').replace(/è/g, 'e').replace(/ê/g, 'e')
      .replace(/à/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i').replace(/ô/g, 'o')
      .replace(/ù/g, 'u').replace(/û/g, 'u').replace(/ç/g, 'c').replace(/ñ/g, 'n')
      .replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ğ/g, 'g')
      .replace(/[^a-z]/g, '');
    return noise.has(n);
  }

  // Extract the name portion from a line using structural patterns
  // Returns the name string or null
  function extractNameByPattern(line) {
    let name = null;

    // Pattern: Name - X (dash)
    let m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) {
      name = m[1].trim();
      const after = m[2].trim();
      // False-positive filter: if pre-dash name contains event-series words → reject
      const bw = name.split(/\s+/);
      if (bw.length >= 3) {
        const mid = bw.slice(1, -1);
        for (const w of mid) {
          if (/^(of|for|in|at|zu|am|im|aus|von|und|mit|and)$/i.test(w)) return null;
        }
      }
      // If pre-dash ends with known event-series suffix → reject
      if (/ (Concerts|Series|Festival|Night|Edition|Biennial|Program|Programme|Session|Fest|Show|Week|Concert)$/i.test(name)) return null;
      // If pre-dash is all-caps and long (band/event name) → skip
      if (name === name.toUpperCase() && name.length > 8 && !name.includes('&')) return null;
      return looksLikePersonName(name) ? name : null;
    }

    // Pattern: Name > X (greater-than)
    m = line.match(/^(.+?)\s+>\s+(.+)$/);
    if (m) { name = m[1].trim(); if (looksLikePersonName(name)) return name; }

    // Pattern: Name (X) — parens
    m = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (m) { name = m[1].trim(); if (looksLikePersonName(name)) return name; }

    // Pattern: Name : X (colon)
    m = line.match(/^([A-Z\u00C0-\u024F][A-Za-z\u00C0-\u024F'.]+(?:\s+[A-Za-z\u00C0-\u024F'.]+){0,3})\s*:\s+(.+)$/);
    if (m) {
      name = m[1].trim();
      const after = m[2].trim().toLowerCase();
      // False-positive: colon followed by URL/price/digits → logistics
      if (/^(https?:\/\/|www\.|\d)/.test(after)) return null;
      if (looksLikePersonName(name)) return name;
    }

    // Pattern: Name | instrument (pipe)
    m = line.match(/^(.+?)\s*\|\s+(.+)$/);
    if (m) {
      name = m[1].trim();
      if (looksLikePersonName(name)) return name;
    }

    // Pattern: Name , X (comma, short line)
    m = line.match(/^([A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+(?:\s+[A-Za-z\u00C0-\u024F'.]+){0,3})\s*,\s+(.+)$/);
    if (m && line.length < 90) {
      name = m[1].trim();
      const after = m[2].trim().toLowerCase();
      // Comma followed by URL → not a name
      if (/^https?:\/\//.test(after)) return null;
      if (looksLikePersonName(name)) return name;
    }

    return null;
  }

  // Extract names from "Name & Name" pattern
  function extractAmpersandPair(line) {
    const m = line.match(/^(.+?)\s+[&∧]\s+(.+)$/);
    if (!m) return null;
    let n1 = m[1].trim();
    let n2 = m[2].trim();
    // Strip trailing parentheticals from both names
    const stripParens = (s) => { const p = s.match(/^(.+?)\s*\(/); return p ? p[1].trim() : s; };
    n1 = stripParens(n1);
    n2 = stripParens(n2);
    return [n1, n2].filter(n => looksLikePersonName(n));
  }

  // Extract names from inside parentheses when outer text isn't a person name
  // e.g. "Project VO (Antti Virtaranta & Rieko Okuda)" → ["Antti Virtaranta", "Rieko Okuda"]
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

  // Split a line on known separators to find multiple names
  function splitNames(line) {
    const results = [];
    // Split on & , / and trim
    const parts = line.split(/[&,;/]\s*/);
    for (const part of parts) {
      let trimmed = part.trim().replace(/^[+\-•·*–—]\s*/, '');
      // Strip trailing parentheticals (e.g. country codes)
      const p = trimmed.match(/^(.+?)\s*\(/);
      if (p) trimmed = p[1].trim();
      if (trimmed.length > 1) results.push(trimmed);
    }
    return results;
  }

  function extractArtists(infoText) {
    // Normalize curly quotes to straight ASCII for regex matching
    const normalized = infoText
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    const artists = new Set();
    const lines = normalized.split(/\n/).map(l => l.trim()).filter(Boolean);

    let inFeaturing = false;

    for (const rawLine of lines) {
      const line = rawLine;

      if (inFeaturing) {
        if (isNoiseLine(line)) { inFeaturing = false; continue; }
        const names = splitNames(line);
        names.forEach(n => {
          const t = n.trim();
          if (t.length > 1 && !/^https?:\/\//i.test(t)) artists.add(t);
        });
        continue;
      }

      if (isFeaturingHeader(line)) { inFeaturing = true; continue; }

      // "by Name" / "with Name" — check BEFORE isNoiseLine since they start with noise words
      const byMatch = line.match(/^(?:by|with)\s+(.+)$/i);
      if (byMatch) {
        const n = byMatch[1].trim();
        if (looksLikePersonName(n)) { artists.add(n); continue; }
      }

      // Names inside parentheses — extract even from noisy lines (e.g. "Duo: Project (Name & Name)")
      const inner = extractNamesFromParens(line);
      if (inner) { inner.forEach(n => artists.add(n)); continue; }

      // Strip section header prefixes ("Set 1:", "Duo:", "Solo:", etc.) — extract artist from remainder
      const headerStrip = line.match(/^(?:set\s+\d+\s*:|duo\s*:|solo\s*:|trio\s*:|-set\s+\d+\s*-)\s*(.+)$/i);
      if (headerStrip) {
        const rest = headerStrip[1].trim();
        const nm = extractNameByPattern(rest);
        if (nm) { artists.add(nm); continue; }
        if (looksLikePersonName(rest)) { artists.add(rest); continue; }
      }

      if (isNoiseLine(line)) continue;

      // 1) Structural patterns (dash, >, parens, colon, comma)
      const name = extractNameByPattern(line);
      if (name) {
        artists.add(name);
        // Comma pattern: also extract RHS if it's a person name (e.g. "Francesca Marongiu, Peder Simonsen")
        const cm = line.match(/^.+?,\s*(.+)$/);
        if (cm) {
          const rhs = cm[1].trim();
          if (looksLikePersonName(rhs)) artists.add(rhs);
        }
        continue;
      }

      // 1b) Colon fallback: "Section Header: Artist Name" (e.g. "Sound Art: Anouk Kellner")
      const colMatch = line.match(/^[A-Z][^:]+:\s+(.+)$/);
      if (colMatch) {
        const rhs = colMatch[1].trim();
        if (rhs.length < 60 && !rhs.includes(':') && looksLikePersonName(rhs)) {
          artists.add(rhs);
          continue;
        }
      }

      // 2) Name & Name (ampersand pair)
      const pair = extractAmpersandPair(line);
      if (pair) { pair.forEach(n => artists.add(n)); continue; }

      // 2b) Pipe-separated or plus-separated name lists (e.g. "Schwarz | Viner | Rößler", "Rieko Okuda + Claudia Schmitz")
      const listSep = line.match(/^(.+?)\s+[|+]\s+(.+?)(?:\s+[|+]\s+(.+))?$/);
      if (listSep) {
        const parts = line.split(/\s*[|+]\s*/).map(s => s.trim()).filter(Boolean);
        let added = false;
        for (const p of parts) {
          const clean = p.replace(/[:;,.\s]+$/, '').trim();
          if (looksLikePersonName(clean)) { artists.add(clean); added = true; }
        }
        if (added) continue;
      }

      // 3) Bare name fallback (short line, looks like person name)
      if (line.length < 60) {
        // Strip band/project suffixes before checking
        const stripped = line.replace(/\s+(Trio|Duo|Solo|Quartett|Quartet|Quintett|Quintet|Project|Ensemble|Group|Band|Collective|Orchestra|Four|Fourtet)$/i, '').trim();
        const candidate = (stripped.length >= 3 && stripped !== line) ? stripped : line;
        if (looksLikePersonName(candidate)) {
          if (candidate === candidate.toUpperCase() && candidate.length <= 15 && !candidate.includes('&')) continue;
          const cleaned = candidate.replace(/[:;,.\s]+$/, '').trim();
          if (cleaned.length >= 3) artists.add(cleaned);
        }
      }
    }

    return [...artists].filter(n => n && n.trim().length > 0 && !/^https?:\/\//i.test(n));
  }

  /* -------- ANALYSIS -------- */

  function buildArtistMap(events) {
    const map = {};

    events.forEach(ev => {
      const names = extractArtists(ev.infoText);
      names.forEach(name => {
        const key = normalizeArtistName(name);
        if (!map[key]) map[key] = { count: 0, events: [] };
        map[key].count++;
        map[key].events.push(ev);
      });
    });

    return map;
  }

  /* -------- RENDERING -------- */

  const KW_SET = new Set([
    // Core instruments (English)
    'piano','guitar','bass','drums','sax','saxophone','trumpet','violin','cello','viola',
    'flute','clarinet','percussion','electronics','synth','synthesizer','voice','vocals',
    'turntables','turntable','keyboard','keys','organ','harp','accordion','trombone','horn','tuba',
    'banjo','mandolin','double bass','modular synth','objects','daxophone','marimba',
    'vibraphone','glockenspiel','xylophone','bassoon','oboe','recorder','recorders',
    'live electronics','sampling','sampler','field recordings','amplifier',
    'sequencer','sequenzer','mixer','effector',
    // German instruments
    'gitarre','klavier','schlagzeug','saxophon','trompete','posaune','geige','bratsche',
    'flöte','blockflöte','klarinetten','violoncello','schlagwerk','bassklarinette',
    'stimme','gesang','elektronik','akustik','verstärker','lautsprecher','mischpult',
    'klavierstücke','cembalo','barockvioline',
    // Extended techniques
    'prepared piano','inside piano','ext. guitar','feedbacker','feedback','bow',
    'ebow','objects','springs','drum membranes',
    // Roles / performance modes
    'solo','duo','trio','quartet','quartett','quintet','quintett',
    'butoh','dance','poetry','spoken word','action poetry','movements',
    'video','visuals','installation','sound art','performance','composition','improvisation',
    'conducting','conduction',
    // Genres / styles
    'electronic','ambient','drone','minimalism','experimental','noise',
    'jazz','free jazz','free improvisation','folk','classical','contemporary',
    'electroacoustic','soundscape','new music','zeitgenössisch',
    // Other common role words from the data
    'bartender','curation','sounddesign','konzept','live set',
    'antennas','radio','magnetic tape','electromagnetic',
    'radio','microphone','amplified','objects','found objects','prepared',
    'ceramic flutes','waterbowls','spring',
  ]);

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractKeywords(infoText) {
    const found = new Set();
    for (const kw of KW_SET) {
      // Word-boundary match to avoid false positives like "harp" in "sharp"
      if (new RegExp('\\b' + escapeRegex(kw) + '\\b', 'i').test(infoText)) found.add(kw);
    }
    return [...found].sort();
  }

  // Keywords that describe the event format/style (not a specific performer's instrument).
  // For these, any artist in the event matches (broader association).
  const GENERIC_KWS = new Set([
    'solo','duo','trio','quartet','quartett','quintet','quintett',
    'experimental','live','electronic','ambient','drone','noise',
    'jazz','free jazz','free improvisation','folk','classical','contemporary',
    'electroacoustic','soundscape','new music','zeitgenössisch', 'minimalism',
    'improvisation','composition','performance','sound art','installation','video',
    'dance','butoh','poetry','spoken word',
  ]);

  // Check if an artist is directly associated with a keyword on the same structural line
  // e.g. "Simon Rose - baritone saxophone" → sax matches Simon Rose
  //      "Lorena Izquierdo - voice, actions" → sax does NOT match Lorena
  function artistMatchesKeyword(artistName, infoText, keyword) {
    const kw = keyword.toLowerCase();

    // For generic/format keywords (trio, experimental, etc.), match if keyword appears as whole word anywhere in event
    if (GENERIC_KWS.has(kw)) {
      return new RegExp('\\b' + escapeRegex(kw) + '\\b', 'i').test(infoText);
    }

    // For instrument/role keywords, require line-level structural match
    const name = artistName.toLowerCase();
    const lines = infoText.split(/\n/).map(l => l.trim()).filter(Boolean);
    return lines.some(line => {
      const l = line.toLowerCase();
      if (!l.includes(name) || !l.includes(kw)) return false;
      // Check structural patterns where name is before separator and keyword is after
      const dash = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (dash) return dash[1].trim().toLowerCase().includes(name) && dash[2].toLowerCase().includes(kw);
      const parens = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (parens) return parens[1].trim().toLowerCase().includes(name) && parens[2].toLowerCase().includes(kw);
      const colon = line.match(/^([A-Z][a-z\u00C0-\u024F]+(?:\s+[A-Za-z\u00C0-\u024F'.]+){0,3})\s*:\s+(.+)$/);
      if (colon) return colon[1].trim().toLowerCase().includes(name) && colon[2].toLowerCase().includes(kw);
      const gt = line.match(/^(.+?)\s+>\s+(.+)$/);
      if (gt) return gt[1].trim().toLowerCase().includes(name) && gt[2].toLowerCase().includes(kw);
      // Also check pipe pattern: Name | instrument
      const pipe = line.match(/^(.+?)\s*\|\s+(.+)$/);
      if (pipe) return pipe[1].trim().toLowerCase().includes(name) && pipe[2].toLowerCase().includes(kw);
      // Comma pattern: Name, instrument
      const comma = line.match(/^([A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+(?:\s+[A-Za-z\u00C0-\u024F'.]+){0,3})\s*,\s+(.+)$/);
      if (comma) return comma[1].trim().toLowerCase().includes(name) && comma[2].toLowerCase().includes(kw);
      return false;
    });
  }

  function renderOverview(events, artistMap) {
    const artistNames = Object.keys(artistMap);
    const venues = new Set(events.map(e => e.venueName));
    const days = new Set(events.map(e => e.dayOfWeek));

    // Compute top keywords — only include those matching at least one artist
    const kwCounts = {};
    events.forEach(ev => {
      extractKeywords(ev.infoText).forEach(kw => {
        kwCounts[kw] = (kwCounts[kw] || 0) + 1;
      });
    });
    const topKws = Object.entries(kwCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    // Persist active keyword across tab switches
    if (keywordFilter && !topKws.some(([kw]) => kw === keywordFilter)) {
      topKws.unshift([keywordFilter, kwCounts[keywordFilter] || 0]);
    }

    // Narrative overview
    const filterLabel = currentFilter === 'today' ? 'Today' :
                        currentFilter === 'tomorrow' ? 'Tomorrow' :
                        currentFilter === 'next7' ? 'The next 7 days' :
                        currentFilter === 'month' ? 'This month' : 'All time';

    const venueCounts = {};
    events.forEach(ev => { if (ev.venueName) venueCounts[ev.venueName] = (venueCounts[ev.venueName] || 0) + 1; });
    const topVenues = Object.entries(venueCounts).sort((a,b) => b[1]-a[1]).slice(0,3)
      .map(([v, c]) => `<span class="venue-name">${escapeHtml(v)}</span>${c > 1 ? ' ('+c+')' : ''}`);

    const topArtists = Object.entries(artistMap).sort((a,b) => b[1].count - a[1].count).slice(0,5)
      .map(([name, d]) => `<span class="artist-link" data-artist="${escapeHtml(name)}">${escapeHtml(name)}</span>${d.count > 1 ? ' ('+d.count+')' : ''}`);

    // Followed artists' upcoming concerts — grouped by artist
    let followedHtml = '';
    if (watchedArtists.length > 0) {
      const isDay = currentFilter === 'today' || currentFilter === 'tomorrow';
      const now = new Date();
      const grouped = {};
      watchedArtists.forEach(artist => {
        const data = artistMap[artist];
        if (!data) return;
        data.events.forEach(ev => {
          const evDate = parseEventDateTime(ev.dateStr, ev.time);
          if (!evDate || evDate <= now) return;
          const label = isDay ? ev.time : ev.dateStr.replace(/\.\d{4}$/, '');
          if (!grouped[artist]) grouped[artist] = [];
          grouped[artist].push(`<span class="nowrap">${label}/${escapeHtml(ev.venueName)}</span>`);
        });
      });
      const entries = Object.entries(grouped);
      if (entries.length > 0) {
        followedHtml = `<div class="followed-concerts">`;
        entries.forEach(([artist, concerts]) => {
          followedHtml += `<div class="followed-concert-row">
            <span class="followed-artist-name">${escapeHtml(artist)}:</span>
            ${concerts.join(', ')}
          </div>`;
        });
        followedHtml += `</div>`;
      }
    }

    overviewText.innerHTML = `
      <span class="stat">${filterLabel}</span>:
      <span class="stat">${events.length}</span> concerts across <span class="stat">${venues.size}</span> venues,
      featuring <span class="stat">${artistNames.length}</span> artists${days.size > 1 ? ` over <span class="stat">${days.size}</span> days` : ''}.
      <br>Top venues: ${topVenues.join(', ')}.
      ${topArtists.length > 0 ? `<br>Top artists: ${topArtists.join(', ')}.` : ''}
      ${followedHtml}
      ${keywordFilter ? `<br>Filtered by keyword: <strong style="color:#ffd54f">${escapeHtml(keywordFilter)}</strong> <a href="#" id="clear-kw" class="kw-clear">✕</a>` : ''}
    `;

    // Keywords section
    kwContainer.innerHTML = `<div class="kw-pills">${topKws.map(([kw, cnt]) =>
      `<span class="kw-pill${kw === keywordFilter ? ' kw-active' : ''}" data-kw="${escapeHtml(kw)}" aria-label="Filter by ${escapeHtml(kw)} — ${cnt} events" tabindex="0">${escapeHtml(kw)} <span class="kw-count">${cnt}</span></span>`
    ).join('')}</div>`;

    overviewText.querySelectorAll('.artist-link').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.artist;
        const cards = document.querySelectorAll('.artist-card');
        for (const card of cards) {
          if (card.dataset.artist === name) {
            toggleArtistExpand(name, card);
            break;
          }
        }
      });
    });

    document.querySelectorAll('.kw-pill').forEach(el => {
      el.addEventListener('click', () => {
        keywordFilter = el.dataset.kw === keywordFilter ? null : el.dataset.kw;
        renderOverview(events, artistMap);
        renderArtistTable();
        renderFollowing();
      });
    });

    const clearKw = document.getElementById('clear-kw');
    if (clearKw) clearKw.addEventListener('click', (e) => {
      e.preventDefault();
      keywordFilter = null;
      renderOverview(events, artistMap);
      renderArtistTable();
      renderFollowing();
    });
  }

  function renderArtistTable() {
    expandedArtist = null;
    const heading = document.getElementById('artist-heading');
    const filter = artistFilter.value.toLowerCase();
    let entries = Object.entries(artistMap)
      .filter(([name]) => name.toLowerCase().includes(filter))
      .sort((a, b) => b[1].count - a[1].count);

    if (keywordFilter) {
      entries = entries.filter(([name, data]) =>
        data.events.some(ev => artistMatchesKeyword(name, ev.infoText, keywordFilter))
      );
      heading.innerHTML = `Artists · ${escapeHtml(keywordFilter)} <span class="filter-count">${entries.length}</span>`;
    } else {
      heading.textContent = 'Artists';
    }

    // Show reset button when keyword filter returns 0 artists
    if (keywordFilter && entries.length === 0) {
      const timeLabel = currentFilter === 'today' ? 'today' :
                        currentFilter === 'tomorrow' ? 'tomorrow' :
                        currentFilter === 'next7' ? 'the next 7 days' :
                        currentFilter === 'month' ? 'this month' : 'all time';
      artistList.innerHTML = `<div class="empty-state">
        <p>No artists found for <strong style="color:#ffd54f">${escapeHtml(keywordFilter)}</strong>.</p>
        <p class="empty-hint">Try <a href="#" class="empty-link" data-filter="all">all time</a> or <a href="#" class="empty-link" data-filter="next7">next 7 days</a>.</p>
        <a href="#" class="reset-btn" id="reset-filter">✕ Reset filter</a>
      </div>`;
      document.getElementById('reset-filter').addEventListener('click', (e) => {
        e.preventDefault();
        keywordFilter = null;
        renderOverview(events, artistMap);
        renderArtistTable();
      });
      artistList.querySelectorAll('.empty-link').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const target = el.dataset.filter;
          document.querySelectorAll('.filter-bar button').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === target);
          });
          currentFilter = target;
          loadAndAnalyze(currentFilter);
        });
      });
      return;
    }

    function renderCard(name, data, i, watched) {
      const preview = data.events[0];
      const venueInfo = preview ? `${preview.dateStr} ${preview.time} · ${preview.venueName}` : '';
      const isSingleDay = currentFilter === 'today' || currentFilter === 'tomorrow';
      return `<div class="artist-card" data-artist="${escapeHtml(name)}" tabindex="0" role="button" aria-label="Show ${escapeHtml(name)}'s concerts">
        <span class="rank">${i + 1}</span>
        <div class="info">
          <div class="name">${escapeHtml(name)}</div>
          ${venueInfo ? `<div class="venue-preview">${escapeHtml(venueInfo)}</div>` : ''}
        </div>
        <div class="right-col">
          ${!isSingleDay ? `<span class="count ${data.count >= 5 ? 'freq-5' : data.count >= 4 ? 'freq-4' : data.count >= 3 ? 'freq-3' : data.count >= 2 ? 'freq-2' : ''}">${data.count}x</span>` : ''}
          <span class="follow-artist${watched ? ' followed' : ''}" data-artist="${escapeHtml(name)}">${watched ? '✓ Following' : '+ Follow'}</span>
        </div>
      </div>`;
    }

    function attachHandlers() {
      artistList.querySelectorAll('.artist-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.follow-artist')) return;
          toggleArtistExpand(card.dataset.artist, card);
        });
      });
      artistList.querySelectorAll('.follow-artist').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleWatchArtist(el.dataset.artist, el);
        });
      });
    }

    if (keywordFilter && watchedArtists.length > 0) {
      // Split into followed and recommendations
      const followed = [];
      const recs = [];
      entries.forEach(([name, data]) => {
        const norm = normalizeArtistName(name);
        if (watchedArtists.includes(norm)) {
          followed.push([name, data]);
        } else {
          recs.push([name, data]);
        }
      });
      let html = '';
      let fi = 0;

      if (followed.length > 0) {
        html += `<div class="artist-group-header">Following who play <span class="kw-label">${escapeHtml(keywordFilter)}</span></div>`;
        html += followed.map(([name, data]) => renderCard(name, data, fi++, true)).join('');
      }

      if (recs.length > 0) {
        html += `<div class="artist-group-header">Recommendations for <span class="kw-label">${escapeHtml(keywordFilter)}</span></div>`;
        html += recs.map(([name, data]) => renderCard(name, data, fi++, false)).join('');
      }

      artistList.innerHTML = html;
    } else {
      artistList.innerHTML = entries.map(([name, data], i) => {
        const watched = watchedArtists.includes(normalizeArtistName(name));
        return renderCard(name, data, i, watched);
      }).join('');
    }

    attachHandlers();
  }

  function toggleArtistExpand(name, cardEl) {
    // Collapse any existing expansion
    const existing = document.querySelector('.card-detail-expanded');
    if (existing) existing.remove();
    document.querySelector('.artist-card.expanded')?.classList.remove('expanded');

    // If same card clicked again, just collapse
    if (expandedArtist === name) {
      expandedArtist = null;
      return;
    }

    expandedArtist = name;
    cardEl.classList.add('expanded');

    const lookups = [fullArtistMap, artistMap];
    let data = null;
    for (const m of lookups) {
      if (m[name]) { data = m[name]; break; }
    }
    if (!data) { expandedArtist = null; return; }

    const watched = watchedArtists.includes(normalizeArtistName(name));
    const now = new Date();
    const filteredEvents = data.events.filter(ev => {
      const d = parseEventDateTime(ev.dateStr, ev.time);
      return d && d > now;
    });
    if (filteredEvents.length === 0) {
      expandedArtist = null;
      cardEl.classList.remove('expanded');
      return;
    }
    const venues = new Set(filteredEvents.map(e => e.venueName));

    const detail = document.createElement('div');
    detail.className = 'card-detail-expanded';
    detail.innerHTML = `
      <div class="cd-header">
        <span class="cd-subtitle">${filteredEvents.length} concert${filteredEvents.length !== 1 ? 's' : ''} · ${venues.size} venue${venues.size !== 1 ? 's' : ''} · </span>
        <span class="follow-artist${watched ? ' followed' : ''}" data-artist="${escapeHtml(name)}">${watched ? '✓ Following' : '+ Follow artist'}</span>
      </div>
      ${filteredEvents.map(ev => `
        <div class="detail-event">
          <div class="de-header">
            <span class="de-time">${escapeHtml(ev.time)}</span>
            <span class="de-date">${escapeHtml(ev.dayOfWeek)} · ${escapeHtml(ev.dateStr)}</span>
          </div>
          <div class="de-venue">${ev.venueHref
            ? `<a href="${normalizeUrl(ev.venueHref)}" target="_blank">${escapeHtml(ev.venueName)}</a>`
            : escapeHtml(ev.venueName)}
          </div>
          <div class="de-address">
            ${escapeHtml(ev.address)}
            ${ev.address ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.address)}" target="_blank">Map</a>` : ''}
          </div>
          <div class="de-actions">
            <a href="${escapeHtml(ev.venueHref ? normalizeUrl(ev.venueHref) : '#')}" target="_blank" ${!ev.venueHref ? 'style="display:none"' : ''}>Venue Info</a>
            ${ev.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.address)}" target="_blank">Map</a>` : ''}
            <a href="#" class="calendar-link" data-date="${escapeHtml(ev.dateStr)}" data-time="${escapeHtml(ev.time)}" data-venue="${escapeHtml(ev.venueName)}" data-address="${escapeHtml(ev.address)}">📅 Calendar</a>
          </div>
        </div>
      `).join('')}
    `;

    cardEl.insertAdjacentElement('afterend', detail);

    // Attach ICS handlers
    detail.querySelectorAll('.calendar-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        downloadICS({
          dateStr: el.dataset.date,
          time: el.dataset.time,
          venueName: el.dataset.venue,
          address: el.dataset.address,
        });
      });
    });

    // Attach follow handler
    detail.querySelector('.follow-artist')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleWatchArtist(e.currentTarget.dataset.artist, e.currentTarget);
    });

    cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Export analysis data for offline review ──

  function exportAnalysisData() {
    const exportData = {
      exportedAt: new Date().toISOString(),
      filter: currentFilter,
      eventCount: events.length,
      artistCount: Object.keys(artistMap).length,
      events: events.map(ev => ({
        date: ev.dateStr,
        day: ev.dayOfWeek,
        time: ev.time,
        venue: ev.venueName,
        address: ev.address,
        infoText: ev.infoText,
        // All lines that match structural patterns
        structuredLines: extractStructuredLines(ev.infoText),
        // Artists detected by the main extraction
        detectedArtists: extractArtists(ev.infoText),
        // Keywords found in this event
        keywords: extractKeywords(ev.infoText),
      })),
      artistSummary: Object.entries(artistMap)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, data]) => ({
          artist: name,
          count: data.count,
          events: data.events.map(ev => `${ev.dateStr} ${ev.time} at ${ev.venueName}`),
        })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echtzeitmusik-analysis-${currentFilter}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Extract all lines that match structural patterns, with their match details
  function extractStructuredLines(infoText) {
    const results = [];
    const lines = infoText.split(/\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      let m, type, namePart, afterPart;

      m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (m) { type = 'dash'; namePart = m[1].trim(); afterPart = m[2].trim(); }

      if (!type) { m = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/); if (m) { type = 'parens'; namePart = m[1].trim(); afterPart = m[2].trim(); } }
      if (!type) { m = line.match(/^(.+?)\s+>\s+(.+)$/); if (m) { type = 'gt'; namePart = m[1].trim(); afterPart = m[2].trim(); } }
      if (!type) { m = line.match(/^([A-Z][a-z\u00C0-\u024F]+(?:\s+[A-Za-z\u00C0-\u024F'.]+){0,3})\s*:\s+(.+)$/); if (m) { type = 'colon'; namePart = m[1].trim(); afterPart = m[2].trim(); } }
      if (!type) { m = line.match(/^(.+?)\s*\|\s+(.+)$/); if (m) { type = 'pipe'; namePart = m[1].trim(); afterPart = m[2].trim(); } }
      if (!type) { m = line.match(/^([A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+(?:\s+[A-Za-z\u00C0-\u024F'.]+){0,3})\s*,\s+(.+)$/); if (m && line.length < 90) { type = 'comma'; namePart = m[1].trim(); afterPart = m[2].trim(); } }

      if (type) {
        results.push({
          raw: line,
          type,
          namePart,
          afterPart,
          nameLooksValid: looksLikePersonName(namePart),
          afterContainsInstrument: containsInstrumentCheck(afterPart),
        });
      }
    }
    return results;
  }

  // Simple instrument-word check for export analysis
  const EXPORT_INST_SET = new Set([
    'piano','guitar','bass','drums','sax','saxophone','trumpet','violin','cello','viola',
    'flute','clarinet','percussion','electronics','synth','synthesizer','voice','vocals','voc',
    'turntables','turntable','keyboard','keys','organ','harp','accordion','trombone','horn','tuba',
    'banjo','mandolin','double bass','modular synth','objects','daxophone','marimba',
    'vibraphone','glockenspiel','xylophone','bassoon','oboe','recorder','recorders',
    'live electronics','sampling','sample','field recordings','amplifier',
    'sequencer','mixer','effector',
    'gitarre','klavier','schlagzeug','saxophon','trompete','posaune','geige','bratsche',
    'flöte','blockflöte','klarinetten','violoncello','schlagwerk','bassklarinette',
    'stimme','gesang','elektronik','mischpult',
    'prepared piano','inside piano','ext. guitar','feedbacker','feedback',
    'butoh','dance','poetry','spoken word','movements',
    'video','visuals','installation','sound art','performance','composition',
    'bartender','curation','sounddesign','live set',
  ]);

  function containsInstrumentCheck(text) {
    const t = text.toLowerCase();
    const words = t.split(/[\s,;/]+/).filter(Boolean);
    for (const w of words) {
      const clean = w.replace(/[^a-z0-9]/g, '');
      if (clean.length > 0 && EXPORT_INST_SET.has(clean)) return true;
    }
    return false;
  }

  function toggleWatchArtist(name, el) {
    name = normalizeArtistName(name);
    const idx = watchedArtists.indexOf(name);
    if (idx === -1) {
      watchedArtists.push(name);
      el.textContent = '✓ Following';
      chrome.runtime.sendMessage({ action: 'artistFollowed', name }).catch(() => {});
    } else {
      watchedArtists.splice(idx, 1);
      el.textContent = '+ Follow artist';
    }
    el.classList.toggle('followed');
    chrome.storage.local.set({ watchedArtists });
    // Also update table cells
    document.querySelectorAll(`.follow-artist[data-artist="${CSS.escape(name)}"]`).forEach(other => {
      if (other === el) return;
      other.textContent = el.textContent === '✓ Following' ? '✓ Following' : '+ Follow';
      other.classList.toggle('followed');
    });
  }

  /* -------- HELPERS -------- */

  function downloadICS(event) {
    const [day, month, year] = event.dateStr.replace(/\.\s*/g, '.').split('.').filter(Boolean);
    const [hour, minute] = event.time.split('.');

    const fullYear = year.length === 2 ? '20' + year : year;
    const dtStart = `${fullYear}${month.padStart(2,'0')}${day.padStart(2,'0')}T${hour.padStart(2,'0')}${minute.padStart(2,'0')}00`;

    // End ~2 hours later
    const endH = String(parseInt(hour) + 2).padStart(2, '0');
    const dtEnd = `${fullYear}${month.padStart(2,'0')}${day.padStart(2,'0')}T${endH}${minute.padStart(2,'0')}00`;

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//echtzeitmusik-extension//EN',
      'BEGIN:VEVENT',
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${event.venueName}`,
      `LOCATION:${event.address}`,
      'END:VEVENT',
      'END:VCALENDAR'
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

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function normalizeUrl(href) {
    if (href.startsWith('/')) return 'https://echtzeitmusik.de' + href;
    if (!href.startsWith('http')) return 'https://' + href;
    return href;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  /* -------- CALENDAR -------- */

  function renderCalendar() {
    const cs = document.getElementById('calendar-section');
    document.querySelectorAll('#overview, #keywords-section, #top-artists, #following-section').forEach(el => el.classList.add('hidden'));
    cs.classList.remove('hidden');

    const month = calDate.getMonth();
    const year = calDate.getFullYear();
    document.getElementById('cal-month-label').textContent = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const calEvents = events.filter(ev => {
      const d = parseEventDateTime(ev.dateStr, ev.time);
      if (!d) return false;
      if (d.getFullYear() !== year || d.getMonth() !== month) return false;
      return watchedArtists.some(a => ev.infoText.toLowerCase().includes(a.toLowerCase()));
    });

    calEvents.sort((a, b) => {
      const da = parseEventDateTime(a.dateStr, a.time);
      const db = parseEventDateTime(b.dateStr, b.time);
      return da - db || a.time.localeCompare(b.time);
    });

    const dayGroups = {};
    calEvents.forEach(ev => {
      const d = parseEventDateTime(ev.dateStr, ev.time);
      const day = d.getDate();
      if (!dayGroups[day]) dayGroups[day] = [];
      dayGroups[day].push(ev);
    });

    renderCalRuler(dayGroups, month, year);
    renderCalTimeline(dayGroups);
  }

  function renderCalRuler(dayGroups, month, year) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;

    let html = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const hasEvents = !!dayGroups[d];
      const isToday = isCurrentMonth && d === today.getDate();
      html += `<div class="cal-ruler-day${hasEvents ? ' has-events' : ''}${isToday ? ' today' : ''}">
        <span class="day-num">${d}</span>
        <span class="day-dot" style="background:${hasEvents ? '#ffd54f' : 'transparent'}"></span>
      </div>`;
    }
    document.getElementById('cal-ruler').innerHTML = html;
  }

  function renderCalTimeline(dayGroups) {
    const container = document.getElementById('cal-timeline');
    const days = Object.keys(dayGroups).map(Number).sort((a, b) => a - b);

    if (days.length === 0) {
      container.innerHTML = '<div class="cal-empty">No concerts from followed artists this month. Track some with +Follow on the Schedule tab.</div>';
      return;
    }

    const monthName = calDate.toLocaleDateString('en-US', { month: 'short' });

    let html = '';
    days.forEach(day => {
      const evs = dayGroups[day];
      const weekday = new Date(calDate.getFullYear(), calDate.getMonth(), day).toLocaleDateString('en-US', { weekday: 'short' });
      html += `<div class="cal-day-group">
        <div class="cal-day-marker has-events">${day}</div>
        <div class="cal-day-header">${monthName} ${day} · ${weekday}</div>`;
      evs.forEach(ev => {
        const artists = watchedArtists.filter(a => ev.infoText.toLowerCase().includes(a.toLowerCase()));
        const artistStr = artists.map(escapeHtml).join(', ');
        html += `<div class="cal-event">
          <span class="cal-event-time">${ev.time}</span>
          <span class="cal-event-artist">${escapeHtml(artistStr)}</span>
          <span class="cal-event-venue">${escapeHtml(ev.venueName)}</span>
        </div>`;
      });
      html += '</div>';
    });

    container.innerHTML = html;
  }

  // Calendar navigation
  document.getElementById('cal-prev').addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() + 1);
    renderCalendar();
  });

  // ── Floating toast notification (in-page) ──

  const dismissedIds = new Set();
  const shownIds = new Set();
  let notifMode = 'silent';

  function loadState() {
    chrome.storage.local.get(['dismissedNotifIds', 'shownToastIds', 'notifMode'], (result) => {
      (result.dismissedNotifIds || []).forEach(id => dismissedIds.add(id));
      (result.shownToastIds || []).forEach(id => shownIds.add(id));
      notifMode = result.notifMode || 'silent';
      // On-load check — only for IDs not already shown
      chrome.storage.local.get('unreadNotifications', (result) => {
        const list = result.unreadNotifications || [];
        for (const n of list) {
          if (shouldSkip(n.id)) continue;
          showToast(n.artistName, n.eventInfo, n.id);
          persistShown(n.id);
        }
      });
    });
  }
  loadState();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.dismissedNotifIds) {
      (changes.dismissedNotifIds.newValue || []).forEach(id => dismissedIds.add(id));
    }
    if (changes.notifMode) {
      notifMode = changes.notifMode.newValue || 'silent';
    }
    if (changes.shownToastIds) {
      (changes.shownToastIds.newValue || []).forEach(id => shownIds.add(id));
    }
  });

  function shouldSkip(id) {
    return notifMode === 'off' || dismissedIds.has(id) || shownIds.has(id);
  }

  function persistShown(id) {
    shownIds.add(id);
    chrome.storage.local.get('shownToastIds', (result) => {
      const list = result.shownToastIds || [];
      if (list.includes(id)) return;
      list.push(id);
      chrome.storage.local.set({ shownToastIds: list });
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'showToast' && !shouldSkip(msg.notifId)) {
      showToast(msg.artistName, msg.eventInfo, msg.notifId);
      persistShown(msg.notifId);
    }
  });

  function persistDismiss(notifId) {
    dismissedIds.add(notifId);
    chrome.storage.local.get('dismissedNotifIds', (result) => {
      const list = result.dismissedNotifIds || [];
      if (list.includes(notifId)) return;
      list.push(notifId);
      chrome.storage.local.set({ dismissedNotifIds: list });
    });
  }

  function showToast(artist, info, notifId) {
    if (shouldSkip(notifId)) return;

    let container = document.getElementById('ech-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'ech-toast-container';
      container.style.cssText = 'all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column-reverse;gap:8px;';
      document.body.appendChild(container);
    }

    const host = document.createElement('div');
    host.style.cssText = 'all:initial;';

    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
  <style>
  *{margin:0;padding:0;box-sizing:border-box}
  .to {
    background:#1e1e0a;border:1px solid #4a4a1a;border-left:3px solid #ffd54f;
    border-radius:6px;padding:10px 14px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;
    color:#e0e0e0;max-width:380px;box-shadow:0 4px 16px rgba(0,0,0,0.4);
    display:flex;align-items:flex-start;gap:8px;animation:in .3s ease;
  }
  @keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .i{flex:1;min-width:0}
  .a{font-weight:700;color:#ffd54f}
  .d{color:#bbb;margin-top:2px}
  .x{flex-shrink:0;background:none;border:none;color:#666;cursor:pointer;font-size:16px;padding:2px;line-height:1}
  .x:hover{color:#e57373}
  </style>
  <div class="to"><div class="i"><div class="a">${esc(artist)}</div><div class="d">${esc(info)}</div></div><button class="x">✕</button></div>`;

    container.appendChild(host);

    const btn = shadow.querySelector('.x');
    btn.onclick = () => {
      host.remove();
      if (notifId) persistDismiss(notifId);
    };

    const timeout = 5000;
    setTimeout(() => {
      if (host.parentNode) host.remove();
    }, timeout);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // Read filter from URL hash (e.g. #today)
  const hashFilter = location.hash.replace('#', '');
  const validFilters = ['today', 'tomorrow', 'next7', 'month', 'all', 'following', 'calendar'];
  if (hashFilter && validFilters.includes(hashFilter)) {
    currentFilter = hashFilter;
    document.querySelectorAll('.filter-bar button').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === currentFilter);
    });
  }

  loadAndAnalyze(currentFilter);
});
