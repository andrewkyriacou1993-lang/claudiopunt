// RotoWire NBA defence vs position (8 Nov 2026, Andrew: "how many threes / rebounds teams allow ... apply that to the
// player projections"). Read-only. Run on https://www.rotowire.com/daily/nba/defense-vspos.php in the built-in browser
// (javascript_tool), signed in to RotoWire. Per team and position (PG/SG/SF/PF/C): points, rebounds, assists, threes,
// steals, blocks allowed per game, season and last 10 games. Save as raw/rwdvp_<DATE>_<HHMM>.txt (dvp.py reads it).
const get = async g => await (await fetch(`/daily/tables/defense-vspos-nba.php?site=DraftKings&projections=RotoWire&pos=ALL&games=${g}`, { credentials: 'include' })).json();
let s = null, l = null;
try { s = await get(82); l = await get(10); } catch (e) {}
if (!Array.isArray(s) || !s.length) {
  '###RWDVP_ERROR\nno data (signed out or no access)';
} else {
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
  const fmt = (j) => j.map(x => [x.team, x.position, x.points, x.rebounds, x.assists, x.pt3_m, x.steals, x.blocks, x.turnovers, x.fg_pct].join('|')).join('\n');
  `###RWDVP captured ${now} AEDT (season)\nteam|pos|pts|reb|ast|tpm|stl|blk|to|fg_pct\n${fmt(s)}\n###RWDVP10 (last 10 games)\nteam|pos|pts|reb|ast|tpm|stl|blk|to|fg_pct\n${fmt(Array.isArray(l) ? l : [])}`;
}
