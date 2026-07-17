/* GGGG mobile SPA engine — persistent shell + hash router + native-feel
   interactions (slide transitions, edge swipe-back, pull-to-refresh, bottom
   sheets, skeleton loaders). No framework, no build step. Experimental branch. */
(() => {
'use strict';

/* ── Helpers (shared with the classic app.js) ─────────────────────────── */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const avatarHTML = (url, name, cls = 'avatar') => url
  ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`
  : `<span class="${cls} ph">${esc((name || '?').slice(0, 2).toUpperCase())}</span>`;
const PLACE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%232a1e16"/></svg>');
function headshotHTML(pid, pos, nflTeam) {
  if (pos === 'DEF' && nflTeam) return `<img class="headshot logo" src="https://sleepercdn.com/images/team_logos/nfl/${String(nflTeam).toLowerCase()}.png" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACE}'">`;
  return `<img class="headshot" src="https://sleepercdn.com/content/nfl/players/thumb/${esc(pid)}.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACE}'">`;
}
const posPill = p => `<span class="pos-pill pos-${esc(p)}">${esc(p)}</span>`;
function relTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Data layer: in-memory cache with refresh ─────────────────────────── */
const cache = new Map();
function getJSON(path, fresh) {
  if (fresh) cache.delete(path);
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path).then(r => { if (!r.ok) throw new Error(path); return r.json(); })
    .catch(e => { cache.delete(path); throw e; });
  cache.set(path, p);
  return p;
}

/* ── Skeletons ────────────────────────────────────────────────────────── */
const skHeader = t => `<header><div class="htext"><p class="eyebrow sk sk-line" style="width:90px">&nbsp;</p>
  <h1 class="sk sk-line" style="width:60%;height:28px">&nbsp;</h1></div></header>`;
const skRows = (n = 8) => `<div class="card">${Array.from({length:n}, () => '<div class="sk sk-row"></div>').join('')}</div>`;
const skGrid = (n = 8) => `<div class="teams-grid">${Array.from({length:n}, () => '<div class="sk sk-card"></div>').join('')}</div>`;

/* ── Router state ─────────────────────────────────────────────────────── */
const view = () => document.getElementById('view');
const wrap = () => document.getElementById('viewWrap');
let viewEl = null, curHash = '', curIdx = 0;
const scrollMem = new Map();

