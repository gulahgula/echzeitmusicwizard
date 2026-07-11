document.addEventListener('DOMContentLoaded', async () => {
  const searchInput = document.getElementById('search');
  const filterInstrument = document.getElementById('filter-instrument');
  const filterVenue = document.getElementById('filter-venue');
  const filterGenre = document.getElementById('filter-genre');
  const filterTag = document.getElementById('filter-tag');
  const sortSelect = document.getElementById('sort');
  const emptyState = document.getElementById('empty-state');
  const loadingEl = document.getElementById('loading');
  const loadingFill = document.querySelector('.loading-fill');
  const resultsEl = document.getElementById('results');
  const resultCount = document.getElementById('result-count');
  const artistList = document.getElementById('artist-list');
  const syncBanner = document.getElementById('sync-banner');
  const footerStats = document.getElementById('footer-stats');
  const detailOverlay = document.getElementById('detail-overlay');
  const detailContent = document.getElementById('detail-content');

  let allArtists = [];
  let filteredArtists = [];
  let currentSort = 'activity';

  // ── Init ──

  await CatalogueDB.init();
  await refreshView();

  // ── Refresh from storage ──

  async function refreshView() {
    allArtists = await CatalogueDB.getAll();
    const syncInfo = await CatalogueDB.getSyncInfo();

    if (allArtists.length === 0) {
      emptyState.classList.remove('hidden');
      loadingEl.classList.add('hidden');
      resultsEl.classList.add('hidden');
      syncBanner.classList.add('hidden');
    } else {
      emptyState.classList.add('hidden');
      resultsEl.classList.remove('hidden');
      showSyncBanner(syncInfo);
      populateFilters();
      applyFilters();
    }

    footerStats.textContent = `${allArtists.length} artists in local catalogue`;
  }

  // ── Sync banner ──

  function showSyncBanner(info) {
    if (!info.lastGitHubSync) {
      syncBanner.classList.add('hidden');
      return;
    }
    const date = new Date(info.lastGitHubSync).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    syncBanner.innerHTML = `
      Community data from GitHub: <strong>${date}</strong> · ${info.artistCount || allArtists.length} artists.
      Events since then are collected automatically.
      <a class="refresh-link" id="banner-refresh">Refresh from GitHub</a>
    `;
    syncBanner.classList.remove('hidden');
    document.getElementById('banner-refresh').addEventListener('click', fetchFromGitHub);
  }

  // ── Populate filter dropdowns ──

  function populateFilters() {
    const instruments = new Set();
    const venues = new Set();
    const genres = new Set();
    const tags = new Set();

    for (const a of allArtists) {
      if (a.instruments) a.instruments.forEach(i => instruments.add(i.name));
      if (a.venues) a.venues.forEach(v => venues.add(v.name));
      if (a.genres) a.genres.forEach(g => genres.add(g));
      if (a.tags) a.tags.forEach(t => tags.add(t));
    }

    populateSelect(filterInstrument, instruments);
    populateSelect(filterVenue, venues);
    populateSelect(filterGenre, genres);
    populateSelect(filterTag, tags);
  }

  function populateSelect(select, values) {
    const current = select.value;
    select.innerHTML = `<option value="">All ${select.id.replace('filter-', '')}s</option>`;
    for (const v of [...values].sort()) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
    select.value = current;
  }

  // ── Filter + sort ──

  function applyFilters() {
    const q = searchInput.value.toLowerCase().trim();
    const inst = filterInstrument.value;
    const venue = filterVenue.value;
    const genre = filterGenre.value;
    const tag = filterTag.value;

    filteredArtists = allArtists.filter(a => {
      if (q && !matchesSearch(a, q)) return false;
      if (inst && !a.instruments?.some(i => i.name === inst)) return false;
      if (venue && !a.venues?.some(v => v.name === venue)) return false;
      if (genre && !a.genres?.some(g => g === genre)) return false;
      if (tag && !a.tags?.some(t => t === tag)) return false;
      return true;
    });

    // Sort
    const sort = sortSelect.value;
    filteredArtists.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'recent') return (b.lastSeen || '').localeCompare(a.lastSeen || '');
      if (sort === 'venues') return (b.venues?.length || 0) - (a.venues?.length || 0);
      // activity (default)
      return (totalEvents(b) - totalEvents(a));
    });

    renderResults();
  }

  function matchesSearch(artist, q) {
    if (artist.name.toLowerCase().includes(q)) return true;
    if (artist.aliases?.some(a => a.toLowerCase().includes(q))) return true;
    if (artist.instruments?.some(i => i.name.toLowerCase().includes(q))) return true;
    if (artist.venues?.some(v => v.name.toLowerCase().includes(q))) return true;
    if (artist.genres?.some(g => g.toLowerCase().includes(q))) return true;
    if (artist.tags?.some(t => t.toLowerCase().includes(q))) return true;
    if (artist.bio?.toLowerCase().includes(q)) return true;
    return false;
  }

  function totalEvents(a) {
    return a.events?.length || 0;
  }

  // ── Render results ──

  function renderResults() {
    if (filteredArtists.length === 0) {
      artistList.innerHTML = '<div class="empty-results">No artists match your filters.</div>';
      resultCount.textContent = '0 artists';
      return;
    }

    resultCount.textContent = `${filteredArtists.length} artist${filteredArtists.length !== 1 ? 's' : ''}`;

    const now = new Date();
    const currentYear = String(now.getFullYear());
    const currentMonth = now.getMonth() + 1;

    artistList.innerHTML = filteredArtists.map((a, i) => {
      const instruments = (a.instruments || []).map(inst => inst.name).join(', ');
      const topVenues = (a.venues || [])
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .slice(0, 3)
        .map(v => `${v.name} (${v.count})`)
        .join(', ');
      const eventCount = totalEvents(a);
      const yr = a.activity?.[currentYear];

      return `<div class="artist-card" data-key="${escapeAttr(a.normalizedKey)}" tabindex="0">
        <span class="rank">${i + 1}</span>
        <div class="info">
          <div class="name">${escapeHtml(a.name)}</div>
          <div class="meta">
            ${instruments ? `<span class="instrument">${escapeHtml(instruments)}</span> · ` : ''}
            <span class="count">${eventCount} concert${eventCount !== 1 ? 's' : ''}</span>
            ${topVenues ? ` · <span class="venue">${escapeHtml(topVenues)}</span>` : ''}
          </div>
          ${yr ? renderActivityBar(yr, currentMonth) : ''}
        </div>
        <div class="right-col">
          ${renderMusicLinks(a)}
          <button class="follow-toggle${a.followed ? ' followed' : ''}" data-key="${escapeAttr(a.normalizedKey)}">
            ${a.followed ? '✓ Following' : '+ Follow'}
          </button>
        </div>
      </div>`;
    }).join('');

    // Attach handlers
    artistList.querySelectorAll('.artist-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.follow-toggle') || e.target.closest('.music-search')) return;
        showDetail(card.dataset.key);
      });
    });

    artistList.querySelectorAll('.follow-toggle').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const artist = allArtists.find(a => a.normalizedKey === key);
        if (!artist) return;
        const newState = !artist.followed;
        await CatalogueDB.setFollowed(key, newState);
        artist.followed = newState;
        btn.classList.toggle('followed', newState);
        btn.textContent = newState ? '✓ Following' : '+ Follow';
        // Update in chrome.storage for backward compat
        const followed = allArtists.filter(a => a.followed).map(a => a.normalizedKey);
        chrome.storage.local.set({ watchedArtists: followed });
      });
    });
  }

  function renderActivityBar(yearData, currentMonth) {
    if (!yearData || !yearData.months || yearData.months.length === 0) return '';
    const months = yearData.months;
    let html = '<div class="activity-bar">';
    for (let m = 1; m <= 12; m++) {
      const active = months.includes(m);
      const isCurrent = m === currentMonth;
      html += `<div class="month${active ? ' active' : ''}${active && isCurrent ? ' current' : ''}"></div>`;
    }
    html += '</div>';
    return html;
  }

  // ── Music search links ──

  function renderMusicLinks(artist) {
    const name = encodeURIComponent(artist.name);
    const bcUrl = artist.links?.bandcamp || `https://bandcamp.com/search?q=${name}&item_type=a`;
    const ytUrl = artist.links?.youtube || `https://www.youtube.com/results?search_query=${name}`;
    const spUrl = artist.links?.spotify || `https://open.spotify.com/search/${name}`;
    const scUrl = artist.links?.soundcloud || `https://soundcloud.com/search?q=${name}`;

    return `<div class="music-search">
      <span class="search-icon">🔍</span>
      <span class="search-menu">
        <a href="${ytUrl}" target="_blank" title="YouTube">YT</a>
        <a href="${spUrl}" target="_blank" title="Spotify">SP</a>
        <a href="${bcUrl}" target="_blank" title="Bandcamp">BC</a>
        <a href="${scUrl}" target="_blank" title="SoundCloud">SC</a>
      </span>
    </div>`;
  }

  // ── Artist detail ──

  function showDetail(key) {
    const artist = allArtists.find(a => a.normalizedKey === key);
    if (!artist) return;

    const instruments = (artist.instruments || []).map(i => i.name).join(', ') || '—';
    const genres = (artist.genres || []).join(', ') || '—';
    const aliases = (artist.aliases || []).join(', ');
    const projects = (artist.projects || []).join(', ');
    const eventCount = totalEvents(artist);

    // Sort events by date descending
    const events = [...(artist.events || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Sort venues by count
    const venues = [...(artist.venues || [])].sort((a, b) => (b.count || 0) - (a.count || 0));

    // Sort collaborators
    const collabs = [...(artist.collaborators || [])].sort((a, b) => (b.count || 0) - (a.count || 0));

    // Links
    const links = artist.links || {};
    const linkEntries = [
      links.bandcamp && { url: links.bandcamp, label: 'Bandcamp', cls: 'play-link' },
      links.spotify && { url: links.spotify, label: 'Spotify' },
      links.youtube && { url: links.youtube, label: 'YouTube' },
      links.soundcloud && { url: links.soundcloud, label: 'SoundCloud' },
      links.website && { url: links.website, label: 'Website' },
    ].filter(Boolean);

    detailContent.innerHTML = `
      <div class="detail-header">
        <h2>${escapeHtml(artist.name)}</h2>
        <div class="detail-meta">
          <span class="inst">${escapeHtml(instruments)}</span>
          · ${eventCount} concert${eventCount !== 1 ? 's' : ''}
          ${artist.firstSeen ? ` · Since ${artist.firstSeen.slice(0, 4)}` : ''}
        </div>
        ${aliases ? `<div class="detail-meta">Also known as: ${escapeHtml(aliases)}</div>` : ''}
        ${projects ? `<div class="detail-meta">Projects: ${escapeHtml(projects)}</div>` : ''}
      </div>

      ${artist.bio ? `
        <div class="detail-section">
          <h3>Bio</h3>
          <p>${escapeHtml(artist.bio)}</p>
        </div>
      ` : ''}

      <div class="detail-section">
        <h3>Genres</h3>
        <p>${escapeHtml(genres)}</p>
      </div>

      ${venues.length > 0 ? `
        <div class="detail-section detail-venues">
          <h3>Venues (${venues.length})</h3>
          ${venues.map(v => `
            <div class="venue-row">
              <span class="venue-name">${escapeHtml(v.name)}</span>
              <span class="venue-count">${v.count}×${v.city ? ' · ' + escapeHtml(v.city) : ''}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${collabs.length > 0 ? `
        <div class="detail-section detail-collabs">
          <h3>Collaborators</h3>
          ${collabs.map(c => `
            <div class="collab-row">
              <span class="collab-name">${escapeHtml(c.name)}</span>
              <span class="collab-count">${c.count}×</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${events.length > 0 ? `
        <div class="detail-section">
          <h3>Events (${events.length})</h3>
          <div class="detail-events">
            ${events.map(ev => `
              <div class="detail-event">
                <span class="de-date">${escapeHtml(ev.date || '')}</span>
                <span class="de-time">${escapeHtml(ev.time || '')}</span>
                <span class="de-venue">${escapeHtml(ev.venue || '')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${renderActivityYears(artist)}

      ${linkEntries.length > 0 ? `
        <div class="detail-section">
          <h3>Links</h3>
          <div class="detail-links">
            ${linkEntries.map(l => `<a href="${escapeAttr(l.url)}" target="_blank" class="${l.cls || ''}">${escapeHtml(l.label)}</a>`).join('')}
          </div>
        </div>
      ` : ''}

      <div class="detail-section" id="bandcamp-player-section"></div>
    `;

    detailOverlay.classList.remove('hidden');

    // Load Bandcamp player if link exists
    if (links.bandcamp) {
      loadBandcampPlayer(links.bandcamp);
    }
  }

  function renderActivityYears(artist) {
    const activity = artist.activity;
    if (!activity || Object.keys(activity).length === 0) return '';

    const years = Object.entries(activity)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, data]) => {
        const months = (data.months || []).length;
        return `<div class="collab-row">
          <span class="collab-name">${year}</span>
          <span class="collab-count">${data.total || 0} concerts · ${data.venues || 0} venues · ${months} months active</span>
        </div>`;
      })
      .join('');

    return `
      <div class="detail-section">
        <h3>Activity</h3>
        ${years}
      </div>
    `;
  }

  // ── Bandcamp player ──

  async function loadBandcampPlayer(bandcampUrl) {
    const section = document.getElementById('bandcamp-player-section');
    if (!section) return;

    // Extract album/track ID from Bandcamp URL
    const match = bandcampUrl.match(/bandcamp\.com\/(album|track)\/([^/?]+)/);
    if (!match) return;

    const type = match[1]; // "album" or "track"
    const slug = match[2];

    // Try to get the numeric ID via autocomplete API
    try {
      const apiUrl = `https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic?search_text=${encodeURIComponent(slug)}&search_filter=a`;
      const res = await fetch(apiUrl);
      if (!res.ok) return;
      const data = await res.json();
      const results = data.results || data.auto?.results || [];
      const found = results.find(r =>
        (r.type === 'a' || r.type === 't') &&
        r.url && r.url.includes(slug)
      );
      if (!found || !found.id) return;

      const embedType = found.type === 't' ? 'track' : 'album';
      const embedUrl = `https://bandcamp.com/EmbeddedPlayer/${embedType}=${found.id}/size=small/bgcol=1a1a1a/linkcol=81d4fa/transparent=true/`;

      section.innerHTML = `
        <h3>Listen</h3>
        <div class="detail-player">
          <iframe src="${embedUrl}" allowtransparency="true"></iframe>
        </div>
      `;
    } catch (e) {
      // Silently fail — player is optional
    }
  }

  // ── GitHub fetch ──

  async function fetchFromGitHub() {
    emptyState.classList.add('hidden');
    resultsEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    try {
      const count = await CatalogueDB.fetchFromGitHub((msg) => {
        const loadingText = document.querySelector('.loading-text');
        if (loadingText) loadingText.textContent = msg;
      });
      await refreshView();
    } catch (e) {
      const loadingText = document.querySelector('.loading-text');
      if (loadingText) loadingText.textContent = `Error: ${e.message}. Using local data.`;
      setTimeout(() => {
        loadingEl.classList.add('hidden');
        refreshView();
      }, 3000);
    }
  }

  // ── Export ──

  async function exportData() {
    const data = await CatalogueDB.exportChanges();
    const all = await CatalogueDB.getAll();
    const exportAll = {
      exportedAt: new Date().toISOString(),
      totalArtists: all.length,
      localEdits: data.count,
      artists: all,
    };
    const blob = new Blob([JSON.stringify(exportAll, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echtzeitmusik-catalogue-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Event listeners ──

  document.getElementById('fetch-github').addEventListener('click', fetchFromGitHub);
  document.getElementById('refresh-github').addEventListener('click', fetchFromGitHub);
  document.getElementById('export-data').addEventListener('click', exportData);
  document.getElementById('open-analysis').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = chrome.runtime.getURL('data-analysis/analysis.html');
  });

  searchInput.addEventListener('input', applyFilters);
  filterInstrument.addEventListener('change', applyFilters);
  filterVenue.addEventListener('change', applyFilters);
  filterGenre.addEventListener('change', applyFilters);
  filterTag.addEventListener('change', applyFilters);
  sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value;
    applyFilters();
  });

  document.getElementById('detail-close').addEventListener('click', () => {
    detailOverlay.classList.add('hidden');
  });

  detailOverlay.addEventListener('click', (e) => {
    if (e.target === detailOverlay) detailOverlay.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') detailOverlay.classList.add('hidden');
  });

  // ── Helpers ──

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});
