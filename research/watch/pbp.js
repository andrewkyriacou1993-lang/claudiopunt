// page: https://www.espn.com/nba/   (built-in browser, javascript_tool; read-only public ESPN API)
// Play-by-play -> on-court possessions per player-game, computed in the page (so only a small table leaves the browser).
// Background job like collect_fullbox.js: first call starts it, later calls return window.__PBP (status/progress);
// results cache in IndexedDB 'nbabt' -> 'pbp' (per game) so only new games are fetched. Export with collect_pbp_export.js.
// /*FROM*/ = first US date (YYYYMMDD); /*ONE*/ = a single event id to (re)process and return in full (testing), or "".
// Per player-game row: gid|date|team|pid|name|sec_on|oposs|dposs|pts_for|pts_against|fga_on|fta_on|tov_on|own_fga|own_fta|own_tov|own_pts|own_ast|own_reb
//   sec_on       seconds on court (compare with box minutes: the lineup logic is validated by this)
//   oposs/dposs  team offensive / defensive possessions ended while he was on court
//   pts_for/against  team points scored / allowed while on court
//   fga_on/fta_on/tov_on  team shot attempts / free throws / turnovers while on court (usage denominator)
//   own_*        his own events while on court (should equal the box score)
// Lineups: starters from the box score; substitution plays move players; at each period start the five are rebuilt from who
// acts before being subbed in (NBA play-by-play has no sub events at quarter breaks).
const FROM = "/*FROM*/", ONE = "/*ONE*/";
window.__PBP = window.__PBP || { status: "idle" };
if (window.__PBP.status !== "running") {
  window.__PBP = { status: "running", done: 0, need: 0, err: 0, started: Date.now() };
  (async () => {
    const IDB = { db: null, async open() { if (this.db) return this.db; return this.db = await new Promise((res, rej) => { const q = indexedDB.open("nbabt", 1); q.onupgradeneeded = () => q.result.createObjectStore("kv"); q.onsuccess = () => res(q.result); q.onerror = rej; }); },
      async get(k) { const db = await this.open(); return new Promise(r => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => r(q.result); }); },
      async set(k, v) { const db = await this.open(); return new Promise(r => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = r; }); } };
    const W = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba";
    const J = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    const games = (await IDB.get("games")) || {};
    const pbp = (await IDB.get("pbp")) || {};
    const secs = (p) => { const m = /^(\d+):(\d+)/.exec((p.clock || {}).displayValue || "0:00"); const left = m ? (+m[1]) * 60 + (+m[2]) : 0; const per = p.period.number; const plen = per <= 4 ? 720 : 300; const before = per <= 4 ? (per - 1) * 720 : 2880 + (per - 5) * 300; return before + (plen - left); };
    function process(r, g) {
      const teams = {}; const pteam = {}, pname = {}, starters = {};
      for (const t of (r.boxscore && r.boxscore.players) || []) { const id = t.team.id; teams[id] = t.team.abbreviation; starters[id] = []; const st = t.statistics && t.statistics[0]; if (!st) continue;
        for (const a of st.athletes) { pteam[a.athlete.id] = id; pname[a.athlete.id] = a.athlete.displayName; if (a.starter) starters[id].push(a.athlete.id); } }
      const tids = Object.keys(teams); if (tids.length !== 2) return null;
      const other = id => tids[0] === id ? tids[1] : tids[0];
      const plays = (r.plays || []).map(p => ({ t: secs(p), per: p.period.number, team: p.team && p.team.id, txt: p.text || "", type: ((p.type || {}).text || ""), sc: !!p.scoringPlay, sv: p.scoreValue || 0,
        hs: p.homeScore, as: p.awayScore, ids: (p.participants || []).map(x => x.athlete && x.athlete.id).filter(Boolean) }));
      // event classes
      const cls = p => { const ty = p.type.toLowerCase(), tx = p.txt.toLowerCase();
        if (ty === "substitution") return "SUB"; if (ty.startsWith("end ")) return "END"; if (ty.includes("timeout")) return "TO";
        if (ty.startsWith("free throw")) return "FT"; if (ty.includes("rebound")) return tx.includes("offensive") ? "OREB" : "DREB";
        if (ty.includes("turnover") || ty === "traveling" || ty.includes("3-seconds") && !ty.includes("defensive")) return "TOV";
        if (ty.includes("foul") || ty.includes("challenge") || ty === "jumpball" || ty.includes("ejection") || ty.includes("violation")) return "OTHER";
        if (tx.includes("misses") || tx.includes("makes") || tx.includes("blocks") || ty.includes("shot") || ty.includes("layup") || ty.includes("dunk")) return "FGA"; return "OTHER"; };
      // lineup state
      const on = {}; for (const id of tids) on[id] = new Set(starters[id]);
      const acc = {}; const row = pid => acc[pid] = acc[pid] || { sec: 0, oposs: 0, dposs: 0, pf: 0, pa: 0, fga_on: 0, fta_on: 0, tov_on: 0, fga: 0, fta: 0, tov: 0, pts: 0, ast: 0, reb: 0 };
      for (const pid of Object.keys(pteam)) row(pid);
      let lastT = 0;
      const credit = (dt) => { for (const id of tids) for (const pid of on[id]) row(pid).sec += dt; };
      const rebuild = (per, from) => {    // period start: who really began the period?
        for (const id of tids) {
          const subbedIn = new Set(), subbedOut = new Set(), acted = new Set();
          for (let k = from; k < plays.length && plays[k].per === per; k++) { const p = plays[k]; const c = cls(p);
            if (c === "SUB" && p.ids.length === 2 && pteam[p.ids[0]] === id) { if (!subbedOut.has(p.ids[0]) && !acted.has(p.ids[0])) subbedIn.add(p.ids[0]); subbedOut.add(p.ids[1]); if (!subbedIn.has(p.ids[1]) && !subbedOut.has(p.ids[1])) { /* out before in: on court at start */ acted.add(p.ids[1]); } }
            else if (c !== "SUB" && c !== "END" && c !== "TO") for (const x of p.ids) if (pteam[x] === id && !subbedIn.has(x)) acted.add(x); }
          const cur = new Set([...on[id]].filter(x => !subbedIn.has(x)));
          for (const x of acted) cur.add(x);
          if (cur.size > 5) { const noAct = [...cur].filter(x => !acted.has(x)); for (const x of noAct) { if (cur.size <= 5) break; cur.delete(x); } }
          if (cur.size > 5) { const arr = [...cur]; while (cur.size > 5) cur.delete(arr.pop()); }
          on[id] = cur; }
      };
      let per = 0; const stintPts = {};
      for (let k = 0; k < plays.length; k++) { const p = plays[k];
        if (p.per !== per) { per = p.per; if (per > 1) rebuild(per, k); lastT = p.t; }
        const dt = Math.max(0, p.t - lastT); if (dt) credit(dt); lastT = p.t;
        const c = cls(p); const tm = p.team;
        if (c === "SUB" && p.ids.length === 2) { const id = pteam[p.ids[0]] || tm; if (id) { on[id].delete(p.ids[1]); on[id].add(p.ids[0]); } continue; }
        if (!tm || !teams[tm]) continue;
        const opp = other(tm);
        const bump = (teamId, f, v = 1) => { for (const pid of on[teamId]) row(pid)[f] += v; };
        if (c === "FGA") { bump(tm, "fga_on"); const sh = p.ids[0]; if (sh && pteam[sh] === tm) { row(sh).fga++; }
          if (p.sc) { bump(tm, "pf", p.sv); bump(opp, "pa", p.sv); if (sh) row(sh).pts += p.sv; const a = p.ids[1]; if (a && pteam[a] === tm) row(a).ast++;
            // possession ends on a made FG unless an and-1 free throw follows at the same clock
            const nxt = plays[k + 1]; const andone = nxt && cls(nxt) === "FT" && nxt.team === tm && Math.abs(nxt.t - p.t) <= 1 && /1 of 1/.test(nxt.type);
            if (!andone) { bump(tm, "oposs"); bump(opp, "dposs"); } } }
        else if (c === "FT") { const tech = /technical/i.test(p.type); if (!tech) bump(tm, "fta_on"); const sh = p.ids[0]; if (sh && pteam[sh] === tm && !tech) row(sh).fta++;
          if (p.sc) { bump(tm, "pf", 1); bump(opp, "pa", 1); if (sh) row(sh).pts += 1; }
          const last = /1 of 1|2 of 2|3 of 3/.test(p.type); if (last && p.sc && !tech) { bump(tm, "oposs"); bump(opp, "dposs"); } }
        else if (c === "DREB") { const rb = p.ids[0]; if (rb && pteam[rb] === tm) row(rb).reb++; bump(tm, "dposs"); bump(opp, "oposs"); }
        else if (c === "OREB") { const rb = p.ids[0]; if (rb && pteam[rb] === tm) row(rb).reb++; }
        else if (c === "TOV") { bump(tm, "tov_on"); const pl = p.ids[0]; if (pl && pteam[pl] === tm) row(pl).tov++; bump(tm, "oposs"); bump(opp, "dposs"); }
      }
      const out = [];
      for (const pid of Object.keys(acc)) { const a = acc[pid]; if (!a.sec && !a.fga && !a.reb) continue;
        out.push([g.id, g.date, teams[pteam[pid]], pid, pname[pid], Math.round(a.sec), a.oposs, a.dposs, a.pf, a.pa, a.fga_on, a.fta_on, a.tov_on, a.fga, a.fta, a.tov, a.pts, a.ast, a.reb].join("|")); }
      return out;
    }
    if (ONE) { const r = await J(`${W}/summary?event=${ONE}`); const g = games[ONE] || { id: ONE, date: "" }; window.__PBP = { status: "done", one: process(r, g) }; return; }
    const need = Object.values(games).filter(g => g.date >= FROM && !pbp[g.id]).sort((a, b) => b.date.localeCompare(a.date));
    window.__PBP.need = need.length; let k = 0, saved = 0;
    await Promise.all(Array.from({ length: 5 }, async () => { while (k < need.length) { const g = need[k++];
      try { const r = await J(`${W}/summary?event=${g.id}`); const rows = r && process(r, g); if (rows && rows.length) pbp[g.id] = rows; else window.__PBP.err++; } catch (e) { window.__PBP.err++; }
      window.__PBP.done++; if (++saved % 50 === 0) await IDB.set("pbp", pbp); } }));
    await IDB.set("pbp", pbp);
    window.__PBP.status = "done"; window.__PBP.total = Object.keys(pbp).length;
  })().catch(e => { window.__PBP.status = "error:" + e; });
}
window.__PBP
