// page: https://www.espn.com/nba/   (built-in browser, javascript_tool; read-only public ESPN APIs)
// Full box scores for every regular-season game since /*FROM*/ (YYYYMMDD; an earlier FROM than the cache adds that season too), cached in this page's IndexedDB
// ('nbabt' -> kv 'fullbox'); only games not cached yet are fetched. Runs in the page's background because the
// browser tool times out at ~45 s: call once to start, call again to read progress (window.__FB), then export
// with collect_fullbox_export.js.
// Row: athlete_id|name|team|pos|starter|dnp|min|fgm-fga|3pm-3pa|ftm-fta|oreb|dreb|reb|ast|stl|blk|tov|pf|plusminus|pts
const FROM = "/*FROM*/";
window.__FB = window.__FB || {status:"idle"};
if (window.__FB.status !== "running") {
  window.__FB = {status:"running", done:0, need:0, err:0, started:Date.now()};
  (async()=>{
    const IDB={db:null,async open(){if(this.db)return this.db;return this.db=await new Promise((res,rej)=>{const q=indexedDB.open("nbabt",1);q.onupgradeneeded=()=>q.result.createObjectStore("kv");q.onsuccess=()=>res(q.result);q.onerror=rej;});},async get(k){const db=await this.open();return new Promise(r=>{const q=db.transaction("kv").objectStore("kv").get(k);q.onsuccess=()=>r(q.result);});},async set(k,v){const db=await this.open();return new Promise(r=>{const t=db.transaction("kv","readwrite");t.objectStore("kv").put(v,k);t.oncomplete=r;});}};
    const W="https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba";
    const J=u=>fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
    const ymd=d=>d.toISOString().slice(0,10).replace(/-/g,"");
    let games=(await IDB.get("games"))||{};
    const known=Object.values(games).map(g=>g.date).sort(); let last=known.at(-1)||FROM;
    const toD=s=>new Date(Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8)));
    const end=new Date(); end.setUTCDate(end.getUTCDate()-1);
    // date ranges to scan: forward from the last known date, and (FROM earlier than anything known) the earlier season(s)
    const ranges=[[toD(last),end]]; if(known.length&&FROM<known[0]) ranges.push([toD(FROM),toD(known[0])]);
    for(const [d0,d1] of ranges) for(let d=new Date(d0);d<=d1;d.setUTCDate(d.getUTCDate()+1)){const sb=await J(`${W}/scoreboard?dates=${ymd(d)}`);
      for(const e of (sb&&sb.events)||[]){ if(!(e.status&&e.status.type&&e.status.type.completed))continue; if(e.season&&e.season.type!==2)continue;
        const c=e.competitions[0],h=c.competitors.find(x=>x.homeAway==="home"),a=c.competitors.find(x=>x.homeAway==="away");
        games[e.id]={id:e.id,date:ymd(d),home:h.team.abbreviation,away:a.team.abbreviation};}}
    await IDB.set("games",games);
    const full=(await IDB.get("fullbox"))||{};
    const KEYS=["minutes","fieldGoalsMade-fieldGoalsAttempted","threePointFieldGoalsMade-threePointFieldGoalsAttempted","freeThrowsMade-freeThrowsAttempted","offensiveRebounds","defensiveRebounds","rebounds","assists","steals","blocks","turnovers","fouls","plusMinus","points"];
    const parse=r=>{const out=[];for(const t of (r&&r.boxscore&&r.boxscore.players)||[]){const st=t.statistics&&t.statistics[0];if(!st)continue;const K=st.keys;
      for(const a of st.athletes){const s=a.stats||[];const v=k=>{const i=K.indexOf(k);return i<0?"":s[i];};
        out.push([a.athlete.id,a.athlete.displayName,t.team.abbreviation,(a.athlete.position||{}).abbreviation||"",a.starter?1:0,(a.didNotPlay||!s.length)?1:0,...KEYS.map(v)]);}}
      const sc={}; for(const c of ((r&&r.header&&r.header.competitions&&r.header.competitions[0]&&r.header.competitions[0].competitors)||[])) sc[c.team.abbreviation]=+c.score;
      return {rows:out, score:sc};};
    const need=Object.values(games).filter(g=>g.date>=FROM&&!full[g.id]).sort((a,b)=>b.date.localeCompare(a.date)).map(g=>g.id);
    window.__FB.need=need.length; let k=0, saved=0;
    await Promise.all(Array.from({length:6},async()=>{while(k<need.length){const id=need[k++];const b=parse(await J(`${W}/summary?event=${id}`));
      if(b.rows.length){full[id]=b;} else window.__FB.err++;
      window.__FB.done++; if(++saved%50===0) await IDB.set("fullbox",full);}}));
    await IDB.set("fullbox",full);
    window.__FB.status="done"; window.__FB.total=Object.keys(full).length;
  })().catch(e=>{window.__FB.status="error:"+e;});
}
window.__FB
