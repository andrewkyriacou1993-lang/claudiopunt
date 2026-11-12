// page: https://www.sportsbet.com.au/betting/basketball-us/nba   (built-in browser, javascript_tool; read-only, logged out)
// Same-player combo prices at Sportsbet. QUERY = the full contents of raw/combo_<D>.txt (the ###CMB block from collect_combo.js).
// For each player's combos it finds the legs in Sportsbet's milestone markets ("To Score 15+ Points", "To Record 6+ Rebounds",
// "To Record 4+ Assists", "2+ Made Threes") and asks Sportsbet's SGM pricer for the combined price
// (POST /apigw/multi-pricer/combinations/price: a price quote only; nothing is placed, nothing goes on a bet slip, no login).
// Quoted per game (MAX_PER_GAME): pts/reb/ast triples first, then the most achievable combos by our game-log chance.
// Output: ###CMBQ book|code|player|spec|leg_prices|sgm_price|log_chance|hits10|lift|side|opp|min10|games|opp_fac
//   (leg_prices ';'-joined in spec order; the last eight fields are echoed from QUERY so the pricer needs only this output)
// Stackers (29 Oct 2026): for each player, rungs of ONE ladder in one SGM (e.g. 6+ and 8+ rebounds). The multi only wins
// when the top rung lands, so it is the top rung at a different price; Sportsbet's SGM engine sometimes pays more than the
// top rung's own single (seen 45+ pts 12.00 alone vs 16.50 stacked). Quoted: rung below + top where the lower rung is 2.20+ (2.50+ until 7 Nov) (shorter lower rungs gave no boost in the 29 Oct test) and the top under 41
// (the singles stop at 41, which understates the real longshots). Output ###STACK side|code|player|stat|lower|top|
//   lower_price|top_price|stack_price  (stat letter P/R/A/T, lower/top = the N in "N+")
const MAX_STACK_PER_GAME = 100;   // 7 Nov 2026: was 60 (5 of 9 games hit it); quotes are cheap
const QRAW = `/*QUERY*/`;
const MAX_PER_GAME = 60;
const ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BRK","Charlotte Hornets":"CHO","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","LA Lakers":"LAL","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHO","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"};
const state = (h) => { const i = h.indexOf('window.__PRELOADED_STATE__'); const st = h.indexOf('{', i); let d = 0, j = st, s = false, e = false; for (; j < h.length; j++) { const c = h[j]; if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; } if (c === '"') s = true; else if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } } return JSON.parse(h.slice(st, j + 1).replace(/[\u0000-\u001f]/g, ' ')); };
const dec = (o) => +(1 + o.winPrice.num / o.winPrice.den).toFixed(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").replace(/ (jr|sr|ii|iii|iv)$/, "").trim();
const MK = [[/^To Score (\d+)\+ Points$/, "P"], [/^To Record (\d+)\+ Rebounds$/, "R"], [/^To Record (\d+)\+ Assists$/, "A"], [/^(\d+)\+ Made Threes$/, "T"]];
const parse = spec => [...spec.matchAll(/([PRAT])(\d+)/g)].map(m => m[1] + m[2]);
const rows = QRAW.split("\n").map(x => x.trim()).filter(l => /^[A-Z]{3}@[A-Z]{3}\|/.test(l)).map(l => { const f = l.split("|"); return { code: f[0], player: f[2], info: [f[1], f[6], f[4], f[3], f[7]], combos: (f[8] || "").split(",").filter(Boolean).map(c => { const [s, q, h, lf] = c.split(":"); return { spec: s, q: +q / 100, h: h || "", lift: lf || "" }; }) }; });
const C = state(await fetch('/betting/basketball-us/nba').then(r => r.text())).entities.sportsbook;
const evByCode = {};
for (const ev of Object.values(C.events)) { if (!/ At /.test(ev.name)) continue; const [a, h] = ev.name.split(' At ').map(s => s.trim()); evByCode[(ABBR[a] || a) + "@" + (ABBR[h] || h)] = ev; }
const out = [], miss = [], Ms = [], STK = [];
for (const code of [...new Set(rows.map(r => r.code))]) {
  const ev = evByCode[code]; if (!ev) { miss.push(code); continue; }
  const slug = ev.name.toLowerCase().replace(/ at /, '-at-').replace(/[^a-z0-9-]+/g, '-') + '-' + ev.id;
  let S; try { S = state(await fetch('/betting/basketball-us/nba/' + slug).then(r => r.text())).entities.sportsbook; } catch (e) { miss.push(code); continue; }
  const compExt = (S.competitions[ev.competitionId] || C.competitions[ev.competitionId] || {}).externalId;
  const legs = {};   // legs[normName][P15] = [marketExternalId, outcomeExternalId, price]
  for (const m of Object.values(S.markets)) {
    if (String(m.eventId) !== String(ev.id) || m.sameGameMultiEnabled === false) continue;
    for (const [rx, k] of MK) {
      const x = m.name.match(rx); if (!x) continue;
      for (const o of m.outcomeIds.map(i => S.outcomes[i]).filter(Boolean)) if (o.winPrice && o.active !== false) (legs[norm(o.name)] = legs[norm(o.name)] || {})[k + x[1]] = [m.externalId, o.externalId, dec(o)];
    }
  }
  // margin on the milestones: each two-way main line ("Player - Points" over/under, no-vig) vs the milestone at the same number
  const WD = { Points: "P", Rebounds: "R", Assists: "A", "Made Threes": "T" };
  for (const m of Object.values(S.markets)) {
    if (String(m.eventId) !== String(ev.id)) continue;
    const x = m.name.match(/^(.*) - (Points|Rebounds|Assists|Made Threes)$/); if (!x) continue;
    const os = m.outcomeIds.map(i => S.outcomes[i]).filter(Boolean), ov = os.find(o => /over/i.test(o.name)), un = os.find(o => /under/i.test(o.name)); if (!ov || !un || !ov.winPrice || !un.winPrice) continue;
    const L = parseFloat((ov.handicap && ov.handicap.value) || (ov.name.match(/[\d.]+/) || [])[0]); if (!(L > 0)) continue;
    const ms = (legs[norm(x[1])] || {})[WD[x[2]] + Math.ceil(L)]; if (!ms) continue;
    const nv = (1 / dec(ov)) / (1 / dec(ov) + 1 / dec(un)), q = 1 / ms[2]; Ms.push((q - nv) / (q * (1 - q)));
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
    const res = await Promise.all(batch.map(x => fetch('/apigw/multi-pricer/combinations/price', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classExternalId: 16, competitionExternalId: compExt, eventExternalId: ev.externalId, outcomesExternalIds: x.sel.map(s => ({ marketExternalId: s[0], outcomeExternalId: s[1] })) }) })
      .then(r => r.ok ? r.json() : null).catch(() => null)));
    res.forEach((j, k) => { const x = batch[k], p = j && j.price; if (p && p.denominator) out.push(["Sportsbet", code, x.r.player, x.c.spec, x.sel.map(s => s[2]).join(";"), (1 + p.numerator / p.denominator).toFixed(2), Math.round(x.c.q * 100), x.c.h, x.c.lift, ...x.r.info].join("|")); });
    await sleep(200);
  }
  // ---- stackers: rung below + top rung of one player's ladder, vs the top rung alone
  const sc = [], seenP = new Set();
  for (const r of rows.filter(r => r.code === code)) {
    const L = who(r.player); if (!L || seenP.has(r.player)) continue; seenP.add(r.player);
    for (const k of ["P", "R", "A", "T"]) {
      const Ns = Object.keys(L).filter(x => x[0] === k).map(x => +x.slice(1)).sort((a, b) => a - b);
      for (let i = 1; i < Ns.length; i++) { const lo = L[k + Ns[i - 1]], top = L[k + Ns[i]];
        if (lo[2] < 2.2 || top[2] >= 41) continue;          // the boost shows when the lower rung is itself a price (29 Oct test; 2.50 until 7 Nov)
        sc.push({ r, k, lo: Ns[i - 1], top: Ns[i], sel: [lo, top], d: lo[2] }); }
    }
  }
  // 7 Nov 2026 (Andrew: Dyson Daniels' assists/rebounds stacks were never quoted): every player's every stat gets its most
  // likely stack quoted first (shortest qualifying lower rung), then the next rung up for each, and so on, until the cap.
  // Before, the longest-priced stacks across the whole game were quoted first, so realistic ones missed the cap.
  const byPS = {};
  for (const x of sc) (byPS[x.r.player + "|" + x.k] = byPS[x.r.player + "|" + x.k] || []).push(x);
  Object.values(byPS).forEach(v => v.sort((a, b) => a.d - b.d));
  const sp = [];
  for (let round = 0; sp.length < MAX_STACK_PER_GAME; round++) {
    const add = Object.values(byPS).map(v => v[round]).filter(Boolean);
    if (!add.length) break;
    sp.push(...add.slice(0, MAX_STACK_PER_GAME - sp.length));
  }
  for (let i = 0; i < sp.length; i += 4) {
    const batch = sp.slice(i, i + 4);
    const res = await Promise.all(batch.map(x => fetch('/apigw/multi-pricer/combinations/price', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classExternalId: 16, competitionExternalId: compExt, eventExternalId: ev.externalId, outcomesExternalIds: x.sel.map(s => ({ marketExternalId: s[0], outcomeExternalId: s[1] })) }) })
      .then(r => r.ok ? r.json() : null).catch(() => null)));
    res.forEach((j, k) => { const x = batch[k], p = j && j.price; if (p && p.denominator) STK.push([x.r.info[0], code, x.r.player, x.k, x.lo, x.top, x.sel[0][2], x.sel[1][2], (1 + p.numerator / p.denominator).toFixed(2)].join("|")); });
    await sleep(200);
  }
}
return ("###CMBQ\nbook|code|player|spec|leg_prices|sgm_price|log_chance|hits10|lift|side|opp|min10|games|opp_fac\n" + out.join("\n") + "\n###CMBQINFO\nmissing|" + [...new Set(miss)].join(";") + "\nmargin|" + (Ms.length ? Ms.sort((a, b) => a - b)[Math.floor(Ms.length / 2)].toFixed(3) : "") + "\nmargin_n|" + Ms.length + "\n###STACK\nside|code|player|stat|lower|top|lower_price|top_price|stack_price\n" + STK.join("\n"));
