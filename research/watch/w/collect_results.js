// Run on any https://www.espn.com/ page (built-in browser, javascript_tool).
// Set DATE to the AEDT date whose games to settle (YYYY-MM-DD); NBA games on that AEDT date
// are the previous US calendar day. Returns ###FINALS and ###BOX blocks.
const DATE = '/*DATE*/';
const us = new Date(new Date(DATE + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10).replace(/-/g, '');
const sb = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${us}`).then(r => r.json());
const F = [], B = [], FS = [];
for (const ev of sb.events || []) {
  const c = ev.competitions[0];
  const away = c.competitors.find(x => x.homeAway === 'away'), home = c.competitors.find(x => x.homeAway === 'home');
  const done = c.status.type.completed;
  F.push([away.team.displayName, home.team.displayName, away.score, home.score, done ? 'final' : c.status.type.name].join('|'));
  if (!done) continue;
  const sum = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${ev.id}`).then(r => r.json());
  const nm = {};
  for (const t of (sum.boxscore && sum.boxscore.players) || []) for (const a of t.statistics[0].athletes) nm[a.athlete.id] = a.athlete.displayName;
  const fs = (sum.plays || []).find(p => p.scoringPlay);
  const fid = fs && fs.participants && fs.participants[0] && fs.participants[0].athlete && fs.participants[0].athlete.id;
  FS.push([away.team.displayName, home.team.displayName, fid ? (nm[fid] || '') : '', fs ? (/free throw/i.test(fs.type && fs.type.text || '') ? 'FT' : 'FG') : ''].join('|'));
  for (const t of (sum.boxscore && sum.boxscore.players) || []) {
    const st = t.statistics[0]; const lab = st.labels || st.names;
    const ix = (k) => lab.indexOf(k);
    for (const a of st.athletes) {
      const s = a.stats || [];
      const played = !a.didNotPlay && s.length > 0;
      const att = (k) => { const v = played && ix(k) >= 0 ? String(s[ix(k)] || '') : ''; const m = v.match(/^\d+-(\d+)$/); return m ? m[1] : ''; };
      B.push([a.athlete.displayName, t.team.displayName, played ? s[ix('MIN')] : 'DNP', played ? s[ix('PTS')] : '', played ? s[ix('REB')] : '', played ? s[ix('AST')] : '', played ? String(parseInt(s[ix('3PT')]) || 0) : '', played ? s[ix('STL')] : '', played ? s[ix('BLK')] : '',
        att('FG'), att('3PT'), played && ix('PF') >= 0 ? s[ix('PF')] : '', a.starter ? 1 : 0].join('|'));   // 8 Nov 2026: shots, threes attempted, fouls, starter
    }
  }
}
return ('###FINALS\naway|home|away_pts|home_pts|status\n' + F.join('\n') + '\n###BOX\nplayer|team|min|pts|reb|ast|tpm|stl|blk|fga|tpa|pf|starter\n' + B.join('\n') + '\n###FIRST\naway|home|first_scorer|type\n' + FS.join('\n'));
