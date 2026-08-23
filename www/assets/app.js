/* Shared app shell for the GGGG Sleeper dashboards.
   Desktop: sidebar. Mobile: bottom tab bar + "More" sheet.
   Loaded before each page's inline <script>, so helpers are global. */

const SC = (() => {
  // Sport config — a page declares which via <body data-sport="nba">, default football.
  const SPORTS = {
    nfl: { headshot: 'nfl', brandTop: 'Fantasy Football', brand: 'GGGG', logo: '/assets/gggg_logo_website2.png', home: '/index.html' },
    nba: { headshot: 'nba', brandTop: 'Fantasy Basketball', brand: 'DMG', home: '/index.html' },
  };
  const SPORT = SPORTS[(document.body.dataset.sport || 'nfl')] || SPORTS.nfl;

  /* ── Where this bundle is mounted ──────────────────────────────────────
     The personal site serves the league under /sleeper and the basketball
     section under /nba; the gridirongrandgambitgala.xyz bundle serves the same
     pages flattened at the root. Every path-dependent decision in this file
     derives from that one fact:

       SECTION    '/sleeper' | '/nba' | ''   (dir containing the current page)
       DATA_BASE  where the cron-built JSON lives for this mount
       FF_ONLY    flattened bundle => there is no wider site to link out to

     This replaces the `sed -i` scrubbing build-ffb.sh used to run over this
     file. That worked only while app.js stayed unminified plain text; it would
     silently no-op against a bundled build and leak outside links onto the FF
     domain. The inline <head> script on each page publishes these as data
     attributes so CSS can react before first paint; the fallback keeps this
     working on the NBA pages, which share this file but are built server-side
     and carry no such script. */
  const ROOT_DS = document.documentElement.dataset;
  const SECTION = ROOT_DS.section != null
    ? ROOT_DS.section
    : location.pathname.replace(/\/[^/]*$/, '');
  const FF_ONLY = SECTION === '';
  const DATA_BASE = SECTION + '/data/';

  /* Resolve a bare `data/x.json` against this mount. Call sites stay relative
     and readable, but stop depending on the current URL's depth. */
  const dataURL = p => /^(?:https?:)?\/\//.test(p) || p.startsWith('/')
    ? p
    : p.replace(/^data\//, DATA_BASE);

  // Nav icons (context-appropriate). Helmet has no unicode glyph -> inline SVG.
  const IC_MATCH  = '<b style="font-size:10px;font-weight:800;letter-spacing:-.4px">VS</b>';
  const IC_WAIVER = '≡';   // ≡ three horizontal lines
  const IC_WHATIF = '?';
  const IC_TEAMS  = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M20.5 12c0-4.6-3.6-7.5-8.3-7.5S4 7.4 4 12.2c0 1.7.4 3.1 1.1 4.2"/><path d="M5.1 16.4 8 16.9l1 2.6c.3.7.9 1.1 1.6 1.1H13v-2h1.3c3.6 0 6.2-2.6 6.2-6.6"/><path d="M8 14.3h6.5"/></svg>';
  // Lucide `panel-left` — the collapse affordance.
  const IC_PANEL  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>';
  // Home silhouette — League is the homepage of the app.
  const IC_HOME   = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align:-3px"><path d="M12 3 2 12H5v8h5v-5h4v5h5v-8h3z"/></svg>';

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  const avatarHTML = (url, name, cls = 'avatar') => url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`
    : `<span class="${cls} ph">${esc((name || '?').slice(0, 2).toUpperCase())}</span>`;

  const PLACE = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%232a1e16"/></svg>');
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
  async function fetchJSON(p) { const r = await fetch(dataURL(p)); if (!r.ok) throw new Error(p); return r.json(); }

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

  /* ── Sidebar collapse state ─────────────────────────────
     Exactly one input: <html data-sb>. CSS rewrites --sb-w off that attribute
     and both the rail width and the content margin follow, so there is no
     layout math here. The initial value is set by a small inline <head> script
     on each page, so a collapsed rail never flashes open on load. */
  const SB_KEY = 'sc-sidebar';

  function sbState() {
    return document.documentElement.dataset.sb === 'collapsed' ? 'collapsed' : 'expanded';
  }

  function setSbState(next) {
    document.documentElement.dataset.sb = next;
    try { localStorage.setItem(SB_KEY, next); } catch (e) {}
    const btn = document.getElementById('sbToggle');
    if (btn) btn.setAttribute('aria-expanded', String(next === 'expanded'));
    hideTip();
  }

  /* Shared, fixed-position tooltip for the collapsed rail. A ::after on each
     link would be clipped by the sidebar's own scroll container. */
  let tipEl = null, tipFor = null;
  function tipNode() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'sb-tip';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function hideTip() { if (tipEl) { tipEl.classList.remove('show'); tipFor = null; } }
  function showTip(el) {
    if (sbState() !== 'collapsed' || window.innerWidth <= 860) return;
    const label = el.dataset.tip;
    if (!label) return;
    const t = tipNode();
    if (tipFor !== el) { t.textContent = label; tipFor = el; }
    // Anchor x to the rail's outer edge, not the link's: the rail is a scroll
    // container, so its scrollbar gutter shortens each link and a link-relative
    // tooltip would sit inside the rail. This also keeps every tooltip in one
    // column. y still tracks the hovered link's centre.
    const rail = document.getElementById('sidebar');
    const r = el.getBoundingClientRect();
    const railRight = rail ? rail.getBoundingClientRect().right : r.right;
    t.style.left = (railRight + 8) + 'px';
    t.style.top = Math.round(r.top + r.height / 2 - t.offsetHeight / 2) + 'px';
    t.classList.add('show');
  }

  /* Delegated once at module load — survives every buildSidebar() rerender. */
  function initSidebarChrome() {
    document.addEventListener('pointerover', e => {
      const el = e.target.closest && e.target.closest('#sidebar [data-tip]');
      if (el) showTip(el); else if (tipFor) hideTip();
    });
    document.addEventListener('focusin', e => {
      const el = e.target.closest && e.target.closest('#sidebar [data-tip]');
      if (el) showTip(el); else hideTip();
    });
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);

    document.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('#sbToggle');
      if (!btn) return;
      e.preventDefault();
      setSbState(sbState() === 'collapsed' ? 'expanded' : 'collapsed');
    });

    // Ctrl/Cmd+B — same shortcut shadcn uses, and it is otherwise unbound here.
    document.addEventListener('keydown', e => {
      if (e.key !== 'b' && e.key !== 'B') return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setSbState(sbState() === 'collapsed' ? 'expanded' : 'collapsed');
    });
  }

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
        <div class="sb-sub" id="${subId}"><div class="sb-sub-inner">${items}</div></div>
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

    const brandInner = SPORT.logo
      ? `<img class="sb-logo" src="${SPORT.logo}" alt="${esc(SPORT.brand)}" style="display:block;width:100%;max-width:150px;height:auto" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'b2',textContent:this.alt}))">`
      : `<div class="b1">${esc(SPORT.brandTop)}</div><div class="b2">${esc(SPORT.brand)}</div>`;
    let html = `<div class="sb-head">`
      + `<a class="sb-brand" href="index.html" aria-label="${esc(SPORT.brand)} fantasy home">${brandInner}</a>`
      + `<button class="sb-toggle" id="sbToggle" type="button" aria-controls="sidebar" data-tip="Toggle sidebar">${IC_PANEL}<span class="sr-only">Toggle sidebar</span></button>`
      + `</div>`;
    if ((document.body.dataset.sport || 'nfl') === 'nfl')
      html += `<div class="sb-search" style="padding:10px 12px 4px"><input type="search" id="sb-player-search" placeholder="Search players…" autocomplete="off" aria-label="Search players" style="width:100%;box-sizing:border-box;padding:7px 10px;background:var(--card,#221812);border:1px solid var(--border,#3d2c1f);border-radius:var(--radius,10px);color:var(--ink,#ffffff);font-size:13px;font-family:inherit"><div id="sb-search-results" style="position:relative"></div></div>`;
    html += link('league',    'index.html',    IC_HOME, 'League');
    html += link('recap',     'recap.html',    '◷', 'Last Week');
    html += link('projections','projections.html', '◈', 'Projections');
    html += link('ledger',    'ledger.html',   '▤', 'Ledger');
    html += link('matchups',  'matchups.html', IC_MATCH, 'Matchups');
    html += link('waivers',   'waivers.html',  IC_WAIVER, 'Waiver Wire');
    html += group('teams',  'teams.html',  IC_TEAMS, 'Teams',   teamItems, page === 'teams' || page === 'team');
    html += group('draft',  'draft.html',  '✦', 'Draft',   draftItems, page === 'draft');
    html += link('keepers', 'keepers.html', '⚓', 'Keepers');
    html += group('whatif', 'whatif.html', IC_WHATIF, 'What-If', wiItems, page === 'whatif');
    html += link('trade',     'trade.html',     '↔', 'Trade Lab');
    html += link('playoff',   'playoff.html',   '★', 'Playoff Watch');
    html += link('punish',    'punish.html',    '⚠', 'Punish Watch');
    html += link('changelog', 'changelog.html', '✎', 'Changelog');
    html += `<div class="sb-spacer"></div>`;
    // On the FF-only bundle the root IS the league hub, so there is no wider
    // site to link back to. (build-ffb.sh used to sed these two lines out.)
    if (!FF_ONLY) {
      html += `<a class="sb-link" href="/sitemap.html" data-tip="Sitemap"><span class="ico" aria-hidden="true">⊞</span><span>Sitemap</span></a>`;
      html += `<a class="sb-link" href="/index.html" data-tip="Home"><span class="ico" aria-hidden="true">←</span><span>Home</span></a>`;
    }
    html += `<div class="sb-foot">${state.meta ? 'Updated ' + relTime(state.meta.generated_at) : ''}</div>`;
    sb.innerHTML = html;

    /* Player search — lazily loads the index on first focus, filters by name. */
    const si = sb.querySelector('#sb-player-search');
    if (si) {
      let idx = null, loading = false;
      const res = sb.querySelector('#sb-search-results');
      const load = async () => {
        if (idx || loading) return; loading = true;
        try { const r = await fetch(dataURL('data/players_index.json')); idx = r.ok ? await r.json() : []; }
        catch (e) { idx = []; }
        loading = false;
      };
      const draw = q => {
        if (!q || q.length < 2 || !idx) { res.innerHTML = ''; return; }
        const ql = q.toLowerCase();
        const hits = idx.filter(p => p.name && p.name.toLowerCase().includes(ql)).slice(0, 8);
        res.innerHTML = hits.length
          ? `<div style="position:absolute;left:0;right:0;top:2px;z-index:30;background:var(--card,#221812);border:1px solid var(--border,#3d2c1f);border-radius:var(--radius,10px);overflow:hidden">`
            + hits.map(p => `<a href="player.html?pid=${p.pid}" style="display:flex;justify-content:space-between;gap:8px;padding:7px 10px;color:var(--ink,#ffffff);text-decoration:none;font-size:13px;border-bottom:1px solid var(--border,#3d2c1f)"><span>${esc(p.name)}</span><span style="color:var(--muted,#7a7570);font-size:11px">${esc(p.pos)} ${esc(p.nfl_team || '')}</span></a>`).join('')
            + `</div>`
          : '';
      };
      si.addEventListener('focus', load);
      si.addEventListener('input', () => draw(si.value.trim()));
      si.addEventListener('blur', () => setTimeout(() => { res.innerHTML = ''; }, 200));
    }

    const tg = sb.querySelector('#sbToggle');
    if (tg) tg.setAttribute('aria-expanded', String(sbState() === 'expanded'));

    sb.querySelectorAll('.sb-caret').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const grp = btn.closest('.sb-group');
      const isOpen = grp.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
    }));

  }

  /* ── Mobile bottom tab bar + More sheet ──────────────────────────── */
  function buildTabbar() {
    const { page, myOwner, teams, meta, draftSeasons, curDraftSeason } = state;

    const TABS = [
      ['league',   'index.html',    IC_HOME, 'League'],
      ['matchups', 'matchups.html', IC_MATCH, 'Matchups'],
      ['teams',    'teams.html',    IC_TEAMS, 'Teams'],
      ['ledger',   'ledger.html',   '▤', 'Ledger'],
    ];
    const tabActive = id =>
      (id === 'teams' && (page === 'teams' || page === 'team')) || page === id;
    const inMore = ['recap', 'projections', 'waivers', 'trade', 'draft', 'keepers', 'whatif', 'playoff', 'punish', 'changelog'].includes(page);

    const bar = document.createElement('nav');
    bar.className = 'tabbar';
    bar.setAttribute('aria-label', 'Primary');
    bar.innerHTML = `<div class="tabbar-inner">` + TABS.map(([id, href, ico, label]) =>
      `<a class="tab-item ${tabActive(id) ? 'active' : ''}" href="${href}"${tabActive(id) ? ' aria-current="page"' : ''}>
        <span class="tico" aria-hidden="true">${ico}</span>${label}</a>`).join('')
      + `<button class="tab-item ${inMore ? 'active' : ''}" id="moreBtn" aria-controls="moreSheet" aria-expanded="false">
          <span class="tico" aria-hidden="true">≡</span>More</button></div>`;
    document.body.appendChild(bar);

    // Mobile-only fixed top header with the GGGG logo (sidebar is hidden on
    // mobile, so this keeps the brand visible — catered to iOS Safari).
    if (SPORT.logo && !document.querySelector('.mtopbar')) {
      const top = document.createElement('header');
      top.className = 'mtopbar';
      top.innerHTML = `<a href="index.html" aria-label="${esc(SPORT.brand)} home"><img src="${SPORT.logo}" alt="${esc(SPORT.brand)}"></a>`;
      document.body.appendChild(top);
      document.body.classList.add('has-mtop');
    }

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

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'moreSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'More navigation');
    sheet.innerHTML = `
      <div class="sheet-grab" aria-hidden="true"></div>
      <p class="sheet-label">Tools</p>
      <div class="sheet-grid">
        ${sheetLink('waivers',   'waivers.html',   IC_WAIVER, 'Waiver Wire')}
        ${sheetLink('trade',     'trade.html',     '↔', 'Trade Lab')}
        ${sheetLink('whatif',    'whatif.html',    IC_WHATIF, 'What-If')}
      </div>
      <p class="sheet-label">Races</p>
      <div class="sheet-grid">
        ${sheetLink('projections','projections.html','◈', 'Projections')}
        ${sheetLink('playoff',   'playoff.html',   '★', 'Playoff Watch')}
        ${sheetLink('punish',    'punish.html',    '⚠', 'Punish Watch')}
      </div>
      <p class="sheet-label">Reference</p>
      <div class="sheet-grid">
        ${sheetLink('recap',     'recap.html',     '◷', 'Last Week')}
        ${sheetLink('keepers',   'keepers.html',   '⚓', 'Keepers')}
        ${sheetLink('changelog', 'changelog.html', '✎', 'Changelog')}
      </div>
      ${draftLinks ? `<p class="sheet-label">Drafts</p><div class="sheet-grid">${draftLinks}</div>` : ''}
      ${teamLinks ? `<p class="sheet-label">Teams</p><div class="sheet-grid">${teamLinks}</div>` : ''}
      ${FF_ONLY ? '' : `<p class="sheet-label">Site</p>
      <div class="sheet-grid">
        <a class="sheet-link" href="/sitemap.html"><span class="ico" aria-hidden="true">⊞</span><span class="stxt">Sitemap</span></a>
        <a class="sheet-link" href="/index.html"><span class="ico" aria-hidden="true">←</span><span class="stxt">Home</span></a>
      </div>`}
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

  function applyNav() {
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
    state._built = true;
  }

  async function buildNav() {
    state.page = document.body.dataset.page || '';
    state.myOwner = document.body.dataset.owner || new URLSearchParams(location.search).get('owner') || '';
    // Instant shell: render the nav from the previous page's cached data.
    try {
      const ct = sessionStorage.getItem('sc-teams');
      if (ct) {
        state.teams = JSON.parse(ct);
        const cm = sessionStorage.getItem('sc-meta');
        state.meta = cm ? JSON.parse(cm) : null;
        applyNav();
      }
    } catch (e) {}
    // Revalidate in the background; only rebuild if the data actually changed.
    try {
      const [teams, meta] = await Promise.all([
        fetchJSON('data/teams.json'),
        fetchJSON('data/meta.json').catch(() => null),
      ]);
      const ts = JSON.stringify(teams), ms = JSON.stringify(meta);
      const changed = ts !== sessionStorage.getItem('sc-teams') || ms !== sessionStorage.getItem('sc-meta');
      state.teams = teams; state.meta = meta;
      try { sessionStorage.setItem('sc-teams', ts); sessionStorage.setItem('sc-meta', ms); } catch (e) {}
      if (changed || !state._built) applyNav();
    } catch (e) { if (!state._built) applyNav(); }
  }

  /* ── Per-page chrome: favicon, a11y, PWA meta ─────────────────────── */
  function injectChrome() {
    const head = document.head;
    const add = (tag, attrs) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      head.appendChild(el);
    };
    // The FF bundle ships a raster icon set (universally rendered); the personal
    // site uses the text-based SVG. build-ffb.sh used to sed this line.
    if (!document.querySelector('link[rel="icon"]')) add('link', FF_ONLY
      ? { rel: 'icon', type: 'image/png', href: '/favicon-32.png' }
      : { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' });
    if (!document.querySelector('meta[name="theme-color"]')) add('meta', { name: 'theme-color', content: '#1a120c' });
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

  document.addEventListener('DOMContentLoaded', () => { injectChrome(); initSidebarChrome(); buildNav(); observeSections(); });

  return { esc, avatarHTML, headshotHTML, posPill, injuryBadge, fmtDate, relTime, fetchJSON };
})();

const esc = SC.esc, avatarHTML = SC.avatarHTML, headshotHTML = SC.headshotHTML,
      posPill = SC.posPill, injuryBadge = SC.injuryBadge, fmtDate = SC.fmtDate,
      relTime = SC.relTime, fetchJSON = SC.fetchJSON;

/* Warm the destination doc (+ its heavy per-item JSON) on hover / touchstart so
   navigation feels instant. fetch() populates the HTTP cache (works on iOS
   Safari); pairs with view transitions + the sessionStorage shell cache. */
(function () {
  const seen = new Set();
  const warm = url => { if (url && !seen.has(url)) { seen.add(url); fetch(url, { credentials: 'same-origin' }).catch(() => {}); } };
  function onLink(e) {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.origin !== location.origin || a.hasAttribute('download')) return;
    if (a.pathname === location.pathname && a.search === location.search) return;
    warm(a.href);
    const page = a.pathname.split('/').pop();
    const q = new URLSearchParams(a.search);
    let data = null;
    if (page === 'player.html' && q.get('pid')) data = `data/players/${q.get('pid')}.json`;
    else if (page === 'team.html' && q.get('owner')) data = `data/team_${q.get('owner')}.json`;
    if (data) warm(new URL(data, a.href).href);
  }
  document.addEventListener('mouseover', onLink, { capture: true, passive: true });
  document.addEventListener('touchstart', onLink, { capture: true, passive: true });
})();
