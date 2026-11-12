// page: https://pointsbet.com.au/sports/basketball/NBA   (read-only, logged out; public PointsBet API)
// Output: ###BOOKS  book|game|mkt|player|line|a|b  (same compact format as collect_betr.js), ###ALT, ###GALT,
//         ###FB  book|game|player|odds|side  (first basket; side home/away)
const DATE = "/*DATE*/";
const BOOK = "PointsBet";
const ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BRK","Charlotte Hornets":"CHO","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","LA Lakers":"LAL","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHO","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"};
const API = "https://api.au.pointsbet.com/api";
const get = async (p) => fetch(API + p).then(r => r.ok ? r.json() : null).catch(() => null);
const aedtDate = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const BEST = new Map(), ALT = {}, GALT = {}, FB = [], TT = [], PBEST = new Map();
// two-stat markets (10 Nov 2026, Andrew): collected only -> ###PAIRS (nothing downstream reads it yet)
const PSTAT = { "Player Points + Rebounds Over/Under": "P+R", "Player Points + Assists Over/Under": "P+A", "Player Assists + Rebounds Over/Under": "R+A",
  "Player Rebounds + Assists Over/Under": "R+A", "Player Pts + Rebs Over/Under": "P+R", "Player Pts + Asts Over/Under": "P+A", "Player Rebs + Asts Over/Under": "R+A" };
const ALTS = { "Alternate Points": "Points", "Alternate Rebounds": "Rebounds", "Alternate Assists": "Assists", "Alternate Points + Rebounds + Assists": "PRA",
  "Alternate Threes": "Threes", "Alternate Steals": "Steals", "Alternate Blocks": "Blocks" };
const put = (key, row) => { const d = Math.abs(1 / row[5] - 1 / row[6]); const c = BEST.get(key); if (!c || d < c.d) BEST.set(key, { d, row }); };
const STAT = { "Player Points Over/Under": "Points", "Player Rebounds Over/Under": "Rebounds",
  "Player Assists Over/Under": "Assists", "Player Pts + Rebs + Asts Over/Under": "PRA",
  "Player 3-Pointers Made": "Threes", "Player Steals Over/Under": "Steals", "Player Blocks Over/Under": "Blocks", "Player Steals": "Steals", "Player Blocks": "Blocks" };
