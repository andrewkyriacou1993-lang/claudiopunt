// page: https://www.espn.com/nba/   (built-in browser, javascript_tool; read-only public ESPN APIs)
// Player history for tonight's props: hit rates over each line (last 5 / last 10 / this season / last season),
// record against tonight's opponent (since 2023-24) and the lines/odds posted in his earlier games (DraftKings via ESPN).
// Box scores are cached in this page's IndexedDB ('nbabt' -> kv 'box', 'props', 'games'); only new games are fetched.
// Input: QUERY lines "player|team|opp|stat|line[,line...]" from hist_query.py (model spelling; one row per player+stat)
// Output: ###OPP team|pos|Points|Rebounds|Assists|min  (what each defence allows per minute to G/F/C vs league; 1.08 = 8% more)
//         ###FORM name|team|n|ws75|wm75|ws94|wm94|wa94   this season's recency-weighted sums for props_model.py: a game k games
//           ago weighs 0.75^k (minutes) or 0.94^k (assists rate); ws = sum of weights, wm = weighted minutes, wa = weighted assists
//         ###HIST player|stat|line|l5|l10|ssn|prev|vs|vsvals|posted   (QUERY may be empty: then only ###OPP)
//   l5/l10/ssn/prev/vs = "hits/games" over that line; vsvals = his numbers vs this opponent, latest first;
//   posted = his last posted lines for this stat "line@overodds>actual" latest first, plus "beat k/n" this season
const TODAY = "/*DATE*/";            // AEDT date of tonight's slate, YYYY-MM-DD
const QUERY = `/*QUERY*/`;
const SEASON_START = { 2024: "20231024", 2025: "20241022", 2026: "20251021", 2027: "20261020" };
const W = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
const IDB = {
  db: null,
  async open() { if (this.db) return this.db; return this.db = await new Promise((res, rej) => { const q = indexedDB.open("nbabt", 1); q.onupgradeneeded = () => q.result.createObjectStore("kv"); q.onsuccess = () => res(q.result); q.onerror = rej; }); },
  async get(k) { const db = await this.open(); return new Promise(r => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => r(q.result); }); },
  async set(k, v) { const db = await this.open(); return new Promise(r => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = r; }); }
};
const J = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
const season = d => { const y = +d.slice(0, 4), m = +d.slice(4, 6); return m >= 7 ? y + 1 : y; };
const ABBR = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHX: "PHO", BKN: "BRK", CHA: "CHO" };
const ab = a => ABBR[a] || a;

// ---- games list (id, date, home, away), cached; fill in any dates since the last cached one
let games = (await IDB.get("games")) || (() => { try { const g = JSON.parse(localStorage.__BT_games || "{}"); const o = {}; for (const x of Object.values(g)) o[x.id] = { id: x.id, date: x.date, home: x.home, away: x.away }; return o; } catch (e) { return {}; } })();
const box = (await IDB.get("box")) || {}, props = (await IDB.get("props")) || {};
const end = new Date(TODAY + "T00:00:00Z"); end.setUTCDate(end.getUTCDate() - 1);           // US date of yesterday's AEDT slate
const known = Object.values(games).map(g => g.date).sort();
let d = new Date(Date.UTC(+(known.at(-1) || SEASON_START[2024]).slice(0, 4), +(known.at(-1) || SEASON_START[2024]).slice(4, 6) - 1, +(known.at(-1) || SEASON_START[2024]).slice(6, 8)));
for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  const sb = await J(`${W}/scoreboard?dates=${ymd(d)}`);
  for (const e of (sb && sb.events) || []) {
    if (!(e.status && e.status.type && e.status.type.completed)) continue;
    const c = e.competitions[0], h = c.competitors.find(x => x.homeAway === "home"), a = c.competitors.find(x => x.homeAway === "away");
    if (e.season && e.season.type !== 2) continue;                                            // regular season only
    games[e.id] = { id: e.id, date: ymd(d), home: h.team.abbreviation, away: a.team.abbreviation };   // raw ESPN codes, mapped on output
  }
}
await IDB.set("games", games);
// ---- box scores and posted lines for games not cached yet
const parse = r => { const out = []; for (const t of (r && r.boxscore && r.boxscore.players) || []) { const st = t.statistics && t.statistics[0]; if (!st) continue; const K = st.keys;
  for (const a of st.athletes) { const s = a.stats || [], v = k => { const i = K.indexOf(k); return i < 0 ? 0 : parseInt(s[i]) || 0; };
    out.push([a.athlete.id, a.athlete.displayName, t.team.abbreviation, a.starter ? 1 : 0, a.didNotPlay || !s.length ? 1 : 0, v("minutes"), v("points"), v("rebounds"), v("assists"), (a.athlete.position || {}).abbreviation || "", v("threePointFieldGoalsMade-threePointFieldGoalsAttempted")]); } } return out; };
