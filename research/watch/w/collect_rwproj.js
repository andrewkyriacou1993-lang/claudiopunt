// RotoWire NBA projections for today's slate (8 Nov 2026, Andrew's RotoWire membership) - read-only.
// Run on https://www.rotowire.com/basketball/projections.php?type=today in the built-in browser (javascript_tool),
// signed in to RotoWire. Reads the same data the page's table shows (its own projections feed); clicks nothing.
// Save the output as raw/rwproj_<DATE>_<HHMM>.txt. MIN 0 = RotoWire has the player out / not playing.
// Used for: (1) a 2-week test of RotoWire's minutes and stat projections against box scores and the bookies' lines
// (rw_test.py, review ~22 Nov), (2) the report's "RotoWire has out" list next to our injury list.
// id = RotoWire player id (onoff.py --query uses the ids of tonight's outs for the on/off splits).
const r = await fetch('/basketball/tables/projections.php?type=today&pos=ALL', { credentials: 'include' });
let j = null;
try { j = await r.json(); } catch (e) {}
if (!Array.isArray(j) || !j.length) {
  return (`###RWPROJ_ERROR\nstatus ${r.status}: no projections (signed out, no access, or no games today)`);
} else {
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
  const f = (v, d) => (+v || 0).toFixed(d);
  return (`###RWPROJ captured ${now} AEDT\nplayer|team|opp|pos|min|pts|reb|ast|tpm|tpa|stl|blk|to|fga|fta|id\n` +
    j.map(x => [x.player, x.team, x.opp, x.pos, f(x.MIN, 1), f(x.PTS, 2), f(x.REB, 2), f(x.AST, 2), f(x.THREEPM, 2),
      f(x.THREEPA, 2), f(x.STL, 2), f(x.BLK, 2), f(x.TO, 2), f(x.FGA, 2), f(x.FTA, 2), x.id || ''].map(v => String(v).replace(/\|/g, '/')).join('|')).join('\n'));
}
