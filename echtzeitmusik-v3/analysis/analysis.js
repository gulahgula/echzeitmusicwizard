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
  // Collaborators are sourced from the ARCHIVE (all stored events), not the live
  // feed, and only surface once a pair has shared a SET in 2+ different events
  // (collection is per performance block, so same-set is the pairing unit).
  const COLLAB_MIN_SHARED = 2;
  let collabIndex = new Map();
  let keywordFilter = null;
  let expandedArtist = null;
  let calDate = new Date();
  

  async function initAnalysis() {
    const result = await chrome.storage.local.get(['watchedArtists']);
    watchedArtists = [...new Set((result.watchedArtists || []).map(n => normalizeArtistName(n)))];

    // One-time repair: a past bug wrote the catalogue's lowercased
    // normalizedKey ("antonio borghini") into watchedArtists instead of the
    // display name ("Antonio Borghini"). Lookups elsewhere (artistMap[name],
    // watchedArtists.includes(normalizeArtistName(name))) are exact-case, so
    // a corrupted entry silently breaks "Following" and disappears from the
    // calendar. Recover proper casing from the catalogue, keyed by the same
    // lowercased normalizedKey the bug wrote.
    if (typeof CatalogueDB !== 'undefined' && watchedArtists.length > 0) {
      for (let i = 0; i < watchedArtists.length; i++) {
        const entry = watchedArtists[i];
        if (entry === entry.toLowerCase() && entry !== entry.toUpperCase()) {
          try {
            const record = await CatalogueDB.getArtist(entry.toLowerCase());
            if (record?.name) watchedArtists[i] = normalizeArtistName(record.name);
          } catch (e) { /* catalogue unavailable — leave as-is */ }
        }
      }
      watchedArtists = [...new Set(watchedArtists)];
    }

    if (watchedArtists.join(',') !== (result.watchedArtists || []).join(',')) {
      chrome.storage.local.set({ watchedArtists });
    }

    // Read filter from URL hash (e.g. #today)
    const hashFilter = location.hash.replace('#', '');
    const validFilters = ['today', 'tomorrow', 'next7', 'month', 'all', 'following', 'calendar', 'catalogue'];
    if (hashFilter && validFilters.includes(hashFilter)) {
      currentFilter = hashFilter;
      document.querySelectorAll('.filter-bar button').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === currentFilter);
      });
    }

    loadAndAnalyze(currentFilter);
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.watchedArtists) {
      watchedArtists = changes.watchedArtists.newValue || [];
      renderArtistTable();
      renderFollowing();
      if (currentFilter === 'calendar') renderCalendar();
    }
  });

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

    // Catalogue tab: load from IndexedDB, no fetch needed
    if (filter === 'catalogue') {
      await renderCatalogue();
      loading.classList.add('hidden');
      main.classList.remove('hidden');
      return;
    }

    const isCalendar = filter === 'calendar';
    const isFollowing = filter === 'following';
    const fetchFilter = (isFollowing || isCalendar) ? 'all' : filter;
    const url = `https://echtzeitmusik.de/index.php?page=calendar&filter=${fetchFilter}`;

    try {
      let html = getCached(url);
      if (!html) {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const dec = new TextDecoder('windows-1252');
        html = fixMojibake(dec.decode(buf));
        setCache(url, html);
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const allParseEvents = parseEvents(doc);

      // Auto-collect ALL artists from events into local catalogue
      collectAllArtists(allParseEvents).catch(() => {});

      // Load archive-derived collaborators (3+ shared events) for card display.
      await loadCollabIndex();

      if (isCalendar) {
        events = allParseEvents;
        renderCalendar();
        main.classList.remove('hidden');
        return;
      }

      if (isFollowing && watchedArtists.length > 0) {
        events = allParseEvents.filter(ev =>
          watchedArtists.some(a => matchesArtist(ev.infoText, a))
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
            const dec = new TextDecoder('windows-1252');
            fullHtml = fixMojibake(dec.decode(buf));
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

      document.querySelectorAll('#calendar-section, #catalogue-section').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('#overview, #keywords-section, #top-artists, #following-section').forEach(el => el.classList.remove('hidden'));
      main.classList.remove('hidden');
    } catch (err) {
      showError('Failed to load: ' + err.message);
    } finally {
      loading.classList.add('hidden');
    }
  }

  function parseEvents(doc) {
    const anchors = doc.querySelectorAll('a[name^="centry."]');
    const result = [];

    for (const anchor of anchors) {
      const tr1 = anchor.parentElement?.parentElement;
      if (!tr1 || tr1.tagName !== 'TR') continue;
      const tr2 = tr1.nextElementSibling;
      const tr3 = tr2?.nextElementSibling;
      if (!tr2 || !tr3) continue;

      const day = (tr1.querySelector('td.datum:nth-child(2)')?.textContent || '').replace(/\D/g, '');
      const month = (tr1.querySelector('td.datum:nth-child(3)')?.textContent || '').replace(/\D/g, '');
      const sourceYear = (tr1.querySelector('td.datum:nth-child(4)')?.textContent || '').replace(/\D/g, '');
      const dateStr = buildDateStr(day, month, sourceYear);

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
          venueName = fixVenueSpacing(link.textContent?.replace(/\s+/g, ' ').trim() || '');
          venueHref = link.getAttribute('href') || '';
        } else {
          venueName = fixVenueSpacing(venueTd.textContent?.replace(/\s+/g, ' ').trim() || '');
        }
      }

      const infoDiv = tr3.querySelector('.calender-entry-info');
      const rawText = infoDiv ? (infoDiv.textContent || '') : '';
      const infoHTML = (infoDiv ? infoDiv.innerHTML : '')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
      const infoText = rawText
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .trim();

      // Extract all artist links from infoHTML
      const artistLinks = extractArtistLinks(infoHTML, infoText);

      result.push({ dateStr, dayOfWeek, time, address, venueName, venueHref, infoText, infoHTML, artistLinks });
    }

    return result;
  }

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
    // Structure-first engine (shared/extractor.js)
    return extractEventArtists(infoText).artists.map(x => x.name);
  }

  // Variant name groups — first entry is canonical
  const VARIANT_GROUPS = [
    ['fabiana striffler', 'fabiana strifler'],
    ['aki takase', 'akio takase'],
    ['ipek odabasi', 'ipek odabaşı'],
    ['silvio annese', 'silvio annesse'],
    ['rodolfo paccabelo', 'rodolfo pacapelo'],
    ['tomas becket', 'tomás becket'],
  ];
  const VARIANT_MAP = new Map();
  for (const group of VARIANT_GROUPS) {
    const canonical = normalizeArtistName(group[0]);
    for (const variant of group) {
      VARIANT_MAP.set(normalizeArtistName(variant), canonical);
    }
  }

  function resolveVariant(name) {
    const key = normalizeArtistName(name);
    return VARIANT_MAP.get(key) || key;
  }

  // Merge collaborator variants and sort by frequency.
  // Accepts either { name: count } dict or [{ name, count }] array or string[].
  function mergeCollabVariants(collabs) {
    const entries = Array.isArray(collabs) ? collabs : Object.entries(collabs).map(function(e) { return { name: e[0], count: e[1] }; });
    const merged = new Map();
    for (const entry of entries) {
      const rawName = typeof entry === 'string' ? entry : entry.name;
      const count = typeof entry === 'string' ? 1 : (entry.count || 1);
      const key = resolveVariant(rawName);
      if (merged.has(key)) {
        merged.get(key).count += count;
      } else {
        merged.set(key, { name: rawName, count: count });
      }
    }
    return [...merged.values()].sort(function(a, b) { return b.count - a.count; });
  }

  function buildArtistMap(events) {
    const map = {};

    events.forEach(ev => {
      const names = extractArtists(ev.infoText);
      const blocks = extractPerformanceBlocks(ev.infoText);

      // Collect all unique artist names from both extraction methods
      const allNames = new Set(names);
      for (const block of blocks) {
        for (const n of block) {
          if (looksLikePersonName(n) && !looksLikeNonArtist(n)) {
            allNames.add(n);
          }
        }
      }

      const collapsedNames = collapseSurnameOnly([...allNames]);
      for (const name of collapsedNames) {
        const key = normalizeArtistName(name);
        if (!map[key]) map[key] = { count: 0, events: [], artistLinks: {}, instruments: {}, collaborators: {}, genres: {} };
        map[key].count++;
        map[key].events.push(ev);

        // Merge artist links from this event (match by normalized name)
        if (ev.artistLinks) {
          for (const [linkName, links] of Object.entries(ev.artistLinks)) {
            if (normalizeArtistName(linkName) === key) {
              for (const [platform, url] of Object.entries(links)) {
                if (url && !map[key].artistLinks[platform]) {
                  map[key].artistLinks[platform] = url;
                }
              }
            }
          }
        }

        // Extract instruments for this artist from this event, expanding abbreviations
        const instruments = catExtractInstruments(name, ev.infoText);
        for (const inst of instruments) {
          const expanded = expandSingleInstrument(inst).toLowerCase();
          map[key].instruments[expanded] = (map[key].instruments[expanded] || 0) + 1;
        }

        // Extract genres from this event, scoped to this artist's lines
        const genres = extractGenres(ev.infoText, name);
        for (const g of genres) {
          const norm = g.toLowerCase();
          map[key].genres[norm] = (map[key].genres[norm] || 0) + 1;
        }

        // Extract collaborators: other artists in the same performance block
        // Deduplicate per event — each collaborator counts at most once per event
        const seenCollabs = new Set();
        const lowerKey = key.toLowerCase();
        for (const block of blocks) {
          if (block.some(n => resolveVariant(n).toLowerCase() === lowerKey)) {
            for (const n of block) {
              const collabKey = resolveVariant(n).toLowerCase();
              if (collabKey !== lowerKey && !seenCollabs.has(collabKey)) {
                seenCollabs.add(collabKey);
                map[key].collaborators[collabKey] = (map[key].collaborators[collabKey] || 0) + 1;
              }
            }
          }
        }
      }
    });

    return map;
  }



  const KW_SET = new Set([
    ...INSTRUMENT_SET,
    ...EXTRA_KW_SET,
  ]);

  // Map abbreviation keywords to display names (single letters and short abbrevs)
  const KW_DISPLAY_MAP = new Map([
    ['g', 'guitar'], ['b', 'bass'], ['p', 'piano'], ['v', 'violin'], ['s', 'saxophone'],
    ['dr', 'drums'], ['tb', 'trombone'], ['tp', 'trumpet'], ['trp', 'trumpet'], ['trpt', 'trumpet'],
    ['pc', 'percussion'], ['perc', 'percussion'], ['vl', 'violin'], ['vc', 'cello'],
    ['va', 'viola'], ['db', 'double bass'], ['cb', 'contrabass'], ['bg', 'bass guitar'],
    ['cl', 'clarinet'], ['bcl', 'bass clarinet'], ['fl', 'flute'], ['picc', 'piccolo'],
    ['ob', 'oboe'], ['bn', 'bassoon'], ['eh', 'english horn'],
    ['sax', 'saxophone'], ['alt', 'alto sax'], ['tsax', 'tenor sax'], ['ssax', 'soprano sax'], ['bsax', 'baritone sax'],
    ['tpt', 'trumpet'], ['hn', 'horn'], ['euph', 'euphonium'], ['tba', 'tuba'],
    ['keys', 'keyboard'], ['keyb', 'keyboard'], ['synth', 'synthesizer'], ['syn', 'synthesizer'],
    ['mod', 'modular synth'], ['samp', 'sampler'], ['loop', 'looper'],
    ['fx', 'effects'], ['pedal', 'effects'], ['laptop', 'laptop'], ['comp', 'computer'],
    ['electr', 'electronics'], ['elektr', 'electronics'], ['live e', 'live electronics'], ['live el', 'live electronics'],
    ['turnt', 'turntables'], ['tt', 'turntables'], ['djing', 'djing'], ['dj', 'djing'],
    // With dots
    ['git', 'guitar'], ['gtr', 'guitar'], ['e-g', 'electric guitar'], ['e-gtr', 'electric guitar'], ['egtr', 'electric guitar'],
    ['e-b', 'electric bass'], ['e-bass', 'electric bass'], ['ebs', 'electric bass'],
    ['e-p', 'electric piano'], ['e-pno', 'electric piano'], ['pno', 'piano'], ['kl', 'klavier'], ['klav', 'klavier'],
    ['vn', 'violin'], ['vln', 'violin'], ['vlc', 'cello'], ['va', 'viola'],
    ['sax', 'saxophone'], ['trp', 'trumpet'], ['tb', 'trombone'], ['pc', 'percussion'], ['perc', 'percussion'],
    ['vln', 'violin'], ['vlc', 'cello'], ['db', 'double bass'], ['cb', 'contrabass'], ['bg', 'bass guitar'],
    ['e-p', 'electric piano'], ['e-g', 'electric guitar'], ['e-b', 'electric bass'],
  ]);

  function getDisplayKeyword(kw) {
    const lower = kw.toLowerCase();
    return KW_DISPLAY_MAP.get(lower) || kw;
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // One shared definition of "this artist's keywords in this event":
  // credited instruments + genres via extractGenres (artist-scoped, with the
  // small-event fallback). Pills are built from this AND pill-click filtering
  // matches against this — same source, so a pill can never return no artists.
  function artistKeywords(artistName, infoText) {
    const found = new Set();
    catExtractInstruments(artistName, infoText)
      .forEach(inst => found.add(foldDiacritics(expandSingleInstrument(inst))));
    extractGenres(infoText, artistName)
      .forEach(g => found.add(foldDiacritics(g)));
    return found;
  }

  function extractKeywords(infoText) {
    // Union of every performer's keywords — strictly artist-derived, so the
    // pill list mirrors what filtering can actually find.
    const r = extractEventArtists(infoText);
    const found = new Set();
    for (const art of r.artists) {
      artistKeywords(art.name, infoText).forEach(k => found.add(k));
    }
    return [...found].sort();
  }


  // Check if an artist is directly associated with a keyword on the same structural line
  // e.g. "Simon Rose - baritone saxophone" → sax matches Simon Rose
  //      "Lorena Izquierdo - voice, actions" → sax does NOT match Lorena
  function artistMatchesKeyword(artistName, infoText, keyword) {
    // Same source as the pills (artistKeywords) — consistency by construction.
    const kw = foldDiacritics(keyword);
    for (const k of artistKeywords(artistName, infoText)) {
      if (k === kw || k.includes(kw) || kw.includes(k)) return true;
    }
    return false;
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
      `<span class="kw-pill${kw === keywordFilter ? ' kw-active' : ''}" data-kw="${escapeHtml(kw)}" aria-label="Filter by ${escapeHtml(getDisplayKeyword(kw))} — ${cnt} events" tabindex="0">${escapeHtml(getDisplayKeyword(kw))} <span class="kw-count">${cnt}</span></span>`
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
      const artistLinks = data.artistLinks || {};
      const discovery = createMusicSearchLinks(name, artistLinks);
      const searchLinksHtml = discovery.outerHTML;
      const instruments = Object.entries(data.instruments || {}).sort((a, b) => b[1] - a[1]).map(([n]) => expandSingleInstrument(n));
      const genres = Object.entries(data.genres || {}).sort((a, b) => b[1] - a[1]).map(([n]) => n);
      const metaParts = [];
      metaParts.push(instruments.length > 0 ? escapeHtml(instruments.join(', ')) : '<span class="meta-empty">—</span>');
      metaParts.push(genres.length > 0 ? escapeHtml(genres.join(', ')) : '<span class="meta-empty">—</span>');
      return `<div class="artist-card" data-artist="${escapeHtml(name)}" tabindex="0" role="button" aria-label="Show ${escapeHtml(name)}'s concerts">
        <span class="rank">${i + 1}</span>
        <div class="info">
          <div class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="artist-meta">${metaParts.join(' · ')}</div>
          ${venueInfo ? `<div class="venue-preview" title="${escapeHtml(venueInfo)}">${escapeHtml(venueInfo)}</div>` : ''}
        </div>
        <div class="artist-links">${searchLinksHtml}</div>
        <div class="right-col">
          ${!isSingleDay ? `<span class="count ${data.count >= 5 ? 'freq-5' : data.count >= 4 ? 'freq-4' : data.count >= 3 ? 'freq-3' : data.count >= 2 ? 'freq-2' : ''}">${data.count}x</span>` : ''}
          <span class="follow-artist${watched ? ' followed' : ''}" data-artist="${escapeHtml(name)}">${watched ? '✓ Following' : '+ Follow'}</span>
        </div>
      </div>`;
    }

    function attachHandlers() {
      artistList.querySelectorAll('.artist-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.follow-artist, .artist-actions')) return;
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

  async function toggleArtistExpand(name, cardEl) {
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

    const lookups = [artistMap, fullArtistMap];
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

    // Build instruments list sorted by frequency
    const instruments = Object.entries(data.instruments)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => expandSingleInstrument(name));

    // Build genres list sorted by frequency
    const genres = Object.entries(data.genres)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => name);

    // Collaborators come from the ARCHIVE (all stored events), filtered to pairs
    // that have shared 3+ events — not the current feed. This list grows as the
    // catalogue accumulates. Empty until a pairing crosses the threshold.
    const collaborators = archiveCollaborators(name)
      .filter(function(c) { return c.name.toLowerCase() !== name.toLowerCase(); })
      .slice(0, 12);

    // Build artist links for detail
    const detailLinks = [];
    if (data.artistLinks?.bandcamp) detailLinks.push({ label: 'Bandcamp', url: data.artistLinks.bandcamp });
    if (data.artistLinks?.soundcloud) detailLinks.push({ label: 'SoundCloud', url: data.artistLinks.soundcloud });
    if (data.artistLinks?.youtube) detailLinks.push({ label: 'YouTube', url: data.artistLinks.youtube });
    if (data.artistLinks?.spotify) detailLinks.push({ label: 'Spotify', url: data.artistLinks.spotify });
    if (data.artistLinks?.website) detailLinks.push({ label: 'Website', url: data.artistLinks.website });

    const detail = document.createElement('div');
    detail.className = 'card-detail-expanded';
    detail.innerHTML = `
      <div class="cd-header">
        <span class="cd-subtitle">${filteredEvents.length} concert${filteredEvents.length !== 1 ? 's' : ''} · ${venues.size} venue${venues.size !== 1 ? 's' : ''} · </span>
        <span class="follow-artist${watched ? ' followed' : ''}" data-artist="${escapeHtml(name)}">${watched ? '✓ Following' : '+ Follow artist'}</span>
      </div>
      ${instruments.length > 0 ? `<div class="detail-section"><strong>Instruments:</strong> ${instruments.map(i => escapeHtml(i)).join(', ')}</div>` : ''}
      ${genres.length > 0 ? `<div class="detail-section"><strong>Genres:</strong> ${genres.map(g => escapeHtml(g)).join(', ')}</div>` : ''}
      ${collaborators.length > 0 ? `<div class="detail-section"><strong>Frequent collaborators:</strong> ${collaborators.map(c => `${escapeHtml(c.name)} <span class="detail-count">(${c.count})</span>`).join(', ')}</div>` : ''}
      <div class="detail-section"><strong>Upcoming events:</strong>
        ${filteredEvents.map(ev => `
          <div class="detail-event">
            <div class="de-header">
              <span class="de-time">${escapeHtml(ev.time)}</span>
              <span class="de-date">${escapeHtml(ev.dateStr)} · ${escapeHtml(ev.dayOfWeek)}</span>
            </div>
            <div class="de-venue">${ev.venueHref
              ? `<a href="${escapeHtml(normalizeUrl(ev.venueHref))}" target="_blank" rel="noopener">${escapeHtml(ev.venueName)}</a>`
              : escapeHtml(ev.venueName)}
            </div>
            <div class="de-address">
              ${escapeHtml(ev.address)}
              ${ev.address ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.address)}" target="_blank" rel="noopener">Map</a>` : ''}
            </div>
            <div class="de-actions">
              <a href="${escapeHtml(ev.venueHref ? normalizeUrl(ev.venueHref) : '#')}" target="_blank" rel="noopener" ${!ev.venueHref ? 'style="display:none"' : ''}>Venue Info</a>
              ${ev.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.address)}" target="_blank" rel="noopener">Map</a>` : ''}
              <a href="#" class="calendar-link" data-date="${escapeHtml(ev.dateStr)}" data-time="${escapeHtml(ev.time)}" data-venue="${escapeHtml(ev.venueName)}" data-address="${escapeHtml(ev.address)}">📅 Calendar</a>
            </div>
          </div>
        `).join('')}
      </div>
      ${detailLinks.length > 0 ? `<div class="detail-section"><strong>Links:</strong><div class="detail-links">${detailLinks.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" class="detail-link">${escapeHtml(l.label)}</a>`).join('')}</div></div>` : ''}
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

  // Simple instrument-word check for export analysis — uses shared INSTRUMENT_SET from parser.js
  const EXPORT_INST_SET = INSTRUMENT_SET;

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
      chrome.runtime.sendMessage({ action: 'artistFollowed', name }).then(r => {
        if (r?.ok && r.upcoming > 0) {
          showPageToast(`🔔 ${r.artistName}: ${r.eventInfo} (in ${r.label})`);
        } else if (r?.ok) {
          showPageToast(`ℹ No upcoming events found for ${name}`);
        } else {
          showPageToast(`⚠ Could not check events: ${r?.error || 'unknown error'}`);
        }
      }).catch(e => { showPageToast(`⚠ Failed: ${e.message || e}`); });
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

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }



  function renderCalendar() {
    const cs = document.getElementById('calendar-section');
    document.querySelectorAll('#overview, #keywords-section, #top-artists, #following-section, #catalogue-section').forEach(el => el.classList.add('hidden'));
    cs.classList.remove('hidden');

    const month = calDate.getMonth();
    const year = calDate.getFullYear();
    document.getElementById('cal-month-label').textContent = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const calEvents = events.filter(ev => {
      const d = parseEventDateTime(ev.dateStr, ev.time);
      if (!d) return false;
      if (d.getFullYear() !== year || d.getMonth() !== month) return false;
      return watchedArtists.some(a => matchesArtist(ev.infoText, a));
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
        const artists = watchedArtists.filter(a => matchesArtist(ev.infoText, a));
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

  const dismissedIds = new Set();
  const shownIds = new Set();
  let notifMode = 'on';

  function loadState() {
    chrome.storage.local.get(['dismissedNotifIds', 'shownToastIds', 'notifMode'], (result) => {
      (result.dismissedNotifIds || []).forEach(id => dismissedIds.add(id));
      (result.shownToastIds || []).forEach(id => shownIds.add(id));
      notifMode = result.notifMode || 'on';
      // On-load check — only for IDs not already shown
      chrome.storage.local.get('unreadNotifications', async (result) => {
        const list = result.unreadNotifications || [];
        for (const n of list) {
          if (shouldSkip(n.id)) continue;
          showToast(n.artistName, n.eventInfo, n.id);
          persistShown(n.id);
        }
        // Prune shownToastIds: keep only IDs that match current notifications
        const validIds = new Set(list.map(n => n.id));
        const pruned = (result.shownToastIds || []).filter(id => validIds.has(id));
        if (pruned.length !== (result.shownToastIds || []).length) {
          chrome.storage.local.set({ shownToastIds: pruned });
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
      notifMode = changes.notifMode.newValue || 'on';
    }
    if (changes.shownToastIds) {
      (changes.shownToastIds.newValue || []).forEach(id => shownIds.add(id));
    }
  });

  function shouldSkip(id) {
    return notifMode === 'off' || dismissedIds.has(id) || shownIds.has(id);
  }

  function persistGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  function persistSet(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve));
  }

  async function persistShown(id) {
    shownIds.add(id);
    const result = await persistGet('shownToastIds');
    const list = result.shownToastIds || [];
    if (list.includes(id)) return;
    list.push(id);
    await persistSet({ shownToastIds: list });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'showToast' && !shouldSkip(msg.notifId)) {
      showToast(msg.artistName, msg.eventInfo, msg.notifId);
      persistShown(msg.notifId);
    }
  });

  async function persistDismiss(notifId) {
    dismissedIds.add(notifId);
    const result = await persistGet('dismissedNotifIds');
    const list = result.dismissedNotifIds || [];
    if (list.includes(notifId)) return;
    list.push(notifId);
    await persistSet({ dismissedNotifIds: list });
  }

  function showPageToast(message) {
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
  .to{background:#1e1e0a;border:1px solid #4a4a1a;border-left:3px solid #ffd54f;border-radius:6px;padding:10px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#e0e0e0;max-width:380px;box-shadow:0 4px 16px rgba(0,0,0,0.4);display:flex;align-items:flex-start;gap:8px;animation:in .3s ease}
  @keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .msg{flex:1;min-width:0}
  .x{flex-shrink:0;background:none;border:none;color:#666;cursor:pointer;font-size:16px;padding:2px;line-height:1}
  .x:hover{color:#e57373}
  </style><div class="to"><div class="msg">${esc(message)}</div><button class="x">✕</button></div>`;
    container.appendChild(host);
    shadow.querySelector('.x').onclick = () => host.remove();
    setTimeout(() => { if (host.parentNode) host.remove(); }, 5000);
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

  const esc = escapeHtml;

  /* -------- CATALOGUE -------- */

  let catalogueArtists = [];
  let catalogueFiltered = [];

  async function renderCatalogue() {
    // Hide other sections
    document.querySelectorAll('#overview, #keywords-section, #top-artists, #following-section, #calendar-section').forEach(el => el.classList.add('hidden'));
    const cs = document.getElementById('catalogue-section');
    cs.classList.remove('hidden');

    await CatalogueDB.init();
    const removed = await CatalogueDB.dedupEvents();
    // One-time rebuild of corrupted venue/collaborator counts
    const preSyncInfo = await CatalogueDB.getSyncInfo();
    if (!preSyncInfo?.countsRebuilt) {
      await CatalogueDB.rebuildCounts();
      await CatalogueDB.setSyncInfo({ ...preSyncInfo, countsRebuilt: true });
    }
    // Clean any self-collaborations from DB (case-insensitive match)
    const allArtists = await CatalogueDB.getAll();
    for (const a of allArtists) {
      if (!a.collaborators || a.collaborators.length === 0) continue;
      const before = a.collaborators.length;
      a.collaborators = a.collaborators.filter(function(c) {
        return typeof c === 'string' ? c.toLowerCase() !== a.name.toLowerCase() : c.name.toLowerCase() !== a.name.toLowerCase();
      });
      if (a.collaborators.length !== before) await CatalogueDB.putArtist(a);
    }
    // One-time migration: lowercase all normalizedKeys and merge case-variant duplicates
    if (!preSyncInfo?.keysLowered) {
      const allForMerge = await CatalogueDB.getAll();
      const byNorm = new Map();
      for (const a of allForMerge) {
        const norm = a.name.toLowerCase();
        if (!byNorm.has(norm)) byNorm.set(norm, []);
        byNorm.get(norm).push(a);
      }
      for (const [norm, group] of byNorm) {
        if (group.length < 2) {
          // Single entry: just lowercase its key
          const a = group[0];
          const oldKey = a.normalizedKey || a.name;
          const lowered = oldKey.toLowerCase();
          if (lowered !== oldKey) {
            a.normalizedKey = lowered;
            await CatalogueDB.deleteArtist(oldKey);
            await CatalogueDB.putArtist(a);
          }
          continue;
        }
        // Multiple entries: merge into the one with the best data
        group.sort(function(x, y) { return (y.events?.length || 0) - (x.events?.length || 0); });
        const keep = group[0];
        const keepOldKey = keep.normalizedKey || keep.name;
        keep.normalizedKey = norm;
        for (let i = 1; i < group.length; i++) {
          const mergeA = group[i];
          if (mergeA.events) {
            if (!keep.events) keep.events = [];
            for (const ev of mergeA.events) {
              const key = `${ev.date}|${ev.venue || ''}|${(ev.time || '').replace(/[^\d.:]/g, '')}`;
              if (!keep.events.some(function(e) { return `${e.date}|${e.venue || ''}|${(e.time || '').replace(/[^\d.:]/g, '')}` === key; })) {
                keep.events.push(ev);
              }
            }
          }
          if (mergeA.venues) {
            if (!keep.venues) keep.venues = [];
            for (const v of mergeA.venues) {
              const key = v.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (!keep.venues.some(function(w) { return w.name.toLowerCase().replace(/[^a-z0-9]/g, '') === key; })) {
                keep.venues.push(v);
              } else {
                const existing = keep.venues.find(function(w) { return w.name.toLowerCase().replace(/[^a-z0-9]/g, '') === key; });
                existing.count = (existing.count || 0) + (v.count || 0);
              }
            }
          }
          if (mergeA.collaborators) {
            if (!keep.collaborators) keep.collaborators = [];
            for (const c of mergeA.collaborators) {
              if (!keep.collaborators.some(function(kc) { return (typeof kc === 'string' ? kc : kc.name).toLowerCase() === (typeof c === 'string' ? c : c.name).toLowerCase(); })) {
                keep.collaborators.push(c);
              }
            }
          }
          if (mergeA.instruments) {
            if (!keep.instruments) keep.instruments = [];
            for (const inst of mergeA.instruments) {
              if (!keep.instruments.some(function(ki) { return ki.name.toLowerCase() === inst.name.toLowerCase(); })) {
                keep.instruments.push(inst);
              }
            }
          }
          if (mergeA.genres) {
            if (!keep.genres) keep.genres = [];
            for (const g of mergeA.genres) {
              if (!keep.genres.includes(g)) keep.genres.push(g);
            }
          }
          if (mergeA.links) {
            if (!keep.links) keep.links = {};
            for (const [platform, url] of Object.entries(mergeA.links)) {
              if (!keep.links[platform]) keep.links[platform] = url;
            }
          }
          await CatalogueDB.deleteArtist(mergeA.normalizedKey || mergeA.name);
        }
        await CatalogueDB.deleteArtist(keepOldKey);
        await CatalogueDB.putArtist(keep);
      }
      await CatalogueDB.setSyncInfo({ ...preSyncInfo, keysLowered: true });
    }
    // Silently purge any non-artist entries (instruments, noise words, etc.)
    const allRaw = await CatalogueDB.getAll();
    const badKeys = allRaw.filter(a => looksLikeNonArtist(a.name)).map(a => a.normalizedKey);
    for (const k of badKeys) await CatalogueDB.deleteArtist(k);
    // Normalize any un-expanded instrument abbreviations in DB
    for (const a of allRaw) {
      if (badKeys.includes(a.normalizedKey)) continue;
      if (!a.instruments || a.instruments.length === 0) continue;
      let changed = false;
      for (const inst of a.instruments) {
        const expanded = expandSingleInstrument(inst.name);
        if (expanded !== inst.name) { inst.name = expanded; changed = true; }
      }
      if (changed) await CatalogueDB.putArtist(a);
    }
    catalogueArtists = await CatalogueDB.getAll();
    // watchedArtists (chrome.storage.local) is the source of truth for follow
    // state — a catalogue row's own `followed` flag can be stale if the
    // artist was followed from the popup or the top-artist-card instead of
    // from here. Overlay it so the checkmark is always correct on load.
    {
      const watchedSet = new Set(watchedArtists.map(n => normalizeArtistName(n).toLowerCase()));
      for (const a of catalogueArtists) {
        a.followed = watchedSet.has(normalizeArtistName(a.name).toLowerCase());
      }
    }
    // Populate instrument filter
    const instruments = new Set();
    const venues = new Set();
    for (const a of catalogueArtists) {
      if (a.instruments) a.instruments.forEach(i => instruments.add(i.name));
      if (a.venues) a.venues.forEach(v => venues.add(v.name));
    }
    populateCatSelect(document.getElementById('catalogue-filter-instrument'), instruments, 'instrument');
    populateCatSelect(document.getElementById('catalogue-filter-venue'), venues, 'venue');

    applyCatalogueFilters();
  }

  function populateCatSelect(select, values, label) {
    const current = select.value;
    select.innerHTML = `<option value="">All ${label}s</option>`;
    for (const v of [...values].sort()) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
    select.value = current;
  }

  function applyCatalogueFilters() {
    const q = document.getElementById('catalogue-search').value.toLowerCase().trim();
    const inst = document.getElementById('catalogue-filter-instrument').value;
    const venue = document.getElementById('catalogue-filter-venue').value;
    const sort = document.getElementById('catalogue-sort').value;

    catalogueFiltered = catalogueArtists.filter(a => {
      if (q && !catMatchesSearch(a, q)) return false;
      if (inst && !a.instruments?.some(i => i.name === inst)) return false;
      if (venue && !a.venues?.some(v => v.name === venue)) return false;
      return true;
    });

    catalogueFiltered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'recent') return (b.lastSeen || '').localeCompare(a.lastSeen || '');
      if (sort === 'venues') return (b.venues?.length || 0) - (a.venues?.length || 0);
      return (b.events?.length || 0) - (a.events?.length || 0);
    });

    renderCatalogueList();
  }

  function catMatchesSearch(artist, q) {
    if (artist.name.toLowerCase().includes(q)) return true;
    if (artist.aliases?.some(a => a.toLowerCase().includes(q))) return true;
    if (artist.instruments?.some(i => i.name.toLowerCase().includes(q))) return true;
    if (artist.venues?.some(v => v.name.toLowerCase().includes(q))) return true;
    if (artist.genres?.some(g => g.toLowerCase().includes(q))) return true;
    if (artist.tags?.some(t => t.toLowerCase().includes(q))) return true;
    return false;
  }

  function renderCatalogueList() {
    const list = document.getElementById('catalogue-list');
    const count = document.getElementById('catalogue-count');
    const empty = document.getElementById('catalogue-empty');

    if (catalogueArtists.length === 0) {
      list.innerHTML = '';
      count.textContent = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    if (catalogueFiltered.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:24px;color:#555;">No artists match your filters.</div>';
      count.textContent = '0 artists';
      return;
    }

    count.textContent = `${catalogueFiltered.length} artist${catalogueFiltered.length !== 1 ? 's' : ''}`;
    const searchName = (n) => encodeURIComponent(n);

    list.innerHTML = catalogueFiltered.map((a, i) => {
      const instruments = (a.instruments || []).map(inst => expandSingleInstrument(inst.name)).join(', ');
      const topVenues = (a.venues || []).sort((x, y) => (y.count || 0) - (x.count || 0)).slice(0, 3)
        .map(v => `${v.name} (${v.count})`).join(', ');
      const eventCount = a.events?.length || 0;
      const sn = searchName(a.name);
      const artistLinks = a.links || {};
      const discovery = createMusicSearchLinks(a.name, artistLinks);
      const searchLinks = discovery.outerHTML;

      // Detail section (hidden by default, shown on click)
      const allVenues = (a.venues || []).sort((x, y) => (y.count || 0) - (x.count || 0))
        .map(v => `${escapeHtml(v.name)} <span class="detail-count">(${v.count})</span>`).join(', ') || '—';
      const allInstruments = (a.instruments || []).map(inst => escapeHtml(expandSingleInstrument(inst.name))).join(', ') || '—';
      const allGenres = (a.genres || []).join(', ') || '—';
      // Recurring collaborators only (3+ shared events across the archive).
      const collabs = CatalogueDB.filterCollaborators(a, COLLAB_MIN_SHARED).map(function(c) {
        return escapeHtml(c.name) + ' <span class="detail-count">(' + c.count + ')</span>';
      }).join(', ') || '—';
      // The archive keeps every event ever seen. Show upcoming shows first (as
      // is), then the most-recent past shows greyed out — so nothing is lost and
      // the current status reads at a glance.
      const todayStr = new Date().toISOString().slice(0, 10);
      const sortedEvents = (a.events || []).slice().sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      const upcoming = sortedEvents.filter(ev => ev.date && ev.date >= todayStr).reverse();
      const past = sortedEvents.filter(ev => !ev.date || ev.date < todayStr);
      const eventRow = (ev, isPast) =>
        `<div class="detail-event${isPast ? ' detail-event-past' : ''}"><span class="detail-date">${escapeHtml(ev.date || '')}</span> <span class="detail-venue">${escapeHtml(ev.venue || '')}</span></div>`;
      const allEvents = [
        ...upcoming.map(ev => eventRow(ev, false)),
        ...past.slice(0, 12).map(ev => eventRow(ev, true)),
      ].join('') || '<div class="detail-event">No events recorded</div>';
      const pastHidden = Math.max(0, past.length - 12);
      const allEventsHtml = allEvents + (pastHidden ? `<div class="detail-event detail-event-more">+${pastHidden} earlier show${pastHidden !== 1 ? 's' : ''} in the archive</div>` : '');

      // Build artist-specific links (bandcamp, soundcloud, website, youtube, spotify)
      const detailLinks = [];
      if (a.links?.bandcamp) detailLinks.push({ label: 'Bandcamp', url: a.links.bandcamp });
      if (a.links?.soundcloud) detailLinks.push({ label: 'SoundCloud', url: a.links.soundcloud });
      if (a.links?.youtube) detailLinks.push({ label: 'YouTube', url: a.links.youtube });
      if (a.links?.spotify) detailLinks.push({ label: 'Spotify', url: a.links.spotify });
      if (a.links?.website) detailLinks.push({ label: 'Website', url: a.links.website });
      const linkHtml = detailLinks.length > 0 ? detailLinks.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" class="detail-link">${escapeHtml(l.label)}</a>`).join('') : '—';

      return `<div class="catalogue-card" data-key="${esc(a.normalizedKey || a.name)}" tabindex="0">
        <span class="rank">${i + 1}</span>
        <div class="info">
          <div class="name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</div>
          <div class="meta">
            ${instruments ? `<span class="instrument">${escapeHtml(instruments)}</span>` : ''}
            ${(a.genres || []).length > 0 ? `<span class="instrument">${escapeHtml((a.genres || []).slice(0, 2).join(', '))}</span>` : ''}
            · <span class="count">${eventCount} concert${eventCount !== 1 ? 's' : ''}</span>
            ${topVenues ? ` · ${escapeHtml(topVenues)}` : ''}
            ${(a.links?.bandcamp || a.links?.soundcloud) ? `<span class="link-hint" title="Has links from event data">${a.links?.bandcamp ? '🔗' : ''}${a.links?.soundcloud ? ' ☁' : ''}</span>` : ''}
          </div>
        </div>
        <div class="artist-links">${searchLinks}</div>
        <div class="right-col">
          <span class="follow-toggle${a.followed ? ' followed' : ''}" data-key="${esc(a.normalizedKey || a.name)}">${a.followed ? '✓ Following' : '+ Follow'}</span>
        </div>
        <div class="catalogue-detail hidden">
          <div class="detail-section"><strong>Instruments:</strong> ${allInstruments}</div>
          <div class="detail-section"><strong>Genres:</strong> ${allGenres}</div>
          <div class="detail-section"><strong>Venues:</strong> ${allVenues}</div>
          <div class="detail-section"><strong>Frequent collaborators:</strong> ${collabs}</div>
          <div class="detail-section"><strong>Concert history:</strong>${allEventsHtml}</div>
          ${Object.values(artistLinks).some(v => v) ? `<div class="detail-section"><strong>Links:</strong><div class="detail-links">${linkHtml}</div></div>` : ''}
        </div>
      </div>`;
    }).join('');

    // Follow toggles. `watchedArtists` (chrome.storage.local) is the single
    // source of truth for who is followed — read by popup, the Following
    // page, and the calendar view. This handler must only add/remove THIS
    // one artist from that shared array (matching toggleWatchArtist's
    // behaviour), never rebuild the whole array from catalogue records: a
    // rebuild here would silently drop anyone followed via the popup or the
    // top-artist-card, since their catalogue row's `followed` flag is never
    // set by those other entry points. The display name (not the lowercased
    // normalizedKey) is what goes into watchedArtists, so case-sensitive
    // lookups elsewhere (artistMap[name], watchedArtists.includes(...)) keep
    // matching correctly.
    list.querySelectorAll('.follow-toggle').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const artist = catalogueArtists.find(a => (a.normalizedKey || a.name) === key);
        if (!artist) return;
        const displayName = normalizeArtistName(artist.name);
        const idx = watchedArtists.indexOf(displayName);
        const newState = idx === -1;
        if (newState) watchedArtists.push(displayName);
        else watchedArtists.splice(idx, 1);
        await CatalogueDB.setFollowed(artist.normalizedKey || displayName.toLowerCase(), newState);
        artist.followed = newState;
        btn.classList.toggle('followed', newState);
        btn.textContent = newState ? '✓ Following' : '+ Follow';
        chrome.storage.local.set({ watchedArtists });
      });
    });

    // Click to expand/collapse detail
    list.querySelectorAll('.catalogue-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't toggle if clicking a button or link
        if (e.target.closest('.follow-toggle, .artist-actions, a')) return;
        const detail = card.querySelector('.catalogue-detail');
        if (detail) detail.classList.toggle('hidden');
      });
    });
  }

  // Build the archive-derived collaborator index: for every artist in the
  // catalogue, keep only collaborators the pair has shared 3+ events with.
  // Keyed by both normalized key and resolved-variant name so lookups from the
  // feed-derived cards resolve regardless of which form we hold.
  async function loadCollabIndex() {
    collabIndex = new Map();
    if (typeof CatalogueDB === 'undefined') return;
    try {
      await CatalogueDB.init();
      const all = await CatalogueDB.getAll();
      for (const artist of all) {
        const collabs = CatalogueDB.filterCollaborators(artist, COLLAB_MIN_SHARED);
        if (!collabs.length) continue;
        const keys = new Set([
          artist.normalizedKey,
          normalizeArtistName(artist.name || '').toLowerCase(),
          resolveVariant(artist.name || '').toLowerCase(),
        ].filter(Boolean));
        keys.forEach(k => collabIndex.set(k, collabs));
      }
    } catch (e) { /* archive unavailable — cards fall back to no collaborators */ }
  }

  function archiveCollaborators(name) {
    const candidates = [
      normalizeArtistName(name).toLowerCase(),
      resolveVariant(name).toLowerCase(),
      String(name).toLowerCase(),
    ];
    for (const k of candidates) {
      if (collabIndex.has(k)) return collabIndex.get(k);
    }
    return [];
  }

  async function collectAllArtists(parsedEvents) {
    if (typeof CatalogueDB === 'undefined') return;
    await CatalogueDB.init();
    for (const ev of parsedEvents) {
      const blocks = extractPerformanceBlocks(ev.infoText);
      for (const block of blocks) {
        for (const name of block) {
          const instruments = catExtractInstruments(name, ev.infoText);
          const genres = extractGenres(ev.infoText, name);
          const blockCollabs = block.filter(function(n) { return resolveVariant(n).toLowerCase() !== resolveVariant(name).toLowerCase(); });
          const artistLinks = ev.artistLinks?.[name] || { bandcamp: '', soundcloud: '', youtube: '', spotify: '', website: '' };
          await CatalogueDB.upsertFromEvent({
            name,
            instruments,
            genres,
            bandcamp: artistLinks.bandcamp,
            soundcloud: artistLinks.soundcloud,
            youtube: artistLinks.youtube,
            spotify: artistLinks.spotify,
            website: artistLinks.website,
            venue: { name: ev.venueName, city: '' },
            date: catNormalizeDate(ev.dateStr),
            time: ev.time,
            address: ev.address,
            description: ev.infoText,
            collaborators: blockCollabs.map(function(n) { return resolveVariant(n); }),
          });
        }
      }
    }
  }

  // catExtractInstruments and catNormalizeDate are now in shared/parser.js

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  async function findDuplicateCandidates() {
    const all = await CatalogueDB.getAll();
    const candidates = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const keyA = (a.normalizedKey || '').toLowerCase();
        const keyB = (b.normalizedKey || '').toLowerCase();
        if (keyA === keyB) continue; // already same key
        const dist = levenshtein(keyA, keyB);
        if (dist <= 2) {
          candidates.push({ a: a.name, b: b.name, keyA: a.normalizedKey, keyB: b.normalizedKey, dist });
        }
        // Also check if one name contains the other (e.g. "Aki Takase" / "Akio Takase")
        if (keyA.includes(keyB) || keyB.includes(keyA)) {
          const shorter = keyA.length < keyB.length ? keyA : keyB;
          const longer = keyA.length < keyB.length ? keyB : keyA;
          if (longer.length - shorter.length <= 4 && dist > 2) {
            candidates.push({ a: a.name, b: b.name, keyA: a.normalizedKey, keyB: b.normalizedKey, dist, contains: true });
          }
        }
      }
    }
    return candidates;
  }

  // Catalogue filter listeners
  document.getElementById('catalogue-search')?.addEventListener('input', applyCatalogueFilters);
  document.getElementById('catalogue-filter-instrument')?.addEventListener('change', applyCatalogueFilters);
  document.getElementById('catalogue-filter-venue')?.addEventListener('change', applyCatalogueFilters);
  document.getElementById('catalogue-sort')?.addEventListener('change', applyCatalogueFilters);

  initAnalysis();
});
