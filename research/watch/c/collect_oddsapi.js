// page: any https page (built-in browser, javascript_tool; The Odds API allows browser calls). No login, read-only.
// NBA game lines + player props from The Odds API (Pinnacle, DraftKings, FanDuel, BetMGM, BetRivers, Bovada, BetOnline,
// Caesars, Unibet + the Australian books) for one AEDT slate date, live or historical.
//   /*DATE*/  AEDT slate date YYYY-MM-DD (its games tip ~7am-3pm AEDT = D-1 20:00Z .. D 05:00Z)
//   /*KEY*/   API key
//   /*AT*/    "" for live prices, or an ISO time (e.g. 2026-11-08T23:35:00Z) for the historical snapshot nearest before it
//             (historical calls cost 10x: ~90 credits for game lines + ~240 per game for props)
// Output (one string; save as raw/oapi_<D>_<HHMM>.txt, or raw/oapih_<D>_<label>.txt for a historical one):
//   ###OAPI_META key|value            (at, snapshot_ts, credits_used_total, credits_this_run, games)
//   ###OAPI_EVENTS game|tip                  (the slate: AWAY@HOME and tip-off in Z - make_inputs.py --oapi builds the slate from it)
//   ###OAPI_GAMES book|game|mkt|line|a|b   game = AWAY@HOME (B-Ref codes); mkt ml (a away, b home) | sp (line = home handicap;
//                                          a away, b home) | tot (a over, b under)
//   ###OAPI_PROPS book|game|player|stat|line|over|under      main two-way lines (stat Points/Rebounds/Assists/Threes/PRA/Steals/Blocks)
//   ###OAPI_ALT   book|game|player|stat|rungs                 alternate lines, one-sided: "line=over_odds line=over_odds ..."
const DATE = "/*DATE*/", KEY = "/*KEY*/", AT = "/*AT*/";
const REGIONS = "us,eu,au";
const GAME_MK = "h2h,spreads,totals";
const PROP_MK = "player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_steals,player_blocks,player_points_alternate,player_rebounds_alternate,player_assists_alternate,player_threes_alternate";
const STAT = { player_points: "Points", player_rebounds: "Rebounds", player_assists: "Assists", player_threes: "Threes", player_points_rebounds_assists: "PRA",
  player_steals: "Steals", player_blocks: "Blocks", player_points_alternate: "Points", player_rebounds_alternate: "Rebounds", player_assists_alternate: "Assists", player_threes_alternate: "Threes" };
const ABBR = { "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BRK", "Charlotte Hornets": "CHO", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET", "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC", "LA Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM", "Miami Heat": "MIA", "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN", "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC", "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHO", "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS" };
const base = "https://api.the-odds-api.com/v4" + (AT ? "/historical" : "") + "/sports/basketball_nba";
const q = (p) => Object.entries(p).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
let used = "", spent = 0;
async function J(url) { const r = await fetch(url); used = r.headers.get("x-requests-used") || used; spent += +(r.headers.get("x-requests-last") || 0);
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 200)); const j = await r.json(); return AT ? (j.data !== undefined ? j : { data: j }) : { data: j }; }
// slate window: AEDT date D = US games from D-1 20:00Z to D 05:00Z
const d0 = new Date(DATE + "T00:00:00Z"); const lo = new Date(d0.getTime() - 4 * 3600e3), hi = new Date(d0.getTime() + 5 * 3600e3);
const evq = AT ? { apiKey: KEY, date: AT } : { apiKey: KEY };
const EV = (await J(`${base}/events?${q(evq)}`));
const events = (EV.data || []).filter(e => { const t = new Date(e.commence_time); return t >= lo && t <= hi; });
const code = e => `${ABBR[e.away_team] || e.away_team}@${ABBR[e.home_team] || e.home_team}`;
const G = [], P = [], A = [];
// game lines (one call)
const gl = await J(`${base}/odds?${q(Object.assign({ apiKey: KEY, regions: REGIONS, markets: GAME_MK, oddsFormat: "decimal" }, AT ? { date: AT } : {}))}`);
const snapshot_ts = gl.timestamp || new Date().toISOString();
for (const e of gl.data || []) { if (!events.find(x => x.id === e.id)) continue; const g = code(e);
  for (const b of e.bookmakers || []) for (const m of b.markets || []) {
    const o = m.outcomes || []; const away = o.find(x => x.name === e.away_team), home = o.find(x => x.name === e.home_team);
    if (m.key === "h2h" && away && home) G.push([b.key, g, "ml", "", away.price, home.price].join("|"));
    else if (m.key === "spreads" && away && home) G.push([b.key, g, "sp", home.point, away.price, home.price].join("|"));
    else if (m.key === "totals") { const ov = o.find(x => x.name === "Over"), un = o.find(x => x.name === "Under"); if (ov && un) G.push([b.key, g, "tot", ov.point, ov.price, un.price].join("|")); } } }
// props (one call per game)
for (const e of events) {
  let pj; try { pj = await J(`${base}/events/${e.id}/odds?${q(Object.assign({ apiKey: KEY, regions: REGIONS, markets: PROP_MK, oddsFormat: "decimal" }, AT ? { date: AT } : {}))}`); } catch (err) { continue; }
  const g = code(e); const d = pj.data || {};
  for (const b of d.bookmakers || []) for (const m of b.markets || []) { const st = STAT[m.key]; if (!st) continue;
    const by = {};
    for (const o of m.outcomes || []) { const k = o.description + "|" + o.point; (by[k] = by[k] || { player: o.description, line: o.point })[o.name] = o.price; }
    if (m.key.endsWith("_alternate")) { const lad = {};
      for (const r of Object.values(by)) if (r.Over != null) (lad[r.player] = lad[r.player] || []).push(`${r.line}=${r.Over}`);
      for (const [pl, rungs] of Object.entries(lad)) A.push([b.key, g, pl, st, rungs.join(" ")].join("|")); }
    else for (const r of Object.values(by)) if (r.Over != null && r.Under != null) P.push([b.key, g, r.player, st, r.line, r.Over, r.Under].join("|")); } }
["###OAPI_META", `at|${AT || "live"}`, `snapshot_ts|${snapshot_ts}`, `credits_used_total|${used}`, `credits_this_run|${spent}`, `games|${events.map(code).join(",")}`,
 "###OAPI_EVENTS", "game|tip", ...events.map(e => `${code(e)}|${e.commence_time}`),
 "###OAPI_GAMES", "book|game|mkt|line|a|b", ...G, "###OAPI_PROPS", "book|game|player|stat|line|over|under", ...P, "###OAPI_ALT", "book|game|player|stat|rungs", ...A].join("\n")
