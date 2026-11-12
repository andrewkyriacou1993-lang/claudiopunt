// RotoWire lineups, news and projected minutes (8 Nov 2026, Andrew: items 4 "RotoWire's injury and news feed, with
// timestamps" and 5 "rotation and minutes reports"). Read-only: fetches the pages' own data, clicks nothing.
// Run on https://www.rotowire.com/basketball/nba-lineups.php in the built-in browser (javascript_tool), signed in.
// Output (save the whole string as raw/rwlineups_<DATE>_<HHMM>.txt):
//   ###RWLINEUPS game|team|lineup|slot|player|id|play_pct|inj     lineup = Confirmed / Expected; slot = PG..C or MNP
//                                                                (may not play); play_pct = RotoWire's chance to play
//   ###RWREFS    game|refs|ref_ids                               tonight's referee crew
//   ###RWREFSTATS ref_id|ref|season|games|pts|pf|fta             each of tonight's referees, per game, this and last season
//   ###RWMIN     team|player|id|slot|inj|proj|avg|min|max|gap|stdev   RotoWire projected minutes (gap = proj - recent avg)
//   ###RWNEWS    player|team|headline|inj|date|news              newest 25 news items (the run stamps the time it saw them)
// rwlineups.py reads it (props_model.py statuses / minutes flags; rwlineups.py --news for the lineup watch).
const clean = s => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
const out = [`###RWLINEUPS captured ${now} AEDT`, 'game|team|lineup|slot|player|id|play_pct|inj'];
const refs = ['###RWREFS', 'game|refs|ref_ids'], rstats = ['###RWREFSTATS', 'ref_id|ref|season|games|pts|pf|fta'], refIds = {};
const mins = ['###RWMIN', 'team|player|id|slot|inj|proj|avg|min|max|gap|stdev'];
const teams = [];
try {
  const d = new DOMParser().parseFromString(await (await fetch('/basketball/nba-lineups.php', { credentials: 'include' })).text(), 'text/html');
  for (const g of d.querySelectorAll('.lineup.is-nba')) {
    const ab = [...g.querySelectorAll('.lineup__abbr')].map(x => x.textContent.trim());
    if (ab.length < 2) continue;
    const game = `${ab[0]}@${ab[1]}`;
    for (const [side, team] of [['is-visit', ab[0]], ['is-home', ab[1]]]) {
      const ul = g.querySelector(`.lineup__list.${side}`); if (!ul) continue;
      teams.push(team);
      const st = ul.querySelector('.lineup__status'); const lineup = st ? (st.className.includes('is-confirmed') ? 'Confirmed' : 'Expected') : '';
      let mnp = false;
      for (const li of ul.querySelectorAll('li')) {
        if (li.classList.contains('lineup__title')) { mnp = true; continue; }
        if (!li.classList.contains('lineup__player')) continue;
        const a = li.querySelector('a'); if (!a) continue;
        const id = ((a.getAttribute('href') || '').match(/-(\d+)$/) || [])[1] || '';
        const pct = ((li.className.match(/is-pct-play-(\d+)/) || [])[1]) || '';
        const pos = (li.querySelector('.lineup__pos') || {}).textContent || '';
        const inj = (li.querySelector('.lineup__inj') || {}).textContent || '';
        out.push([game, team, lineup, mnp ? 'MNP' : clean(pos), clean(a.getAttribute('title') || a.textContent), id, pct, clean(inj)].join('|'));
      }
    }
    const rm = g.innerHTML.match(/Referees:[\s\S]*?<\/div>/);
    if (rm) {
      const ids = [...rm[0].matchAll(/ref\.php\?id=(\d+)">([^<]+)</g)];
      ids.forEach(m => refIds[m[1]] = clean(m[2]));
      refs.push(`${game}|${clean(rm[0].replace(/<[^>]+>/g, '').replace('Referees:', '').replace(/&nbsp;/g, ' '))}|${ids.map(m => m[1]).join(',')}`);
    }
  }
  for (const t of teams) {
    try {
      const j = await (await fetch('/basketball/ajax/get-projected-minutes.php?team=' + t, { credentials: 'include' })).json();
      for (const p of j || []) mins.push([t, clean(p.name), p.id, p.lineup, p.inj, p.proj, p.avg, p.min, p.max, p.gap, (+p.stdev || 0).toFixed(2)].join('|'));
    } catch (e) { mins.push(`${t}|ERROR ${clean(e)}||||||||||`); }
    await new Promise(r => setTimeout(r, 300));
  }
  for (const [id, nm] of Object.entries(refIds)) {
    try {
      const j = await (await fetch('/basketball/tables/stats-for-ref.php?perGame=game&id=' + id, { credentials: 'include' })).json();
      for (const x of (j || []).slice(0, 2)) rstats.push([id, nm, clean(x.season).replace('&ndash;', '-'), x.games, x.gamepts, x.gamepf, x.gamefta].join('|'));
    } catch (e) { rstats.push(`${id}|${nm}|ERROR||||`); }
    await new Promise(r => setTimeout(r, 250));
  }
} catch (e) { out[0] = `###RWLINEUPS_ERROR ${clean(e)}`; }
const news = ['###RWNEWS', 'player|team|headline|inj|date|news'];
try {
  const n = new DOMParser().parseFromString(await (await fetch('/basketball/news.php', { credentials: 'include' })).text(), 'text/html');
  for (const it of n.querySelectorAll('.news-update')) {
    const q = s => clean((it.querySelector(s) || {}).textContent || '');
    const logo = it.querySelector('.news-update__logo');
    news.push([q('.news-update__player-link'), logo ? logo.getAttribute('alt') : '', q('.news-update__headline'), q('.news-update__inj'),
      q('.news-update__timestamp'), q('.news-update__news').slice(0, 240)].join('|'));
  }
} catch (e) { news.push(`ERROR ${clean(e)}|||||`); }
return ([...out, ...refs, ...rstats, ...mins, ...news].join('\n'));
