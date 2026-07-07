document.addEventListener('DOMContentLoaded', () => {
  const filterButtons = document.querySelectorAll('.filter-bar button');
  const eventList = document.getElementById('event-list');
  const loading = document.getElementById('loading');
  const errorEl = document.getElementById('error');

  let currentFilter = 'today';
  let watchedArtists = [];
  let loadedEvents = [];
  const responseCache = {};
  function getCached(url) { const e = responseCache[url]; return e && (Date.now() - e.t < 3e5) ? e.d : null; }
  function setCache(url, d) { responseCache[url] = { d, t: Date.now() }; }

  chrome.storage.local.get(['watchedArtists'], (result) => {
    watchedArtists = [...new Set((result.watchedArtists || []).map(n => normalizeArtistName(n)))];
    if (watchedArtists.join(',') !== (result.watchedArtists || []).join(',')) {
      chrome.storage.local.set({ watchedArtists });
    }
    if (loadedEvents.length > 0) {
      renderOverview(loadedEvents, currentFilter);
      refreshFollowedBars();
      refreshNowBars();
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.watchedArtists) {
      watchedArtists = changes.watchedArtists.newValue || [];
      if (loadedEvents.length > 0) {
        renderOverview(loadedEvents, currentFilter);
        refreshFollowedBars();
      }
    }
  });

  setInterval(refreshNowBars, 60000);

  // Clear badge on popup open
  chrome.action.setBadgeText({ text: '' });

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      if (currentFilter === 'notifications') {
        renderNotifications();
      } else {
        loadConcerts(currentFilter);
      }
    });
  });

  document.getElementById('open-analysis').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('analysis/analysis.html') + '#today' });
  });

  document.getElementById('open-about').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('about/about.html') });
  });

  async function loadConcerts(filter) {
    loading.classList.remove('hidden');
    errorEl.classList.add('hidden');
    eventList.innerHTML = '';

    const url = `https://echtzeitmusik.de/index.php?page=calendar&filter=${filter}`;

    try {
      let html = getCached(url);
      if (!html) {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('iso-8859-1');
        html = decoder.decode(buffer);
        setCache(url, html);
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');

      loadedEvents = parseEvents(doc);
      renderOverview(loadedEvents, filter);
      renderEvents(loadedEvents, filter);
      if (watchedArtists.length > 0) refreshFollowedBars();
      refreshNowBars();
    } catch (err) {
      showError('Failed to load: ' + err.message);
    } finally {
      loading.classList.add('hidden');
    }
  }

  function parseEvents(doc) {
    const anchors = doc.querySelectorAll('a[name^="centry."]');
    const events = [];

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
      let venueName = '';
      let venueHref = '';
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
      const rawHTML = infoDiv ? infoDiv.innerHTML : '';
      const rawText = infoDiv ? (infoDiv.textContent || '') : '';
      // Normalize curly quotes to straight ASCII for regex matching
      const infoHTML = rawHTML
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
      const infoText = rawText
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');

      const iconDiv = tr2.querySelector('.calender-entry-icons');
      const links = { info: '', web: '', maps: '' };
      if (iconDiv) {
        iconDiv.querySelectorAll('a').forEach(a => {
          const icon = a.querySelector('.material-icons');
          if (icon) {
            const type = icon.textContent.trim();
            if (type === 'info') links.info = a.getAttribute('href') || '';
            else if (type === 'web_asset') links.web = a.getAttribute('href') || '';
            else if (type === 'place') links.maps = a.getAttribute('href') || '';
          }
        });
      }

      events.push({ dateStr, dayOfWeek, time, address, venueName, venueHref, infoHTML, infoText, links });
    }

    return events;
  }

  // ── Render events ──

  function refreshFollowedBars() {
    document.querySelectorAll('.event').forEach(card => {
      const ev = loadedEvents.find(e => e.dateStr === card.dataset.date && e.time === card.dataset.time);
      if (!ev) return;
      const artists = extractArtistsBasic(ev.infoText);
      const has = artists.some(n => watchedArtists.includes(normalizeArtistName(n)));
      card.classList.toggle('event-has-followed', has);
    });
  }

  function refreshNowBars() {
    const now = new Date();
    document.querySelectorAll('.event').forEach(card => {
      const ev = loadedEvents.find(e => e.dateStr === card.dataset.date && e.time === card.dataset.time);
      if (!ev) return;
      const evStart = parseEventDateTime(ev.dateStr, ev.time);
      if (!evStart) return;
      const diffMin = (evStart.getTime() - now.getTime()) / 60000;
      card.classList.toggle('event-is-now', diffMin <= 0 && diffMin > -120);
      card.classList.toggle('event-is-soon', diffMin > 0 && diffMin <= 60);
    });
  }

  function renderEvents(events, filter) {
    if (events.length === 0) {
      eventList.innerHTML = '<div id="error">No concerts found.</div>';
      return;
    }

    const count = document.createElement('div');
    count.className = 'event-count';
    count.textContent = `${events.length} concert${events.length !== 1 ? 's' : ''}`;
    eventList.appendChild(count);

    const now = new Date();
    let firstCurrent = null;

    events.forEach(ev => {
      const div = document.createElement('div');
      div.className = 'event';
      div.dataset.date = ev.dateStr;
      div.dataset.time = ev.time;

      // Determine if past (for today view)
      const isPast = isEventPast(ev, now);
      if (isPast && filter === 'today') div.classList.add('event-past');
      else if (!isPast && filter === 'today' && !firstCurrent) firstCurrent = div;

      // Header
      const header = document.createElement('div');
      header.className = 'event-header';
      const timeSpan = document.createElement('span');
      timeSpan.className = 'event-time';
      timeSpan.textContent = ev.time;
      header.appendChild(timeSpan);
      if (ev.dayOfWeek || ev.dateStr) {
        const daySpan = document.createElement('span');
        daySpan.className = 'event-day';
        daySpan.textContent = [ev.dayOfWeek, ev.dateStr].filter(Boolean).join(' · ');
        header.appendChild(daySpan);
      }
      div.appendChild(header);

      // Venue
      const venueDiv = document.createElement('div');
      venueDiv.className = 'event-venue';
      if (ev.venueHref) {
        const a = document.createElement('a');
        a.href = normalizeUrl(ev.venueHref);
        a.target = '_blank';
        a.textContent = ev.venueName;
        venueDiv.appendChild(a);
      } else {
        venueDiv.textContent = ev.venueName;
      }
      div.appendChild(venueDiv);

      // Address
      const addrDiv = document.createElement('div');
      addrDiv.className = 'event-address';
      addrDiv.textContent = ev.address;
      div.appendChild(addrDiv);

      // Check if any followed artist is in this event
      const artists = extractArtistsBasic(ev.infoText);
      const hasFollowed = artists.some(n => watchedArtists.includes(normalizeArtistName(n)));
      if (hasFollowed) div.classList.add('event-has-followed');

      // "NOW" indicator: 30 min before concert start
      const evStart = parseEventDateTime(ev.dateStr, ev.time);
      if (evStart) {
        const diffMin = (evStart.getTime() - now.getTime()) / 60000;
        if (diffMin <= 0 && diffMin > -120) div.classList.add('event-is-now');
        if (diffMin > 0 && diffMin <= 60) div.classList.add('event-is-soon');
      }

      // Original description
      if (ev.infoHTML) {
        const infoDiv2 = document.createElement('div');
        infoDiv2.className = 'event-desc';
        infoDiv2.innerHTML = ev.infoHTML;
        div.appendChild(infoDiv2);
      }

      // ── Artist tags + follow buttons (compact) ──
      if (artists.length > 0 && artists.length <= 10) {
        const artistRow = document.createElement('div');
        artistRow.className = 'event-artists';
        artists.forEach(name => {
          const isWatched = watchedArtists.includes(normalizeArtistName(name));
          const tag = document.createElement('span');
          tag.className = 'artist-tag';
          tag.dataset.artist = name;
          const nameSpan = document.createElement('span');
          nameSpan.className = isWatched ? 'artist-name followed' : 'artist-name';
          nameSpan.textContent = isWatched ? `✓ ${name}` : name;
          tag.appendChild(nameSpan);
          const btn = document.createElement('span');
          btn.className = 'follow-btn' + (isWatched ? ' followed' : '');
          btn.textContent = isWatched ? 'Following' : '+ Follow';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleWatchArtist(name, btn, nameSpan);
          });
          tag.appendChild(btn);
          artistRow.appendChild(tag);
        });
        div.appendChild(artistRow);
      }

      // ── Link bar ──
      const linkBar = document.createElement('div');
      linkBar.className = 'event-links';
      if (ev.links.web) linkBar.appendChild(createLink(ev.links.web, 'Website'));
      if (ev.links.maps) linkBar.appendChild(createLink(ev.links.maps, 'Map'));

      // Calendar
      const calLink = document.createElement('a');
      calLink.href = '#';
      calLink.className = 'calendar-link';
      calLink.textContent = '📅 Calendar';
      calLink.addEventListener('click', e => {
        e.preventDefault();
        downloadICS(ev);
      });
      linkBar.appendChild(calLink);

      div.appendChild(linkBar);
      eventList.appendChild(div);
    });

    // Auto-scroll to current/upcoming event in today view
    if (firstCurrent) {
      setTimeout(() => firstCurrent.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }

  function renderOverview(events, filter) {
    const overview = document.getElementById('overview');
    if (!events.length) { overview.classList.add('hidden'); return; }

    const venues = new Set(events.map(e => e.venueName));
    const filterLabel = filter === 'today' ? 'Today' :
                        filter === 'tomorrow' ? 'Tomorrow' :
                        filter === 'next7' ? 'Next 7 days' :
                        filter === 'month' ? 'This month' : 'All concerts';

    const now = new Date();
    const upcoming = filter === 'today' ? events.filter(e => !isEventPast(e, now)).length : null;

    let html = `<div class="overview-summary"><span class="stat">${filterLabel}</span>: `;
    html += `<span class="stat">${events.length}</span> concerts at <span class="stat">${venues.size}</span> venues`;
    if (upcoming !== null) {
      html += ` · <span class="stat">${upcoming}</span> still ahead today`;
    }

    const topVenues = {};
    events.forEach(e => { if (e.venueName) topVenues[e.venueName] = (topVenues[e.venueName] || 0) + 1; });
    const sorted = Object.entries(topVenues).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (sorted.length > 0) {
      html += `. Top: ${sorted.map(([v, c]) => `<span class="venue-name">${escapeHtml(v)}</span>` + (c > 1 ? ` (${c})` : '')).join(', ')}`;
    }
    html += `</div>`;

    // Show followed artists' concerts — group by artist
    if (watchedArtists.length > 0) {
      const isDay = filter === 'today' || filter === 'tomorrow';
      const artistConcerts = {};
      events.forEach(ev => {
        const matchNames = watchedArtists.filter(a => ev.infoText.toLowerCase().includes(a.toLowerCase()));
        matchNames.forEach(a => {
          const norm = a.trim().replace(/[:;,.\s]+$/, '').replace(/\s+/g, ' ');
          if (!artistConcerts[norm]) artistConcerts[norm] = [];
          const label = isDay ? ev.time : ev.dateStr.replace(/\.\d{4}$/, '');
          artistConcerts[norm].push(`<span class="nowrap">${label}/${escapeHtml(ev.venueName)}</span>`);
        });
      });
      const entries = Object.entries(artistConcerts);
      if (entries.length > 0) {
        const rows = entries.map(([artist, concerts]) =>
          `<div class="followed-hint-row"><span class="followed-hint-artist">${escapeHtml(artist)}:</span> <span class="followed-hint-concerts">${concerts.join(', ')}</span></div>`
        ).join('');
        html += `<div class="followed-hint">${rows}</div>`;
      }
    }

    overview.className = 'overview-section';
    overview.innerHTML = html;
  }

  // ── Time helpers ──

  function isEventPast(ev, now) {
    const evStart = parseEventDateTime(ev.dateStr, ev.time);
    if (!evStart) return false;
    return (now.getTime() - evStart.getTime()) > 2 * 60 * 60 * 1000;
  }

  // ── Basic artist extraction for popup ──

  function extractArtistsBasic(infoText) {
    const names = new Set();
    const lines = infoText.split(/\n/).map(l => l.trim()).filter(Boolean);
    for (const rawLine of lines) {
      // Strip section headers before parsing
      const hStrip = rawLine.match(/^(?:set\s+\d+\s*:|duo\s*:|solo\s*:|trio\s*:|-set\s+\d+\s*-)\s*(.+)$/i);
      const line = hStrip ? hStrip[1].trim() : rawLine;
      if (!line) continue;
      // Names inside parentheses — extract before structured patterns
      const inner = extractNamesFromParens(line);
      if (inner) { inner.forEach(n => names.add(n)); continue; }
      // Name - instrument
      let m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (m) { const n = m[1].trim(); if (looksLikePersonName(n)) names.add(n); continue; }
      // Name (instrument)
      m = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (m) { const n = m[1].trim(); if (looksLikePersonName(n)) names.add(n); continue; }
      // Name : instrument
      m = line.match(/^([A-Z\u00C0-\u024F][A-Za-z\u00C0-\u024F'.]+(?:\s+[A-Za-z\u00C0-\u024F'.]+){0,3})\s*:\s+(.+)$/);
      if (m) { const n = m[1].trim(); if (looksLikePersonName(n)) names.add(n); continue; }
      // Name & Name
      m = line.match(/^(.+?)\s+[&∧]\s+(.+)$/);
      if (m) {
        [m[1].trim(), m[2].trim()].forEach(n => { if (looksLikePersonName(n)) names.add(n); });
        continue;
      }
      // Name | instrument
      m = line.match(/^(.+?)\s*\|\s+(.+)$/);
      if (m) { const n = m[1].trim(); if (looksLikePersonName(n)) names.add(n); continue; }
      // Bare name fallback with band suffix stripping
      if (line.length < 60) {
        const stripped = line.replace(/\s+(Trio|Duo|Solo|Quartett|Quartet|Quintett|Quintet|Project|Ensemble|Group|Band|Collective|Orchestra|Four)$/i, '').trim();
        const candidate = (stripped.length >= 3 && stripped !== line) ? stripped : line;
        if (looksLikePersonName(candidate)) names.add(candidate);
      }
    }
    return [...names].filter(n => looksLikePersonName(n)).slice(0, 8);
  }

  // ── Watch toggle ──

  function toggleWatchArtist(name, btn, nameSpan) {
    name = normalizeArtistName(name);
    const idx = watchedArtists.indexOf(name);
    if (idx === -1) {
      watchedArtists.push(name);
      btn.textContent = 'Following';
      btn.classList.add('followed');
      if (nameSpan) { nameSpan.textContent = `✓ ${name}`; nameSpan.classList.add('followed'); }
      chrome.runtime.sendMessage({ action: 'artistFollowed', name }).catch(() => {});
    } else {
      watchedArtists.splice(idx, 1);
      btn.textContent = '+ Follow';
      btn.classList.remove('followed');
      if (nameSpan) { nameSpan.textContent = name; nameSpan.classList.remove('followed'); }
    }
    chrome.storage.local.set({ watchedArtists });
    // Update followed indicators on all visible events
    document.querySelectorAll('.event-has-followed').forEach(el => {
      const has = [...el.querySelectorAll('.artist-name.followed')].length > 0;
      el.classList.toggle('event-has-followed', has);
    });
  }

  // ── ICS download (shared in shared/parser.js) ──

  function createLink(href, label) {
    const a = document.createElement('a');
    a.href = normalizeUrl(href);
    a.target = '_blank';
    a.textContent = label;
    return a;
  }

  function normalizeUrl(href) {
    if (href.startsWith('/')) return 'https://echtzeitmusik.de' + href;
    if (!href.startsWith('http')) return 'https://' + href;
    return href;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  // ── Notifications tab ──

  function renderNotifications() {
    loading.classList.add('hidden');
    errorEl.classList.add('hidden');
    document.getElementById('overview').classList.add('hidden');
    eventList.innerHTML = '';

    // ── Settings: notification mode ──
    chrome.storage.local.get(['notifMode', 'unreadNotifications'], (result) => {
      const mode = result.notifMode || 'silent';
      const list = result.unreadNotifications || [];

      const settings = document.createElement('div');
      settings.className = 'notif-settings';
      settings.innerHTML = '<span class="notif-settings-label">🔔 Toast</span>';
      ['off', 'silent'].forEach(val => {
        const label = document.createElement('label');
        label.className = 'notif-mode-label';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'notifMode';
        radio.value = val;
        if (val === mode || (!mode && val === 'silent')) radio.checked = true;
        radio.addEventListener('change', () => {
          if (radio.checked) {
            chrome.storage.local.set({ notifMode: val });
          }
        });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(val === 'off' ? 'Off' : 'Silent'));
        settings.appendChild(label);
      });
      eventList.appendChild(settings);

      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.style.cssText = 'text-align:center;color:#666;padding:40px 16px;font-size:13px;';
        empty.textContent = 'No notifications · follow artists to get notified when they play';
        eventList.appendChild(empty);
        return;
      }

      const count = document.createElement('div');
      count.className = 'event-count';
      count.textContent = `${list.length} notification${list.length !== 1 ? 's' : ''}`;
      eventList.appendChild(count);

      list.forEach(n => {
        const item = document.createElement('div');
        item.className = 'notif-list-item';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'notif-list-info';

        const artistEl = document.createElement('div');
        artistEl.className = 'notif-list-artist';
        artistEl.textContent = n.artistName;
        infoDiv.appendChild(artistEl);

        const detailEl = document.createElement('div');
        detailEl.className = 'notif-list-detail';
        detailEl.textContent = n.eventInfo;
        infoDiv.appendChild(detailEl);

        if (n.address) {
          const addrEl = document.createElement('div');
          addrEl.className = 'notif-list-address';
          addrEl.textContent = n.address;
          infoDiv.appendChild(addrEl);
        }

        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'notif-dismiss';
        dismissBtn.textContent = '✕';
        dismissBtn.setAttribute('aria-label', `Dismiss notification for ${n.artistName}`);
        dismissBtn.addEventListener('click', () => {
          chrome.storage.local.get(['unreadNotifications', 'dismissedNotifIds'], (result) => {
            const updated = (result.unreadNotifications || []).filter(x => x.id !== n.id);
            chrome.storage.local.set({ unreadNotifications: updated });
            if (updated.length === 0) chrome.action.setBadgeText({ text: '' });
            // Also persist dismissal so floating toast never resurfaces
            const dismissed = result.dismissedNotifIds || [];
            if (!dismissed.includes(n.id)) {
              dismissed.push(n.id);
              chrome.storage.local.set({ dismissedNotifIds: dismissed });
            }
            renderNotifications();
          });
        });

        item.appendChild(infoDiv);
        item.appendChild(dismissBtn);
        eventList.appendChild(item);
      });
    });
  }

  loadConcerts(currentFilter);
});