const TY = { "Total Points": "Points", "Total Rebounds": "Rebounds", "Total Assists": "Assists", "Total Points, Rebounds, and Assists": "PRA" };
const need = Object.values(games).filter(g => !box[g.id]).map(g => g.id);
let k = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (k < need.length) { const id = need[k++];
  const b = parse(await J(`${W}/summary?event=${id}`)); if (b.length) box[id] = b;
  if (!props[id] && season(games[id].date) >= 2027) {                                         // DraftKings lines (ESPN feed) for this season
    const r = await J(`${CORE}/events/${id}/competitions/${id}/odds/100/propBets?limit=1000`); const by = {}, rows = [];
    for (const it of (r && r.items) || []) { const st = TY[(it.type || {}).name]; if (!st) continue; const ath = it.athlete.$ref.match(/athletes\/(\d+)/)[1]; (by[st + "|" + ath] = by[st + "|" + ath] || []).push(it); }
    for (const [kk, L] of Object.entries(by)) { const [st, ath] = kk.split("|"); let best = null;
      for (let i = 0; i + 1 < L.length; i += 2) { const a = L[i], c = L[i + 1], ln = (a.current || {}).target && a.current.target.value; if (ln == null || c.current.target.value !== ln) continue;
        const row = [st, ath, ln, +a.odds.decimal.value, +c.odds.decimal.value], dd = Math.abs(1 / row[3] - 1 / row[4]); if (!best || dd < best.dd) best = { dd, row }; }
      if (best) rows.push(best.row); }
    if (rows.length) props[id] = rows;
  } } }));
await IDB.set("box", box); await IDB.set("props", props);

// ---- per-player history
const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const H = {};                                                                                  // ath -> [{date, s, opp, min, v:{Points..}}]
const nameOf = {}, teamOf = {};
const G = Object.values(games).filter(g => box[g.id]).sort((a, b) => a.date.localeCompare(b.date));
for (const g of G) for (const r of box[g.id]) {
  const [ath, name, team0, , dnp, min, p, rb, as] = r, team = ab(team0); if (name) nameOf[ath] = name; teamOf[ath] = team;
  if (dnp || !(min > 0)) continue;
  (H[ath] = H[ath] || []).push({ id: g.id, date: g.date, s: season(g.date), opp: ab(team0 === g.home ? g.away : g.home), v: { Points: p, Rebounds: rb, Assists: as, PRA: p + rb + as } });
}
const byName = {}; for (const [ath, n] of Object.entries(nameOf)) (byName[norm(n)] = byName[norm(n)] || []).push(ath);
const find = (name, team) => { const c = byName[norm(name)] || []; if (c.length === 1) return c[0]; const t = c.find(a => teamOf[a] === team); if (t) return t;
  // initial + surname fallback within the team
  const parts = norm(name).split(" "), sur = parts.at(-1); const m = Object.keys(nameOf).filter(a => teamOf[a] === team && norm(nameOf[a]).split(" ").at(-1) === sur); return m.length === 1 ? m[0] : null; };
const S = season(TODAY.replace(/-/g, ""));
// ---- opponent factors: per-minute points / rebounds / assists each team allows to guards, forwards and centres,
//      relative to league average; this season shrunk to last season with 1,500 minutes of weight (backtest settings)
const P3 = p => (p || "F")[0] === "G" ? "G" : (p || "F")[0] === "C" ? "C" : "F";
const ST3 = { Points: 6, Rebounds: 7, Assists: 8 }, acc = {}, lgA = {};
const blank = () => ({ min: 0, Points: 0, Rebounds: 0, Assists: 0 });
for (const g of G) { const s = season(g.date); if (s < S - 1) continue;
  for (const r of box[g.id]) { if (r[4] || !(r[5] > 0)) continue; const def = ab(r[2] === g.home ? g.away : g.home), pos = P3(r[9]);
    for (const k of [s + "|" + def + "|" + pos, s + "||" + pos]) { const o = acc[k] = acc[k] || blank(); o.min += r[5]; for (const st in ST3) o[st] += r[ST3[st]]; } } }
