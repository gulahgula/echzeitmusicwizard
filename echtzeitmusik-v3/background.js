importScripts('../shared/dictionaries.js', '../shared/extractor.js', '../shared/parser.js', '../shared/catalogue-db.js');

const CALENDAR_URL = 'https://echtzeitmusik.de/index.php?page=calendar&filter=month';
const THRESHOLDS = [
  { key: '1d', ms: 86400000 },
  { key: '5h', ms: 18000000 },
  { key: '3h', ms: 10800000 },
  { key: '1h', ms: 3600000 },
];

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('checkCalendar', { periodInMinutes: 60 });
  checkAllArtists();
});

chrome.alarms.onAlarm.addListener(() => checkAllArtists());

let pendingFollow = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'artistFollowed') {
    pendingFollow = true;
    checkArtistNow(msg.name).then(r => {
      pendingFollow = false;
      updateBadge();
      sendResponse(r);
    }).catch(() => { pendingFollow = false; updateBadge(); sendResponse({ ok: false }); });
    return true;
  }
  if (msg.action === 'setNotifMode') {
    chrome.storage.local.set({ notifMode: msg.mode });
    sendResponse({ ok: true });
    return true;
  }
});

async function checkArtistNow(artistName) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(CALENDAR_URL, { signal: ctrl.signal });
    clearTimeout(t);
    const buf = await res.arrayBuffer();
    const dec = new TextDecoder('windows-1252');
    const html = fixMojibake(dec.decode(buf));
    const events = parseEvents(html);
    const now = new Date();

    const upcoming = events
      .filter(ev => {
        if (!matchesArtist(ev.infoText, artistName)) return false;
        const d = parseEventDateTime(ev.dateStr, ev.time);
        return d && d > now;
      })
      .sort((a, b) => parseEventDateTime(a.dateStr, a.time) - parseEventDateTime(b.dateStr, b.time));

    if (upcoming.length > 0) {
      const ev = upcoming[0];
      const eventDate = parseEventDateTime(ev.dateStr, ev.time);
      const notifId = buildNotifId(artistName, ev);
      // Manual follow: the popup shows its own confirmation, so store the unread
      // entry + badge but stay silent here. checkThresholds still fires a timely
      // OS reminder if the show is imminent (≤ 1 day away).
      await persistNotification(artistName, ev, eventDate, notifId, { force: true, silent: true });
      await checkThresholds(notifId, artistName, ev, eventDate);
      const evInfo = `${ev.dayOfWeek} ${ev.displayDate || ev.dateStr} · ${ev.time} at ${ev.venueName}`;
      const label = formatLead(eventDate.getTime() - Date.now());
      return { ok: true, upcoming: upcoming.length, artistName, eventInfo: evInfo, label };
    }
    updateBadge();
    return { ok: true, upcoming: 0, artistName, reason: 'no upcoming events found for this artist' };
  } catch (e) {
    console.error('[echtzeit] checkArtistNow failed:', e);
    return { ok: false, error: e.message || String(e) };
  }
}

let checkTimer = null;
chrome.storage.onChanged.addListener((changes) => {
  if (changes.watchedArtists) {
    if (pendingFollow) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => checkAllArtists(), 500);
  }
});

// Catalogue collection is expensive (many IndexedDB writes); run it at most once
// per day rather than on every hourly alarm tick.
const CATALOGUE_INTERVAL_MS = 86400000;

// In-flight guard: onStartup, onInstalled, onAlarm and storage.onChanged can all
// fire concurrently. Collapse overlapping runs onto a single shared promise so we
// never double-fetch or race the catalogue writes.
let checkInFlight = null;
function checkAllArtists() {
  if (checkInFlight) return checkInFlight;
  checkInFlight = runCheckAllArtists().finally(() => { checkInFlight = null; });
  return checkInFlight;
}

