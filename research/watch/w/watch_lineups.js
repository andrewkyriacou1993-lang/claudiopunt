// page: https://www.nba.com/players/todays-lineups   (built-in browser, javascript_tool; read-only)
// Lineup & injury watcher. The first call installs a poller inside this page (every 30 s: NBA.com's starting-lineups feed,
// ESPN's injury feed, NBA.com's scoreboard for tip times); later calls just read what it found. Keep this tab on this
// page for the whole watch (use other tabs for the bookies). Safe to call repeatedly; it never installs twice, and its
// state lives in this page's localStorage, so a reload or a later session carries on from the last snapshot.
// DATE = the AEDT date being watched (NBA games on it are the previous US date).
// Returns:
//   ###WATCH  now|games_left|next_tip_min|confirmed_teams|teams|last_poll_s_ago|polls
//   ###GAMES  code|tip_aedt|min_to_tip|status|away_lineup|home_lineup        (lineup = Expected / Confirmed / none)
//   ###EVENTS at|code|team|kind|player|detail      (new since the last read; kinds: confirmed, starter_in, starter_out,
//              inactive, active, injury)  — the first read of a day only records the baseline (no events)
//   ###LINEUPS code|team|side|status|starters (';'-joined)   — save as raw/lineups_<D>.txt (first-basket uses it)
//   ###INJURIES team|player|status   (only when any injury or inactive changed since the last read: the full current list
//              in collect_espn.js's format, plus confirmed inactives as Out — save it as raw/espn.txt)
const DATE = '/*DATE*/';
const POLL_MS = 30000;
const US = new Date(new Date(DATE + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10).replace(/-/g, '');
const KEY = 'cp-watch-' + DATE;
const N2US = { BKN: 'BRK', PHX: 'PHO', CHA: 'CHO' };
const aedt = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit' });
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
// ESPN injury status, same rules as collect_espn.js: read the latest note if it is fresh, else ESPN's status
const injStatus = (status, note, dateIso) => {
  const fresh = dateIso && (Date.now() - new Date(dateIso).getTime()) / 864e5 <= 1.6;
  const n = fresh ? (note || '').toLowerCase() : '';
  if (/ruled out|is out|will miss|won't play|out for|out indefinitely|miss the/.test(n)) return 'Out';
  if (/doubtful/.test(n)) return 'Doubtful';
  if (/questionable|game-time decision/.test(n)) return 'Questionable';
  if (/probable|upgraded to available|expected to play|will play/.test(n)) return 'Probable';
  return /out/i.test(status || '') ? 'Out' : 'Questionable';
};
async function poll() {
  const st = load() || { games: {}, teams: {}, inj: {}, events: [], injChanged: false, base: false, polls: 0 };
  const now = new Date().toISOString();
  const get = (u) => fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
  const [L, SB, INJ] = await Promise.all([
    get(`https://stats.nba.com/js/data/leaders/00_daily_lineups_${US}.json`),
    get('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json'),
    get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries')]);
  const ev = (code, team, kind, player, detail) => { if (st.base) st.events.push([aedt(now), code, team, kind, player || '', detail || ''].join('|')); };
  // tip times and game status from the scoreboard (only when it is for our US date)
  if (SB && SB.scoreboard && SB.scoreboard.gameDate.replace(/-/g, '') === US) {
    for (const g of SB.scoreboard.games) {
      const code = (N2US[g.awayTeam.teamTricode] || g.awayTeam.teamTricode) + '@' + (N2US[g.homeTeam.teamTricode] || g.homeTeam.teamTricode);
      const G = st.games[code] = st.games[code] || {};
      Object.assign(G, { tip: g.gameTimeUTC, status: g.gameStatus, away: g.awayTeam.teamName, home: g.homeTeam.teamName });
    }
  }
  // starting lineups
  if (L && L.games) {
    for (const g of L.games) {
      const ab = (t) => N2US[t.teamAbbreviation] || t.teamAbbreviation;
      const code = ab(g.awayTeam) + '@' + ab(g.homeTeam);
      const G = st.games[code] = st.games[code] || {};
      for (const [side, t] of [['away', g.awayTeam], ['home', g.homeTeam]]) {
        const team = ab(t), ps = t.players || [];
        const starters = ps.filter(p => p.position).map(p => p.playerName);
        const status = ps.some(p => p.position && p.lineupStatus === 'Confirmed') ? 'Confirmed' : starters.length ? 'Expected' : 'none';
        const inactive = ps.filter(p => p.rosterStatus && p.rosterStatus !== 'Active').map(p => p.playerName);
        const T = st.teams[team] || { status: 'none', starters: [], inactive: [] };
        if (T.status !== 'Confirmed' && status === 'Confirmed') ev(code, team, 'confirmed', '', starters.join(', '));
        if (T.starters.length && starters.length) {
          for (const p of starters) if (!T.starters.includes(p)) ev(code, team, 'starter_in', p, status);
          for (const p of T.starters) if (!starters.includes(p)) ev(code, team, 'starter_out', p, status);
        }
        for (const p of inactive) if (!T.inactive.includes(p)) { ev(code, team, 'inactive', p, 'NBA lineup feed'); st.injChanged = true; }
        for (const p of T.inactive) if (!inactive.includes(p)) { ev(code, team, 'active', p, 'NBA lineup feed'); st.injChanged = true; }
        st.teams[team] = { status, starters, inactive, code, side };
        G[side + 'Lineup'] = status;
      }
    }
  }
  // ESPN injuries for the teams playing
  if (INJ && INJ.injuries) {
    const playing = Object.values(st.games).flatMap(g => [g.away, g.home]).filter(Boolean);
    const cur = {};
    for (const t of INJ.injuries) {
      const nick = playing.find(n => (t.displayName || '').endsWith(n)); if (!nick) continue;
      for (const i of t.injuries || []) { const nm = i.athlete && i.athlete.displayName; if (nm) cur[t.displayName + '|' + nm] = injStatus(i.status, i.shortComment || i.longComment, i.date); }
    }
    const codeOf = (full) => { const e = Object.entries(st.games).find(([, g]) => full.endsWith(g.away) || full.endsWith(g.home)); return e ? e[0] : ''; };
    for (const [k, s] of Object.entries(cur)) if (st.inj[k] !== s) { const [tm, p] = k.split('|'); ev(codeOf(tm), tm, 'injury', p, (st.inj[k] || 'new') + ' -> ' + s); st.injChanged = true; }
    for (const k of Object.keys(st.inj)) if (!(k in cur)) { const [tm, p] = k.split('|'); ev(codeOf(tm), tm, 'injury', p, st.inj[k] + ' -> off the report'); st.injChanged = true; }
    st.inj = cur;
  }
  st.base = true; st.last = now; st.polls = (st.polls || 0) + 1;
  save(st);
}
if (!window.__cpWatch || window.__cpWatch.date !== DATE) {
  if (window.__cpWatch) clearInterval(window.__cpWatch.timer);
  window.__cpWatch = { date: DATE, timer: setInterval(() => poll().catch(() => {}), POLL_MS) };
  await poll().catch(() => {});
}
const S = load() || { games: {}, teams: {}, events: [], inj: {} };
const nowMs = Date.now();
const left = Object.entries(S.games).filter(([, g]) => g.tip && (g.status || 1) === 1 && new Date(g.tip).getTime() > nowMs - 5 * 60000);
const mins = left.map(([, g]) => Math.round((new Date(g.tip).getTime() - nowMs) / 60000));
const teams = Object.values(S.teams);
const out = ['###WATCH', 'now|games_left|next_tip_min|confirmed_teams|teams|last_poll_s_ago|polls',
  [aedt(new Date().toISOString()), left.length, mins.length ? Math.min(...mins) : '', teams.filter(t => t.status === 'Confirmed').length, teams.length,
   S.last ? Math.round((nowMs - new Date(S.last).getTime()) / 1000) : '', S.polls || 0].join('|'),
  '###GAMES', 'code|tip_aedt|min_to_tip|status|away_lineup|home_lineup',
  ...Object.entries(S.games).map(([c, g]) => [c, g.tip ? aedt(g.tip) : '', g.tip ? Math.round((new Date(g.tip).getTime() - nowMs) / 60000) : '', g.status === 1 ? 'scheduled' : g.status === 2 ? 'live' : g.status === 3 ? 'final' : '', g.awayLineup || 'none', g.homeLineup || 'none'].join('|')),
  '###EVENTS', 'at|code|team|kind|player|detail', ...S.events,
  '###LINEUPS', 'code|team|side|status|starters', ...Object.entries(S.teams).map(([t, v]) => [v.code, t, v.side, v.status, v.starters.join(';')].join('|'))];
if (S.injChanged) {
  const outs = Object.values(S.teams).flatMap(t => t.inactive.map(p => [t.code, t.side, p]));
  const full = (code, side) => { const e = Object.entries(S.games).find(([c]) => c === code); if (!e) return ''; const nick = e[1][side]; const k = Object.keys(S.inj).find(x => x.split('|')[0].endsWith(nick)); return k ? k.split('|')[0] : nick; };
  const rows = Object.entries(S.inj).map(([k, s]) => k + '|' + s);
  for (const [code, side, p] of outs) { const tm = full(code, side); if (!rows.some(r => r.startsWith(tm + '|' + p + '|'))) rows.push(`${tm}|${p}|Out`); else for (let i = 0; i < rows.length; i++) if (rows[i].startsWith(tm + '|' + p + '|')) rows[i] = `${tm}|${p}|Out`; }
  out.push('###INJURIES', 'team|player|status', ...rows);
}
S.events = []; S.injChanged = false; save(S);
return (out.join('\n'));
