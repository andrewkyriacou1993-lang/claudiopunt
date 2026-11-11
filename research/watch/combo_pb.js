// page: https://pointsbet.com.au/sports/basketball/NBA   (built-in browser, javascript_tool; read-only, logged out)
// Same-player combo prices at PointsBet. QUERY = the full contents of raw/combo_<D>.txt (the ###CMB block from collect_combo.js).
// For each player's combos it finds the legs in PointsBet's alternate markets ("X To Score 15+ Points", "To Get 6+ Rebounds",
// "To Get 4+ Assists", "To Get 2+ Three Pointers") and asks PointsBet's public SGM pricing endpoint for the combined price
// (POST /api/v2/sgm/price: a price quote only; nothing is placed, nothing goes on a bet slip, no login).
// Quoted per game (MAX_PER_GAME): pts/reb/ast triples first, then the most achievable combos by our game-log chance.
// Output: ###CMBQ book|code|player|spec|leg_prices|sgm_price|log_chance|hits10|lift|side|opp|min10|games|opp_fac
//   (leg_prices ';'-joined in spec order; the last eight fields are echoed from QUERY so the pricer needs only this output)
const QRAW = `/*QUERY*/`;
const MAX_PER_GAME = 60;
const ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BRK","Charlotte Hornets":"CHO","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","LA Lakers":"LAL","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHO","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"};
const API = "https://api.au.pointsbet.com/api";
const get = async (p) => fetch(API + p).then(r => r.ok ? r.json() : null).catch(() => null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").replace(/ (jr|sr|ii|iii|iv)$/, "").trim();
const RX = { P: [/^Alternate Points$/, /^(.*) To Score (\d+)\+ Points$/], R: [/^Alternate Rebounds$/, /^(.*) To Get (\d+)\+ Rebounds$/],
             A: [/^Alternate Assists$/, /^(.*) To Get (\d+)\+ Assists$/], T: [/^Alternate Threes$/, /^(.*) To Get (\d+)\+ Three Pointers$/] };
const MAIN = { P: "Player Points Over/Under", R: "Player Rebounds Over/Under", A: "Player Assists Over/Under", T: "Player 3-Pointers Made" };
const parse = spec => [...spec.matchAll(/([PRAT])(\d+)/g)].map(m => m[1] + m[2]);
// the ###CMB lines: code|side|player|n|min10|proj_min|opp|opp_fac|combos
const rows = QRAW.split("\n").map(x => x.trim()).filter(l => /^[A-Z]{3}@[A-Z]{3}\|/.test(l)).map(l => { const f = l.split("|"); return { code: f[0], player: f[2], info: [f[1], f[6], f[4], f[3], f[7]], combos: (f[8] || "").split(",").filter(Boolean).map(c => { const [s, q, h, lf] = c.split(":"); return { spec: s, q: +q / 100, h: h || "", lift: lf || "" }; }) }; });
const comp = await get("/v2/competitions/7176/events/featured?includeLive=false&page=1");
const evByCode = {};
for (const ev of (comp && comp.events) || []) if (ev.awayTeam) evByCode[(ABBR[ev.awayTeam] || ev.awayTeam) + "@" + (ABBR[ev.homeTeam] || ev.homeTeam)] = ev;
const out = [], miss = [], Ms = [];
for (const code of [...new Set(rows.map(r => r.code))]) {
  const ev = evByCode[code]; if (!ev) { miss.push(code); continue; }
  const e = await get("/mes/v3/events/" + ev.key); if (!e) { miss.push(code); continue; }
  const legs = {};   // legs[normName][P15] = [marketKey, outcomeKey, price]
  for (const m of e.fixedOddsMarkets || []) {
    if (m.isOpenForBetting === false || m.enableCorrelatedMulti === false) continue;
    for (const [k, [mr, orx]] of Object.entries(RX)) {
      if (!mr.test(m.eventName)) continue;
      for (const o of m.outcomes || []) { const x = o.isOpenForBetting !== false && o.name.match(orx); if (x) (legs[norm(x[1])] = legs[norm(x[1])] || {})[k + x[2]] = [m.key, o.key, o.price]; }
    }
  }
  // margin on the milestones: each two-way main line (no-vig) vs the milestone at the same number
  for (const [k, mn] of Object.entries(MAIN)) {
    const m = (e.fixedOddsMarkets || []).find(m => m.eventName === mn); if (!m) continue; const by = {};
    for (const o of m.outcomes || []) { const x = o.name.match(/^(.*) (Over|Under) ([\d.]+)$/); if (x) (by[x[1] + "|" + x[3]] = by[x[1] + "|" + x[3]] || {})[x[2]] = o.price; }
    for (const [key, v] of Object.entries(by)) { if (!v.Over || !v.Under) continue; const [pl, L] = key.split("|"); const ms = (legs[norm(pl)] || {})[k + Math.ceil(+L)]; if (!ms) continue;
      const nv = (1 / v.Over) / (1 / v.Over + 1 / v.Under), q = 1 / ms[2]; Ms.push((q - nv) / (q * (1 - q))); }
  }
  const names = Object.keys(legs);
  const who = (n) => { const w = norm(n); if (legs[w]) return legs[w]; const last = w.split(" ").pop(); const c = names.filter(x => x.split(" ").pop() === last && x[0] === w[0]); return c.length === 1 ? legs[c[0]] : null; };
  const cand = [];
  for (const r of rows.filter(r => r.code === code)) {
    const L = who(r.player); if (!L) { miss.push(r.player); continue; }
    for (const c of r.combos) {
      const sel = parse(c.spec).map(k => L[k]); if (sel.some(x => !x)) continue;
      cand.push({ r, c, sel, score: c.q + (sel.length === 3 && !/T/.test(c.spec) ? 1 : 0) });
    }
  }
  cand.sort((a, b) => b.score - a.score);
  const pick = cand.slice(0, MAX_PER_GAME);
  for (let i = 0; i < pick.length; i += 4) {
    const batch = pick.slice(i, i + 4);
    const res = await Promise.all(batch.map(x => fetch(API + "/v2/sgm/price", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ EventKey: String(ev.key), SelectedOutcomes: x.sel.map(s => ({ MarketKey: String(s[0]), OutcomeKey: String(s[1]) })) }) })
      .then(r => r.ok ? r.json() : null).catch(() => null)));
    res.forEach((j, k) => { const x = batch[k]; if (j && j.success && j.price) out.push(["PointsBet", code, x.r.player, x.c.spec, x.sel.map(s => s[2]).join(";"), j.price, Math.round(x.c.q * 100), x.c.h, x.c.lift, ...x.r.info].join("|")); });
    await sleep(150);
  }
}
"###CMBQ\nbook|code|player|spec|leg_prices|sgm_price|log_chance|hits10|lift|side|opp|min10|games|opp_fac\n" + out.join("\n") + "\n###CMBQINFO\nmissing|" + [...new Set(miss)].join(";") + "\nmargin|" + (Ms.length ? Ms.sort((a, b) => a - b)[Math.floor(Ms.length / 2)].toFixed(3) : "") + "\nmargin_n|" + Ms.length;
