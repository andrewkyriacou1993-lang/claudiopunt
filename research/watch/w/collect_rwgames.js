// page: https://www.rotowire.com/betting/nba/odds   (built-in browser, javascript_tool; read-only, clicks nothing)
// US sportsbooks' main game lines via RotoWire (8 Nov 2026, Andrew: "bring RotoWire into the opening price run, as this is
// the most important to find an edge"). DraftKings, FanDuel, Circa, Caesars, MGM, BetRivers, Fanatics, Hard Rock, theScore,
// Betr US. Replace /*DATE*/ with the AEDT date D; the US (Eastern) game date is D - 1 day.
// Output (save as raw/usgames_<D>_<HHMM>.txt): ###USGAMES  book|game|mkt|player|line|a|b  (same compact format as the
// bookie files: ml a=away b=home; sp line = HOME handicap, a=away b=home; tot a=over b=under; decimal odds).
// These prices feed the market consensus only (nba_predictor.py --us); they are never a price to bet at.
const DATE = '/*DATE*/';
const US = new Date(new Date(DATE + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
const FIX = { BKN: 'BRK', PHX: 'PHO', CHA: 'CHO', GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', WAS: 'WAS' };
const ab = (x) => FIX[x] || x;
const NAME = { betr: 'BetrUS', betrivers: 'BetRivers', caesars: 'Caesars', circasports: 'Circa', draftkings: 'DraftKings', fanatics: 'Fanatics',
  fanduel: 'FanDuel', hardrock: 'HardRock', mgm: 'BetMGM', thescore: 'theScore' };
const dec = (a) => { a = parseFloat(a); if (!isFinite(a) || a === 0) return null; return +(a > 0 ? 1 + a / 100 : 1 + 100 / -a).toFixed(3); };
const j = await (await fetch('/betting/nba/tables/nba-games-by-market.php?date=' + US, { credentials: 'include' })).json();
const byGame = {};
for (const r of j) (byGame[r.gameID] = byGame[r.gameID] || {})[r.homeAway] = r;
const out = [];
for (const g of Object.values(byGame)) {
  const A = g.away, H = g.home; if (!A || !H) continue;
  const code = ab(A.abbr) + '@' + ab(H.abbr);
  for (const [k, nm] of Object.entries(NAME)) {
    const mA = dec(A[k + '_moneyline']), mH = dec(H[k + '_moneyline']);
    if (mA && mH) out.push([nm, code, 'ml', '', '', mA, mH].join('|'));
    const sA = dec(A[k + '_spreadML']), sH = dec(H[k + '_spreadML']);
    if (sA && sH && H[k + '_spread'] != null) out.push([nm, code, 'sp', '', +H[k + '_spread'], sA, sH].join('|'));
    const o = dec(A[k + '_ouML']), u = dec(H[k + '_ouML']);
    if (o && u && A[k + '_ou'] != null && A[k + '_ou'] === H[k + '_ou']) out.push([nm, code, 'tot', '', +A[k + '_ou'], o, u].join('|'));
  }
}
return ('###USGAMES us_date=' + US + ' games=' + Object.keys(byGame).length + '\n' + out.join('\n'));
