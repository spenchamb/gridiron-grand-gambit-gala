/* Shared app shell for the GGGG Sleeper dashboards.
   Desktop: sidebar. Mobile: bottom tab bar + "More" sheet.
   Loaded before each page's inline <script>, so helpers are global. */

const SC = (() => {
  // Sport config — a page declares which via <body data-sport="nba">, default football.
  const SPORTS = {
    nfl: { headshot: 'nfl', brandTop: 'Fantasy Football', brand: 'GGGG', home: '/index.html' },
    nba: { headshot: 'nba', brandTop: 'Fantasy Basketball', brand: 'DMG', home: '/index.html' },
  };
  const SPORT = SPORTS[(document.body.dataset.sport || 'nfl')] || SPORTS.nfl;

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  const avatarHTML = (url, name, cls = 'avatar') => url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`
    : `<span class="${cls} ph">${esc((name || '?').slice(0, 2).toUpperCase())}</span>`;

  const PLACE = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%231c1c22"/></svg>');
  function headshotHTML(pid, pos, nflTeam) {
    // Football DEF uses a team logo; every NBA slot is an individual player.
    if (SPORT.headshot === 'nfl' && pos === 'DEF' && nflTeam) {
      const t = String(nflTeam).toLowerCase();
      return `<img class="headshot logo" src="https://sleepercdn.com/images/team_logos/nfl/${t}.png" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACE}'">`;
    }
    return `<img class="headshot" src="https://sleepercdn.com/content/${SPORT.headshot}/players/thumb/${esc(pid)}.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACE}'">`;
  }

  const posPill = p => `<span class="pos-pill pos-${esc(p)}">${esc(p)}</span>`;
  const INJ = { Out: 'O', IR: 'IR', Doubtful: 'D', Questionable: 'Q', PUP: 'PUP', Sus: 'SUS' };
  function injuryBadge(inj) {
    if (!inj) return '';
    const code = INJ[inj] || esc(inj).slice(0, 3).toUpperCase();
    const cls = (inj === 'Out' || inj === 'IR' || inj === 'PUP') ? 'inj-out' : 'inj-q';
    return ` <span class="inj-badge ${cls}" title="${esc(inj)}">${code}</span>`;
  }
  const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  function relTime(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  /* Data files: no ?t= buster — the server sends no-cache on /sleeper/data/*
     so browsers revalidate (304 when unchanged) instead of re-downloading. */
  async function fetchJSON(p) { const r = await fetch(p); if (!r.ok) throw new Error(p); return r.json(); }

  /* Sections render immediately (entrance animations removed in v10). */
  function observeSections() {
    document.querySelectorAll('section').forEach(s => s.classList.add('visible'));
  }

  const WHATIF_SCENARIOS = (document.body.dataset.sport === 'nba') ? [
    ['#sec-bestball', 'Best Ball'],
    ['#sec-notrade',  'No Trades'],
    ['#sec-median',   'Median Format'],
    ['#sec-seeding',  'Playoff Seeding'],
  ] : [
    ['#sec-scoring', 'Scoring Systems'],
    ['#sec-notrade', 'No Trades'],
    ['#sec-median',  'Median Format'],
    ['#sec-seeding', 'Playoff Seeding'],
  ];

  const state = { page: '', myOwner: '', teams: [], meta: null, draftSeasons: [], curDraftSeason: null };

  /* ── Desktop sidebar ─────────────────────────────────────────────── */
  function buildSidebar() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    const { page, myOwner, teams, meta, draftSeasons, curDraftSeason } = state;

    sb.setAttribute('role', 'navigation');
    sb.setAttribute('aria-label', 'Primary');

    const link = (id, href, ico, label) => {
      const on = page === id;
      return `<a class="sb-link ${on ? 'active' : ''}" href="${href}"${on ? ' aria-current="page"' : ''} data-tip="${esc(label)}">`
        + `<span class="ico" aria-hidden="true">${ico}</span><span>${label}</span></a>`;
    };

    let gN = 0;
    const group = (gid, href, ico, label, items, isOpen) => {
      const subId = `sbsub-${gid}-${gN++}`;
      return `
      <div class="sb-group ${isOpen ? 'open' : ''}">
        <div class="sb-grouphead">
          ${link(gid, href, ico, label)}
          <button class="sb-caret" aria-label="Toggle ${label} menu" aria-controls="${subId}" aria-expanded="${isOpen}">&#9658;</button>
        </div>
        <div class="sb-sub" id="${subId}">${items}</div>
      </div>`;
    };

    const teamItems = teams.length ? teams.map(t => {
      const active = page === 'team' && t.owner_id === myOwner;
      return `<a class="sb-team ${active ? 'active' : ''}" href="team.html?owner=${encodeURIComponent(t.owner_id)}"${active ? ' aria-current="page"' : ''}>
        ${avatarHTML(t.avatar, t.team, 'savatar')}
        <span class="stxt">${esc(t.team)}${t.championships ? ' 🏆'.repeat(Math.min(t.championships, 2)) : ''}</span></a>`;
    }).join('') : '<span class="muted" style="padding:6px 14px;font-size:12px">—</span>';

    const draftItems = draftSeasons.length ? draftSeasons.map(s => {
      const active = page === 'draft' && String(curDraftSeason) === String(s);
      return `<a class="sb-subitem ${active ? 'active' : ''}" href="draft.html?season=${s}"${active ? ' aria-current="page"' : ''}>${esc(s)} Draft</a>`;
    }).join('') : '<span class="muted" style="padding:6px 14px;font-size:12px">—</span>';

    const wiItems = WHATIF_SCENARIOS.map(([a, l]) =>
      `<a class="sb-subitem" href="whatif.html${a}">${esc(l)}</a>`).join('');

    let html = `<a class="sb-brand" href="index.html" aria-label="${esc(SPORT.brand)} fantasy home"><div class="b1">${esc(SPORT.brandTop)}</div><div class="b2">${esc(SPORT.brand)}</div></a>`;
    html += link('league',    'index.html',    '◆', 'League');
    html += link('recap',     'recap.html',    '◷', 'Last Week');
    html += link('matchups',  'matchups.html', '⇄', 'Matchups');
    html += link('waivers',   'waivers.html',  '◰', 'Waiver Wire');
    html += group('teams',  'teams.html',  '▣', 'Teams',   teamItems, page === 'teams' || page === 'team');
    html += group('draft',  'draft.html',  '✦', 'Draft',   draftItems, page === 'draft');
    html += group('whatif', 'whatif.html', '⤴', 'What-If', wiItems, page === 'whatif');
    html += link('trade',     'trade.html',     '↔', 'Trade Lab');
    html += link('changelog', 'changelog.html', '✎', 'Changelog');
    html += `<div class="sb-spacer"></div>`;
    html += `<a class="sb-link" href="/sitemap.html" data-tip="Sitemap"><span class="ico" aria-hidden="true">⊞</span><span>Sitemap</span></a>`;
    html += `<a class="sb-link" href="/index.html" data-tip="Home"><span class="ico" aria-hidden="true">←</span><span>Home</span></a>`;
    html += `<button class="sb-collapse-btn" aria-label="Collapse sidebar"><span class="sb-collapse-icon" aria-hidden="true">‹</span><span class="sb-collapse-label"> Collapse</span></button>`;
    html += `<div class="sb-foot">${state.meta ? esc(state.meta.league_name || '') + '<br>Updated ' + relTime(state.meta.generated_at) : ''}</div>`;
    sb.innerHTML = html;

    sb.querySelectorAll('.sb-caret').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const grp = btn.closest('.sb-group');
      const isOpen = grp.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
    }));

    if (localStorage.getItem('sc-sb-rail') === '1') document.body.classList.add('sb-rail');
    sb.querySelector('.sb-collapse-btn').addEventListener('click', () => {
      const rail = document.body.classList.toggle('sb-rail');
      localStorage.setItem('sc-sb-rail', rail ? '1' : '0');
    });
  }

  /* ── Mobile bottom tab bar + More sheet ──────────────────────────── */
  function buildTabbar() {
    const { page, myOwner, teams, meta, draftSeasons, curDraftSeason } = state;

    const TABS = [
      ['league',   'index.html',    '◆', 'League'],
      ['matchups', 'matchups.html', '⇄', 'Matchups'],
      ['teams',    'teams.html',    '▣', 'Teams'],
      ['trade',    'trade.html',    '↔', 'Trade'],
    ];
    const tabActive = id =>
      (id === 'teams' && (page === 'teams' || page === 'team')) || page === id;
    const inMore = ['recap', 'waivers', 'draft', 'whatif', 'changelog'].includes(page);

    const bar = document.createElement('nav');
    bar.className = 'tabbar';
    bar.setAttribute('aria-label', 'Primary');
    bar.innerHTML = `<div class="tabbar-inner">` + TABS.map(([id, href, ico, label]) =>
      `<a class="tab-item ${tabActive(id) ? 'active' : ''}" href="${href}"${tabActive(id) ? ' aria-current="page"' : ''}>
        <span class="tico" aria-hidden="true">${ico}</span>${label}</a>`).join('')
      + `<button class="tab-item ${inMore ? 'active' : ''}" id="moreBtn" aria-controls="moreSheet" aria-expanded="false">
          <span class="tico" aria-hidden="true">≡</span>More</button></div>`;
    document.body.appendChild(bar);

    const sheetLink = (id, href, ico, label) => {
      const on = page === id;
      return `<a class="sheet-link ${on ? 'active' : ''}" href="${href}"${on ? ' aria-current="page"' : ''}>
        <span class="ico" aria-hidden="true">${ico}</span><span class="stxt">${label}</span></a>`;
    };

    const teamLinks = teams.map(t => {
      const on = page === 'team' && t.owner_id === myOwner;
      return `<a class="sheet-link ${on ? 'active' : ''}" href="team.html?owner=${encodeURIComponent(t.owner_id)}">
        ${avatarHTML(t.avatar, t.team, 'savatar')}<span class="stxt">${esc(t.team)}</span></a>`;
    }).join('');

    const draftLinks = draftSeasons.map(s => {
      const on = page === 'draft' && String(curDraftSeason) === String(s);
      return `<a class="sheet-link ${on ? 'active' : ''}" href="draft.html?season=${s}">
        <span class="ico" aria-hidden="true">✦</span><span class="stxt">${esc(s)} Draft</span></a>`;
    }).join('');

    const wiLinks = WHATIF_SCENARIOS.map(([a, l]) =>
      `<a class="sheet-link" href="whatif.html${a}"><span class="ico" aria-hidden="true">⤴</span><span class="stxt">${esc(l)}</span></a>`).join('');

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'moreSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'More navigation');
    sheet.innerHTML = `
      <div class="sheet-grab" aria-hidden="true"></div>
      <p class="sheet-label">Pages</p>
      <div class="sheet-grid">
        ${sheetLink('recap',     'recap.html',     '◷', 'Last Week')}
        ${sheetLink('waivers',   'waivers.html',   '◰', 'Waiver Wire')}
        ${sheetLink('whatif',    'whatif.html',    '⤴', 'What-If')}
        ${sheetLink('changelog', 'changelog.html', '✎', 'Changelog')}
      </div>
      ${draftLinks ? `<p class="sheet-label">Drafts</p><div class="sheet-grid">${draftLinks}</div>` : ''}
      ${wiLinks ? `<p class="sheet-label">What-If Scenarios</p><div class="sheet-grid">${wiLinks}</div>` : ''}
      ${teamLinks ? `<p class="sheet-label">Teams</p><div class="sheet-grid">${teamLinks}</div>` : ''}
      <p class="sheet-label">Site</p>
      <div class="sheet-grid">
        <a class="sheet-link" href="/sitemap.html"><span class="ico" aria-hidden="true">⊞</span><span class="stxt">Sitemap</span></a>
        <a class="sheet-link" href="/index.html"><span class="ico" aria-hidden="true">←</span><span class="stxt">Home</span></a>
      </div>
      <div class="sheet-foot">${meta ? esc(meta.league_name || '') + ' · Updated ' + relTime(meta.generated_at) : ''}</div>`;
    document.body.appendChild(sheet);

    const scrim = document.getElementById('scrim');
    const moreBtn = bar.querySelector('#moreBtn');
    const close = () => {
      sheet.classList.remove('open');
      scrim && scrim.classList.remove('show');
      moreBtn.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      sheet.classList.add('open');
      scrim && scrim.classList.add('show');
      moreBtn.setAttribute('aria-expanded', 'true');
    };
    moreBtn.addEventListener('click', () => sheet.classList.contains('open') ? close() : open());
    scrim && scrim.addEventListener('click', close);
    sheet.addEventListener('click', e => { if (e.target.closest('a')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  async function buildNav() {
    state.page = document.body.dataset.page || '';
    state.myOwner = document.body.dataset.owner || new URLSearchParams(location.search).get('owner') || '';
    try {
      [state.teams, state.meta] = await Promise.all([
        fetchJSON('data/teams.json'),
        fetchJSON('data/meta.json').catch(() => null),
      ]);
    } catch (e) { /* render with what we have */ }
    if (state.page === 'team' && !state.myOwner && state.meta) state.myOwner = state.meta.my_owner_id;
    const ds = (state.meta && state.meta.draft_seasons) ? state.meta.draft_seasons.slice() : [];
    // During the football offseason/preseason, surface the upcoming draft (which
    // has no results yet) so its pre-draft big board is reachable. Gated on
    // nfl_season_type so it never fires on the basketball section (no such field).
    const m = state.meta;
    if (m && m.nfl_season && ['off', 'pre', 'pre_draft', 'offseason'].includes(String(m.nfl_season_type))
        && !ds.map(String).includes(String(m.nfl_season))) {
      ds.unshift(String(m.nfl_season));
    }
    state.draftSeasons = ds;
    state.curDraftSeason = new URLSearchParams(location.search).get('season') || state.draftSeasons[0];

    buildSidebar();
    buildTabbar();
  }

  /* ── Per-page chrome: favicon, a11y, PWA meta ─────────────────────── */
  function injectChrome() {
    const head = document.head;
    const add = (tag, attrs) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      head.appendChild(el);
    };
    if (!document.querySelector('link[rel="icon"]')) add('link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' });
    if (!document.querySelector('meta[name="theme-color"]')) add('meta', { name: 'theme-color', content: '#0e0e10' });
    if (!document.querySelector('link[rel="manifest"]')) add('link', { rel: 'manifest', href: '/manifest.webmanifest' });
    if (!document.querySelector('link[rel="apple-touch-icon"]')) add('link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' });
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
      add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
      add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
      add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' });
    }
    if (!document.documentElement.lang) document.documentElement.lang = 'en';
    const main = document.querySelector('main.content');
    if (main) {
      if (!main.id) main.id = 'main';
      main.setAttribute('role', 'main');
      main.setAttribute('tabindex', '-1');
    }
    if (!document.querySelector('.skip-link')) {
      const a = document.createElement('a');
      a.className = 'skip-link'; a.href = '#main'; a.textContent = 'Skip to content';
      document.body.insertBefore(a, document.body.firstChild);
    }
  }

  document.addEventListener('DOMContentLoaded', () => { injectChrome(); buildNav(); observeSections(); });

  return { esc, avatarHTML, headshotHTML, posPill, injuryBadge, fmtDate, relTime, fetchJSON };
})();

const esc = SC.esc, avatarHTML = SC.avatarHTML, headshotHTML = SC.headshotHTML,
      posPill = SC.posPill, injuryBadge = SC.injuryBadge, fmtDate = SC.fmtDate,
      relTime = SC.relTime, fetchJSON = SC.fetchJSON;