async function runCheckAllArtists() {
  const { watchedArtists = [], notifMode = 'on', lastCatalogueRun = 0 } =
    await chrome.storage.local.get(['watchedArtists', 'notifMode', 'lastCatalogueRun']);

  try {
    const res = await fetch(CALENDAR_URL);
    const buf = await res.arrayBuffer();
    const dec = new TextDecoder('windows-1252');
    const html = fixMojibake(dec.decode(buf));
    const events = parseEvents(html);

    // Collect into catalogue (archive) at most once per day — even if no artists followed
    if (Date.now() - lastCatalogueRun > CATALOGUE_INTERVAL_MS) {
      await catalogueCollectArtists(events);
      await storageSet({ lastCatalogueRun: Date.now() });
    }

    // Notification checks only if user follows artists
    if (watchedArtists.length > 0) {
      const deduped = [...new Set(watchedArtists.map(a => a.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/[:;,.\s]+$/, '').replace(/\s+/g, ' ')))];
      if (deduped.length !== watchedArtists.length || deduped.join(',') !== watchedArtists.join(',')) {
        await chrome.storage.local.set({ watchedArtists: deduped });
      }
      const normalized = deduped;
      const now = new Date();

      for (const name of normalized) {
        const upcoming = events
          .filter(ev => {
            if (!matchesArtist(ev.infoText, name)) return false;
            const d = parseEventDateTime(ev.dateStr, ev.time);
            return d && d > now;
          })
          .sort((a, b) => parseEventDateTime(a.dateStr, a.time) - parseEventDateTime(b.dateStr, b.time));

        if (upcoming.length > 0) {
          const ev = upcoming[0];
          const eventDate = parseEventDateTime(ev.dateStr, ev.time);
          const notifId = buildNotifId(name, ev);
          await persistNotification(name, ev, eventDate, notifId);
          await checkThresholds(notifId, name, ev, eventDate);
        }
      }

      await detectCancellation(normalized, events);
    }
  } catch (e) {
    console.error('[echtzeit] checkAllArtists failed:', e);
  } finally {
    updateBadge();
  }
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

