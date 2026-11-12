// page: https://www.ladbrokes.com.au/sports/basketball/usa/nba   (read-only, logged out; public Entain API)
// Ladbrokes and Neds share the Entain platform and usually post the same NBA prices.
// Output: ###BOOKS  book|game|mkt|player|line|a|b  (same compact format as collect_betr.js)
const DATE = "/*DATE*/";
const BOOK = "Ladbrokes";
const ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BRK","Charlotte Hornets":"CHO","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","LA Lakers":"LAL","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHO","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"};
const H = { headers: { "content-type": "application/json" } };
const get = async (p) => fetch("https://api.ladbrokes.com.au/v2/sport/" + p, H).then(r => r.ok ? r.json() : null).catch(() => null);
const aedtDate = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const dec = o => o && o.odds ? +(1 + o.odds.numerator / o.odds.denominator).toFixed(2) : null;
const BEST = new Map(), ALT = {}, GALT = {}, FB = [];
const put = (key, row) => { const d = Math.abs(1 / row[5] - 1 / row[6]); const c = BEST.get(key); if (!c || d < c.d) BEST.set(key, { d, row }); };
const STAT = { "Player Points O/U": "Points", "Player Rebounds O/U": "Rebounds", "Player Assists O/U": "Assists",
  "Player Points, Rebounds & Assists O/U": "PRA" };
const list = await get("event-request?category_ids=%5B%223c34d075-dc14-436d-bfc4-9272a49c2b39%22%5D");
const evs = Object.values(list.events || {}).filter(e => (e.competition || {}).name === "NBA" && / vs /.test(e.name) && aedtDate(e.advertised_start) === DATE);
for (const ev of evs) {
  const [home, away] = ev.name.split(" vs ").map(s => s.trim());
  const code = (ABBR[away] || away) + "@" + (ABBR[home] || home);
  const j = await get("event-card?id=" + ev.id);
  if (!j) continue;
  const price = {};
  for (const [k, v] of Object.entries(j.prices || {})) price[k.split(":")[0]] = dec(v);
  const en = j.entrants || {};
  const ents = m => (m.entrant_ids || []).map(id => ({ name: (en[id] || {}).name, p: price[id] })).filter(x => x.p);
  const mk = Object.values(j.markets || {}).filter(m => m.visible !== false);
  const h2h = mk.find(m => m.name === "Head To Head");
  let homeFav = null;
  if (h2h) {
    const e = ents(h2h), a = e.find(x => x.name === away), h = e.find(x => x.name === home);
    if (a && h) { put(code + "|ml", [BOOK, code, "ml", "", "", a.p, h.p]); homeFav = h.p < a.p; }
  }
  // the main line / total have their own market type; alternates share another
  const mainOf = name => {
    const ms = mk.filter(m => m.name === name), n = {};
    ms.forEach(m => n[m.market_type_id] = (n[m.market_type_id] || 0) + 1);
    const solo = ms.filter(m => n[m.market_type_id] === 1);
    return solo.length === 1 ? solo : ms;
  };
  for (const m of mainOf("Line")) {
    const e = ents(m), a = e.find(x => x.name === away), h = e.find(x => x.name === home);
    if (a && h && homeFav !== null) put(code + "|sp", [BOOK, code, "sp", "", homeFav ? -Math.abs(m.handicap) : Math.abs(m.handicap), a.p, h.p]);
  }
  for (const m of mainOf("Total")) {
    const e = ents(m), o = e.find(x => x.name === "Over"), u = e.find(x => x.name === "Under");
    if (o && u) put(code + "|tot", [BOOK, code, "tot", "", m.handicap, o.p, u.p]);
  }
  for (const m of mk) {
    const x = m.name.match(/^(Player .*O\/U) - (.+)$/); if (!x || !STAT[x[1]]) continue;
    const e = ents(m), o = e.find(y => y.name === "Over"), u = e.find(y => y.name === "Under");
    if (o && u) put(`${code}|${STAT[x[1]]}|${x[2]}`, [BOOK, code, STAT[x[1]], x[2].trim(), m.handicap, o.p, u.p]);
  }
  // alternate totals: every full-game "Total" market (the main one included), one-sided rungs
  for (const m of mk.filter(m => m.name === "Total")) for (const e of ents(m)) {
    const sd = e.name === "Over" ? "Over" : e.name === "Under" ? "Under" : null;
    if (sd && m.handicap != null) (GALT[code + "|tot|" + sd] = GALT[code + "|tot|" + sd] || []).push(Math.abs(m.handicap) + "=" + e.p);
  }
  // first basket (posted closer to tip-off): one row per player
  for (const m of mk.filter(m => /^first basket( scorer)?$/i.test(m.name))) for (const e of ents(m)) if (e.name) FB.push([BOOK, code, e.name.replace(/\s*\(.*\)$/, "").trim(), e.p, ""].join("|"));
  // alternate lines: "To Score 25+ Points", "To Have 10+ Rebounds", "To Have 8+ Assists", "Player to have 40+ PRA"
  for (const m of mk) {
    const x = m.name.match(/^(?:To Score|To Have|Player to have) (\d+)\+ (Points|Rebounds|Assists|PRA)$/); if (!x) continue;
    for (const e of ents(m)) if (e.name) { const k = code + "|" + x[2] + "|" + e.name.replace(/\s*\(.*\)$/, "").trim(); (ALT[k] = ALT[k] || []).push((+x[1] - 0.5) + "=" + e.p); }
  }
}
return ("###BOOKS\n" + [...BEST.values()].map(x => x.row.join("|")).join("\n") + "\n###ALT\n" + Object.entries(ALT).map(([k, v]) => BOOK + "|" + k.split("|")[0] + "|" + k.split("|")[1] + "|" + k.split("|")[2] + "|" + v.join(" ")).join("\n") + "\n###GALT\n" + Object.entries(GALT).map(([k, v]) => BOOK + "|" + k + "|" + v.join(" ")).join("\n") + "\n###FB\n" + FB.join("\n"));
