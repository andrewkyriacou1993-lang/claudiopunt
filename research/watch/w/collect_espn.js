// Run on https://www.espn.com/nba/injuries (built-in browser, javascript_tool).
// Returns ###INJURIES: team|player|status, where status is read from the latest note
// (ruled out / doubtful / questionable / probable), falling back to ESPN's status column.
const st = (s, note) => {
  const n = (note || '').toLowerCase();
  if (/ruled out|is out|will miss|won't play|out for|out indefinitely|miss the/.test(n)) return 'Out';
  if (/doubtful/.test(n)) return 'Doubtful';
  if (/questionable|game-time decision/.test(n)) return 'Questionable';
  if (/probable|upgraded to available|expected to play|will play/.test(n)) return 'Probable';
  return /out/i.test(s) ? 'Out' : 'Questionable';
};
const TODAY = new Date('/*DATE*/T12:00:00+11:00');
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const fresh = (note) => { const m = (note || '').match(/^([A-Z][a-z]{2}) (\d+):/); if (!m) return false;
  let d = new Date(TODAY.getFullYear(), MON[m[1]], +m[2]); if (d > TODAY) d.setFullYear(d.getFullYear() - 1);
  if ((TODAY - d) / 864e5 > 1.6) return false;
  // a note about a named game on another day (e.g. "Sunday's game") is about an earlier game
  const usDay = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(TODAY - 864e5).getDay()];
  const named = (note.match(/(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/) || [])[1];
  return !named || named === usDay; };
const out = [];
for (const t of document.querySelectorAll('.ResponsiveTable')) {
  const team = (t.querySelector('.Table__Title') || {}).textContent || '';
  for (const tr of t.querySelectorAll('tbody tr')) {
    const td = [...tr.querySelectorAll('td')].map(x => x.textContent.trim());
    if (td.length < 4) continue;
    // a note about an earlier game is stale: fall back to ESPN's status column
    const status = fresh(td[4]) ? st(td[3], td[4]) : (/out/i.test(td[3]) ? 'Out' : 'Questionable');
    out.push([team.trim(), td[0], status].join('|'));
  }
}
return ('###INJURIES\nteam|player|status\n' + out.join('\n'));
