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

function closeAnySheet() {
  const host = document.getElementById('sheetHost');
  if (host._close && host.classList.contains('open')) host._close();
}
function go(hash) {
  hash = parse(hash).hash;
  closeAnySheet();
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
  // team/player links open as a bottom-sheet peek; a [data-full] link (the
  // sheet's "open full page") routes to the full screen instead.
  const { name, params } = parse(h);
  if (!a.hasAttribute('data-full')) {
    if (name === 'team' && params.get('owner')) return openTeamSheet(params.get('owner'));
    if (name === 'player' && params.get('pid')) return openPlayerSheet(params.get('pid'));
  }
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
  host._close = close;
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

/* ── Full Team page (routed screen; the peek sheet links here) ─────────── */
const _shade = (hex, f) => { if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16); let r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  return '#' + [r*f, g*f, b*f].map(x => Math.round(x).toString(16).padStart(2, '0')).join(''); };
const _ord = n => (['', 'st', 'nd', 'rd'][n] || 'th');
const _slot = s => ({ WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', SUPER_FLEX: 'SFLX' }[s] || s);
const _plink = (pid, inner) => pid ? `<a href="#/player?pid=${pid}" style="color:inherit;text-decoration:none">${inner}</a>` : inner;
const _nick = p => (p.nick && p.nick !== p.player)
  ? `<div class="pnick" style="font-size:11px;color:var(--muted);font-style:italic;line-height:1.25;margin-top:1px">&ldquo;${esc(p.nick)}&rdquo;</div>` : '';
const FLEX_ELIG = { FLEX: ['RB','WR','TE'], WRRB_FLEX: ['RB','WR'], REC_FLEX: ['WR','TE'], SUPER_FLEX: ['QB','RB','WR','TE'] };
const _slotElig = (slot, pos) => FLEX_ELIG[slot] ? FLEX_ELIG[slot].includes(pos) : slot === pos;
function _optimalStarters(roster, slots, valueOf) {
  const pool = roster.filter(p => p.pid != null).map(p => ({ pid: String(p.pid), pos: p.pos, v: valueOf(p) }))
    .filter(p => p.v != null).sort((a, b) => b.v - a.v);
  const used = new Set(), started = new Set();
  [...slots].sort((a, b) => (FLEX_ELIG[a] ? 1 : 0) - (FLEX_ELIG[b] ? 1 : 0)).forEach(slot => {
    const pick = pool.find(p => !used.has(p.pid) && _slotElig(slot, p.pos));
    if (pick) { used.add(pick.pid); started.add(pick.pid); }
  });
  return started;
}
function _rosterTable(roster) {
  return `<div class="card table-wrap" style="padding:8px 12px"><table>
    <thead><tr><th>Slot</th><th>Player</th><th class="num">Season PPR</th></tr></thead><tbody>${roster.map(p => {
      const st = p.slot && p.slot !== 'BN', age = p.age != null ? p.age : '';
      return `<tr><td style="width:52px"><span class="slot-badge ${st ? 'start' : ''}">${esc(_slot(p.slot || 'BN'))}</span></td>
        <td><div class="player-cell">${headshotHTML(p.pid, p.pos, p.nfl_team)}
          <div class="pmeta"><div class="pname">${_plink(p.pid, esc(p.player))}${injuryBadge(p.injury)}</div>${_nick(p)}
            <div class="psub">${esc(p.pos)} · ${esc(p.nfl_team)}${age !== '' ? ` · ${age}y` : ''}</div></div></div></td>
        <td class="num">${(p.pts_ppr || 0).toFixed(1)}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function _gameLog(log) {
  if (!log || !log.length) return '<p class="muted">No games.</p>';
  return `<div class="card table-wrap" style="padding:8px 12px"><table>
    <thead><tr><th>Wk</th><th>Opponent</th><th class="num">Score</th><th class="num">Res</th></tr></thead>
    <tbody>${log.map(g => `<tr><td class="muted">${g.week}</td><td>${esc(g.opp)}</td>
      <td class="num">${g.pts.toFixed(1)} – ${g.opp_pts.toFixed(1)}</td>
      <td class="num ${g.result === 'W' ? 'w' : g.result === 'L' ? 'l' : 't'}">${g.result}</td></tr>`).join('')}</tbody></table></div>`;
}
function _draftTable(picks) {
  return `<div class="card table-wrap" style="padding:8px 12px"><table>
    <thead><tr><th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th><th class="num">PPR</th></tr></thead>
    <tbody>${picks.map(p => `<tr><td class="muted">${p.round}</td><td class="muted">${p.pick}</td>
      <td><span class="team-name">${esc(p.player)}</span></td><td>${posPill(p.pos)}</td>
      <td class="num">${(p.pts_ppr || 0).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`;
}
function _txList(txs) {
  return `<div class="tx-list">${txs.map(t => {
    const badge = `<span class="tx-badge tx-${t.type}">${t.type === 'free_agent' ? 'FA' : t.type}</span>`;
    const body = t.type === 'trade' ? `<div><strong>Trade</strong> — ${esc(t.summary)}</div>`
      : `<div><span class="tx-add">+ ${esc(t.add)}</span> <span class="muted">(${esc(t.add_pos)})</span>${t.drop ? `<span class="tx-drop"> − ${esc(t.drop)}</span>` : ''}</div>`;
    return `<div class="tx-item">${badge}<div class="tx-body">${body}<div class="tx-date">${fmtDate(t.created)}</div></div></div>`;
  }).join('')}</div>`;
}
function _seasonBlock(s, open) {
  const ring = s.champion ? ' 🏆' : '', finishTxt = s.finish ? `${s.finish}${_ord(s.finish)} place` : '', e = s.efficiency;
  const effLine = (e && e.pct != null)
    ? `<div class="season-tag">Lineup Efficiency</div><div class="card" style="padding:14px 16px;margin-bottom:4px">
       <div class="eff-wrap"><div class="eff-bar"><div class="eff-fill" style="width:${e.pct}%"></div></div>
       <div class="eff-foot"><span>${e.pct}% · ${e.actual} of ${e.optimal} pts</span><span>${e.left_on_bench} left on bench</span></div></div></div>` : '';
  return `<div class="season-block ${open ? 'open' : ''}"><div class="season-head">
      <span class="syr">${esc(s.season)}${ring}</span>
      <span class="sfin">${esc(s.team_name)} · ${esc(s.record)} · ${finishTxt} · ${s.pf.toFixed(0)} PF</span>
      <span class="schev">▶</span></div>
    <div class="season-body">${effLine}
      <div class="season-tag">Roster</div>${_rosterTable(s.roster)}
      <div class="season-tag">Game Log</div>${_gameLog(s.game_log)}
      ${s.draft_picks && s.draft_picks.length ? `<div class="season-tag">Draft Picks</div>${_draftTable(s.draft_picks)}` : ''}
      ${s.transactions && s.transactions.length ? `<div class="season-tag">Transactions (${s.transactions.length})</div>${_txList(s.transactions)}` : ''}</div></div>`;
}
function _teamRecommended(s0, ecrOf) {
  if (!s0.recommended) return '';
  const rows = s0.recommended.lineup.map(r => {
    if (!r.player) return `<div class="lineup-row empty"><span class="slot-badge">${esc(_slot(r.slot))}</span><span class="lp-name muted">— empty —</span></div>`;
    const e = ecrOf(r.pid), rank = e && e.pos_rank ? `<span class="muted" style="font-weight:400"> · ${esc(e.pos_rank)}</span>` : '';
    return `<div class="lineup-row"><span class="slot-badge start">${esc(_slot(r.slot))}</span>${headshotHTML(r.pid, r.pos, r.nfl_team)}
      <span class="lp-name">${_plink(r.pid, esc(r.player))}${injuryBadge(r.injury)} <span class="muted" style="font-weight:400">${esc(r.pos)}·${esc(r.nfl_team)}</span>${rank}</span>
      <span class="lp-val">${(r.ppg || 0).toFixed(1)}</span></div>`;
  }).join('');
  return `<section><p class="section-label">Recommended Lineup <span class="sub">— ${esc(s0.recommended.basis)}</span></p>
    <div class="card"><div class="lineup">${rows}</div>
      <div class="lineup-total"><span class="muted">Projected weekly total</span><strong>${s0.recommended.proj_total.toFixed(1)}</strong></div></div></section>`;
}
function _teamROS(s0, ECR, ecrOf) {
  const roster = (s0 && s0.roster) || [];
  if (!ECR || !ECR.players || !roster.length) return '';
  const ranked = roster.filter(p => p.pid != null).map(p => { const e = ecrOf(p.pid); return { p, e, ecr: e && e.ecr != null ? e.ecr : Infinity }; }).sort((a, b) => a.ecr - b.ecr);
  if (!ranked.some(r => isFinite(r.ecr))) return '';
  const modeLabel = ECR.mode === 'ros' ? 'rest-of-season' : 'preseason';
  const byPts = roster.filter(p => p.pid != null).slice().sort((a, b) => (b.pts_ppr || 0) - (a.pts_ppr || 0));
  const ptsRank = {}; byPts.forEach((p, i) => ptsRank[String(p.pid)] = i + 1);
  const ecrList = ranked.filter(r => isFinite(r.ecr)); const ecrRank = {}; ecrList.forEach((r, i) => ecrRank[String(r.p.pid)] = i + 1);
  const n = ecrList.length;
  const rows = ranked.map(({ p, e, ecr }) => {
    let tag = '';
    if (isFinite(ecr) && (p.pts_ppr || 0) > 0 && ['RB','WR','TE'].includes(p.pos)) {
      const pr = ptsRank[String(p.pid)], er = ecrRank[String(p.pid)];
      if (er - pr >= Math.max(3, Math.round(n * .25))) tag = '<span class="tx-badge tx-drop">sell-high</span>';
      else if (pr - er >= Math.max(3, Math.round(n * .25))) tag = '<span class="tx-badge tx-add">buy-low</span>';
    }
    return `<tr><td><div class="player-cell">${headshotHTML(p.pid, p.pos, p.nfl_team)}
        <div class="pmeta"><div class="pname">${_plink(p.pid, esc(p.player))}${injuryBadge(p.injury)} ${tag}</div>${_nick(p)}
          <div class="psub">${esc(p.pos)} · ${esc(p.nfl_team)}</div></div></div></td>
      <td class="num"><strong>${isFinite(ecr) ? ecr : '<span class="muted">—</span>'}</strong></td>
      <td class="num muted">${e && e.pos_rank ? esc(e.pos_rank) : ''}</td>
      <td class="num muted">${(p.pts_ppr || 0).toFixed(1)}</td></tr>`;
  }).join('');
  return `<section><p class="section-label">Rest-of-Season Outlook <span class="sub">— ${modeLabel} consensus (PPR)</span></p>
    <div class="card table-wrap" style="padding:8px 12px"><table><thead><tr><th>Player</th><th class="num">ECR</th><th class="num">Pos</th><th class="num">PPR</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
ROUTES.team = {
  title: () => 'Team',
  skeleton: () => skHeader() + `<div class="stat-grid">${Array.from({length:4},()=>'<div class="sk sk-card"></div>').join('')}</div>` + skRows(8),
  render: async (el, params) => {
    const owner = params.get('owner');
    const [T, M, ECR] = await Promise.all([
      getJSON(`data/team_${owner}.json`),
      getJSON('data/meta.json').catch(() => null),
      getJSON('data/ecr.json').catch(() => null),
    ]);
    if (T.meta.color) { el.style.setProperty('--accent', T.meta.color); el.style.setProperty('--accent-dim', _shade(T.meta.color, .7)); }
    document.title = `${T.meta.team} · GGGG`;
    const ecrOf = pid => (ECR && ECR.players && ECR.players[String(pid)]) || null;
    const at = T.all_time, s0 = T.seasons[0] || {}, eff = s0.efficiency;
    const summary = [
      ['All-Time', `${at.w}-${at.l}${at.t ? '-' + at.t : ''}`, `${(at.win_pct * 100).toFixed(1)}% · ${at.seasons} seasons`],
      ['Titles', `${at.championships}`, `${at.playoff_apps} playoff app${at.playoff_apps !== 1 ? 's' : ''}`],
      ['Best Finish', `${at.best_finish}${_ord(at.best_finish)}`, `${at.pf.toFixed(0)} total PF`],
      eff && eff.pct != null ? ['Lineup IQ', `${eff.pct}%`, `${eff.left_on_bench} left on bench (${s0.season})`]
        : ['Best Game', at.high ? at.high.pts.toFixed(1) : '—', at.high ? `${at.high.season} Wk ${at.high.week}` : ''],
    ].map(([l, v, s]) => `<div class="stat-card"><div class="stat-label">${esc(l)}</div><div class="stat-value">${esc(v)}</div><div class="stat-sub">${esc(s)}</div></div>`).join('');
    el.innerHTML = `<header>${avatarHTML(T.meta.avatar, T.meta.team, 'head-avatar')}
        <div class="htext"><p class="eyebrow">${esc(T.meta.owner)} · ${at.seasons} season${at.seasons > 1 ? 's' : ''}</p>
        <h1>${esc(T.meta.team)}</h1>
        <p class="subtitle">${at.w}-${at.l}${at.t ? '-' + at.t : ''} all-time · ${(at.win_pct * 100).toFixed(0)}%${at.championships ? ` · <span style="color:var(--amber)">${'🏆'.repeat(at.championships)} ${at.championships} title${at.championships > 1 ? 's' : ''}</span>` : ''}</p></div></header>
      <p class="updated">${M ? 'Updated ' + relTime(M.generated_at) : ''}</p>
      <section><div class="stat-grid">${summary}</div></section>
      ${_teamRecommended(s0, ecrOf)}
      ${_teamROS(s0, ECR, ecrOf)}
      <section><p class="section-label">Seasons &amp; Roster History</p>
        ${T.seasons.map((s, i) => _seasonBlock(s, i === 0)).join('')}</section>`;
    el.querySelectorAll('.season-head').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
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
      <a class="team-link" data-full href="#/team?owner=${encodeURIComponent(owner)}" style="display:block;margin-top:14px;color:var(--accent)">Open full team page →</a>`;
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
