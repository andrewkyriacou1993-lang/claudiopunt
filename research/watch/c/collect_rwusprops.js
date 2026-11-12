// US bookmaker player props via RotoWire (8 Nov 2026, Andrew: sharper reference prices). Read-only.
// Run on https://www.rotowire.com/betting/nba/player-props.php in the built-in browser (javascript_tool), signed in.
// The page carries every prop at ~10 US books (DraftKings, FanDuel, Caesars, BetMGM, BetRivers, Hard Rock, Fanatics,
// theScore, Betr US, Circa). Output (compact, ~45 KB): ###USPROPSC player|team|opp|stat|line|n|p_over|circa_over - one row per
// player, stat and line: how many US books hang it, their average over chance with the margin removed, and Circa's (%).
// Set FULL = true for the per-book rows instead (###USPROPS player|team|opp|stat|book|line|over|under, ~280 KB).
// Save as raw/usprops_<DATE>_<HHMM>.txt. props_model.py / props_extra.py mix these into the market price (usprops.py).
const html = await fetch(location.pathname, { credentials: 'include' }).then(r => r.text());
const arrs = [...html.matchAll(/data\s*:\s*(\[\{[\s\S]*?\}\])\s*[,}]/g)].map(m => { try { return JSON.parse(m[1]); } catch (e) { return null; } }).filter(a => Array.isArray(a) && a.length);
const STAT = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', threes: 'Threes', blk: 'Blocks', stl: 'Steals', ptsrebast: 'PRA', ptsreb: 'P+R', ptsast: 'P+A', rebast: 'R+A' };
const dec = (a) => { a = Number(a); if (!a) return ''; return (a > 0 ? 1 + a / 100 : 1 + 100 / -a).toFixed(3); };
const seen = new Set(), out = [];
for (const arr of arrs) for (const r of arr) {
  if (!r.name) continue;
  for (const k of Object.keys(r)) {
    const m = k.match(/^([a-z]+)_([a-z]+)$/); if (!m || !STAT[m[2]]) continue;
    const [_, book, st] = m, line = r[k], o = r[`${book}_${st}Over`], u = r[`${book}_${st}Under`];
    if (line === '' || line == null || !o || !u) continue;
    const key = [r.name, st, book].join('|'); if (seen.has(key)) continue; seen.add(key);
    out.push([r.name, r.team, String(r.opp || '').replace('@', ''), STAT[st], book, line, dec(o), dec(u)].join('|'));
  }
}
const FULL = false;
const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
let res;
if (!out.length) res = '###USPROPS_ERROR\nno prop data on the page (signed out, no games, or the page changed)';
else if (FULL) res = `###USPROPS captured ${now} AEDT\nplayer|team|opp|stat|book|line|over|under\n` + out.join('\n');
else {
  const g = {};
  for (const l of out) {
    const [p, t, o, s, b, ln, ov, un] = l.split('|'); const k = [p, t, o, s, ln].join('|');
    const po = (1 / ov) / (1 / ov + 1 / un); g[k] = g[k] || { n: 0, sum: 0, c: '' };
    g[k].n++; g[k].sum += po; if (b === 'circasports') g[k].c = (po * 100).toFixed(1);
  }
  res = `###USPROPSC captured ${now} AEDT (10 US books, margin removed)\nplayer|team|opp|stat|line|n|p_over|circa_over\n` +
        Object.entries(g).map(([k, v]) => `${k}|${v.n}|${(v.sum / v.n * 100).toFixed(1)}|${v.c}`).join('\n');
}
res;
