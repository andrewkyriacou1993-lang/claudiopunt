// page: https://www.betr.com.au/   (read-only, logged out; uses Betr's public BlueBet API)
// NBA prices for one AEDT date. Output (compact, one row per market, both sides):
// ###BOOKS  book|game|mkt|player|line|a|b
//   game = AWAY@HOME (B-Ref codes); mkt: ml (a=away, b=home), sp (line = HOME handicap; a=away, b=home),
//   tot (a=over, b=under), Points/Rebounds/Assists/PRA (a=over, b=under). Main line only (most even prices).
const DATE = "/*DATE*/";
const BOOK = "Betr";
const ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BRK","Charlotte Hornets":"CHO","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","LA Lakers":"LAL","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHO","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"};
const API = "https://web20-api.bluebet.com.au";
const get = async (p) => fetch(API + p, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() : null).catch(() => null);
const aedtDate = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
// keep, per key, the two-sided quote whose prices are most even (the bookmaker's main line)
const BEST = new Map();
const put = (key, row) => { const d = Math.abs(1 / row[5] - 1 / row[6]); const c = BEST.get(key); if (!c || d < c.d) BEST.set(key, { d, row }); };
const top = await get("/MasterCategory?EventTypeId=107&WithLevelledMarkets=true&MasterCategoryId=18");
const cat = top.MasterCategories[0].Categories.find(c => c.CategoryName === "NBA");
const games = cat.MasterEvents.filter(m => / @ /.test(m.MasterEventName) && aedtDate(m.MaxAdvertisedStartTime) === DATE);
const STAT = { G382: "Points", G383: "Assists", G384: "Rebounds" };
for (const g of games) {
  const [away, home] = g.MasterEventName.split(" @ ").map(s => s.trim());
  const code = (ABBR[away] || away) + "@" + (ABBR[home] || home);
  const e = await get(`/MasterEvent?MasterEventId=${g.MasterEventId}&WithLevelledMarkets=true`);
  if (!e) continue;
  for (const ev of e.Events || []) {
    const n = ev.EventName || "", os = ev.Outcomes || [];
    if (/^Money Line \(/.test(n)) {
      const a = os.find(o => o.OutcomeName.trim() === away), h = os.find(o => o.OutcomeName.trim() === home);
      if (a && h) put(code + "|ml", [BOOK, code, "ml", "", "", a.Price, h.Price]);
    } else if (/^Point Spread /.test(n)) {
      const p = os.map(o => o.OutcomeName.match(/^(.*) ([+-][\d.]+)$/)).filter(Boolean);
      const a = p.find(m => m[1].trim() === away), h = p.find(m => m[1].trim() === home);
      if (a && h) put(code + "|sp", [BOOK, code, "sp", "", +h[2], os[p.indexOf(a)].Price, os[p.indexOf(h)].Price]);
    } else if (/^Total Points Over\/Under /.test(n)) {
      const o = os.find(x => /^Over /.test(x.OutcomeName)), u = os.find(x => /^Under /.test(x.OutcomeName));
      if (o && u) put(code + "|tot", [BOOK, code, "tot", "", +o.OutcomeName.split(" ")[1], o.Price, u.Price]);
    }
  }
  for (const [gc, stat] of Object.entries(STAT)) {
    const p = await get(`/MasterEvent?MasterEventId=${g.MasterEventId}&GroupTypeCode=${gc}`);
    for (const ev of (p && p.Events) || []) {
      const q = (ev.Outcomes || []).map(o => [o, o.OutcomeName.match(/^(.*) - (Over|Under) ([\d.]+)$/)]).filter(x => x[1]);
      const o = q.find(x => x[1][2] === "Over"), u = q.find(x => x[1][2] === "Under");
      if (o && u && o[1][3] === u[1][3]) put(`${code}|${stat}|${o[1][1]}`, [BOOK, code, stat, o[1][1].trim(), +o[1][3], o[0].Price, u[0].Price]);
    }
  }
}
"###BOOKS\n" + [...BEST.values()].map(x => x.row.join("|")).join("\n");
