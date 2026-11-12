// page: https://www.tab.com.au/sports/betting/Basketball/competitions/NBA   (read-only, logged out; public TAB API)
// TAB posts two-sided player POINTS lines only (rebounds/assists/PRA are "X+" milestones, skipped).
// Output: ###BOOKS  book|game|mkt|player|line|a|b  (same compact format as collect_betr.js)
const DATE = "/*DATE*/";
const BOOK = "TAB";
const ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BRK","Charlotte Hornets":"CHO","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","LA Lakers":"LAL","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHO","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"};
const BASE = "https://api.beta.tab.com.au/v1/tab-info-service/sports/Basketball/competitions/NBA/matches";
// TAB's page wraps fetch() with bot protection that sometimes refuses; plain XHR is reliable
const get = (u) => new Promise(res => { const q = new XMLHttpRequest(); q.open("GET", u); q.setRequestHeader("accept", "application/json");
  q.onload = () => { try { res(q.status === 200 ? JSON.parse(q.responseText) : null); } catch (e) { res(null); } }; q.onerror = () => res(null); q.send(); });
const aedtDate = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const BEST = new Map();
const put = (key, row) => { const d = Math.abs(1 / row[5] - 1 / row[6]); const c = BEST.get(key); if (!c || d < c.d) BEST.set(key, { d, row }); };
const full = c => decodeURIComponent(((c.image || [])[0] || {}).url || "").split("/").pop().replace(/\.svg$/, "");
const list = await get(BASE + "?jurisdiction=NSW&numTopMarkets=5");
for (const mt of (list && list.matches) || []) {
  if (aedtDate(mt.startTime) !== DATE || (mt.contestants || []).length !== 2) continue;
  const hc = mt.contestants.find(c => c.isHome), ac = mt.contestants.find(c => !c.isHome);
  const home = full(hc), away = full(ac);
  const code = (ABBR[away] || away) + "@" + (ABBR[home] || home);
  const j = await get(`${BASE}/${encodeURIComponent(mt.name)}/markets?jurisdiction=NSW`);
  for (const m of (j && j.markets) || []) {
    const ps = (m.propositions || []).filter(p => p.isOpen !== false && p.returnWin);
    if (m.betOption === "Head To Head") {
      const a = ps.find(p => p.name === ac.name), h = ps.find(p => p.name === hc.name);
      if (a && h) put(code + "|ml", [BOOK, code, "ml", "", "", a.returnWin, h.returnWin]);
    } else if (m.betOption === "Line") {
      const x = ps.map(p => [p, p.name.match(/^(.*) ([+-][\d.]+)$/)]).filter(y => y[1]);
      const a = x.find(y => y[1][1] === ac.name), h = x.find(y => y[1][1] === hc.name);
      if (a && h) put(code + "|sp", [BOOK, code, "sp", "", +h[1][2], a[0].returnWin, h[0].returnWin]);
    } else if (m.betOption === "Total Points Over/Under") {
      const o = ps.find(p => /^Over /.test(p.name)), u = ps.find(p => /^Under /.test(p.name));
      if (o && u) put(code + "|tot", [BOOK, code, "tot", "", +o.name.split(" ")[1], o.returnWin, u.returnWin]);
    } else if (m.betOption === "Player Points") {
      const x = ps.map(p => [p, p.name.match(/^(.*) (Over|Under) ([\d.]+) Pts$/)]).filter(y => y[1]);
      const o = x.find(y => y[1][2] === "Over"), u = x.find(y => y[1][2] === "Under");
      if (o && u && o[1][3] === u[1][3]) put(`${code}|Points|${o[1][1]}`, [BOOK, code, "Points", o[1][1].trim(), +o[1][3], o[0].returnWin, u[0].returnWin]);
    }
  }
}
return ("###BOOKS\n" + [...BEST.values()].map(x => x.row.join("|")).join("\n"));