function parse(hash) {
  hash = (hash || '#/league').replace(/^#/, '');
  const [path, qs] = hash.split('?');
  const name = path.replace(/^\//, '') || 'league';
  return { name, params: new URLSearchParams(qs || ''), hash: '#' + hash.replace(/^#?\/?/, '/') };
}

let pending = null;                                   // in-flight slide, force-completable
function settle() { if (pending) { const p = pending; pending = null; p.done(); } }

async function render(hash, direction) {
  const { name, params } = parse(hash);
  const route = ROUTES[name] || ROUTES._missing;
  document.title = (route.title ? route.title(params) : name) + ' · GGGG';
  setChrome(route, params);
  setActiveTab(route.tab || name);

  const incoming = document.createElement('div');
  incoming.className = 'view';
  incoming.innerHTML = (route.skeleton ? route.skeleton(params) : '');
  const old = viewEl;
  viewEl = incoming;                                  // becomes current synchronously
  curHash = hash;
  swap(old, incoming, direction);

  try {
    await route.render(incoming, params);
  } catch (e) {
    console.error(e);
    incoming.innerHTML = `<p class="muted" style="padding:40px 0;text-align:center">Couldn't load this page.<br><button class="tab" style="margin-top:12px;color:var(--accent)" onclick="location.reload()">Reload</button></p>`;
  }
  if (viewEl === incoming)                            // only if not superseded by a newer nav
    incoming.scrollTop = (direction === 'back' && scrollMem.has(hash)) ? scrollMem.get(hash) : 0;
}

function swap(old, incoming, direction) {
  settle();                                           // snap any prior slide to its end first
  const w = wrap();
  if (!old) { w.appendChild(incoming); return; }
  if (direction === 'none' || direction == null || reduceMotion) { old.replaceWith(incoming); return; }
  incoming.classList.add('incoming');
  incoming.style.transform = direction === 'back' ? 'translateX(-100%)' : 'translateX(100%)';
  w.appendChild(incoming);
  incoming.getBoundingClientRect();                   // reflow
  incoming.classList.add('sliding'); old.classList.add('sliding');
  incoming.style.transform = 'translateX(0)';
  old.style.transform = direction === 'back' ? 'translateX(45%)' : 'translateX(-25%)';
  old.style.opacity = '.5';
  const done = () => { old.remove(); incoming.classList.remove('incoming', 'sliding'); incoming.style.transform = ''; };
  pending = { done };
  incoming.addEventListener('transitionend', e => { if (e.propertyName === 'transform') settle(); }, { once: true });
  setTimeout(settle, 420);                            // safety
}

function go(hash) {
  hash = parse(hash).hash;
  if (hash === curHash) { viewEl && viewEl.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (viewEl) scrollMem.set(curHash, viewEl.scrollTop);
  curIdx += 1;
  history.pushState({ idx: curIdx, hash }, '', hash);
  render(hash, 'forward');
}

window.addEventListener('popstate', e => {
  const idx = (e.state && e.state.idx) || 0;
  const dir = idx < curIdx ? 'back' : 'forward';
  if (viewEl) scrollMem.set(curHash, viewEl.scrollTop);
  curIdx = idx;
  render(location.hash, dir);
});

/* Intercept in-app links: #/… hash links and legacy *.html?… links. */
function linkToHash(a) {
  if (a.hash && a.hash.startsWith('#/')) return a.hash;
  const page = a.pathname.split('/').pop().replace('.html', '');
  const q = a.search ? a.search : '';
  const map = { index: 'league', teams: 'teams', team: 'team', matchups: 'matchups', player: 'player',
    recap: 'recap', waivers: 'waivers', draft: 'draft', keepers: 'keepers', whatif: 'whatif',
    playoff: 'playoff', punish: 'punish', trade: 'trade', changelog: 'changelog' };
  const name = map[page]; if (!name) return null;
  return `#/${name}${q}`;
}
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
  if (a.origin && a.origin !== location.origin) return;
  const h = linkToHash(a);
  if (!h) return;
  e.preventDefault();
  // team/player links open as a bottom sheet peek; everything else is a page
  const { name, params } = parse(h);
  if (name === 'team' && params.get('owner')) return openTeamSheet(params.get('owner'));
  if (name === 'player' && params.get('pid')) return openPlayerSheet(params.get('pid'));
  go(h);
});

/* ── Shell chrome: app-bar + tab bar ──────────────────────────────────── */
const TABS = [
  { name: 'league',   label: 'League',   ico: '◆' },
  { name: 'matchups', label: 'Matchups', ico: '<b style="font-size:11px;font-weight:800">VS</b>' },
  { name: 'teams',    label: 'Teams',    ico: '⚇' },
  { name: 'more',     label: 'More',     ico: '≡' },
];
function buildTabs() {
  document.getElementById('tabbar').innerHTML = TABS.map(t =>
    `<a class="tab" data-tab="${t.name}" href="#/${t.name}"><span class="tico">${t.ico}</span>${t.label}</a>`).join('');
}
function setActiveTab(tab) {
  document.querySelectorAll('.tab[data-tab]').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab));
}
function setChrome(route, params) {
  document.getElementById('appTitle').textContent = route.title ? route.title(params) : 'GGGG';
  const isTab = TABS.some(t => t.name === (route.tab || route.name));
  document.getElementById('backBtn').hidden = isTab;
}
document.getElementById('backBtn').addEventListener('click', () => history.back());
const refreshBtn = document.getElementById('refreshBtn');
refreshBtn.addEventListener('click', () => refresh());

/* ── Pull-to-refresh + edge swipe-back (shared touch handling) ─────────── */
async function refresh() {
  refreshBtn.classList.add('spin');
  const { name, params } = parse(curHash);
  const route = ROUTES[name] || ROUTES._missing;
  try { if (route.render) { cache.clear(); await route.render(viewEl, params, true); } } catch (e) {}
  refreshBtn.classList.remove('spin');
}

(function gestures() {
  const w = wrap(), ptr = document.getElementById('ptr');
  let mode = null, startX = 0, startY = 0, dx = 0, dy = 0;

  w.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || mode) return;
    const t = e.touches[0]; startX = t.clientX; startY = t.clientY; dx = dy = 0;
    if (startX < 24) mode = 'back';
    else if (viewEl && viewEl.scrollTop <= 0) mode = 'ptr?';
  }, { passive: true });

  w.addEventListener('touchmove', e => {
    if (!mode) return;
    const t = e.touches[0]; dx = t.clientX - startX; dy = t.clientY - startY;
    if (mode === 'ptr?') {
      if (dy > 6 && Math.abs(dy) > Math.abs(dx)) { mode = 'ptr'; }
      else if (Math.abs(dx) > 6) { mode = null; return; }
    }
    if (mode === 'back') {
      if (dx > 0) { e.preventDefault(); viewEl.classList.add('dragging');
        viewEl.style.transform = `translateX(${Math.min(dx, innerWidth)}px)`;
        viewEl.style.opacity = String(1 - Math.min(dx / innerWidth, .3)); }
    } else if (mode === 'ptr') {
      if (dy > 0) { e.preventDefault(); const d = Math.min(dy * .5, 90);
        ptr.style.height = d + 'px'; ptr.classList.toggle('armed', d >= 60); }
    }
  }, { passive: false });

  w.addEventListener('touchend', () => {
    if (mode === 'back') {
      viewEl.classList.remove('dragging');
      if (dx > 80) { viewEl.style.transition = 'transform .25s, opacity .25s';
        viewEl.style.transform = `translateX(${innerWidth}px)`;
        setTimeout(() => { viewEl.style.transition = ''; history.back(); }, 180); }
      else { viewEl.style.transition = 'transform .25s, opacity .25s';
        viewEl.style.transform = ''; viewEl.style.opacity = '';
        setTimeout(() => { viewEl.style.transition = ''; }, 260); }
    } else if (mode === 'ptr') {
      const armed = ptr.classList.contains('armed');
      ptr.style.height = ''; ptr.classList.remove('armed');
      if (armed) { ptr.classList.add('refreshing'); refresh().finally(() => ptr.classList.remove('refreshing')); }
    }
    mode = null;
  });
})();

