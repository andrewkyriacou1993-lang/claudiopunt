// RotoWire on/off court stats (8 Nov 2026, Andrew): every team-mate's stats while the players ruled out tonight were OFF
// the court this season. Read-only. Run on https://www.rotowire.com/basketball/court-on-off.php in the built-in browser.
// /*QUERY*/ = lines "TEAM|id1,id2" (RotoWire team code and player ids of tonight's outs, from onoff_query.py).
// Output ###RWONOFF team|off_ids|player|id|pos|games|minutes_off|minutes_on|usage|usage_diff|pts36|pts36_diff|reb36|reb36_diff|
// ast36|ast36_diff|tpm36|tpm36_diff|fga36_diff|tpa36_diff: per-36 numbers and usage are with ALL the listed players OFF the
// court; diff = that minus with them on; minutes_off / minutes_on = his minutes in each case. Save as
// raw/rwonoff_<DATE>_<HHMM>.txt. onoff.py turns it into rate factors for props_model.py.
const QUERY = `/*QUERY*/`;
const out = [];
for (const ln of QUERY.split('\n').map(s => s.trim()).filter(Boolean)) {
  const [team, ids] = ln.split('|'); if (!team || !ids) continue;
  const q = new URLSearchParams(); q.append('team', team); ids.split(',').filter(Boolean).forEach(i => q.append('off[]', i));
  let j = null; try { j = await (await fetch('/basketball/tables/court-on-off-stats.php?' + q, { credentials: 'include' })).json(); } catch (e) {}
  for (const p of (j && j.players) || []) {
    if (p.usageDifference === '' || p.usageDifference == null) continue;     // never on the court without them
    out.push([team, ids, `${p.firstname} ${p.lastname}`, p.ID, p.position, p.games, p.minutes, p.minutesOther, p.usage, p.usageDifference,
      p.pointsPer36, p.pointsDifference, p.reboundsPer36, p.reboundsDifference, p.assistsPer36, p.assistsDifference,
      p.threePointersMadePer36, p.threePointersMadeDifference, p.fieldGoalAttemptsDifference, p.threePointerAttemptsDifference].join('|'));
  }
  await new Promise(r => setTimeout(r, 400));
}
'###RWONOFF\nteam|off_ids|player|id|pos|games|minutes_off|minutes_on|usage|usage_diff|pts36|pts36_diff|reb36|reb36_diff|ast36|ast36_diff|tpm36|tpm36_diff|fga36_diff|tpa36_diff\n' + out.join('\n');
