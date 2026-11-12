// Run on any basketball-reference.com page (built-in browser, javascript_tool).
// Set TEAMS to the B-Ref abbreviations playing today (empty = all teams).
// Returns ###TEAMS (team_current.csv), ###PLAYERS (current-season player table) and
// ###SCHEDULE (every game this season so far + the next few days, US dates) for rest/travel.
const TEAMS = new Set([/*TEAMS*/]);
const SEASON = 2027;
const getDoc = async (path) => new DOMParser().parseFromString((await fetch(path).then(r => r.text())).replace(/<!--|-->/g, ''), 'text/html');
const rows = (t, F) => [...t.querySelectorAll('tbody tr')].filter(tr => !tr.classList.contains('thead')).map(tr => Object.fromEntries(F.map(w => { const c = tr.querySelector(`[data-stat="${w}"]`); return [w, c ? c.textContent.trim() : '']; })));
const byName = (arr) => { const m = {}; for (const o of arr) if (o.name_display && !m[o.name_display]) m[o.name_display] = o; return m; };
const sd = await getDoc(`/leagues/NBA_${SEASON}.html`);
const at = sd.querySelector('#advanced-team');
const teams = rows(at, ['team', 'wins', 'losses', 'off_rtg', 'def_rtg', 'pace']).filter(r => r.team && !/League/.test(r.team))
  .map(r => [r.team.replace('*', ''), (+r.wins) + (+r.losses), r.pace, r.off_rtg, r.def_rtg].join(','));
const pgD = await getDoc(`/leagues/NBA_${SEASON}_per_game.html`), adD = await getDoc(`/leagues/NBA_${SEASON}_advanced.html`), ppD = await getDoc(`/leagues/NBA_${SEASON}_per_poss.html`);
// players traded mid-season: keep the row for their current team (last listed), totals from the TOT row
const pgAll = rows(pgD.querySelector('table'), ['name_display', 'team_name_abbr', 'pos', 'games', 'games_started', 'mp_per_g', 'pts_per_g', 'trb_per_g', 'ast_per_g', 'fga_per_g', 'fg3a_per_g', 'fta_per_g', 'tov_per_g', 'fg3_per_g', 'stl_per_g', 'blk_per_g']);
const curTeam = {}; for (const r of pgAll) if (r.team_name_abbr && !/TM$/.test(r.team_name_abbr)) curTeam[r.name_display] = r.team_name_abbr;
const pg = byName(pgAll);
const ad = byName(rows(adD.querySelector('table'), ['name_display', 'mp', 'usg_pct', 'ts_pct', 'ast_pct', 'trb_pct', 'bpm']));
const pp = byName(rows(ppD.querySelector('table'), ['name_display', 'off_rtg', 'def_rtg']));
const out = [];
for (const [n, r] of Object.entries(pg)) {
  const team = curTeam[n] || r.team_name_abbr; const a = ad[n] || {}, p = pp[n] || {};
  if (TEAMS.size && !TEAMS.has(team)) continue;
  if ((+a.mp || 0) < 10) continue;
  out.push([n, team, r.pos, r.games, r.games_started, a.mp, r.mp_per_g, r.pts_per_g, r.trb_per_g, r.ast_per_g, r.fga_per_g, r.fg3a_per_g, r.fta_per_g, r.tov_per_g, a.usg_pct, a.ts_pct, a.ast_pct, a.trb_pct, p.off_rtg, p.def_rtg, a.bpm, r.fg3_per_g, r.stl_per_g, r.blk_per_g].join('|'));
}
// last season's threes / steals / blocks per game (props_extra.py priors); TOT row for traded players (first listed)
const prior3 = []; try { const lD = await getDoc(`/leagues/NBA_${SEASON - 1}_per_game.html`);
  for (const [n, r] of Object.entries(byName(rows(lD.querySelector('table'), ['name_display', 'games', 'mp_per_g', 'fg3_per_g', 'stl_per_g', 'blk_per_g']))))
    if ((+r.games || 0) >= 10) prior3.push([n, r.games, r.mp_per_g, r.fg3_per_g, r.stl_per_g, r.blk_per_g].join('|')); } catch (e) {}
// schedule: current and previous month pages (US dates)
const MONTHS = ['october', 'november', 'december', 'january', 'february', 'march', 'april', 'may', 'june'];
const now = new Date(), mi = Math.max(0, MONTHS.indexOf(now.toLocaleString('en-US', { month: 'long', timeZone: 'America/New_York' }).toLowerCase()));
const sched = [];
for (const m of MONTHS.slice(Math.max(0, mi - 1), mi + 1)) {
  let d; try { d = await getDoc(`/leagues/NBA_${SEASON}_games-${m}.html`); } catch (e) { continue; }
  const t = d.querySelector('#schedule'); if (!t) continue;
  for (const tr of t.querySelectorAll('tbody tr')) {
    const c = (k) => tr.querySelector(`[data-stat="${k}"]`);
    const ymd = (c('date_game')?.getAttribute('csk') || '').match(/^(\d{4})(\d{2})(\d{2})/);
    const v = c('visitor_team_name')?.querySelector('a')?.getAttribute('href')?.split('/')[2];
    const h = c('home_team_name')?.querySelector('a')?.getAttribute('href')?.split('/')[2];
    if (ymd && v && h) sched.push([`${ymd[1]}-${ymd[2]}-${ymd[3]}`, v, h].join('|'));
  }
}
return ('###TEAMS\nteam,gp,pace,ortg,drtg\n' + teams.join('\n') + '\n###PLAYERS\nname|team|pos|g|gs|mp|mpg|pts|reb|ast|fga|fg3a|fta|tov|usg|ts|astp|trbp|ortg|drtg|bpm|fg3|stl|blk\n' + out.join('\n') + '\n###SCHEDULE\ndate|away|home\n' + sched.join('\n') + '\n###PRIOR3\nname|g|mpg|fg3|stl|blk\n' + prior3.join('\n'));
