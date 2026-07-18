document.addEventListener('DOMContentLoaded', () => {
  const eventList = document.getElementById('event-list');
  const loading = document.getElementById('loading');
  const errorEl = document.getElementById('error');

  let currentFilter = 'today';
  let watchedArtists = [];
  let loadedEvents = [];
  let notifMode = 'on';
  let justFollowed = false;
  const responseCache = {};
  function getCached(url) { const e = responseCache[url]; return e && (Date.now() - e.t < 3e5) ? e.d : null; }
  function setCache(url, d) { responseCache[url] = { d, t: Date.now() }; }

  async function initPopup() {
    const result = await chrome.storage.local.get(['watchedArtists', 'notifMode']);
    watchedArtists = [...new Set((result.watchedArtists || []).map(n => normalizeArtistName(n)))];

    // One-time repair for a past bug that wrote the catalogue's lowercased
    // normalizedKey ("antonio borghini") into watchedArtists instead of the
    // display name. watchedArtists.includes(normalizeArtistName(name)) below
    // is exact-case, so a corrupted entry silently loses its "Following"
    // state on artist tags. Recover proper casing from the catalogue.
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
    notifMode = result.notifMode || 'on';
    updateBellVisual();
    loadConcerts(currentFilter);
  }

  function updateBellVisual() {
    const bell = document.querySelector('[data-filter="notifications"]');
    if (!bell) return;
    if (notifMode === 'off') {
      bell.textContent = '🔇';
      bell.classList.add('dimmed');
    } else {
      bell.textContent = '🔔';
      bell.classList.remove('dimmed');
    }
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.watchedArtists) {
      watchedArtists = changes.watchedArtists.newValue || [];
      if (loadedEvents.length > 0) {
        renderOverview(loadedEvents, currentFilter);
        refreshFollowedBars();
        refreshNowBars();
      }
    }
    if (changes.unreadNotifications && currentFilter === 'notifications') {
      renderNotifications();
    }
  });

  setInterval(refreshNowBars, 60000);

  // Unified handler for all [data-filter] buttons (filter bar + notifications)
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.filter === 'notifications') {
        if (notifMode === 'off') {
          notifMode = 'on';
          chrome.storage.local.set({ notifMode: 'on' });
          updateBellVisual();
        } else if (currentFilter === 'notifications') {
          notifMode = 'off';
          chrome.storage.local.set({ notifMode: 'off' });
          updateBellVisual();
          document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
          document.querySelector('[data-filter="today"]').classList.add('active');
          currentFilter = 'today';
          loadConcerts('today');
          return;
        }
      }
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      if (currentFilter === 'notifications') {
        chrome.action.setBadgeText({ text: '' });
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
        const decoder = new TextDecoder('windows-1252');
        html = fixMojibake(decoder.decode(buffer));
        setCache(url, html);
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');

      loadedEvents = parseEvents(doc);
      renderOverview(loadedEvents, filter);
      renderEvents(loadedEvents, filter);
      if (watchedArtists.length > 0) refreshFollowedBars();
      refreshNowBars();
      // Auto-collect artist data into catalogue
      collectArtistsFromEvents(loadedEvents);
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
      let venueName = '';
      let venueHref = '';
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
      const rawHTML = infoDiv ? infoDiv.innerHTML : '';
      const rawText = infoDiv ? (infoDiv.textContent || '') : '';
      // Normalize curly quotes to straight ASCII for regex matching
      const infoHTML = rawHTML
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
      const infoText = rawText
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');

      // Extract all artist links (bandcamp, soundcloud, website)
      const artistLinks = extractArtistLinks(infoHTML, infoText);

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

      const freeEntry = detectFreeEntry(infoText);
      events.push({ dateStr, dayOfWeek, time, address, venueName, venueHref, infoHTML, infoText, links, artistLinks, freeEntry });
    }

    return events;
  }

  function refreshFollowedBars() {
    document.querySelectorAll('.event').forEach(card => {
      const ev = loadedEvents.find(e => e.dateStr === card.dataset.date && e.time === card.dataset.time);
      if (!ev) return;
      const has = watchedArtists.some(a => matchesArtist(ev.infoText, a));
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
      card.classList.toggle('event-is-now', diffMin <= 30 && diffMin > -120);
      card.classList.toggle('event-is-soon', diffMin > 30 && diffMin <= 120);
    });
  }

  function captureEventCard(ev, filter, allEvents) {
    const W = 480, PAD = 24;
    const artists = extractArtistsBasic(ev.infoText);
    const dateLabel = [ev.dayOfWeek, ev.dateStr].filter(Boolean).join(' \u00b7 ');

    // Pre-measure text to compute canvas height
    const canvas = document.createElement('canvas');
    canvas.width = W;
    const ctx = canvas.getContext('2d');

    // Fonts
    const MONO = '700 12px "SFMono-Regular", Consolas, monospace';
    const MONO_SM = '400 10px "SFMono-Regular", Consolas, monospace';
    const MONO_XS = '400 9px "SFMono-Regular", Consolas, monospace';
    const SERIF_LG = '700 20px "Iowan Old Style", Palatino, Georgia, serif';
    const SERIF = '400 13px "Iowan Old Style", Palatino, Georgia, serif';
    const TITLE = '700 22px "Iowan Old Style", Palatino, Georgia, serif';
    const SUBTITLE = '400 10px "SFMono-Regular", Consolas, monospace';
    const SUMMARY = '400 10px "SFMono-Regular", Consolas, monospace';
    const WATERMARK = '400 9px "SFMono-Regular", Consolas, monospace';

    // Colors
    const PAPER = '#f4f0e7', INK = '#1a1d18', MUTED = '#4a4d43';
    const CORAL = '#d45540', LINE = '#b8b1a4';

    // Word-wrap helper
    function wrapText(ctx, text, maxWidth, font) {
      ctx.font = font;
      const words = text.split(/\s+/);
      const lines = [];
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    // Build summary line
    const filterLabel = filter === 'today' ? 'Today' :
                        filter === 'tomorrow' ? 'Tomorrow' :
                        filter === 'next7' ? 'Next 7 days' :
                        filter === 'month' ? 'This month' : 'All concerts';
    const venueCount = new Set(allEvents.map(e => e.venueName)).size;
    const summaryText = `${filterLabel} \u00b7 ${allEvents.length} concert${allEvents.length !== 1 ? 's' : ''} at ${venueCount} venue${venueCount !== 1 ? 's' : ''}`;

    // Calculate height
    let y = PAD;
    y += 26; // title "echtzeitmusik"
    y += 14; // subtitle "Berlin experimental music calendar"
    y += 12; // gap before header divider
    y += 1;  // header divider line
    y += 10; // gap after header divider
    y += 14; // summary line
    y += 16; // gap before event content
    y += 16; // time
    y += 14; // date
    y += 14; // gap before venue
    const venueLines = wrapText(ctx, ev.venueName || 'Unknown venue', W - PAD * 2, SERIF_LG);
    y += venueLines.length * 24;
    y += 4;
    if (ev.address) {
      const addrLines = wrapText(ctx, ev.address, W - PAD * 2, MONO_SM);
      y += addrLines.length * 14;
    }
    y += 14; // gap before artists
    const maxArtists = 8;
    const shownArtists = artists.slice(0, maxArtists);
    y += shownArtists.length * 18;
    if (artists.length > maxArtists) y += 18;
    y += 18; // gap before footer divider
    y += 1;  // footer divider line
    y += 14; // gap after footer divider
    y += 12; // watermark
    y += PAD; // bottom padding

    canvas.height = y;

    // Draw background
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, y);

    // Draw content
    y = PAD;

    // Title
    ctx.font = TITLE;
    ctx.fillStyle = INK;
    ctx.fillText('echtzeitmusik', PAD, y + 20);
    y += 26;

    // Subtitle
    ctx.font = SUBTITLE;
    ctx.fillStyle = MUTED;
    ctx.fillText('Berlin experimental music calendar', PAD, y + 10);
    y += 14;

    // Gap
    y += 12;

    // Header divider
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    y += 1;

    // Gap
    y += 10;

    // Summary line
    ctx.font = SUMMARY;
    ctx.fillStyle = MUTED;
    ctx.fillText(summaryText, PAD, y + 10);
    y += 14;

    // Gap
    y += 16;

    // Time (right-aligned)
    ctx.font = MONO;
    ctx.fillStyle = CORAL;
    const timeWidth = ctx.measureText(ev.time).width;
    ctx.fillText(ev.time, W - PAD - timeWidth, y + 11);
    y += 6;

    // Date (right-aligned, below time)
    if (dateLabel) {
      ctx.font = MONO_SM;
      ctx.fillStyle = MUTED;
      const dateWidth = ctx.measureText(dateLabel).width;
      ctx.fillText(dateLabel, W - PAD - dateWidth, y + 10);
    }
    y += 14;

    // Gap
    y += 10;

    // Venue
    ctx.font = SERIF_LG;
    ctx.fillStyle = INK;
    for (const vl of venueLines) {
      ctx.fillText(vl, PAD, y + 18);
      y += 24;
    }
    y += 4;

    // Address
    if (ev.address) {
      ctx.font = MONO_SM;
      ctx.fillStyle = MUTED;
      const addrLines = wrapText(ctx, ev.address, W - PAD * 2, MONO_SM);
      for (const al of addrLines) {
        ctx.fillText(al, PAD, y + 10);
        y += 14;
      }
    }

    // Gap
    y += 10;

    // Artists
    ctx.font = SERIF;
    ctx.fillStyle = INK;
    for (const name of shownArtists) {
      ctx.fillText(name, PAD, y + 13);
      y += 18;
    }
    if (artists.length > maxArtists) {
      ctx.font = MONO_XS;
      ctx.fillStyle = MUTED;
      ctx.fillText(`+ ${artists.length - maxArtists} more`, PAD, y + 10);
      y += 18;
    }

    // Gap
    y += 8;

    // Footer divider
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    y += 1;

    // Gap
    y += 14;

    // Watermark
    ctx.font = WATERMARK;
    ctx.fillStyle = LINE;
    ctx.textAlign = 'center';
    ctx.fillText('echtzeitmusik.de', W / 2, y);
    ctx.textAlign = 'left';

    // Download
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (ev.venueName || 'event').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
      a.download = `echtzeitmusik-${ev.dateStr.replace(/\./g, '')}-${ev.time.replace('.', '')}-${safeName}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  function renderEvents(events, filter) {
    if (events.length === 0) {
      eventList.innerHTML = '<div id="error">No concerts found.</div>';
      return;
    }

    const count = document.createElement('div');
    count.className = 'event-count';
    count.textContent = `${events.length} event${events.length !== 1 ? 's' : ''} in the programme`;
    eventList.appendChild(count);

    const now = new Date();
    let firstCurrent = null;

    let featuredEventAdded = false;
    events.forEach(ev => {
      const div = document.createElement('div');
      div.className = 'event';
      div.dataset.date = ev.dateStr;
      div.dataset.time = ev.time;

      // Determine if past (for today view)
      const isPast = isEventPast(ev, now);
      if (isPast && filter === 'today') div.classList.add('event-past');
      else if (!isPast && filter === 'today' && !firstCurrent) firstCurrent = div;

      // Give the next show a clear visual lead without hiding the full programme.
      const shouldFeature = !featuredEventAdded && !isPast && (filter === 'today' || filter === 'tomorrow');
      if (shouldFeature) {
        featuredEventAdded = true;
        div.classList.add('event-featured');
        const lead = document.createElement('div');
        lead.className = 'event-lead';
        lead.textContent = filter === 'today' ? 'Next on' : 'First tomorrow';
        div.appendChild(lead);
      }

      // Two-column body: when/where on the left, the programme on the right.
      const body = document.createElement('div');
      body.className = 'event-body';
      const when = document.createElement('div');
      when.className = 'event-when';
      const what = document.createElement('div');
      what.className = 'event-what';

      // ── LEFT: time · day · venue · address · free-entry marker ──
      const timeSpan = document.createElement('div');
      timeSpan.className = 'event-time';
      timeSpan.textContent = ev.time || '—';
      when.appendChild(timeSpan);
      if (ev.dayOfWeek || ev.dateStr) {
        const daySpan = document.createElement('div');
        daySpan.className = 'event-day';
        daySpan.textContent = [ev.dayOfWeek, ev.dateStr].filter(Boolean).join(' · ');
        when.appendChild(daySpan);
      }

      const venueDiv = document.createElement('div');
      venueDiv.className = 'event-venue';
      if (ev.venueHref) {
        const a = document.createElement('a');
        a.href = normalizeUrl(ev.venueHref);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = ev.venueName;
        venueDiv.appendChild(a);
      } else {
        venueDiv.textContent = ev.venueName;
      }
      when.appendChild(venueDiv);

      const addrDiv = document.createElement('div');
      addrDiv.className = 'event-address';
      addrDiv.textContent = ev.address;
      when.appendChild(addrDiv);

      if (ev.freeEntry) {
        const free = document.createElement('div');
        free.className = 'event-free';
        free.textContent = 'Free entry';
        free.title = 'Free admission / Eintritt frei';
        when.appendChild(free);
        div.classList.add('event-is-free');
      }

      // Check if any followed artist is in this event
      const hasFollowed = watchedArtists.some(a => matchesArtist(ev.infoText, a));
      if (hasFollowed) div.classList.add('event-has-followed');

      // Extract artists for tag rendering (used below)
      const artists = extractArtistsBasic(ev.infoText);

      // "NOW" indicator: 30 min before concert start
      const evStart = parseEventDateTime(ev.dateStr, ev.time);
      if (evStart) {
        const diffMin = (evStart.getTime() - now.getTime()) / 60000;
        if (diffMin <= 30 && diffMin > -120) div.classList.add('event-is-now');
        if (diffMin > 30 && diffMin <= 120) div.classList.add('event-is-soon');
      }

      // ── RIGHT: programme note first, then artists + links at the bottom ──
      if (ev.infoHTML) {
        const note = document.createElement('div');
        note.className = 'event-note';
        const full = document.createElement('div');
        full.className = 'event-desc event-note-full';
        renderSanitizedHtml(full, ev.infoHTML);
        note.appendChild(full);
        what.appendChild(note);
      }

      // Identified artists with their listen/search links
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
          const artistLinks = ev.artistLinks?.[name] || {};
          tag.appendChild(createMusicSearchLinks(name, artistLinks));
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
        what.appendChild(artistRow);
      }

      const linkBar = document.createElement('div');
      linkBar.className = 'event-links';
      if (ev.links.info) linkBar.appendChild(createLink(ev.links.info, 'Info'));
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

      // Screenshot download button (in links bar, next to Calendar)
      const ssBtn = document.createElement('a');
      ssBtn.href = '#';
      ssBtn.className = 'screenshot-btn';
      ssBtn.title = 'Download event card as image';
      ssBtn.textContent = '\u2913 Card';
      ssBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        captureEventCard(ev, filter, events);
      });
      linkBar.appendChild(ssBtn);

      // Links live in the left column, under venue/address.
      when.appendChild(linkBar);

      body.append(when, what);
      div.appendChild(body);
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
        const matchNames = watchedArtists.filter(a => matchesArtist(ev.infoText, a));
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

  function isEventPast(ev, now) {
    const evStart = parseEventDateTime(ev.dateStr, ev.time);
    if (!evStart) return false;
    return (now.getTime() - evStart.getTime()) > 2 * 60 * 60 * 1000;
  }

  function extractArtistsBasic(infoText) {
    // Structure-first engine (shared/extractor.js) — already validated names
    return extractEventArtists(infoText).artists.map(a => a.name).slice(0, 8);
  }

  async function toggleWatchArtist(name, btn, nameSpan) {
    name = normalizeArtistName(name);
    const idx = watchedArtists.indexOf(name);
    if (idx === -1) {
      watchedArtists.push(name);
      btn.textContent = 'Following';
      btn.classList.add('followed');
      if (nameSpan) { nameSpan.textContent = `✓ ${name}`; nameSpan.classList.add('followed'); }
      showPopupToast(`✓ Following ${name}`);
      justFollowed = true;
      setTimeout(() => justFollowed = false, 15000);
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tabId = tabs[0]?.id;
      try {
        const response = await chrome.runtime.sendMessage({ action: 'artistFollowed', name });
        if (response?.ok) {
          if (response.upcoming > 0) {
            showPopupToast(`🔔 ${response.artistName}: ${response.eventInfo} (in ${response.label})`);
            if (tabId) {
              chrome.scripting.executeScript({
                target: { tabId },
                func: injectPageToast,
                args: [response.artistName, `${response.eventInfo} (in ${response.label})`],
              }).catch(() => {});
            }
          } else {
            showPopupToast(`ℹ No upcoming events found for ${name}`);
          }
        } else {
          showPopupToast(`⚠ Could not check events: ${response?.error || 'unknown error'}`);
        }
      } catch (e) {
        showPopupToast(`⚠ Failed to check events: ${e.message || e}`);
      }
    } else {
      watchedArtists.splice(idx, 1);
      btn.textContent = '+ Follow';
      btn.classList.remove('followed');
      if (nameSpan) { nameSpan.textContent = name; nameSpan.classList.remove('followed'); }
    }
    chrome.storage.local.set({ watchedArtists });
  }

  function createLink(href, label) {
    const a = document.createElement('a');
    a.href = normalizeUrl(href);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    return a;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  function showPopupToast(text) {
    let container = document.getElementById('popup-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'popup-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'popup-toast';
    toast.textContent = text;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function injectPageToast(artist, info) {
    let c = document.getElementById('ech-toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'ech-toast-container';
      c.style.cssText = 'all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column-reverse;gap:8px;';
      document.body.appendChild(c); }
    const host = document.createElement('div'); host.style.cssText = 'all:initial;';
    const s = host.attachShadow({ mode: 'closed' });
    s.innerHTML = `<style>
*{margin:0;padding:0;box-sizing:border-box}
.t{background:#1e1e0a;border:1px solid #4a4a1a;border-left:3px solid #ffd54f;border-radius:6px;
padding:10px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;
color:#e0e0e0;max-width:380px;box-shadow:0 4px 16px rgba(0,0,0,0.4);display:flex;align-items:flex-start;gap:8px;animation:in .3s ease}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.i{flex:1;min-width:0}
.a{font-weight:700;color:#ffd54f}
.d{color:#bbb;margin-top:2px}
.x{flex-shrink:0;background:none;border:none;color:#666;cursor:pointer;font-size:16px;padding:2px;line-height:1}
.x:hover{color:#e57373}
</style><div class="t"><div class="i"><div class="a">${artist.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div><div class="d">${info.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div></div><button class="x">✕</button></div>`;
    s.querySelector('.x').onclick = () => host.remove();
    c.appendChild(host);
    setTimeout(() => { if (host.parentNode) host.remove(); }, 8000);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'showToast' && !justFollowed) {
      showPopupToast(`🔔 ${msg.artistName} — ${msg.eventInfo}`);
    }
  });

  function renderNotifications() {
    loading.classList.add('hidden');
    errorEl.classList.add('hidden');
    document.getElementById('overview').classList.add('hidden');
    eventList.innerHTML = '';

    const pauseRow = document.createElement('div');
    pauseRow.className = 'notif-pause-row';
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'notif-pause-btn';
    pauseBtn.textContent = '🔇 Pause notifications';
    pauseBtn.addEventListener('click', () => {
      notifMode = 'off';
      chrome.storage.local.set({ notifMode: 'off' });
      updateBellVisual();
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-filter="today"]').classList.add('active');
      currentFilter = 'today';
      loadConcerts('today');
    });
    pauseRow.appendChild(pauseBtn);
    eventList.appendChild(pauseRow);

    chrome.storage.local.get('unreadNotifications', (result) => {
      // Hide notifications for events that already happened (background prunes them on its next check)
      const list = (result.unreadNotifications || []).filter(n => !n.eventTs || n.eventTs > Date.now());

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
        // Countdown computed at render time so it never goes stale
        detailEl.textContent = n.eventTs
          ? `${n.eventInfo} (in ${formatLead(n.eventTs - Date.now())})`
          : n.eventInfo;
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
            chrome.action.setBadgeText({ text: updated.length > 0 ? String(updated.length) : '' });
            // Also persist dismissal so floating toast never resurfaces
            const dismissed = result.dismissedNotifIds || [];
            if (!dismissed.includes(n.id)) {
              dismissed.push(n.id);
              chrome.storage.local.set({ dismissedNotifIds: dismissed.slice(-200) });
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

  async function collectArtistsFromEvents(events) {
    if (typeof CatalogueDB === 'undefined') return;
    try {
      await CatalogueDB.init();
      for (const ev of events) {
        const blocks = extractPerformanceBlocks(ev.infoText);
        for (const block of blocks) {
          for (const name of block) {
            const instruments = catExtractInstruments(name, ev.infoText);
            const genres = extractGenres(ev.infoText, name);
            const blockCollabs = block.filter(n => normalizeArtistName(n).toLowerCase() !== normalizeArtistName(name).toLowerCase());
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
              collaborators: blockCollabs.map(function(n) { return normalizeArtistName(n).toLowerCase(); }),
            });
          }
        }
      }
    } catch (e) {
      console.error('[echtzeit] collectArtistsFromEvents failed:', e);
    }
  }

  initPopup();
});