/* ── Bottom sheet ─────────────────────────────────────────────────────── */
function openSheet(headHTML, bodyHTML, onBody) {
  const host = document.getElementById('sheetHost');
  host.innerHTML = `<div class="sheet-scrim"></div><div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-grab"></div><div class="sheet-head">${headHTML}</div>
    <div class="sheet-body">${bodyHTML}</div></div>`;
  host.classList.add('open'); host.setAttribute('aria-hidden', 'false');
  const sheet = host.querySelector('.sheet');
  const close = () => { host.classList.remove('open'); host.setAttribute('aria-hidden', 'true');
    setTimeout(() => { if (!host.classList.contains('open')) host.innerHTML = ''; }, 340); };
  host.querySelector('.sheet-scrim').addEventListener('click', close);
  // drag-to-dismiss on the grab handle / head
  let sy = 0, sd = 0, dragging = false;
  const head = sheet.querySelector('.sheet-grab');
  head.addEventListener('touchstart', e => { sy = e.touches[0].clientY; dragging = true; sheet.classList.add('dragging'); }, { passive: true });
  head.addEventListener('touchmove', e => { if (!dragging) return; sd = Math.max(0, e.touches[0].clientY - sy);
    sheet.style.transform = `translateY(${sd}px)`; }, { passive: true });
  head.addEventListener('touchend', () => { dragging = false; sheet.classList.remove('dragging'); sheet.style.transform = '';
    if (sd > 90) close(); sd = 0; });
  if (onBody) onBody(host.querySelector('.sheet-body'));
  return close;
}

/* ── Routes ───────────────────────────────────────────────────────────── */
const ROUTES = {};

