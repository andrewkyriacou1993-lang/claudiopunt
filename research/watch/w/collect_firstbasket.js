// page: https://www.espn.com/nba/   (built-in browser, javascript_tool; read-only)
// First-basket model. Needs the IndexedDB cache "nbabt" (kv: games, box) that collect_history.js keeps up to date;
// adds each game's opening plays to kv "fb" (jump ball, first score, first field goal) from ESPN's play-by-play,
// then prices the lineups in QUERY.
// QUERY (raw/fb_query.txt from fb_query.py): lines "code|side|player", e.g. "BRK@BOS|away|Julius Randle" (our team codes)
// Output: ###FBP code|side|player|prob|tipwin|jumper|ppg|starts|fb|team|opp|team_tips|opp_tips|jumper_name|jumper_tips|opp_jumper|opp_jumper_tips
//   (prob in %; starts/fb and the tip records 'won/jumps' are since the start of 2025-26)
const QRAW = `/*QUERY*/`;
const QUERY = {};
for (const ln of QRAW.split("\n").map(x => x.trim()).filter(Boolean)) { const [c, sd, n] = ln.split("|"); if (!c || !n) continue; ((QUERY[c] = QUERY[c] || { away: [], home: [] })[sd] || []).push(n); }
// Model (backtest on 2025-26 + 2026-27, 1,278 games, trained walk-forward on 2023-24 onward; see BACKTEST.md):
//   P(team scores first) = A + B x P(its jumper wins the tip)        tip winner scores first 66% of the time
//   tip: Elo on every opening jump ball (K 24);  jumper = the starter with the most jump balls (centres favoured)
//   share of the team's first basket: prior = ppg^EX (x CM for centres, x JM for the jumper), shrunk with the
//   player's own first-basket record as a starter (K_SH pseudo-games); bench players never scored first (0 of 3,744)
const C = { EX: 0.6, K_SH: 250, CM: 1.3, JM: 1.2, DECAY: 0.5, K: 24, A: 0.30, B: 0.40 };
const ESPN2US = { NY: "NYK", SA: "SAS", GS: "GSW", NO: "NOP", UTAH: "UTA", WSH: "WAS", BKN: "BRK", PHX: "PHO", CHA: "CHO" };
const db = await new Promise((res, rej) => { const r = indexedDB.open('nbabt'); r.onsuccess = () => res(r.result); r.onerror = rej; });
const get = (k) => new Promise(res => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); });
const put = (k, v) => new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; });
const games = await get('games'), box = await get('box');
const fb = (await get('fb')) || {};
const aid = (p) => { const m = p && p.athlete && p.athlete.$ref && p.athlete.$ref.match(/athletes\/(\d+)/); return m ? m[1] : ''; };
async function opening(id) {
  try {
    for (const lim of [30, 120]) {
      const j = await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${id}/competitions/${id}/plays?limit=${lim}`).then(r => r.ok ? r.json() : null).catch(() => null);
      if (!j) return null;
      const it = j.items || [];
      const jb = it.find(p => p.type && p.type.text === 'Jumpball' && p.period && p.period.number === 1);
      const jp = (jb && jb.participants) || [];
      const fs = it.find(p => p.scoringPlay);
      const fg = it.find(p => p.scoringPlay && !/free throw/i.test((p.type && p.type.text) || '') && p.scoreValue >= 2);
      const J = [aid(jp[0]), aid(jp[1]), aid(jp[2])];
      const P = (p) => aid(((p && p.participants) || [])[0]);
      const ft = (p) => /free throw/i.test((p.type && p.type.text) || '') ? 1 : 0;
      if (fs && fg) return J.concat([P(fs), fs.scoreValue, ft(fs), P(fg), fg.scoreValue]);
      if (lim === 120) return fs ? J.concat([P(fs), fs.scoreValue, ft(fs), '', 0]) : null;
    }
  } catch (e) { return null; }
}
const todo = Object.keys(games).filter(id => !fb[id] && box[id]);
for (let i = 0; i < todo.length; i += 14) {
  const b = todo.slice(i, i + 14);
  const r = await Promise.all(b.map(opening));
  r.forEach((v, k) => { if (v) fb[b[k]] = v; });
}
if (todo.length) await put('fb', fb);
// walk forward through every cached game to the current state
const seasonOf = d => { const y = +d.slice(0, 4), m = +d.slice(4, 6); return m >= 9 ? y + 1 : y; };
const G = Object.values(games).filter(g => fb[g.id] && box[g.id]).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const elo = {}, nj = {}, fbc = {}, opp = {}, pts = {}, gms = {}, info = {}, raw = {}, jrec = {}, trec = {};   // jrec/trec: tips since 2025-26
let season = 0;
for (const g of G) {
  const s = seasonOf(g.date);
  if (s !== season) { if (season) for (const D of [fbc, opp, pts, gms, nj]) for (const k in D) D[k] *= C.DECAY; season = s; }
  const f = fb[g.id], B = box[g.id];
  const gain = B.find(p => p[0] === f[2]), j1 = B.find(p => p[0] === f[0]), j2 = B.find(p => p[0] === f[1]);
  if (j1 && j2 && gain) {
    const w1 = gain[2] === j1[2] ? 1 : 0, e1 = 1 / (1 + Math.pow(10, -((elo[j1[0]] || 1500) - (elo[j2[0]] || 1500)) / 400));
    elo[j1[0]] = (elo[j1[0]] || 1500) + C.K * (w1 - e1); elo[j2[0]] = (elo[j2[0]] || 1500) - C.K * (w1 - e1);
    nj[j1[0]] = (nj[j1[0]] || 0) + 1; nj[j2[0]] = (nj[j2[0]] || 0) + 1;
    if (g.date >= '20251021') {
      for (const [j, w] of [[j1, w1], [j2, 1 - w1]]) { const r = jrec[j[0]] = jrec[j[0]] || [0, 0]; r[0]++; r[1] += w; const t = ESPN2US[j[2]] || j[2], q = trec[t] = trec[t] || [0, 0]; q[0]++; q[1] += w; }
    }
  }
  const st = B.filter(p => p[3]);
  const fsP = B.find(p => p[0] === f[3]);
  if (fsP) for (const p of st.filter(p => p[2] === fsP[2])) { opp[p[0]] = (opp[p[0]] || 0) + 1; if (p[0] === f[3]) fbc[p[0]] = (fbc[p[0]] || 0) + 1; }
  for (const p of B) {
    if (p[1]) info[p[0]] = [p[1], ESPN2US[p[2]] || p[2], p[9]];
    if (!p[4] && p[5] > 0) { pts[p[0]] = (pts[p[0]] || 0) + p[6]; gms[p[0]] = (gms[p[0]] || 0) + 1; }
  }
  if (g.date >= '20251021') for (const p of st) { const r = raw[p[0]] = raw[p[0]] || [0, 0]; r[0]++; if (p[0] === f[3]) r[1]++; }
}
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/ (jr|sr|ii|iii|iv)$/, '').trim();
const byName = {};
for (const [id, v] of Object.entries(info)) byName[norm(v[0])] = id;
const last = (n) => { const k = norm(n).split(' '); return k[k.length - 1]; };
const find = (n, team) => {
  const id = byName[norm(n)]; if (id) return id;
  const c = Object.entries(info).filter(([, v]) => v[1] === team && last(v[0]) === last(n) && norm(v[0])[0] === norm(n)[0]);
  return c.length === 1 ? c[0][0] : '';
};
const out = [];
for (const [code, sides] of Object.entries(QUERY)) {
  const [away, home] = code.split('@');
  const L = ['away', 'home'].map((sd, ti) => (sides[sd] || []).map(n => { const id = find(n, ti ? home : away); return { n, id, pos: id ? info[id][2] : 'F' }; })
    // a bookie may list more than five: keep the five who have started most this season
    .sort((a, b) => ((raw[b.id] || [0])[0]) - ((raw[a.id] || [0])[0])).slice(0, 5));
  if (L[0].length < 5 || L[1].length < 5) continue;
  const jumper = L.map(side => side.slice().sort((a, b) => ((nj[b.id] || 0) + (b.pos === 'C' ? 0.6 : 0)) - ((nj[a.id] || 0) + (a.pos === 'C' ? 0.6 : 0)))[0]);
  const pTip0 = 1 / (1 + Math.pow(10, -((elo[jumper[0].id] || 1500) - (elo[jumper[1].id] || 1500)) / 400));
  const pT0 = C.A + C.B * pTip0;
  L.forEach((side, ti) => {
    const pt = ti === 0 ? pT0 : 1 - pT0;
    const rw = side.map(p => { const ppg = gms[p.id] > 0.5 ? pts[p.id] / gms[p.id] : 8; let pr = Math.pow(Math.max(ppg, 1), C.EX); if (p.pos === 'C') pr *= C.CM; if (p === jumper[ti]) pr *= C.JM; return [p, pr, ppg]; });
    const ps = rw.reduce((s, x) => s + x[1], 0);
    const sh = rw.map(([p, pr, ppg]) => [p, ((fbc[p.id] || 0) + C.K_SH * pr / ps) / ((opp[p.id] || 0) + C.K_SH), ppg]);
    const ss = sh.reduce((s, x) => s + x[1], 0);
    const team = ti ? home : away, oppT = ti ? away : home, me = jumper[ti], them = jumper[1 - ti];
    const rec = (j) => { const r = jrec[j.id] || [0, 0]; return `${r[1]}/${r[0]}`; }, tr = (t) => { const r = trec[t] || [0, 0]; return `${r[1]}/${r[0]}`; };
    sh.forEach(([p, v, ppg]) => { const r = raw[p.id] || [0, 0]; out.push([code, ti ? 'home' : 'away', p.n, (pt * v / ss * 100).toFixed(1), (ti ? 1 - pTip0 : pTip0).toFixed(2), p === me ? 'J' : '', ppg.toFixed(1), r[0], r[1],
      team, oppT, tr(team), tr(oppT), me.n, rec(me), them.n, rec(them)].join('|')); });
  });
}
return (`###FBP\ncode|side|player|prob|tipwin|jumper|ppg|starts|fb|team|opp|team_tips|opp_tips|jumper_name|jumper_tips|opp_jumper|opp_jumper_tips\n${out.join('\n')}\n###FBINFO\nnew_games|${todo.length}`);