const oppOut = [];
for (const def of [...new Set(Object.keys(acc).map(k => k.split("|")[1]).filter(Boolean))].sort())
  for (const pos of ["G", "F", "C"]) {
    const cur = acc[S + "|" + def + "|" + pos] || blank(), prv = acc[(S - 1) + "|" + def + "|" + pos] || blank();
    const L = (acc[S + "||" + pos] || blank()).min > 2000 ? acc[S + "||" + pos] : acc[(S - 1) + "||" + pos], Lp = acc[(S - 1) + "||" + pos];
    const f = st => { if (!L) return 1; const lr = L[st] / L.min, lrp = Lp ? Lp[st] / Lp.min : lr; const prior = prv.min > 500 ? (prv[st] / prv.min) / lrp : 1;
      return ((cur[st] / lr) + 1500 * prior) / (cur.min + 1500); };
    oppOut.push([def, pos, f("Points").toFixed(3), f("Rebounds").toFixed(3), f("Assists").toFixed(3), Math.round(cur.min)].join("|"));
  }
// ---- recent form (this season, games played only, latest weighs most; trend_backtest.js 2026-10-29)
const FM = {};
for (const g of G) { if (season(g.date) !== S) continue;
  for (const r of box[g.id]) { if (r[4] || !(r[5] > 0)) continue; const f = FM[r[0]] = FM[r[0]] || { n: 0, ws75: 0, wm75: 0, ws94: 0, wm94: 0, wa94: 0 };
    f.n++; f.ws75 = f.ws75 * 0.75 + 1; f.wm75 = f.wm75 * 0.75 + r[5]; f.ws94 = f.ws94 * 0.94 + 1; f.wm94 = f.wm94 * 0.94 + r[5]; f.wa94 = f.wa94 * 0.94 + r[8]; } }
const formOut = Object.entries(FM).map(([ath, f]) => [nameOf[ath], teamOf[ath], f.n, f.ws75.toFixed(3), f.wm75.toFixed(1), f.ws94.toFixed(3), f.wm94.toFixed(1), f.wa94.toFixed(1)].join("|"));
const out = [];
for (const q of QUERY.split("\n").map(s => s.trim()).filter(Boolean)) {
  const [player, team, opp, stat, lines] = q.split("|"); const ath = find(player, team); if (!ath) { out.push([player, stat, "", "nomatch"].join("|")); continue; }
  const hs = (H[ath] || []).slice().reverse();                                                 // latest first
  const cur = hs.filter(h => h.s === S), prv = hs.filter(h => h.s === S - 1), vs = hs.filter(h => h.opp === opp).slice(0, 8);
  const posted = []; for (const h of hs) { const L = (props[h.id] || []).find(x => x[1] === ath && x[0] === stat); if (L) posted.push({ s: h.s, l: +L[2], o: L[3], a: h.v[stat] }); }
  const pc = posted.filter(p => p.s === S), beat = pc.filter(p => p.a > p.l).length;
  const pstr = posted.slice(0, 5).map(p => `${p.l}@${(+p.o).toFixed(2)}>${p.a}`).join(" ") + (pc.length ? ` beat ${beat}/${pc.length}` : "");
  for (const ln of lines.split(",").map(Number)) {
    const hit = arr => arr.filter(h => h.v[stat] > ln).length + "/" + arr.length;
    out.push([player, stat, ln, hit(cur.slice(0, 5)), hit(cur.slice(0, 10)), hit(cur), hit(prv), hit(vs), vs.map(h => h.v[stat]).join(" "), pstr].join("|"));
  }
}
"###OPP\nteam|pos|Points|Rebounds|Assists|min_this_season\n" + oppOut.join("\n") + "\n###FORM\nname|team|n|ws75|wm75|ws94|wm94|wa94\n" + formOut.join("\n") + "\n###HIST\nplayer|stat|line|l5|l10|ssn|prev|vs|vsvals|posted\n" + out.join("\n");
