// page: https://www.espn.com/nba/   (built-in browser, javascript_tool; read-only)
// Same-player combo chances (e.g. 15+ pts & 6+ reb) from each player's own game log. Needs the IndexedDB cache "nbabt"
// (kv: games, box) that collect_history.js keeps up to date (run step 2b first).
// QUERY (raw/combo_query.txt from combo_query.py): lines "code|side|player|proj_min", e.g. "BRK@BOS|home|Derrick White|33.1"
// Output: ###CMB code|side|player|n|min10|proj_min|opp|opp_fac|combos
//   combos: comma list of spec:chance%:hitsInLast10:lift%, spec = rungs, P points, R rebounds, A assists, T threes
//   (e.g. "P15R4:62:7:112" = 15+ pts and 4+ reb, 62% in his log, hit in 7 of his last 10, 1.12x what unrelated legs would give). Kept: players averaging 18+ min over the last 10,
//   combos with a 25-90% chance, 20 per player (up to 10 triples, the rest pairs, ranked by chance x lift).
// Model (BACKTEST.md "Same-player stat combos", 803k combo outcomes in 2025-26): recency-weighted log (half-life 10 games,
// earlier seasons x0.5); joint = weighted combo hit rate shrunk toward the product of his single rates (15 pseudo-games);
// logit x0.9; x the opponent's combo factor (this season blended with last season's x0.75); 3-leg combos -0.1 logit.
const QRAW = `/*QUERY*/`;
const CFG = { half: 10, prev: 0.5, a0: 2, k: 15, calB: 0.9, oppK: 20, oppCarry: 0.75, leg3: -0.1, minGames: 10, minMin: 18, qMin: 0.25, qMax: 0.90, perPlayer: 20 };
const RUNG = { P: [10, 15, 20, 25, 30, 35, 40], R: [4, 6, 8, 10, 12, 14], A: [2, 4, 6, 8, 10, 12], T: [1, 2, 3, 4, 5] };
const COL = { P: 'pts', R: 'reb', A: 'ast', T: 'tpm' }, IDX = { pts: 6, reb: 7, ast: 8, tpm: 10 };
const ESPN2US = { NY: "NYK", SA: "SAS", GS: "GSW", NO: "NOP", UTAH: "UTA", WSH: "WAS", BKN: "BRK", PHX: "PHO", CHA: "CHO" };
const T30 = new Set(['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GS','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NO','NY','OKC','ORL','PHI','PHX','POR','SAC','SA','TOR','UTAH','WSH']);
const db = await new Promise((res, rej) => { const r = indexedDB.open('nbabt'); r.onsuccess = () => res(r.result); r.onerror = rej; });
const get = (k) => new Promise(res => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); });
const put = (k, v) => new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; });
const games = await get('games'), box = await get('box');
const G = Object.values(games).filter(g => box[g.id] && T30.has(g.home) && T30.has(g.away)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const seasonOf = d => { const y = +d.slice(0, 4), m = +d.slice(4, 6); return m >= 9 ? y + 1 : y; };
const lastDate = G[G.length - 1].date, SEASON = seasonOf(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
const lg = q => Math.log(q / (1 - q)), sg = x => 1 / (1 + Math.exp(-x)), cl = q => Math.min(Math.max(q, 0.003), 0.997);
// weights, single rates and the shrunk joint for a history H at season s
function model(H, s) {
  const W = H.map((h, i) => Math.pow(0.5, (H.length - 1 - i) / CFG.half) * (h.s === s ? 1 : CFG.prev));
  const sw = W.reduce((a, b) => a + b, 0);
  const single = (st, r) => (H.reduce((t, h, i) => t + (h[st] >= r ? W[i] : 0), 0) + CFG.a0 * 0.5) / (sw + CFG.a0);
  const joint = (c) => {
    const ind = c.reduce((t, [st, r]) => t * single(st, r), 1);
    if (c.length === 1) return ind;
    const emp = H.reduce((t, h, i) => t + (c.every(([st, r]) => h[st] >= r) ? W[i] : 0), 0) / sw;
    return (emp * sw + CFG.k * ind) / (sw + CFG.k);
  };
  return { W, sw, single, joint, mean: st => H.reduce((t, h, i) => t + W[i] * h[st], 0) / sw };
}
const calib = (q, legs) => sg(CFG.calB * lg(cl(q)) + (legs >= 3 ? CFG.leg3 : 0));
// 1. opponent factors: predicted vs actual combos allowed, last season and this season (cached per latest game date)
let OF = await get('combo_opp');
if (!OF || OF.asof !== lastDate) {
  const hist = {}, acc = {};   // acc[season][opp] = [pred, actual, games]
  for (const g of G) {
    const s = seasonOf(g.date), live = s >= SEASON - 1;
    const seenOpp = {};
    for (const p of box[g.id]) {
      if (p[4] || !(p[5] > 0)) continue;
      const H = hist[p[0]] || [], opp = p[2] === g.home ? g.away : g.home;
      if (live && H.length >= 15) {
        const M = model(H, s), rungs = {};
        for (const st of ['pts', 'reb', 'ast', 'tpm']) { const m = M.mean(st), R = RUNG[Object.keys(COL).find(k => COL[k] === st)]; let j = 0; for (let k = 0; k < R.length; k++) if (Math.abs(R[k] - m) < Math.abs(R[j] - m)) j = k; rungs[st] = [R[Math.max(0, j - 1)], R[j]]; }
        const sts = ['pts', 'reb', 'ast', 'tpm'], combos = [];
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) for (const ra of rungs[sts[a]]) for (const rb of rungs[sts[b]]) combos.push([[sts[a], ra], [sts[b], rb]]);
        for (const ra of rungs.pts) for (const rb of rungs.reb) for (const rc of rungs.ast) combos.push([['pts', ra], ['reb', rb], ['ast', rc]]);
        acc[s] = acc[s] || {}; const A = acc[s][opp] = acc[s][opp] || [0, 0, 0];
        if (!seenOpp[opp]) { A[2]++; seenOpp[opp] = 1; }
        for (const c of combos) { A[0] += calib(M.joint(c), c.length); A[1] += c.every(([st, r]) => p[IDX[st]] >= r) ? 1 : 0; }
      }
      (hist[p[0]] = H).push({ s, o: opp, pts: p[6], reb: p[7], ast: p[8], tpm: p[10] || 0, min: p[5] });
      if (H.length > 120) H.shift();
    }
  }
  const fac = {};
  for (const t of T30) {
    const cur = (acc[SEASON] || {})[t], last = (acc[SEASON - 1] || {})[t];
    const lc = cur && cur[0] ? Math.log(cur[1] / cur[0]) : 0, ll = last && last[0] ? Math.log(last[1] / last[0]) : 0, n = cur ? cur[2] : 0;
    fac[t] = Math.exp((n * lc + CFG.oppK * CFG.oppCarry * ll) / (n + CFG.oppK));
  }
  OF = { asof: lastDate, fac };
  await put('combo_opp', OF);
}
// 2. tonight's players
const info = {}, H = {};
for (const g of G) {
  const s = seasonOf(g.date);
  for (const p of box[g.id]) {
    if (p[1]) info[p[0]] = [p[1], ESPN2US[p[2]] || p[2]];
    if (p[4] || !(p[5] > 0)) continue;
    const opp = p[2] === g.home ? g.away : g.home;
    (H[p[0]] = H[p[0]] || []).push({ s, o: opp, pts: p[6], reb: p[7], ast: p[8], tpm: p[10] || 0, min: p[5] });
    if (H[p[0]].length > 120) H[p[0]].shift();
  }
}
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/ (jr|sr|ii|iii|iv)$/, '').trim();
const byName = {}; for (const [id, v] of Object.entries(info)) byName[norm(v[0])] = id;
const lastN = n => norm(n).split(' ').pop();
const find = (n, team) => { const id = byName[norm(n)]; if (id) return id; const c = Object.entries(info).filter(([, v]) => v[1] === team && lastN(v[0]) === lastN(n) && norm(v[0])[0] === norm(n)[0]); return c.length === 1 ? c[0][0] : ''; };
const US2ESPN = Object.fromEntries(Object.entries(ESPN2US).map(([a, b]) => [b, a]));
const out = [], miss = [];
for (const ln of QRAW.split('\n').map(x => x.trim()).filter(Boolean)) {
  const [code, side, name, pm] = ln.split('|'); if (!code || !name) continue;
  const [away, home] = code.split('@'), team = side === 'home' ? home : away, opp = side === 'home' ? away : home;
  const id = find(name, team), h = id && H[id];
  // too few games for the game-log combo model: still pass the player on for stackers (5 Nov 2026, Andrew: rookies such as
  // Acuff were never quoted). Stackers price off Sportsbet's own top-rung single, so they don't need the game log.
  const stackOnly = (n) => [code, side, name, n, '', pm || '', opp, (OF.fac[US2ESPN[opp] || opp] || 1).toFixed(2), ''].join('|');
  if (!h || h.length < CFG.minGames) { if ((+pm || 0) >= CFG.minMin) out.push(stackOnly(h ? h.length : 0)); miss.push(name + ' (stack only)'); continue; }
  const M = model(h, SEASON), of = OF.fac[US2ESPN[opp] || opp] || 1;
  const legs = [];
  for (const k of ['P', 'R', 'A', 'T']) for (const r of RUNG[k]) { const q = M.single(COL[k], r); if (q >= 0.25 && q <= 0.97) legs.push([k, r]); }
  const combos = legs.map(l => [l]);
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) if (legs[i][0] !== legs[j][0]) {
    combos.push([legs[i], legs[j]]);
    if (legs[i][0] === 'P' && legs[j][0] === 'R') for (const l of legs) if (l[0] === 'A') combos.push([legs[i], legs[j], l]);
  }
  const last10 = h.slice(-10), min10 = last10.reduce((t, g) => t + g.min, 0) / last10.length;
  if (min10 < CFG.minMin) { miss.push(name + ' (min)'); continue; }
  const cand = [];
  for (const c of combos.filter(c => c.length > 1)) {
    const cc = c.map(([k, r]) => [COL[k], r]);
    const q0 = calib(M.joint(cc), c.length), q = sg(lg(q0) + Math.log(of));
    if (q < CFG.qMin || q > CFG.qMax) continue;
    const ind = cc.reduce((t, x) => t * M.single(x[0], x[1]), 1);   // what pricing the legs as unrelated would give (raw log rates)
    cand.push({ c, cc, q, lift: M.joint(cc) / ind });
  }
  // keep pts/reb/ast triples first (bookies price these closest to the legs multiplied, while they land ~25% more often:
  // BACKTEST.md), then the combos whose stats move together most and are most achievable
  const score = x => x.q * Math.min(x.lift, 1.5);
  cand.sort((a, b) => score(b) - score(a));
  const tri = cand.filter(x => x.c.length === 3).slice(0, CFG.perPlayer / 2);
  const keep = tri.concat(cand.filter(x => x.c.length === 2).slice(0, CFG.perPlayer - tri.length));
  const cells = keep.map(({ c, cc, q, lift }) => `${c.map(([k, r]) => k + r).join('')}:${Math.round(q * 100)}:${last10.filter(g => cc.every(([st, r]) => g[st] >= r)).length}:${Math.round(lift * 100)}`);
  if (!cells.length) { out.push(stackOnly(h.length)); continue; }
  out.push([code, side, name, h.length, min10.toFixed(1), pm || '', opp, of.toFixed(2), cells.join(',')].join('|'));
}
`###CMB\ncode|side|player|n|min10|proj_min|opp|opp_fac|combos\n${out.join('\n')}\n###CMBINFO\nasof|${lastDate}\nmissing|${miss.join(';')}`;