function buildNotifId(artistName, ev) {
  return `ech-${artistName.replace(/[^a-zA-Z0-9]/g, '')}-${ev.id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

async function persistNotification(artistName, ev, eventDate, notifId, opts = {}) {
  const { force = false, silent = false } = opts;
  const eventTs = eventDate.getTime();
  const info = `${ev.dayOfWeek} ${ev.displayDate || ev.dateStr} · ${ev.time} at ${ev.venueName}`;
  const label = formatLead(eventTs - Date.now());

  const result = await storageGet(['unreadNotifications', 'dismissedNotifIds', 'notifMode']);
  const list = result.unreadNotifications || [];
  const dismissed = result.dismissedNotifIds || [];
  if (list.some(n => n.id === notifId)) return;
  // If the user dismissed this notification before, don't re-add it on periodic checks
  if (dismissed.includes(notifId) && !force) return;
  // Remove from dismissed (force: re-follow gets a fresh notification)
  const filtered = dismissed.filter(id => id !== notifId);
  list.unshift({ id: notifId, artistName, eventInfo: info, eventTs, address: ev.address || '', timestamp: Date.now() });
  await storageSet({ unreadNotifications: list, dismissedNotifIds: filtered });
  updateBadge();

  if (result.notifMode === 'off' || silent) return;

  chrome.runtime.sendMessage({ action: 'showToast', artistName, eventInfo: `${info} (in ${label})`, notifId })
    .catch(() => {});

  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: artistName,
    message: `${info} (in ${label})`,
    priority: 2,
  });
}

async function checkThresholds(notifId, artistName, ev, eventDate) {
  const leadMs = eventDate.getTime() - Date.now();
  if (leadMs <= 0) return;

  const result = await storageGet(['notifiedThresholds', 'dismissedNotifIds', 'notifMode']);
  if (result.notifMode === 'off') return;
  if ((result.dismissedNotifIds || []).includes(notifId)) return;

  const nt = result.notifiedThresholds || {};
  const done = [...(nt[notifId] || [])];
  const info = `${ev.dayOfWeek} ${ev.displayDate || ev.dateStr} · ${ev.time} at ${ev.venueName}`;

  let selectedThreshold = null;
  for (const th of [...THRESHOLDS].reverse()) {
    if (leadMs <= th.ms && !done.includes(th.key)) {
      selectedThreshold = th;
      break;
    }
  }

  if (selectedThreshold) {
    done.push(selectedThreshold.key);
    const message = `${info} — starts in ${selectedThreshold.key}`;
    const opts = {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: artistName,
      message,
      priority: 2,
    };
    const existed = await chrome.notifications.update(notifId, opts).catch(() => false);
    if (!existed) chrome.notifications.create(notifId, opts);
  }

  if (done.length > (nt[notifId] || []).length) {
    nt[notifId] = done;
    await storageSet({ notifiedThresholds: nt });
  }
}

async function detectCancellation(watchedArtists, currentEvents) {
  const now = new Date();
  const result = await storageGet(['knownEvents', 'notifMode', 'firedCancellations']);
  const known = result.knownEvents || {};
  // Remember which cancellations we've already announced so overlapping runs
  // (startup + alarm firing close together) never double-notify.
  const fired = new Set(result.firedCancellations || []);
  const updated = {};

  for (const name of watchedArtists) {
    const current = currentEvents
      .filter(ev => {
        if (!matchesArtist(ev.infoText, name)) return false;
        const d = parseEventDateTime(ev.dateStr, ev.time);
        return d && d > now;
      })
      .map(ev => ({ id: ev.id, dateStr: ev.dateStr, time: ev.time, venueName: ev.venueName }));

    const previous = known[name] || [];

    for (const prev of previous) {
      if (!current.some(c => c.id === prev.id)) {
        const cancelId = `${prev.id}-cancelled`;
        if (result.notifMode === 'off' || fired.has(cancelId)) continue;
        fired.add(cancelId);
        const displayDate = `${prev.dateStr} ${prev.time}`;
        chrome.notifications.create(cancelId, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: `${name} — cancelled`,
          message: `${prev.venueName} on ${displayDate} has been cancelled`,
          priority: 2,
        });
      }
    }

    updated[name] = current;
  }

  // A cancelled event is absent from `current` by definition, so we can't key the
  // suppression set on live events. Cap it FIFO instead — the newest 100 fired ids
  // stay suppressed, which comfortably outlives any event's cancellation window.
  const prunedFired = [...fired].slice(-100);
  await storageSet({ knownEvents: updated, firedCancellations: prunedFired });
}

async function updateBadge() {
  const result = await storageGet(['unreadNotifications', 'notifiedThresholds', 'dismissedNotifIds']);
  const stored = result.unreadNotifications || [];
  const list = stored.filter(n => !n.eventTs || n.eventTs > Date.now());
  if (list.length !== stored.length) {
    await storageSet({ unreadNotifications: list });
  }
  const activeIds = new Set(list.map(n => n.id));
  const nt = result.notifiedThresholds || {};
  const cleanedNt = {};
  for (const [k, v] of Object.entries(nt)) {
    if (activeIds.has(k)) cleanedNt[k] = v;
  }
  if (Object.keys(cleanedNt).length !== Object.keys(nt).length) {
    await storageSet({ notifiedThresholds: cleanedNt });
  }
  const count = list.length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#ffd54f' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkCalendar', { periodInMinutes: 60 });
  // Drop transient reminder state so upgrades don't carry stale thresholds forever.
  chrome.storage.local.remove(['notifiedThresholds', 'firedCancellations']);
  setTimeout(() => checkAllArtists(), 5000);
});

chrome.notifications.onClicked.addListener((notifId) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('analysis/analysis.html') + '#today' });
  chrome.notifications.clear(notifId);
  // Cancellation notifications are ephemeral — no need to track dismissal
  if (notifId.endsWith('-cancelled')) return;
  chrome.storage.local.get(['unreadNotifications', 'dismissedNotifIds'], (result) => {
    const updated = (result.unreadNotifications || []).filter(n => n.id !== notifId);
    chrome.storage.local.set({ unreadNotifications: updated });
    const dismissed = result.dismissedNotifIds || [];
    if (!dismissed.includes(notifId)) {
      dismissed.push(notifId);
      // Cap FIFO so the dismissed-id ledger can't grow without bound.
      chrome.storage.local.set({ dismissedNotifIds: dismissed.slice(-200) });
    }
    updateBadge();
  });
});

// buildNotifId is background-specific; parseEvents is regex-based (no DOM needed)
// matchesArtist, formatLead, parseEventDateTime are imported from shared/parser.js

function parseEvents(html) {
  const events = [];
  const blocks = html.split(/<!--\s*ENTRY:\s*#(\d+)\s+(\d{2})\.(\d{2})\.(\d{4})\s*-->/);

  for (let i = 1; i + 4 < blocks.length; i += 5) {
    const id = blocks[i];
    const day = blocks[i + 1];
    const month = blocks[i + 2];
    const year = blocks[i + 3];
    const block = blocks[i + 4];
    const dateStr = buildDateStr(day, month, year);
    const displayDate = `${day}. ${month}. ${normalizeYear(year)}`;

    const addrMatch = block.match(/<div class="calender-entry-address">\s*([\s\S]*?)<\/div>/);
    const address = addrMatch ? addrMatch[1].replace(/\s+/g, ' ').trim() : '';

    const dayMatch = block.match(/<td align="left" class="tagUhrzeit">(\w+)<\/td>/);
    const timeMatch = block.match(/<td align="right" class="tagUhrzeit">([\d.]+)<\/td>/);
    const dayOfWeek = dayMatch ? dayMatch[1] : '';
    const time = timeMatch ? timeMatch[1] : '';

    const venueMatch = block.match(/<td colspan="5" align="center" valign="middle" class="name-box">([\s\S]*?)<\/td>/);
    let venueName = '';
    if (venueMatch) {
      const inner = venueMatch[1];
      const aMatch = inner.match(/<a[^>]*>([\s\S]*?)<\/a>/);
      venueName = fixVenueSpacing(aMatch ? aMatch[1].replace(/\s+/g, ' ').trim() : inner.replace(/\s+/g, ' ').trim());
    }

    const infoMatch = block.match(/<div class="calender-entry-info">([\s\S]*?)<\/div>\s*<\/td>/);
    let infoHTML = '';
    if (infoMatch) {
      infoHTML = infoMatch[1];
    }
    let infoText = '';
    if (infoMatch) {
      infoText = infoMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c))
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }

    const artistLinks = extractArtistLinks(infoHTML, infoText);

    events.push({
      id: `centry.${id}`,
      dateStr,
      dayOfWeek,
      time,
      address,
      venueName,
      infoText,
      infoHTML,
      artistLinks,
      displayDate,
    });
  }

  return events;
}

async function catalogueCollectArtists(events) {
  try {
    await CatalogueDB.init();
    for (const ev of events) {
      const blocks = extractPerformanceBlocks(ev.infoText);
      for (const block of blocks) {
        for (const name of block) {
          const instruments = catExtractInstruments(name, ev.infoText);
          const genres = extractGenres(ev.infoText, name);
          const blockCollabs = block.filter(n => normalizeArtistName(n) !== normalizeArtistName(name));
          const links = ev.artistLinks?.[name] || { bandcamp: '', soundcloud: '', website: '' };
    await CatalogueDB.upsertFromEvent({
              name,
              instruments,
              genres,
              bandcamp: links.bandcamp,
              soundcloud: links.soundcloud,
              website: links.website,
              venue: { name: ev.venueName, city: '' },
              date: catNormalizeDate(ev.dateStr),
              time: ev.time,
              address: ev.address,
              description: ev.infoText,
              collaborators: blockCollabs.map(n => normalizeArtistName(n)),
            });
        }
      }
    }
  } catch (e) {
    console.error('[echtzeit] catalogueCollectArtists failed:', e);
  }
}
