// ── Artist Catalogue Database (IndexedDB) ──
// Persistent local store for artist profiles.
// Auto-collected from events, optionally seeded from GitHub Pages.

const CatalogueDB = (() => {
  const DB_NAME = 'echzeit-catalogue';
  const DB_VERSION = 1;
  let db = null;

  // ── Open / init ──

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

  // ── Internal helpers ──

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

  // ── Meta (sync info) ──

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

  // ── Artist CRUD ──

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

  // ── Follow management ──

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

  // ── Search ──

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

  // ── Auto-collection from events ──

  async function upsertFromEvent(data) {
    // data: { name, instruments[], venue: {name, city}, date, time, description, collaborators[] }
    await init();
    const key = normalizeArtistName(data.name);
    let artist = await getArtist(key);

    if (!artist) {
      artist = createEmptyArtist(key, data.name);
      artist.firstSeen = data.date;
    }

    // Merge instruments (append if new, bump confidence)
    if (data.instruments && data.instruments.length > 0) {
      if (!artist.instruments) artist.instruments = [];
      for (const inst of data.instruments) {
        const existing = artist.instruments.find(i => i.name.toLowerCase() === inst.toLowerCase());
        if (existing) {
          existing.confidence = Math.min(1, (existing.confidence || 0.5) + 0.1);
        } else {
          artist.instruments.push({ name: inst, confidence: 0.5 });
        }
      }
    }

    // Merge venues (increment count, update dates)
    if (data.venue && data.venue.name) {
      if (!artist.venues) artist.venues = [];
      const existing = artist.venues.find(v => v.name === data.venue.name);
      if (existing) {
        existing.count = (existing.count || 1) + 1;
        existing.lastSeen = data.date;
      } else {
        artist.venues.push({
          name: data.venue.name,
          city: data.venue.city || '',
          count: 1,
          firstSeen: data.date,
          lastSeen: data.date,
        });
      }
    }

    // Append events (dedup by date+venue+time)
    if (!artist.events) artist.events = [];
    const eventKey = `${data.date}|${data.venue?.name || ''}|${data.time || ''}`;
    const exists = artist.events.some(e =>
      `${e.date}|${e.venue || ''}|${e.time || ''}` === eventKey
    );
    if (!exists) {
      artist.events.push({
        date: data.date,
        time: data.time || '',
        venue: data.venue?.name || '',
        address: data.address || '',
        description: data.description || '',
      });
    }

    // Merge collaborators (increment count)
    if (data.collaborators && data.collaborators.length > 0) {
      if (!artist.collaborators) artist.collaborators = [];
      for (const collab of data.collaborators) {
        const existing = artist.collaborators.find(c => c.name === collab);
        if (existing) {
          existing.count = (existing.count || 1) + 1;
        } else {
          artist.collaborators.push({ name: collab, count: 1 });
        }
      }
    }

    // Update activity stats
    if (data.date) {
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

  // ── GitHub fetch ──

  const GITHUB_BASE = 'https://gulahgula.github.io/echzeit-data';

  async function fetchFromGitHub(onProgress) {
    await init();

    // Fetch index
    if (onProgress) onProgress('Fetching artist index...');
    const indexRes = await fetch(`${GITHUB_BASE}/index.json`);
    if (!indexRes.ok) throw new Error(`GitHub fetch failed: ${indexRes.status}`);
    const index = await indexRes.json();
    const artists = index.artists || [];
    if (onProgress) onProgress(`Found ${artists.length} artists. Loading profiles...`);

    // Fetch artist files in batches of 10
    let loaded = 0;
    const batchSize = 10;
    for (let i = 0; i < artists.length; i += batchSize) {
      const batch = artists.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          const res = await fetch(`${GITHUB_BASE}/artists/${entry.file}`);
          if (!res.ok) throw new Error(`Failed to fetch ${entry.file}`);
          return res.json();
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          const artist = r.value;
          // Don't overwrite local edits
          const existing = await getArtist(artist.normalizedKey);
          if (existing && existing.localEdit) {
            // Merge: keep local edits, update non-local fields from remote
            const merged = mergeRemoteIntoLocal(artist, existing);
            await putArtist(merged);
          } else {
            await putArtist(artist);
          }
          loaded++;
        }
      }
      if (onProgress) onProgress(`Loaded ${loaded}/${artists.length} artists...`);
    }

    // Save sync info
    await setSyncInfo({
      lastGitHubSync: new Date().toISOString(),
      artistCount: loaded,
    });

    if (onProgress) onProgress(`Catalogue loaded — ${loaded} artists from GitHub.`);
    return loaded;
  }

  function mergeRemoteIntoLocal(remote, local) {
    // Local edits take precedence for: bio, links, aliases, tags, followed
    // Remote takes precedence for: events, venues, collaborators, activity (auto-collected)
    return {
      ...remote,
      // Preserve local edits
      bio: local.bio || remote.bio,
      links: { ...remote.links, ...local.links },
      aliases: local.aliases && local.aliases.length > 0 ? local.aliases : remote.aliases,
      projects: local.projects && local.projects.length > 0 ? local.projects : remote.projects,
      tags: local.tags && local.tags.length > 0 ? local.tags : remote.tags,
      followed: local.followed || remote.followed,
      localEdit: local.localEdit || false,
      // Merge auto-collected data (remote + local events combined)
      events: mergeEvents(remote.events || [], local.events || []),
      venues: mergeVenues(remote.venues || [], local.venues || []),
      collaborators: mergeCollaborators(remote.collaborators || [], local.collaborators || []),
      activity: mergeActivity(remote.activity || {}, local.activity || {}),
      instruments: mergeInstruments(remote.instruments || [], local.instruments || []),
      lastUpdated: new Date().toISOString(),
    };
  }

  function mergeEvents(remote, local) {
    const map = new Map();
    for (const ev of [...remote, ...local]) {
      const key = `${ev.date}|${ev.venue}|${ev.time}`;
      if (!map.has(key)) map.set(key, ev);
    }
    return [...map.values()].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function mergeVenues(remote, local) {
    const map = new Map();
    for (const v of remote) map.set(v.name, { ...v });
    for (const v of local) {
      const existing = map.get(v.name);
      if (existing) {
        existing.count = Math.max(existing.count || 0, v.count || 0);
        if (v.firstSeen && (!existing.firstSeen || v.firstSeen < existing.firstSeen)) existing.firstSeen = v.firstSeen;
        if (v.lastSeen && (!existing.lastSeen || v.lastSeen > existing.lastSeen)) existing.lastSeen = v.lastSeen;
      } else {
        map.set(v.name, { ...v });
      }
    }
    return [...map.values()];
  }

  function mergeCollaborators(remote, local) {
    const map = new Map();
    for (const c of remote) map.set(c.name, { ...c });
    for (const c of local) {
      const existing = map.get(c.name);
      if (existing) {
        existing.count = Math.max(existing.count || 0, c.count || 0);
      } else {
        map.set(c.name, { ...c });
      }
    }
    return [...map.values()];
  }

  function mergeActivity(remote, local) {
    const result = { ...remote };
    for (const [year, data] of Object.entries(local)) {
      if (!result[year]) {
        result[year] = { ...data };
      } else {
        result[year].total = Math.max(result[year].total || 0, data.total || 0);
        const months = new Set([...(result[year].months || []), ...(data.months || [])]);
        result[year].months = [...months].sort((a, b) => a - b);
        result[year].venues = Math.max(result[year].venues || 0, data.venues || 0);
      }
    }
    return result;
  }

  function mergeInstruments(remote, local) {
    const map = new Map();
    for (const i of remote) map.set(i.name.toLowerCase(), { ...i });
    for (const i of local) {
      const key = i.name.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.confidence = Math.min(1, Math.max(existing.confidence || 0, i.confidence || 0.5));
      } else {
        map.set(key, { ...i });
      }
    }
    return [...map.values()];
  }

  // ── Export local edits ──

  async function exportChanges() {
    const all = await getAll();
    const edited = all.filter(a => a.localEdit);
    return {
      exportedAt: new Date().toISOString(),
      count: edited.length,
      artists: edited,
    };
  }

  // ── Factory ──

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

  // ── Public API ──

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
    getByInstrument,
    getByVenue,
    upsertFromEvent,
    fetchFromGitHub,
    getSyncInfo,
    setSyncInfo,
    exportChanges,
    createEmptyArtist,
  };
})();
