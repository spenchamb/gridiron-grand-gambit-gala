/* GGGG visual components — mechanical odometer + boxy charts. Vanilla, no deps.
   Exposed as window.SCviz. Aesthetic: sharp, monospace, flat. */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const raf2 = fn => requestAnimationFrame(() => requestAnimationFrame(fn));

  /* Mechanical rolling-digit odometer. Rolls each digit 0 -> target with a stagger. */
  function odometer(el, value, decimals) {
    decimals = decimals == null ? 1 : decimals;
    const s = Number(value).toFixed(decimals);
    el.classList.add('odo'); el.textContent = '';
    let i = 0;
    for (const ch of s) {
      if (ch < '0' || ch > '9') { const sep = document.createElement('span'); sep.className = 'odo-sep'; sep.textContent = ch; el.appendChild(sep); continue; }
      const d = +ch;
      const win = document.createElement('span'); win.className = 'odo-d';
      const reel = document.createElement('span'); reel.className = 'odo-reel';
      for (let n = 0; n <= 9; n++) { const c = document.createElement('span'); c.textContent = n; reel.appendChild(c); }
      win.appendChild(reel); el.appendChild(win);
      const delay = (i++) * 70;
      raf2(() => { reel.style.transitionDelay = delay + 'ms'; reel.style.transform = 'translateY(-' + (d * 10) + '%)'; });
    }
  }
  function odometerAll(root) {
    root.querySelectorAll('[data-odo]').forEach(el => odometer(el, el.getAttribute('data-odo'),
      el.hasAttribute('data-dec') ? +el.getAttribute('data-dec') : 1));
  }

  /* Positional battle — mirrored bars, one row per starting position: where the game was won. */
  const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  function aggStarters(players) {
    const m = {};
    (players || []).forEach(p => { if (p.starter) m[p.pos] = (m[p.pos] || 0) + p.pts; });
    return m;
  }
  function positionalBattle(el, me, ot) {
    const A = aggStarters(me.players), B = aggStarters(ot.players);
    const poss = POS_ORDER.filter(p => A[p] || B[p]).concat(Object.keys(A).concat(Object.keys(B)).filter(p => !POS_ORDER.includes(p)));
    const uniq = [...new Set(poss)];
    const max = Math.max(1, ...uniq.map(p => Math.max(A[p] || 0, B[p] || 0)));
    const ca = me.color || 'var(--accent)', cb = ot.color || 'var(--muted)';
    const rows = uniq.map(p => {
      const a = A[p] || 0, b = B[p] || 0, aw = a > b, bw = b > a;
      return `<div class="pb-row">
        <div class="pb-val l ${aw ? 'w' : ''}">${a.toFixed(1)}</div>
        <div class="pb-track l"><span class="pb-bar l ${aw ? '' : 'dim'}" data-w="${a / max * 100}" style="background:${ca}"></span></div>
        <div class="pb-pos">${esc(p)}</div>
        <div class="pb-track r"><span class="pb-bar r ${bw ? '' : 'dim'}" data-w="${b / max * 100}" style="background:${cb}"></span></div>
        <div class="pb-val r ${bw ? 'w' : ''}">${b.toFixed(1)}</div>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="pb-head">
        <span class="pb-t"><i style="background:${ca}"></i>${esc(me.team)}</span>
        <span class="pb-cap">where it was won</span>
        <span class="pb-t r">${esc(ot.team)}<i style="background:${cb}"></i></span>
      </div>${rows}`;
    raf2(() => el.querySelectorAll('.pb-bar').forEach(b => b.style.width = b.dataset.w + '%'));
  }

  /* All-time win% leaderboard — sequential bars, title-holders in amber. */
  function allTimeBars(el, all) {
    const rows = [...all].sort((a, b) => b.win_pct - a.win_pct);
    const max = Math.max(...rows.map(r => r.win_pct)) || 1;
    el.innerHTML = '<div class="atb">' + rows.map((r, i) => {
      const gp = r.wins + r.losses + (r.ties || 0), ppg = gp ? r.pf / gp : 0;
      const tro = r.championships ? `<span class="atb-tro">${'\u{1F3C6}'.repeat(r.championships)}</span>` : '';
      return `<div class="atb-row${r.championships ? ' champ' : ''}">
        <span class="atb-rk">${i + 1}</span>
        <span class="atb-nm">${esc(r.owner)}</span>
        <span class="atb-track"><span class="atb-bar" data-w="${r.win_pct / max * 100}"></span></span>
        <span class="atb-pct">${(r.win_pct * 100).toFixed(1)}%</span>
        <span class="atb-meta">${tro}<span class="atb-ppg">${ppg.toFixed(1)} pg</span></span>
      </div>`;
    }).join('') + '</div>';
    raf2(() => el.querySelectorAll('.atb-bar').forEach(b => b.style.width = b.dataset.w + '%'));
  }

  /* Champions ledger — boxy season cards. */
  function championsLedger(el, seasons) {
    el.innerHTML = '<div class="cl">' + (seasons || []).map(s => `
      <div class="cl-card">
        <div class="cl-yr">${esc(s.season)}</div>
        <div class="cl-main"><span class="cl-tro">\u{1F3C6}</span><span class="cl-champ">${esc(s.champion || '—')}</span></div>
        <div class="cl-sub">def. ${esc(s.runner_up || '—')}</div>
        <div class="cl-sub">reg. #1 ${esc(s.regular_season || '—')} · ${s.teams} tms</div>
      </div>`).join('') + '</div>';
  }

  window.SCviz = { odometer, odometerAll, positionalBattle, allTimeBars, championsLedger };
})();
