// Run on https://www.sportsbet.com.au/betting/basketball-us/nba (built-in browser, javascript_tool).
// Set DATE to the AEDT date to collect (YYYY-MM-DD); leave /*PLAYERS*/ empty for the daily run.
// Returns ###GAMES, ###PROPS, ###FB (first basket: game|player|odds), ###ALT (player alternate-line ladders, 'line=odds' rungs) and ###GALT (alternate spreads/totals:
// kind sp = that team's handicap, side home/away; kind tot = total, side Over/Under) blocks.
const DATE = '/*DATE*/';
// Optional: list player names to keep only their props (closing snapshots), e.g. 'Jayson Tatum','Naz Reid'. Empty = all.
const ONLY = new Set([/*PLAYERS*/]);
const ABBR = {"Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BRK","Charlotte Hornets":"CHO","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","LA Clippers":"LAC","Los Angeles Clippers":"LAC","LA Lakers":"LAL","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHO","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WAS"};
const state = (h) => { const i = h.indexOf('window.__PRELOADED_STATE__'); const st = h.indexOf('{', i); let d = 0, j = st, s = false, e = false; for (; j < h.length; j++) { const c = h[j]; if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; } if (c === '"') s = true; else if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } } return JSON.parse(h.slice(st, j + 1).replace(/[\u0000-\u001f]/g, ' ')); };
const dec = (o) => (1 + o.winPrice.num / o.winPrice.den).toFixed(2);
const ST = (x) => ({ 'Pts + Reb + Ast': 'PRA', 'Made Threes': 'Threes' })[x] || x;
const aedt = (t) => new Date(t && t.milliseconds ? t.milliseconds : t * 1000).toLocaleString('en-CA', { timeZone: 'Australia/Sydney', hour12: false }).replace(',', '');
const comp = state(await fetch('/betting/basketball-us/nba').then(r => r.text())).entities.sportsbook;
const events = Object.values(comp.events).filter(ev => ev.startTime && aedt(ev.startTime).startsWith(DATE));
const G = [], P = [], A = [], GA = [], FBK = [], TT = [], PR = [], PN = new Set();
// two-stat markets (10 Nov 2026, Andrew): points + rebounds, points + assists, rebounds + assists -> P+R / P+A / R+A
const PAIR = (x) => { const s = x.toLowerCase(), p = /pts|points/.test(s), r = /reb/.test(s), a = /ast|assist/.test(s); return p && r && !a ? 'P+R' : p && a && !r ? 'P+A' : r && a && !p ? 'R+A' : null; };
for (const ev of events) {
  const slug = ev.name.toLowerCase().replace(/ at /, '-at-').replace(/[^a-z0-9-]+/g, '-') + '-' + ev.id;
  const [awayN, homeN] = ev.name.split(' At ').map(s => s.trim());
  let S; try { S = state(await fetch('/betting/basketball-us/nba/' + slug).then(r => r.text())).entities.sportsbook; } catch (e) { continue; }
  const ms = Object.values(S.markets).filter(m => String(m.eventId) === String(ev.id));
  const oc = (m) => m.outcomeIds.map(x => S.outcomes[x]).filter(Boolean);
  const mk = (n) => ms.find(m => m.name === n);
  const ml = mk('Match Betting'), hc = mk('Handicap Betting'), tp = mk('Total Points');
  if (!ml || !hc || !tp) continue;
  const mlo = oc(ml), hco = oc(hc), tpo = oc(tp);
  const side = (arr, n) => arr.find(o => o.name.trim() === n);
  const mlA = side(mlo, awayN), mlH = side(mlo, homeN), hcA = side(hco, awayN), hcH = side(hco, homeN);
  if (!mlA || !mlH || !hcA || !hcH) continue;
  const v = Math.abs(parseFloat(hcH.handicap.value));
  const homeFav = +dec(mlH) < +dec(mlA);
  const spreadHome = homeFav ? -v : v;
  const ov = tpo.find(o => /Over/.test(o.name)), un = tpo.find(o => /Under/.test(o.name));
  const tip = aedt(ev.startTime).slice(11, 16);
  G.push([DATE, tip, awayN, homeN, dec(mlA), dec(mlH), spreadHome, dec(hcH), dec(hcA), ov.handicap.value, dec(ov), dec(un)].join(','));
  const code = (ABBR[awayN] || awayN) + '@' + (ABBR[homeN] || homeN);
  // team totals (8 Nov 2026): "HOU Rockets Total Pts" Over/Under X -> ###TT book|game|team|line|over|under
  for (const m of ms) {
    const tx = m.name.match(/^[A-Z]{2,3} (.+) Total Pts$/); if (!tx) continue;
    const nick = tx[1].trim(), tn = awayN.endsWith(nick) ? awayN : homeN.endsWith(nick) ? homeN : null; if (!tn) continue;
    const to = oc(m), tov = to.find(o => /^Over/.test(o.name)), tun = to.find(o => /^Under/.test(o.name));
    if (tov && tun && tov.handicap) TT.push(['Sportsbet', code, ABBR[tn] || tn, tov.handicap.value, dec(tov), dec(tun)].join('|'));
  }
  for (const m of ms) {
    const mm = m.name.match(/^(.+) - (Points|Rebounds|Assists|Pts \+ Reb \+ Ast|Made Threes|Steals|Blocks)$/); if (!mm) continue;
    const os = oc(m); const o = os.find(x => /Over$/.test(x.name)), u = os.find(x => /Under$/.test(x.name));
    if (!o || !u || !o.active || !u.active) continue;
    if (ONLY.size && !ONLY.has(mm[1].trim())) continue;
    P.push([code, mm[1], ST(mm[2]), o.handicap.value, dec(o), dec(u)].join('|'));
  }
  // two-stat over/unders (collected only, nothing downstream reads ###PAIRS yet): "Player - Pts + Reb" style names.
  // Any other market name with a '+' in it is listed in ###PAIRNAMES so a naming change shows up. Never breaks the run.
  try {
    for (const m of ms) {
      if (!/ \+ /.test(m.name) || /Pts \+ Reb \+ Ast/.test(m.name)) continue;
      const mm = m.name.match(/^(.+) - ([A-Za-z]+ \+ [A-Za-z]+)$/), st = mm && PAIR(mm[2]);
      if (!st) { if (PN.size < 25) PN.add(m.name.replace(/^.* - /, '')); continue; }
      const os = oc(m), o = os.find(x => /Over$/.test(x.name)), u = os.find(x => /Under$/.test(x.name));
      if (!o || !u || !o.active || !u.active || !o.handicap) continue;
      if (ONLY.size && !ONLY.has(mm[1].trim())) continue;
      PR.push([code, mm[1].trim(), st, o.handicap.value, dec(o), dec(u)].join('|'));
    }
  } catch (e) { PN.add('ERROR ' + String(e && e.message).slice(0, 80)); }
  // alternate game lines: "Alternate Total Points" (Over/Under X) and "Pick Your Own Line" (Team +/-X), one-sided rungs
  const gl = {};
  for (const m of ms) {
    if (m.name === 'Alternate Total Points') for (const o of oc(m)) { const x = o.name.match(/^(Over|Under) (\d+(?:\.5)?)$/); if (x && o.active) (gl['tot|' + x[1]] = gl['tot|' + x[1]] || []).push(x[2] + '=' + (+dec(o))); }
    if (m.name === 'Pick Your Own Line') for (const o of oc(m)) { const x = o.name.match(/^(.*) ([+-]\d+(?:\.5)?)$/); if (!x || !o.active) continue;
      const sd = x[1].trim() === homeN ? 'home' : x[1].trim() === awayN ? 'away' : null; if (sd) (gl['sp|' + sd] = gl['sp|' + sd] || []).push(x[2] + '=' + (+dec(o))); }
  }
  // first basket (when posted): game|player|odds
  const fbm = ms.find(m => m.name === 'First Basket');
  if (fbm) for (const o of oc(fbm)) if (o.active !== false) FBK.push([code, o.name.trim(), dec(o)].join('|'));
  for (const [k, v] of Object.entries(gl)) GA.push([code, k.split('|')[0], k.split('|')[1], v.join(' ')].join('|'));
  // alternate lines: one-sided ladders "Player - Alt Points" -> outcomes "Player Over 24.5"
  for (const m of ms) {
    const mm = m.name.match(/^(.+) - Alt (Points|Rebounds|Assists|Pts \+ Reb \+ Ast|Threes)$/); if (!mm) continue;
    if (ONLY.size && !ONLY.has(mm[1].trim())) continue;
    const rungs = []; for (const o of oc(m)) { const lm = o.name.match(/Over (\d+(?:\.5)?)$/); if (lm && o.active) rungs.push(lm[1] + '=' + (+dec(o))); }
    if (rungs.length) A.push([code, mm[1].trim(), ST(mm[2]), rungs.join(' ')].join('|'));
  }
  // game-level ladders for threes / steals / blocks: "3+ Made Threes", "To Record 2+ Steals" (outcomes are players)
  const lad = {};
  for (const m of ms) {
    const x = m.name.match(/^(\d+)\+ Made Threes$/) || m.name.match(/^To Record (\d+)\+ (Steals|Blocks)$/); if (!x) continue;
    const stt = x[2] || 'Threes';
    for (const o of oc(m)) { if (!o.winPrice || o.active === false) continue; if (ONLY.size && !ONLY.has(o.name.trim())) continue;
      (lad[o.name.trim() + '|' + stt] = lad[o.name.trim() + '|' + stt] || []).push((+x[1] - 0.5) + '=' + (+dec(o))); }
  }
  for (const [k, v] of Object.entries(lad)) { const [pl, stt] = k.split('|'); A.push([code, pl, stt, v.join(' ')].join('|')); }
}
'###GAMES\ndate,tip,away,home,ml_away,ml_home,spread_home,spread_home_odds,spread_away_odds,total,over_odds,under_odds\n' + G.join('\n') + '\n###PROPS\ngame|player|stat|line|over|under\n' + P.join('\n') + '\n###ALT\ngame|player|stat|rungs\n' + A.join('\n') + '\n###GALT\ngame|kind|side|rungs\n' + GA.join('\n') + '\n###FB\ngame|player|odds\n' + FBK.join('\n') + '\n###TT\nbook|game|team|line|over|under\n' + TT.join('\n') + '\n###PAIRS\ngame|player|stat|line|over|under\n' + PR.join('\n') + '\n###PAIRNAMES\n' + [...PN].join('\n');
