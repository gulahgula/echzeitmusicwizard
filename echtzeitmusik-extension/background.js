const CALENDAR_URL = 'https://echtzeitmusik.de/index.php?page=calendar&filter=month';

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('checkCalendar', { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener(() => checkAllArtists());

// ── Follow artist: check for upcoming, store notification, update badge ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'artistFollowed') {
    checkArtistNow(msg.name).then(sendResponse).catch(() => sendResponse({ ok: false }));
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
    const dec = new TextDecoder('iso-8859-1');
    const html = dec.decode(buf);
    const events = parseEvents(html);
    const now = new Date();

    const upcoming = events
      .filter(ev => {
        if (!ev.infoText.toLowerCase().includes(artistName.toLowerCase())) return false;
        const d = parseEventDateTime(ev.dateStr, ev.time);
        return d && d > now;
      })
      .sort((a, b) => parseEventDateTime(a.dateStr, a.time) - parseEventDateTime(b.dateStr, b.time));

    if (upcoming.length > 0) {
      const ev = upcoming[0];
      const diffMs = parseEventDateTime(ev.dateStr, ev.time).getTime() - now.getTime();
      const hours = Math.round(diffMs / (1000 * 60 * 60));
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      const label = days >= 1 ? `${days} days` : `${hours} hours`;
      storeNotification(artistName, ev, label);
    }
    updateBadge();
    return { ok: true, upcoming: upcoming.length };
  } catch (e) {
    console.error('checkArtistNow failed:', e);
    return { ok: false };
  }
}

// ── Periodic check for all watched artists ──

let checkTimer = null;
chrome.storage.onChanged.addListener((changes) => {
  if (changes.watchedArtists) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => checkAllArtists(), 500);
  }
});

async function checkAllArtists() {
  const { watchedArtists = [] } = await chrome.storage.local.get('watchedArtists');
  if (watchedArtists.length === 0) { updateBadge(); return; }

  // Deduplicate and normalize, then persist cleanup
  const deduped = [...new Set(watchedArtists.map(a => a.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/[:;,.\s]+$/, '').replace(/\s+/g, ' ')))];
  if (deduped.length !== watchedArtists.length || deduped.join(',') !== watchedArtists.join(',')) {
    await chrome.storage.local.set({ watchedArtists: deduped });
  }
  const normalized = deduped;

  try {
    const res = await fetch(CALENDAR_URL);
    const buf = await res.arrayBuffer();
    const dec = new TextDecoder('iso-8859-1');
    const html = dec.decode(buf);
    const events = parseEvents(html);
    const now = new Date();

    for (const name of normalized) {
      const upcoming = events
        .filter(ev => {
          if (!ev.infoText.toLowerCase().includes(name.toLowerCase())) return false;
          const d = parseEventDateTime(ev.dateStr, ev.time);
          return d && d > now;
        })
        .sort((a, b) => parseEventDateTime(a.dateStr, a.time) - parseEventDateTime(b.dateStr, b.time));

      if (upcoming.length > 0) {
        const ev = upcoming[0];
        const diffMs = parseEventDateTime(ev.dateStr, ev.time).getTime() - now.getTime();
        const hours = Math.round(diffMs / (1000 * 60 * 60));
        const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
        const label = days >= 1 ? `${days} days` : `${hours} hours`;
        storeNotification(name, ev, label);
      }
    }

    updateBadge();
  } catch (e) {
    console.error('checkAllArtists failed:', e);
  }
}

// ── Storage + badge ──

function storeNotification(artistName, ev, label) {
  const id = `ech-${artistName.replace(/[^a-zA-Z0-9]/g, '')}-${ev.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  const info = `${ev.dayOfWeek} ${ev.displayDate || ev.dateStr} · ${ev.time} at ${ev.venueName} (in ${label})`;

  chrome.storage.local.get(['unreadNotifications'], (result) => {
    const list = result.unreadNotifications || [];
    const dup = list.some(n => n.artistName === artistName && n.eventInfo === info);
    if (dup) return;
    list.unshift({ id, artistName, eventInfo: info, address: ev.address || '', timestamp: Date.now() });
    chrome.storage.local.set({ unreadNotifications: list });

    // Send toast to the active tab — reaches content.js on web pages AND analysis.js on extension pages
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'showToast', artistName, eventInfo: info, notifId: id })
          .catch(() => {});
      }
    });
  });
}

function updateBadge() {
  chrome.storage.local.get(['unreadNotifications'], (result) => {
    const list = result.unreadNotifications || [];
    const count = list.length;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#ffd54f' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkCalendar', { periodInMinutes: 60 });
  chrome.storage.local.remove(['notifMeta', 'unreadNotifications', 'notifiedThresholds']);
  setTimeout(() => checkAllArtists(), 5000);
});

// ── Helpers ──

function parseEventDateTime(dateStr, time) {
  const parts = dateStr.replace(/\.\s*/g, '.').split('.').filter(Boolean);
  if (parts.length < 3) return null;
  const [day, month, year] = parts;
  const [hour, minute] = time.split('.').map(s => parseInt(s, 10));
  const fullYear = year.length === 2 ? 2000 + parseInt(year) : parseInt(year);
  return new Date(fullYear, parseInt(month) - 1, parseInt(day), hour || 0, minute || 0);
}

function parseEvents(html) {
  const events = [];
  const blocks = html.split(/<!--\s*ENTRY:\s*#(\d+)\s+(\d{2})\.(\d{2})\.(\d{4})\s*-->/);

  for (let i = 1; i + 4 < blocks.length; i += 5) {
    const id = blocks[i];
    const day = blocks[i + 1];
    const month = blocks[i + 2];
    const year = blocks[i + 3];
    const block = blocks[i + 4];
    const dateStr = `${day}. ${month}. ${year.slice(-2)}`;
    const displayDate = `${day}. ${month}. 20${year.slice(-2)}`;

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
      venueName = aMatch ? aMatch[1].replace(/\s+/g, ' ').trim() : inner.replace(/\s+/g, ' ').trim();
    }

    const infoMatch = block.match(/<div class="calender-entry-info">([\s\S]*?)<\/div>\s*<\/td>/);
    let infoText = '';
    if (infoMatch) {
      infoText = infoMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c))
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }

    events.push({
      id: `centry.${id}`,
      dateStr,
      dayOfWeek,
      time,
      address,
      venueName,
      infoText,
      displayDate,
    });
  }

  return events;
}
