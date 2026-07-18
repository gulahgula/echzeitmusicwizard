const CatalogueDB = (() => {
  const DB_NAME = 'echzeit-catalogue';
  const DB_VERSION = 1;
  let db = null;

  // Instrument abbreviation map: canonical copy is INSTRUMENT_ABBREV in
  // dictionaries.js (loaded before this file). Fall back to an empty object so
  // a standalone import still works.
  const ABBREV = (typeof INSTRUMENT_ABBREV !== 'undefined') ? INSTRUMENT_ABBREV : {};

  function normalizeInstrumentName(inst) {
    const lower = inst.toLowerCase().trim();
    // Remove parenthetical suffixes like "(SOLO)", "(fx)", etc.
    const cleaned = lower.replace(/\s*\([^)]*\)\s*$/g, '').trim();
    // Check abbreviation map
    if (ABBREV[cleaned]) return ABBREV[cleaned];
    // Check if already a full name
    return cleaned;
  }

  function init() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('artists')) {
          const store = d.createObjectStore('artists', { keyPath: 'normalizedKey' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('followed', 'followed', { unique: false });
          store.createIndex('lastSeen', 'lastSeen', { unique: false });
        }
        if (!d.objectStoreNames.contains('meta')) {
          d.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  async function getSyncInfo() {
    await init();
    const meta = tx('meta', 'readonly');
    const result = await promisify(meta.get('syncInfo'));
    return result || { key: 'syncInfo', lastGitHubSync: null, artistCount: 0 };
  }

  async function setSyncInfo(info) {
    await init();
    const meta = tx('meta', 'readwrite');
    await promisify(meta.put({ key: 'syncInfo', ...info }));
  }

  async function getArtist(normalizedKey) {
    await init();
    const store = tx('artists', 'readonly');
    return promisify(store.get(normalizedKey));
  }

  async function getAll() {
    await init();
    const store = tx('artists', 'readonly');
    return promisify(store.getAll());
  }

  async function putArtist(artist) {
    await init();
    const store = tx('artists', 'readwrite');
    return promisify(store.put(artist));
  }

  async function deleteArtist(normalizedKey) {
    await init();
    const store = tx('artists', 'readwrite');
    return promisify(store.delete(normalizedKey));
  }

  async function count() {
    await init();
    const store = tx('artists', 'readonly');
    return promisify(store.count());
  }

  async function isFollowed(normalizedKey) {
    const artist = await getArtist(normalizedKey);
    return artist ? !!artist.followed : false;
  }

  async function setFollowed(normalizedKey, followed) {
    let artist = await getArtist(normalizedKey);
    if (!artist) {
      artist = createEmptyArtist(normalizedKey, normalizedKey);
    }
    artist.followed = followed;
    artist.lastUpdated = new Date().toISOString();
    await putArtist(artist);
  }

  async function getFollowed() {
    const all = await getAll();
    return all.filter(a => a.followed);
  }

  async function search(query) {
    const all = await getAll();
    const q = query.toLowerCase().trim();
    if (!q) return all;
    return all.filter(a => {
      if (a.name.toLowerCase().includes(q)) return true;
      if (a.aliases && a.aliases.some(al => al.toLowerCase().includes(q))) return true;
      if (a.instruments && a.instruments.some(i => i.name.toLowerCase().includes(q))) return true;
      if (a.venues && a.venues.some(v => v.name.toLowerCase().includes(q))) return true;
      if (a.genres && a.genres.some(g => g.toLowerCase().includes(q))) return true;
      if (a.tags && a.tags.some(t => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  // Established collaborators for one artist, sourced from the ARCHIVE (every
  // stored event) rather than the live feed. Pairing unit is the performance
  // SET (collection passes per-block collaborators), and a collaborator is
  // "real" once the pair has shared a set in `minShared` different events —
  // a bond that emerges as the archive grows.
  // Returns [{ name, count }] sorted by shared-event count, descending.
  async function getCollaborators(normalizedKey, minShared) {
    await init();
    const min = minShared || 2;
    const artist = await getArtist(normalizedKey);
    if (!artist || !artist.collaborators) return [];
    const self = (artist.name || '').toLowerCase();
    return artist.collaborators
      .filter(c => (c.count || 0) >= min && c.name.toLowerCase() !== self)
      .sort((a, b) => (b.count || 0) - (a.count || 0));
  }

  // Synchronous variant: filter an already-loaded artist record's collaborators.
  // Useful in render paths that hold the catalogue list in memory.
  function filterCollaborators(artist, minShared) {
    const min = minShared || 2;
    if (!artist || !artist.collaborators) return [];
    const self = (artist.name || '').toLowerCase();
    return artist.collaborators
      .filter(c => (c.count || 0) >= min && c.name.toLowerCase() !== self)
      .sort((a, b) => (b.count || 0) - (a.count || 0));
  }

  async function getByInstrument(instrument) {
    const all = await getAll();
    const q = instrument.toLowerCase();
    return all.filter(a =>
      a.instruments && a.instruments.some(i => i.name.toLowerCase().includes(q))
    );
  }

  async function getByVenue(venue) {
    const all = await getAll();
    const q = venue.toLowerCase();
    return all.filter(a =>
      a.venues && a.venues.some(v => v.name.toLowerCase().includes(q))
    );
  }

  async function upsertFromEvent(data) {
    // data: { name, instruments[], venue: {name, city}, date, time, description, collaborators[] }
    await init();
    const key = normalizeArtistName(data.name).toLowerCase();
    let artist = await getArtist(key);

    if (!artist) {
      // Case-insensitive fallback: find existing entry with different case
      const all = await getAll();
      const match = all.find(function(a) {
        return normalizeForDedup(a.name) === normalizeForDedup(data.name);
      });
      if (match) {
        artist = match;
        artist.normalizedKey = key;
        await deleteArtist(match.normalizedKey);
      } else {
        artist = createEmptyArtist(key, data.name);
        artist.firstSeen = data.date;
      }
    }

    // Merge genre from extracted list (scoped to artist lines by caller)
    const extractedGenres = data.genres || [];

    // Merge instruments (append if new, bump confidence)
    if (data.instruments && data.instruments.length > 0) {
      if (!artist.instruments) artist.instruments = [];
      for (const inst of data.instruments) {
        const normalized = normalizeInstrumentName(inst);
        const existing = artist.instruments.find(i => i.name.toLowerCase() === normalized.toLowerCase());
        if (existing) {
          existing.confidence = Math.min(1, (existing.confidence || 0.5) + 0.1);
        } else {
          artist.instruments.push({ name: normalized, confidence: 0.5 });
        }
      }
    }

    // Merge genres (append if new)
    if (extractedGenres.length > 0) {
      if (!artist.genres) artist.genres = [];
      for (const g of extractedGenres) {
        if (!artist.genres.includes(g)) artist.genres.push(g);
      }
    }

    // Merge links from event data (first valid link wins unless current is a search placeholder)
    if (data.bandcamp || data.soundcloud || data.youtube || data.spotify || data.website) {
      if (!artist.links) artist.links = {};
      const linkTargets = {
        bandcamp: [['bandcamp.com/search']],
        soundcloud: [['soundcloud.com/search']],
        youtube: [['youtube.com/search', 'youtu.be/search']],
        spotify: [['spotify.com/search']],
        website: [['bandcamp.com/search', 'soundcloud.com/search']],
      };
      for (const [platform, searchSets] of Object.entries(linkTargets)) {
        const value = data[platform];
        if (!value) continue;
        const current = artist.links[platform];
        if (!current || searchSets[0].some(function(s) { return current.includes(s); })) {
          artist.links[platform] = value;
        }
      }
    }

    // Append events (dedup by date+venue+time)
    if (!artist.events) artist.events = [];
    const venueForEvent = data.venue?.name ? fixVenueSpacing(data.venue.name) : '';
    const normalizedTime = (data.time || '').replace(/[^\d.:]/g, '').trim();
    const eventKey = `${data.date}|${venueForEvent}|${normalizedTime}`;
    let exists = artist.events.some(e =>
      `${e.date}|${e.venue || ''}|${(e.time || '').replace(/[^\d.:]/g, '').trim()}` === eventKey
    );
    if (!exists) {
      artist.events.push({
        date: data.date,
        time: data.time || '',
        venue: venueForEvent,
        address: data.address || '',
        description: data.description || '',
      });
    }

    // Merge venues (increment count only for new events)
    if (data.venue && data.venue.name) {
      if (!artist.venues) artist.venues = [];
      const venueName = fixVenueSpacing(data.venue.name);
      const venueKey = venueName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existing = artist.venues.find(v => v.name.toLowerCase().replace(/[^a-z0-9]/g, '') === venueKey);
      if (existing) {
        if (!exists) {
          existing.count = (existing.count || 1) + 1;
          existing.lastSeen = data.date;
        }
      } else {
        artist.venues.push({
          name: venueName,
          city: data.venue.city || '',
          count: 1,
          firstSeen: data.date,
          lastSeen: data.date,
        });
      }
    }

    // Merge collaborators (increment count only for new events)
    if (data.collaborators && data.collaborators.length > 0) {
      if (!artist.collaborators) artist.collaborators = [];
      for (const collab of data.collaborators) {
        const existing = artist.collaborators.find(function(c) { return c.name.toLowerCase() === collab.toLowerCase(); });
        if (existing) {
          if (!exists) existing.count = (existing.count || 1) + 1;
        } else {
          artist.collaborators.push({ name: collab, count: 1 });
        }
      }
    }

    // Update activity stats
    if (data.date && !exists) {
      const year = data.date.slice(0, 4);
      const month = parseInt(data.date.slice(5, 7), 10);
      if (!artist.activity) artist.activity = {};
      if (!artist.activity[year]) artist.activity[year] = { total: 0, months: [], venues: 0 };
      const yr = artist.activity[year];
      yr.total = (yr.total || 0) + 1;
      if (!yr.months.includes(month)) yr.months.push(month);
      // Recount unique venues for this year
      const yearVenues = new Set(
        artist.events.filter(e => e.date && e.date.startsWith(year)).map(e => e.venue).filter(Boolean)
      );
      yr.venues = yearVenues.size;
    }

    // Update lastSeen
    if (data.date && (!artist.lastSeen || data.date > artist.lastSeen)) {
      artist.lastSeen = data.date;
    }

    artist.lastUpdated = new Date().toISOString();
    await putArtist(artist);
    return artist;
  }

  const VARIANT_GROUPS = [
    ['fabiana striffler', 'fabiana strifler'],
    ['ipek odabasi', 'ipek odabaşı'],
    ['silvio annese', 'silvio annesse'],
    ['aki takase', 'akio takase'],
    ['rodolfo paccabelo', 'rodolfo pacapelo'],
    ['tomas becket', 'tomás becket'],
  ];

function normalizeForDedup(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')  // Turkish dotless ı → i
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

  async function findDeduplicationCandidates() {
    await init();
    const all = await getAll();
    const candidates = [];
    
    // Group by normalized key
    const byKey = new Map();
    for (const artist of all) {
      const key = normalizeForDedup(artist.name);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(artist);
    }
    
    // Find groups with multiple artists
    for (const [key, artists] of byKey) {
      if (artists.length > 1) {
        candidates.push({ key, artists: artists.map(a => a.name) });
      }
    }
    
    // Also check known variant groups
    for (const group of VARIANT_GROUPS) {
      const found = group.filter(g => all.some(a => normalizeForDedup(a.name) === normalizeForDedup(g)));
      if (found.length > 1) {
        candidates.push({ key: 'variant-group', artists: found });
      }
    }
    
    return candidates;
  }

  async function mergeArtists(keepName, mergeNames) {
    await init();
    const all = await getAll();
    const keepArtist = all.find(a => normalizeForDedup(a.name) === normalizeForDedup(keepName));
    if (!keepArtist) return { success: false, error: 'Keep artist not found' };
    
    for (const mergeName of mergeNames) {
      const mergeArtist = all.find(a => normalizeForDedup(a.name) === normalizeForDedup(mergeName));
      if (!mergeArtist || mergeArtist.normalizedKey === keepArtist.normalizedKey) continue;
      
      // Merge instruments
      for (const inst of mergeArtist.instruments || []) {
        const normalized = normalizeInstrumentName(inst.name);
        const existing = keepArtist.instruments.find(i => i.name.toLowerCase() === normalized.toLowerCase());
        if (existing) {
          existing.confidence = Math.min(1, (existing.confidence || 0.5) + (inst.confidence || 0.5));
        } else {
          keepArtist.instruments.push({ name: normalized, confidence: inst.confidence || 0.5 });
        }
      }
      
      // Merge venues
      for (const ven of mergeArtist.venues || []) {
        const existing = keepArtist.venues.find(v => v.name === ven.name);
        if (existing) {
          existing.count = Math.max(existing.count || 0, ven.count || 0);
        } else {
          keepArtist.venues.push(ven);
        }
      }
      
      // Merge events
      for (const ev of mergeArtist.events || []) {
        const venue = fixVenueSpacing(ev.venue || '');
        const eventKey = `${ev.date}|${venue}|${(ev.time || '').replace(/[^\d.:]/g, '').trim()}`;
        const exists = keepArtist.events.some(e => `${e.date}|${fixVenueSpacing(e.venue || '')}|${(e.time || '').replace(/[^\d.:]/g, '').trim()}` === eventKey);
        if (!exists) keepArtist.events.push({ ...ev, venue });
      }
      
      // Merge collaborators
      for (const coll of mergeArtist.collaborators || []) {
        const cname = typeof coll === 'string' ? coll : coll.name;
        const existing = keepArtist.collaborators.find(c => (typeof c === 'string' ? c : c.name) === cname);
        if (existing) {
          if (typeof existing === 'object' && typeof coll === 'object') {
            existing.count = (existing.count || 0) + (coll.count || 0);
          }
        } else {
          keepArtist.collaborators.push(coll);
        }
      }
      
      // Merge genres
      for (const g of mergeArtist.genres || []) {
        if (!keepArtist.genres.includes(g)) keepArtist.genres.push(g);
      }
      
      // Merge tags
      for (const t of mergeArtist.tags || []) {
        if (!keepArtist.tags.includes(t)) keepArtist.tags.push(t);
      }
      
      // Merge bio (keep longer)
      if (mergeArtist.bio && mergeArtist.bio.length > (keepArtist.bio || '').length) {
        keepArtist.bio = mergeArtist.bio;
      }
      
      // Merge links
      for (const [key, val] of Object.entries(mergeArtist.links || {})) {
        if (val && (!keepArtist.links[key] || val.length > keepArtist.links[key].length)) {
          keepArtist.links[key] = val;
        }
      }
      
      // Mark as merged
      mergeArtist.aliases = mergeArtist.aliases || [];
      mergeArtist.aliases.push(mergeName);
      mergeArtist.mergedInto = keepArtist.normalizedKey;
      
      await putArtist(keepArtist);
      await putArtist(mergeArtist);
    }
    
    return { success: true, keepKey: keepArtist.normalizedKey };
  }

  // Remove duplicate events and merge duplicate venues across all artists
  async function dedupEvents() {
    await init();
    const all = await getAll();
    let totalRemoved = 0;
    for (const artist of all) {
      let changed = false;

      // Dedup events
      if (artist.events && artist.events.length >= 2) {
        const seen = new Map();
        const deduped = [];
        for (const ev of artist.events) {
          const venue = fixVenueSpacing(ev.venue || '');
          const time = (ev.time || '').replace(/[^\d.:]/g, '').trim();
          // Aggressive norm: lowercase, strip all non-alphanumeric for comparison
          const norm = `${ev.date}|${venue.toLowerCase().replace(/[^a-z0-9]/g, '')}|${time}`;
          const canonical = `${ev.date}|${venue}|${time}`;
          if (!seen.has(norm)) {
            seen.set(norm, canonical);
            deduped.push({ ...ev, venue });
          } else {
            totalRemoved++;
            changed = true;
          }
        }
        if (changed) artist.events = deduped;
      }

      // Merge duplicate venues (same normalized name → combine counts)
      if (artist.venues && artist.venues.length >= 2) {
        const venueMap = new Map();
        for (const v of artist.venues) {
          const norm = fixVenueSpacing(v.name || '');
          const key = norm.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (venueMap.has(key)) {
            const existing = venueMap.get(key);
            existing.count = (existing.count || 0) + (v.count || 0);
            if (v.firstSeen && (!existing.firstSeen || v.firstSeen < existing.firstSeen)) existing.firstSeen = v.firstSeen;
            if (v.lastSeen && (!existing.lastSeen || v.lastSeen > existing.lastSeen)) existing.lastSeen = v.lastSeen;
            changed = true;
          } else {
            venueMap.set(key, { ...v, name: norm });
          }
        }
        if (changed) artist.venues = [...venueMap.values()];
      }

      if (changed) await putArtist(artist);
    }
    return totalRemoved;
  }

  async function rebuildCounts() {
    await init();
    const all = await getAll();
    let changed = 0;
    for (const artist of all) {
      let dirty = false;

      // Rebuild venue counts from stored events
      if (artist.events && artist.events.length > 0) {
        const venueCounts = new Map();
        for (const ev of artist.events) {
          const vname = ev.venue || '';
          if (!vname) continue;
          const key = vname.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (venueCounts.has(key)) {
            const entry = venueCounts.get(key);
            entry.count++;
            if (ev.date && (!entry.lastSeen || ev.date > entry.lastSeen)) entry.lastSeen = ev.date;
            if (ev.date && (!entry.firstSeen || ev.date < entry.firstSeen)) entry.firstSeen = ev.date;
          } else {
            venueCounts.set(key, { name: vname, count: 1, firstSeen: ev.date || '', lastSeen: ev.date || '' });
          }
        }
        const newVenues = [...venueCounts.values()];
        if (JSON.stringify(newVenues) !== JSON.stringify(artist.venues || [])) {
          artist.venues = newVenues;
          dirty = true;
        }
      }

      // Reset collaborators — they'll rebuild on next collectAllArtists call
      if (artist.collaborators && artist.collaborators.length > 0) {
        artist.collaborators = [];
        dirty = true;
      }

      if (dirty) {
        await putArtist(artist);
        changed++;
      }
    }
    return changed;
  }

  function createEmptyArtist(normalizedKey, displayName) {
    return {
      name: displayName,
      normalizedKey,
      aliases: [],
      projects: [],
      instruments: [],
      genres: [],
      venues: [],
      events: [],
      activity: {},
      collaborators: [],
      bio: '',
      links: { bandcamp: '', spotify: '', youtube: '', soundcloud: '', website: '' },
      tags: [],
      followed: false,
      localEdit: false,
      firstSeen: null,
      lastSeen: null,
      lastUpdated: new Date().toISOString(),
      version: 1,
    };
  }

  return {
    init,
    getArtist,
    getAll,
    putArtist,
    deleteArtist,
    count,
    isFollowed,
    setFollowed,
    getFollowed,
    search,
    getCollaborators,
    filterCollaborators,
    getByInstrument,
    getByVenue,
    upsertFromEvent,
    dedupEvents,
    rebuildCounts,
    getSyncInfo,
    setSyncInfo,
    createEmptyArtist,
  };
})();