const comp = await get("/v2/competitions/7176/events/featured?includeLive=false&page=1");
for (const ev of (comp && comp.events) || []) {
  if (!ev.awayTeam || !ev.homeTeam || aedtDate(ev.startsAt) !== DATE) continue;
  const code = (ABBR[ev.awayTeam] || ev.awayTeam) + "@" + (ABBR[ev.homeTeam] || ev.homeTeam);
  const e = await get("/mes/v3/events/" + ev.key);
  for (const m of (e && e.fixedOddsMarkets) || []) {
    if (m.isOpenForBetting === false) continue;
    const os = (m.outcomes || []).filter(o => o.isOpenForBetting !== false);
    if (m.eventName === "Pick Your Own Line" || m.eventName === "Alternate Totals") {   // alternate game lines, one-sided rungs
      for (const o of os) {
        const k = m.eventName === "Alternate Totals" ? (/^Over/.test(o.name) ? "tot|Over" : /^Under/.test(o.name) ? "tot|Under" : null)
                                                     : (o.side === "Home" ? "sp|home" : o.side === "Away" ? "sp|away" : null);
        if (k && o.points != null) (GALT[code + "|" + k] = GALT[code + "|" + k] || []).push(o.points + "=" + o.price);
      }
      continue;
    }
    if (m.eventName === ev.awayTeam + " Total" || m.eventName === ev.homeTeam + " Total") {   // team totals (8 Nov 2026)
      const tn = m.eventName.slice(0, -6), by = {};
      for (const o of os) if (o.points != null) (by[o.points] = by[o.points] || {})[/^Over/.test(o.name) ? "o" : /^Under/.test(o.name) ? "u" : "x"] = o.price;
      let best = null;
      for (const [pt, q] of Object.entries(by)) if (q.o && q.u) { const d = Math.abs(1 / q.o - 1 / q.u); if (!best || d < best.d) best = { d, pt, q }; }
      if (best) TT.push([BOOK, code, ABBR[tn] || tn, best.pt, best.q.o, best.q.u].join("|"));
      continue;
    }
    if (m.eventName === "Player To Score First Basket") {   // first basket: one row per player, side Home/Away
      for (const o of os) if (o.price) FB.push([BOOK, code, o.name, o.price, (o.side || "").toLowerCase()].join("|"));
      continue;
    }
    if (ALTS[m.eventName]) {   // "Aaron Gordon To Score 10+ Points" (points 9.5)
      for (const o of os) { const x = o.name.match(/^(.*?) To (?:Score|Record|Have|Get) (\d+)\+/); if (x) { const k = code + "|" + ALTS[m.eventName] + "|" + x[1].trim(); (ALT[k] = ALT[k] || []).push((+x[2] - 0.5) + "=" + o.price); } }
      continue;
    }
    if (PSTAT[m.eventName]) {   // one market holds every player: "Jalen Brunson Over 28.5" / "... Under 28.5"; keep each player's most balanced line
      try {
        const by = {};
        for (const o of os) { const x = o.name.match(/^(.*) (Over|Under) ([\d.]+)$/); if (x && o.price > 1) (by[x[1] + "|" + x[3]] = by[x[1] + "|" + x[3]] || {})[x[2]] = o.price; }
        for (const [k, v] of Object.entries(by)) {
          const [pl, ln] = k.split("|"); if (!v.Over || !v.Under) continue;
          const key = `${code}|${PSTAT[m.eventName]}|${pl}`, d = Math.abs(1 / v.Over - 1 / v.Under), c = PBEST.get(key);
          if (!c || d < c.d) PBEST.set(key, { d, row: [BOOK, code, PSTAT[m.eventName], pl, +ln, v.Over, v.Under] });
        }
      } catch (e) {}
      continue;
    }
    const H = os.find(o => o.side === "Home"), A = os.find(o => o.side === "Away");
    if (m.eventName === "Moneyline" && H && A) put(code + "|ml", [BOOK, code, "ml", "", "", A.price, H.price]);
    else if (m.eventName === "Point Spread" && H && A) put(code + "|sp", [BOOK, code, "sp", "", H.points, A.price, H.price]);
    else if (m.eventName === "Total") {
      const o = os.find(x => /^Over/.test(x.name)), u = os.find(x => /^Under/.test(x.name));
      if (o && u) put(code + "|tot", [BOOK, code, "tot", "", o.points, o.price, u.price]);
    } else if (STAT[m.eventName]) {
      const by = {};
      for (const o of os) { const x = o.name.match(/^(.*) (Over|Under) ([\d.]+)$/); if (x) (by[x[1] + "|" + x[3]] = by[x[1] + "|" + x[3]] || {})[x[2]] = o.price; }
      for (const [k, v] of Object.entries(by)) {
        const [pl, ln] = k.split("|");
        if (v.Over && v.Under) put(`${code}|${STAT[m.eventName]}|${pl}`, [BOOK, code, STAT[m.eventName], pl, +ln, v.Over, v.Under]);
      }
    }
  }
}
"###BOOKS\n" + [...BEST.values()].map(x => x.row.join("|")).join("\n") + "\n###ALT\n" + Object.entries(ALT).map(([k, v]) => BOOK + "|" + k.split("|")[0] + "|" + k.split("|")[1] + "|" + k.split("|")[2] + "|" + v.join(" ")).join("\n") + "\n###GALT\n" + Object.entries(GALT).map(([k, v]) => BOOK + "|" + k + "|" + v.join(" ")).join("\n") + "\n###FB\n" + FB.join("\n") + "\n###TT\nbook|game|team|line|over|under\n" + TT.join("\n") + "\n###PAIRS\nbook|game|mkt|player|line|a|b\n" + [...PBEST.values()].map(x => x.row.join("|")).join("\n");
