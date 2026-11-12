// page: https://pointsbet.com.au/sports/basketball/NBA   (built-in browser, javascript_tool; read-only, logged out)
// Same-game multi prices. QUERY = the full contents of raw/sgm_query.txt (from sgm_query.py), lines "code|spec1|spec2":
//   spec: prop:<player>:<stat>:<Over/Under>:<line> | ml:<home/away> | spread:<home/away>:<line> | total:<Over/Under>:<line>
// For each pair it finds the two outcomes in PointsBet's markets and asks PointsBet's public SGM pricing endpoint for the
// combined price (POST /api/v2/sgm/price: a price quote only; nothing is placed, nothing is put on a bet slip, no login).
// Output: ###SGM code|spec1|spec2|price1|price2|sgm_price   (pairs PointsBet won't combine or can't find are left out)
const QRAW = `/*QUERY*/`;
const ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BRK","Charlotte Hornets":"CHO","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","LA Lakers":"LAL","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHO","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"};
const API = "https://api.au.pointsbet.com/api";
const get = async (p) => fetch(API + p).then(r => r.ok ? r.json() : null).catch(() => null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MKT = { Points: "Player Points Over/Under", Rebounds: "Player Rebounds Over/Under", Assists: "Player Assists Over/Under", PRA: "Player Pts + Rebs + Asts Over/Under" };
const norm = s => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").replace(/ (jr|sr|ii|iii|iv)$/, "").trim();
const Q = QRAW.split("\n").map(x => x.trim()).filter(Boolean).map(l => l.split("|"));
const codes = [...new Set(Q.map(q => q[0]))];
const comp = await get("/v2/competitions/7176/events/featured?includeLive=false&page=1");
const evByCode = {};
for (const ev of (comp && comp.events) || []) if (ev.awayTeam) evByCode[(ABBR[ev.awayTeam] || ev.awayTeam) + "@" + (ABBR[ev.homeTeam] || ev.homeTeam)] = ev;
const out = [];
for (const code of codes) {
  const ev = evByCode[code]; if (!ev) continue;
  const e = await get("/mes/v3/events/" + ev.key); if (!e) continue;
  const ms = (e.fixedOddsMarkets || []).filter(m => m.isOpenForBetting !== false);
  const find = (spec) => {
    const s = spec.split(":");
    const open = (m) => (m.outcomes || []).filter(o => o.isOpenForBetting !== false);
    if (s[0] === "ml") { const m = ms.find(m => m.eventName === "Moneyline"); const o = m && open(m).find(o => o.side === (s[1] === "home" ? "Home" : "Away")); return o && [m.key, o.key, o.price]; }
    if (s[0] === "spread") { const m = ms.find(m => m.eventName === "Point Spread"); const o = m && open(m).find(o => o.side === (s[1] === "home" ? "Home" : "Away") && Math.abs(o.points - +s[2]) < 0.01); return o && [m.key, o.key, o.price]; }
    if (s[0] === "total") { const m = ms.find(m => m.eventName === "Total"); const o = m && open(m).find(o => o.name.startsWith(s[1]) && Math.abs(o.points - +s[2]) < 0.01); return o && [m.key, o.key, o.price]; }
    if (s[0] === "prop") {
      const [, pl, stat, side, line] = s; const m = ms.find(m => m.eventName === MKT[stat]); if (!m) return null;
      const want = norm(pl), last = want.split(" ").pop();
      const cand = open(m).map(o => ({ o, x: o.name.match(/^(.*) (Over|Under) ([\d.]+)$/) })).filter(c => c.x && c.x[2] === side && Math.abs(+c.x[3] - +line) < 0.01);
      let c = cand.find(c => norm(c.x[1]) === want) || (cand.filter(c => norm(c.x[1]).split(" ").pop() === last && norm(c.x[1])[0] === want[0]).length === 1 ? cand.find(c => norm(c.x[1]).split(" ").pop() === last && norm(c.x[1])[0] === want[0]) : null);
      return c && [m.key, c.o.key, c.o.price];
    }
    return null;
  };
  const pairs = Q.filter(q => q[0] === code).map(q => ({ q, a: find(q[1]), b: find(q[2]) })).filter(x => x.a && x.b);
  for (let i = 0; i < pairs.length; i += 4) {
    const batch = pairs.slice(i, i + 4);
    const res = await Promise.all(batch.map(x => fetch(API + "/v2/sgm/price", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ EventKey: String(ev.key), SelectedOutcomes: [{ MarketKey: String(x.a[0]), OutcomeKey: String(x.a[1]) }, { MarketKey: String(x.b[0]), OutcomeKey: String(x.b[1]) }] }) })
      .then(r => r.ok ? r.json() : null).catch(() => null)));
    res.forEach((j, k) => { const x = batch[k]; if (j && j.success && j.price) out.push([code, x.q[1], x.q[2], x.a[2], x.b[2], j.price].join("|")); });
    await sleep(150);
  }
}
return ("###SGM\ncode|spec1|spec2|price1|price2|sgm_price\n" + out.join("\n"));
