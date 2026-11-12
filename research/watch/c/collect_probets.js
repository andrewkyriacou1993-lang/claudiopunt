// RotoWire ProBets (OddsJam "liquidity opportunities", region AU-AU) - read-only (8 Nov 2026, Andrew: "start at 1 unit").
// Run on https://www.rotowire.com/betting/probets/ in the built-in browser (javascript_tool), signed in to RotoWire.
// Reads the rendered cards only: never clicks a "Bet" button, never changes the filters.
// Save the output as raw/probets_<DATE>_<HHMM>.txt, then ./add_probets.sh <DATE>.
const LEAGUE = 'NBA';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let grid = null;
for (let i = 0; i < 40 && !grid; i++) {           // the widget renders a few seconds after load
  const H = [...document.querySelectorAll('*')].find(e => e.shadowRoot && e.shadowRoot.textContent.includes('Win Probability'));
  grid = H && [...H.shadowRoot.querySelectorAll('div')].find(d => String(d.className).includes('oj:grid-cols-1') && d.children.length);
  if (!grid) await wait(500);
}
if (!grid) {
  '###PROBETS_ERROR\n' + (/log ?in|sign ?in|subscribe/i.test(document.body.textContent) && !document.body.textContent.includes('Win Probability')
    ? 'not signed in or no ProBets access (ask Andrew to sign in to RotoWire in the built-in browser)' : 'ProBets cards did not load');
} else {
  const now = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
  const rows = [...grid.children].map(c => {
    const leaf = [...c.querySelectorAll('*')].filter(e => !e.children.length && (e.textContent || '').trim() && e.tagName !== 'STYLE').map(e => e.textContent.trim());
    const btn = [...c.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(t => /Bet \$/.test(t)).join(';');
    const books = [...c.querySelectorAll('button img')].map(i => (i.src || '').split('/').pop().split('.')[0]).join(',');
    // leaf: market, pick, game, day, time, league, score, 'Staked', staked, 'Edge', edge, 'Win Probability', win
    const ix = (k) => leaf.indexOf(k);
    return [leaf[5], leaf[0], leaf[1], leaf[2], leaf[3], leaf[4], leaf[6], leaf[ix('Staked') + 1], leaf[ix('Edge') + 1],
      leaf[ix('Win Probability') + 1], btn, books].map(x => String(x || '').replace(/\|/g, '/')).join('|');
  }).filter(r => r.startsWith(LEAGUE + '|'));
  `###PROBETS captured ${now} AEDT\nleague|market|pick|game|day|tip_aedt|score|staked|edge|win_prob|button|books\n` + rows.join('\n');
}
