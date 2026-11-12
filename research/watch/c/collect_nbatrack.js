// NBA.com player tracking (8 Nov 2026, Andrew: item 3 "usage-quality stats that settle faster than results"). Read-only.
// Run on https://www.nba.com/stats/players/rebounding in the built-in browser (javascript_tool); clicks nothing.
// Reads the same feeds the NBA.com stats pages show (Rebounding, Passing, Possessions), this season and the last 5 games.
// Output ###NBATRACK player|team|gp|min|reb|reb_ch|reb_ch_pct_adj|ast|pot_ast|passes|touches|paint_touches|
//                    l5_gp|l5_min|l5_reb|l5_reb_ch|l5_ast|l5_pot_ast|l5_touches        (per game)
// Save as raw/nbatrack_<DATE>_<HHMM>.txt. track.py turns it into rebound / assist rates for props_model.py.
const now0 = new Date(), y = now0.getMonth() >= 8 ? now0.getFullYear() : now0.getFullYear() - 1;
const SEASON = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
const base = (m, n) => 'https://stats.nba.com/stats/leaguedashptstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=' +
  `&DraftPick=&DraftYear=&GameScope=&Height=&LastNGames=${n}&LeagueID=00&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0` +
  `&PerMode=PerGame&PlayerExperience=&PlayerOrTeam=Player&PlayerPosition=&Season=${SEASON}&SeasonSegment=` +
  `&SeasonType=Regular%20Season&StarterBench=&TeamID=0&VsConference=&VsDivision=&Weight=&PtMeasureType=${m}`;
const get = async (m, n) => {
  const j = await (await fetch(base(m, n), { headers: { Accept: 'application/json' } })).json();
  const rs = j.resultSets[0], H = rs.headers, out = {};
  for (const r of rs.rowSet) { const o = {}; H.forEach((h, i) => o[h] = r[i]); out[o.PLAYER_ID] = o; }
  return out;
};
let res;
try {
  const S = {}, L = {};
  for (const m of ['Rebounding', 'Passing', 'Possessions']) {
    S[m] = await get(m, 0); await new Promise(r => setTimeout(r, 300));
    L[m] = await get(m, 5); await new Promise(r => setTimeout(r, 300));
  }
  const v = (x, k) => (x && x[k] != null ? x[k] : '');
  const rows = Object.keys(S.Possessions).map(id => {
    const r = S.Rebounding[id], p = S.Passing[id], t = S.Possessions[id], lr = L.Rebounding[id], lp = L.Passing[id], lt = L.Possessions[id];
    return [t.PLAYER_NAME, t.TEAM_ABBREVIATION, t.GP, t.MIN, v(r, 'REB'), v(r, 'REB_CHANCES'), v(r, 'REB_CHANCE_PCT_ADJ'), v(p, 'AST'),
      v(p, 'POTENTIAL_AST'), v(p, 'PASSES_MADE'), t.TOUCHES, t.PAINT_TOUCHES, v(lt, 'GP'), v(lt, 'MIN'), v(lr, 'REB'), v(lr, 'REB_CHANCES'),
      v(lp, 'AST'), v(lp, 'POTENTIAL_AST'), v(lt, 'TOUCHES')].join('|');
  });
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
  res = `###NBATRACK captured ${now} AEDT season ${SEASON}\nplayer|team|gp|min|reb|reb_ch|reb_ch_pct_adj|ast|pot_ast|passes|touches|paint_touches|` +
    `l5_gp|l5_min|l5_reb|l5_reb_ch|l5_ast|l5_pot_ast|l5_touches\n` + rows.join('\n');
} catch (e) {
  res = `###NBATRACK_ERROR\n${e}`;
}
res;
