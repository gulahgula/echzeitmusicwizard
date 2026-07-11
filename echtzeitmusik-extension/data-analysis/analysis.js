document.addEventListener('DOMContentLoaded', async () => {
  const emptyState = document.getElementById('empty-state');
  const loadingEl = document.getElementById('loading');
  const resultsEl = document.getElementById('results');

  // ── Init ──

  await CatalogueDB.init();
  const allArtists = await CatalogueDB.getAll();

  if (allArtists.length === 0) {
    emptyState.classList.remove('hidden');
    loadingEl.classList.add('hidden');
    return;
  }

  loadingEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');

  // Run analysis asynchronously to keep UI responsive
  await new Promise(r => setTimeout(r, 50));
  const report = analyse(allArtists);

  loadingEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');

  renderOverview(report);
  renderQualityIssues(report);
  renderInstruments(report);
  renderVenues(report);
  renderTimeline(report);
  renderCollabs(report);
  renderFollowed(report);
  renderExport(report);

  // ── Back link ──

  document.getElementById('back-link').addEventListener('click', e => {
    e.preventDefault();
    window.location.href = chrome.runtime.getURL('catalogue/catalogue.html');
  });

  // ═══════════════════════════════════════════════
  // ANALYSIS ENGINE
  // ═══════════════════════════════════════════════

  function analyse(artists) {
    const r = {
      total: artists.length,
      withInstruments: 0,
      withVenues: 0,
      withEvents: 0,
      withBio: 0,
      withLinks: 0,
      followed: 0,
      instrumentCounts: {},
      venueCounts: {},
      yearActivity: {},
      collabPairs: {},
      issues: {
        missingInstruments: [],
        missingVenues: [],
        missingEvents: [],
        noActivity: [],
        lowConfidence: [],
        duplicates: [],
        orphanFollows: [],
        inconsistentDates: [],
      },
    };

    const nameMap = {};

    for (const a of artists) {
      // Instruments
      if (a.instruments && a.instruments.length > 0) {
        r.withInstruments++;
        for (const i of a.instruments) {
          const key = i.name.toLowerCase().trim();
          r.instrumentCounts[key] = (r.instrumentCounts[key] || 0) + 1;
          if (i.confidence < 0.6) {
            r.issues.lowConfidence.push({ name: a.name, field: 'instrument', value: i.name, confidence: i.confidence });
          }
        }
      } else {
        r.issues.missingInstruments.push(a.name);
      }

      // Venues
      if (a.venues && a.venues.length > 0) {
        r.withVenues++;
        for (const v of a.venues) {
          r.venueCounts[v.name] = (r.venueCounts[v.name] || 0) + 1;
        }
      } else {
        r.issues.missingVenues.push(a.name);
      }

      // Events
      if (a.events && a.events.length > 0) {
        r.withEvents++;
        // Check for date inconsistencies
        for (const ev of a.events) {
          if (ev.date && !/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) {
            r.issues.inconsistentDates.push({ name: a.name, date: ev.date });
          }
        }
      } else {
        r.issues.missingEvents.push(a.name);
      }

      // Bio
      if (a.bio && a.bio.trim().length > 0) r.withBio++;

      // Links
      const hasLink = a.links && Object.values(a.links).some(l => l && l.trim().length > 0);
      if (hasLink) r.withLinks++;

      // Followed
      if (a.followed) {
        r.followed++;
        if (!a.events || a.events.length === 0) {
          r.issues.orphanFollows.push(a.name);
        }
      }

      // Activity
      if (a.activity) {
        for (const [year, data] of Object.entries(a.activity)) {
          if (!r.yearActivity[year]) r.yearActivity[year] = { total: 0, artists: 0, venues: 0, months: new Set() };
          r.yearActivity[year].total += data.total || 0;
          r.yearActivity[year].artists++;
          r.yearActivity[year].venues = Math.max(r.yearActivity[year].venues, data.venues || 0);
          if (data.months) data.months.forEach(m => r.yearActivity[year].months.add(m));
        }
      } else {
        r.issues.noActivity.push(a.name);
      }

      // Collaborations
      if (a.collaborators && a.collaborators.length > 0) {
        for (const c of a.collaborators) {
          const pair = [a.name, c.name].sort().join(' | ');
          r.collabPairs[pair] = (r.collabPairs[pair] || 0) + c.count;
        }
      }

      // Duplicate name check
      const key = a.normalizedKey || a.name.toLowerCase();
      if (nameMap[key]) {
        r.issues.duplicates.push({ names: [nameMap[key], a.name], key });
      } else {
        nameMap[key] = a.name;
      }
    }

    // Sort year activity
    r.yearsSorted = Object.entries(r.yearActivity)
      .sort(([a], [b]) => a.localeCompare(b));

    return r;
  }

  // ═══════════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════════

  function renderOverview(r) {
    document.getElementById('overview-stats').innerHTML = `
      <div class="stat-card"><div class="stat-value">${r.total}</div><div class="stat-label">Artists</div></div>
      <div class="stat-card"><div class="stat-value">${r.withEvents}</div><div class="stat-label">With Events</div></div>
      <div class="stat-card"><div class="stat-value">${r.withInstruments}</div><div class="stat-label">With Instruments</div></div>
      <div class="stat-card"><div class="stat-value">${r.withVenues}</div><div class="stat-label">With Venues</div></div>
      <div class="stat-card"><div class="stat-value">${r.followed}</div><div class="stat-label">Followed</div></div>
      <div class="stat-card"><div class="stat-value">${r.withBio}</div><div class="stat-label">With Bio</div></div>
    `;
  }

  function renderQualityIssues(r) {
    const el = document.getElementById('quality-issues');
    const groups = [
      { title: 'Missing Instruments', items: r.issues.missingInstruments, badge: 'badge-orange', desc: 'No instrument data extracted' },
      { title: 'Missing Venues', items: r.issues.missingVenues, badge: 'badge-orange', desc: 'No venue data' },
      { title: 'No Activity Data', items: r.issues.noActivity, badge: 'badge-blue', desc: 'No yearly activity stats' },
      { title: 'Low Confidence Instruments', items: r.issues.lowConfidence, badge: 'badge-orange', desc: 'Instrument extraction uncertain', custom: true },
      { title: 'Date Format Issues', items: r.issues.inconsistentDates, badge: 'badge-red', desc: 'Non-standard date format', custom: true },
      { title: 'Followed But No Events', items: r.issues.orphanFollows, badge: 'badge-blue', desc: 'Following artist with no event history' },
    ];

    el.innerHTML = groups.map(g => {
      if (!g.items || g.items.length === 0) return '';
      const count = g.items.length;
      let itemsHtml;
      if (g.custom) {
        itemsHtml = g.items.slice(0, 20).map(item => {
          if (item.field) {
            return `<li><span class="artist-name">${esc(item.name)}</span> <span class="issue-desc">${esc(item.field)}: "${esc(item.value)}" (${(item.confidence * 100).toFixed(0)}%)</span></li>`;
          }
          if (item.date) {
            return `<li><span class="artist-name">${esc(item.name)}</span> <span class="issue-desc">"${esc(item.date)}"</span></li>`;
          }
          return '';
        }).join('');
      } else {
        itemsHtml = g.items.slice(0, 20).map(name =>
          `<li><span class="artist-name">${esc(name)}</span></li>`
        ).join('');
      }
      const more = count > 20 ? `<li class="issue-desc">…and ${count - 20} more</li>` : '';
      return `<div class="quality-group">
        <h3>${esc(g.title)} <span class="badge ${g.badge}">${count}</span></h3>
        <ul class="quality-list">${itemsHtml}${more}</ul>
      </div>`;
    }).join('');
  }

  function renderInstruments(r) {
    const el = document.getElementById('instruments-chart');
    const sorted = Object.entries(r.instrumentCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20);
    if (sorted.length === 0) {
      el.innerHTML = '<p style="color:#555;font-size:13px;">No instrument data collected yet.</p>';
      return;
    }
    const max = sorted[0][1];
    el.innerHTML = `<div class="bar-chart">${sorted.map(([name, count]) =>
      `<div class="bar-row">
        <span class="bar-label">${esc(name)}</span>
        <div class="bar-track"><div class="bar-fill amber" style="width:${(count / max * 100).toFixed(1)}%"></div></div>
        <span class="bar-value">${count}</span>
      </div>`
    ).join('')}</div>`;
  }

  function renderVenues(r) {
    const el = document.getElementById('venues-chart');
    const sorted = Object.entries(r.venueCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20);
    if (sorted.length === 0) {
      el.innerHTML = '<p style="color:#555;font-size:13px;">No venue data collected yet.</p>';
      return;
    }
    const max = sorted[0][1];
    el.innerHTML = `<div class="bar-chart">${sorted.map(([name, count]) =>
      `<div class="bar-row">
        <span class="bar-label">${esc(name)}</span>
        <div class="bar-track"><div class="bar-fill blue" style="width:${(count / max * 100).toFixed(1)}%"></div></div>
        <span class="bar-value">${count}</span>
      </div>`
    ).join('')}</div>`;
  }

  function renderTimeline(r) {
    const el = document.getElementById('activity-timeline');
    if (r.yearsSorted.length === 0) {
      el.innerHTML = '<p style="color:#555;font-size:13px;">No activity data collected yet.</p>';
      return;
    }
    const currentYear = String(new Date().getFullYear());
    const currentMonth = new Date().getMonth() + 1;

    el.innerHTML = r.yearsSorted.map(([year, data]) => {
      const months = data.months || new Set();
      let monthBars = '';
      for (let m = 1; m <= 12; m++) {
        const active = months.has(m);
        const isCurrent = year === currentYear && m === currentMonth;
        monthBars += `<div class="timeline-month${active ? ' active' : ''}${isCurrent ? ' current' : ''}"></div>`;
      }
      return `<div class="timeline-row">
        <span class="timeline-year">${year}</span>
        <div class="timeline-bar">${monthBars}</div>
        <span class="timeline-stats">${data.total} events · ${data.artists} artists · ${data.venues} venues</span>
      </div>`;
    }).join('');
  }

  function renderCollabs(r) {
    const el = document.getElementById('collab-network');
    const sorted = Object.entries(r.collabPairs)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20);
    if (sorted.length === 0) {
      el.innerHTML = '<p style="color:#555;font-size:13px;">No collaboration data collected yet.</p>';
      return;
    }
    el.innerHTML = `<div class="collab-list">${sorted.map(([pair, count]) => {
      const [a, b] = pair.split(' | ');
      return `<div class="collab-row">
        <span class="names">${esc(a)} ↔ ${esc(b)}</span>
        <span class="count">${count}× together</span>
      </div>`;
    }).join('')}</div>`;
  }

  function renderFollowed(r) {
    const el = document.getElementById('followed-stats');
    const followed = allArtists.filter(a => a.followed);
    if (followed.length === 0) {
      el.innerHTML = '<p style="color:#555;font-size:13px;">No artists followed yet.</p>';
      return;
    }
    el.innerHTML = `<div class="followed-grid">${followed.map(a => {
      const evCount = a.events ? a.events.length : 0;
      const venues = a.venues ? a.venues.length : 0;
      const instruments = (a.instruments || []).map(i => i.name).join(', ') || '—';
      const lastSeen = a.lastSeen || '—';
      return `<div class="followed-card">
        <div class="name">${esc(a.name)}</div>
        <div class="detail">${evCount} events · ${venues} venues</div>
        <div class="detail">${esc(instruments)}</div>
        <div class="detail">Last seen: ${esc(lastSeen)}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function renderExport(r) {
    const el = document.getElementById('export-options');
    el.innerHTML = `
      <button class="export-btn" id="export-all">Export Full Catalogue (JSON)</button>
      <button class="export-btn" id="export-quality">Export Quality Report (JSON)</button>
      <button class="export-btn" id="export-followed">Export Followed Artists (JSON)</button>
    `;

    document.getElementById('export-all').addEventListener('click', () => {
      downloadJSON(allArtists, `echtzeitmusik-catalogue-${today()}.json`);
    });

    document.getElementById('export-quality').addEventListener('click', () => {
      const report = {
        generatedAt: new Date().toISOString(),
        totalArtists: r.total,
        coverage: {
          withInstruments: r.withInstruments,
          withVenues: r.withVenues,
          withEvents: r.withEvents,
          withBio: r.withBio,
          withLinks: r.withLinks,
        },
        issues: {
          missingInstruments: r.issues.missingInstruments.length,
          missingVenues: r.issues.missingVenues.length,
          missingEvents: r.issues.missingEvents.length,
          noActivity: r.issues.noActivity.length,
          lowConfidence: r.issues.lowConfidence.length,
          inconsistentDates: r.issues.inconsistentDates.length,
          orphanFollows: r.issues.orphanFollows.length,
        },
        topInstruments: Object.entries(r.instrumentCounts).sort(([,a],[,b]) => b-a).slice(0, 30),
        topVenues: Object.entries(r.venueCounts).sort(([,a],[,b]) => b-a).slice(0, 30),
        topCollabs: Object.entries(r.collabPairs).sort(([,a],[,b]) => b-a).slice(0, 30),
      };
      downloadJSON(report, `echtzeitmusik-quality-report-${today()}.json`);
    });

    document.getElementById('export-followed').addEventListener('click', () => {
      const followed = allArtists.filter(a => a.followed);
      downloadJSON(followed, `echtzeitmusik-followed-${today()}.json`);
    });
  }

  // ── Helpers ──

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
});