ROUTES.league = {
  tab: 'league', title: () => 'League',
  skeleton: () => skHeader() + `<p class="section-label">Standings</p>` + skRows(12),
  render: async (el) => {
    const [L, M] = await Promise.all([getJSON('data/league.json'), getJSON('data/meta.json').catch(() => null)]);
    const s = L.standings || [];
    el.innerHTML = `<header><div class="htext"><p class="eyebrow">${esc((M && M.league_name) || 'Fantasy Football')}</p>
        <h1>Standings</h1><p class="subtitle">${M ? 'Updated ' + relTime(M.generated_at) : ''}</p></div></header>
      <section><div class="card table-wrap"><table>
        <thead><tr><th class="rank-cell">#</th><th>Team</th><th class="num">W-L</th><th class="num">PF</th><th class="num">PA</th><th class="num">Strk</th></tr></thead>
        <tbody>${s.map(r => `<tr>
          <td class="rank-cell">${r.rank}</td>
          <td><a class="team-link" href="#/team?owner=${encodeURIComponent(r.owner_id || '')}"><div class="team-cell">${avatarHTML(r.avatar, r.team)}<span class="team-name">${esc(r.team)}</span></div></a></td>
          <td class="num">${r.wins}-${r.losses}${r.ties ? '-' + r.ties : ''}</td>
          <td class="num">${r.pf.toFixed(1)}</td><td class="num muted">${r.pa.toFixed(1)}</td>
          <td class="num ${r.streak && r.streak[0] === 'W' ? 'w' : r.streak && r.streak[0] === 'L' ? 'l' : ''}">${esc(r.streak || '')}</td></tr>`).join('')}
        </tbody></table></div></section>
      ${(L.power && L.power.length) ? `<section><p class="section-label">Power Rankings <span class="sub">— by all-play win%</span></p>
        <div class="card table-wrap"><table><thead><tr><th class="rank-cell">#</th><th>Team</th><th class="num">All-Play</th><th class="num">PF</th></tr></thead>
        <tbody>${L.power.map(p => `<tr><td class="rank-cell">${p.rank}</td>
          <td><div class="team-cell">${avatarHTML(p.avatar, p.team)}<span class="team-name">${esc(p.team)}</span></div></td>
          <td class="num">${p.all_play}</td><td class="num muted">${p.pf.toFixed(0)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  },
};

ROUTES.teams = {
  tab: 'teams', title: () => 'Teams',
  skeleton: () => skHeader() + skGrid(12),
  render: async (el) => {
    const [T, M] = await Promise.all([getJSON('data/teams.json'), getJSON('data/meta.json')]);
    el.innerHTML = `<header><div class="htext"><p class="eyebrow">All Managers</p><h1>Teams</h1>
        <p class="subtitle">${T.length} managers · ${M.seasons.length} season${M.seasons.length > 1 ? 's' : ''}</p></div></header>
      <section><div class="teams-grid">${T.map(t => `
        <a class="team-tile" href="#/team?owner=${encodeURIComponent(t.owner_id)}">
          ${avatarHTML(t.avatar, t.team, 'tt-avatar')}
          <div style="min-width:0"><div class="tt-name">${esc(t.team)}</div>
            <div class="tt-sub">${esc(t.owner)} · ${esc(t.record)} · ${(t.win_pct * 100).toFixed(0)}%</div>
            ${t.championships ? `<div class="tt-rings">${'🏆'.repeat(t.championships)} ${t.championships} title${t.championships > 1 ? 's' : ''}</div>`
              : `<div class="tt-sub">${t.seasons} season${t.seasons > 1 ? 's' : ''} · best ${t.best_finish}</div>`}
          </div></a>`).join('')}</div></section>`;
  },
};

ROUTES.more = {
  tab: 'more', title: () => 'More',
  render: async (el) => {
    const items = [
      ['recap', '◷', 'Last Week'], ['matchups', 'VS', 'Matchups'], ['waivers', '≡', 'Waiver Wire'],
      ['draft', '✦', 'Draft'], ['keepers', '⚓', 'Keepers'], ['whatif', '?', 'What-If'],
      ['playoff', '★', 'Playoff Watch'], ['punish', '⚠', 'Punish Watch'], ['trade', '↔', 'Trade Lab'],
      ['changelog', '✎', 'Changelog'],
    ];
    el.innerHTML = `<header><div class="htext"><p class="eyebrow">GGGG</p><h1>More</h1></div></header>
      <section><div class="card" style="padding:0">${items.map(([n, i, l]) =>
        `<a href="#/${n}" class="sheet-link" style="padding:15px 16px;border-bottom:2px solid var(--border)">
          <span class="ico" style="font-size:16px">${i}</span><span class="stxt" style="font-size:15px">${l}</span>
          <span style="margin-left:auto;color:var(--muted)">›</span></a>`).join('')}</div></section>`;
  },
};

const _stub = (label) => ({ title: () => label, render: async (el) => {
  el.innerHTML = `<header><div class="htext"><p class="eyebrow">GGGG</p><h1>${esc(label)}</h1></div></header>
    <p class="muted" style="padding:30px 0;text-align:center">This page is being rebuilt for the new mobile experience.<br><br>
    <a class="team-link" href="/sleeper/${routeToFile(label)}" style="color:var(--accent)">Open the classic version →</a></p>`;
}});
function routeToFile(label){ return ({'Matchups':'matchups','Last Week':'recap','Waiver Wire':'waivers','Draft':'draft','Keepers':'keepers','What-If':'whatif','Playoff Watch':'playoff','Punish Watch':'punish','Trade Lab':'trade','Changelog':'changelog'}[label] || 'index') + '.html'; }
['matchups','recap','waivers','draft','keepers','whatif','playoff','punish','trade','changelog'].forEach(n => {
  ROUTES[n] = _stub(({matchups:'Matchups',recap:'Last Week',waivers:'Waiver Wire',draft:'Draft',keepers:'Keepers',whatif:'What-If',playoff:'Playoff Watch',punish:'Punish Watch',trade:'Trade Lab',changelog:'Changelog'})[n]);
  ROUTES[n].tab = 'more';
});
ROUTES._missing = { title: () => 'GGGG', render: async (el) => { el.innerHTML = `<p class="muted" style="padding:40px 0;text-align:center">Not found.</p>`; } };

/* ── Detail sheets (quick peek) ───────────────────────────────────────── */
async function openTeamSheet(owner) {
  const close = openSheet(`<div class="sk sk-line" style="width:60%;height:22px"></div>`, skRows(4));
  try {
    const T = await getJSON(`data/team_${owner}.json`);
    const m = T.meta || {}, s0 = (T.seasons && T.seasons[0]) || null;
    const host = document.getElementById('sheetHost');
    host.querySelector('.sheet-head').innerHTML = `${avatarHTML(m.avatar, m.team, 'head-avatar')}
      <div style="min-width:0"><div class="team-name" style="font-size:18px;font-weight:700">${esc(m.team || '')}${m.championships ? ' ' + '🏆'.repeat(m.championships) : ''}</div>
      <div class="muted" style="font-size:13px">${esc(m.owner || '')}</div></div>`;
    host.querySelector('.sheet-body').innerHTML = `
      ${s0 ? `<div class="stat-grid"><div class="stat-card"><div class="stat-label">${esc(s0.season)} Record</div><div class="stat-value">${s0.wins}-${s0.losses}${s0.ties ? '-' + s0.ties : ''}</div><div class="stat-sub">${s0.rank ? '#' + s0.rank + ' seed' : ''}</div></div>
        <div class="stat-card"><div class="stat-label">Points For</div><div class="stat-value">${(s0.pf || 0).toFixed(0)}</div></div></div>` : ''}
      <a class="team-link" href="/sleeper/team.html?owner=${encodeURIComponent(owner)}" style="display:block;margin-top:14px;color:var(--accent)">Open full team page →</a>`;
  } catch (e) { close(); }
}
async function openPlayerSheet(pid) {
  const close = openSheet(`<div class="sk sk-line" style="width:50%;height:22px"></div>`, skRows(4));
  try {
    const P = await getJSON(`data/players/${pid}.json`);
    const host = document.getElementById('sheetHost');
    host.querySelector('.sheet-head').innerHTML = `${headshotHTML(P.pid, P.pos, P.nfl_team)}
      <div><div style="font-weight:700;font-size:17px">${esc(P.name)}</div><div class="muted" style="font-size:13px">${posPill(P.pos)} ${esc(P.nfl_team || '')}</div></div>`;
    const s = P.summary || {};
    host.querySelector('.sheet-body').innerHTML = `<div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Started</div><div class="stat-value">${s.started ?? '—'}</div><div class="stat-sub">of ${s.games ?? '—'} rostered</div></div>
        <div class="stat-card"><div class="stat-label">Started Pts</div><div class="stat-value">${s.started_pts != null ? s.started_pts.toFixed(0) : '—'}</div></div></div>
      <a class="team-link" href="/sleeper/player.html?pid=${encodeURIComponent(pid)}" style="display:block;margin-top:14px;color:var(--accent)">Open full player page →</a>`;
  } catch (e) { close(); }
}

/* ── Boot ─────────────────────────────────────────────────────────────── */
buildTabs();
viewEl = view();
const initHash = parse(location.hash).hash;
history.replaceState({ idx: 0, hash: initHash }, '', initHash);
curHash = ''; render(initHash, 'none');
})();
