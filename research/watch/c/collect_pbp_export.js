// page: https://www.espn.com/nba/  — export the 'pbp' cache (collect_pbp.js) as pipe text. /*SINCE*/ = first US date;
// daily: yesterday's date -> one day's rows (~15 KB) inline, appended to raw/pbp_2026.psv. Full export: SINCE 20251020 and
// /*CHUNK*/ 0,1,2... (600 KB each; `more` says when to stop). Row layout is in collect_pbp.js's header.
const SINCE = "/*SINCE*/", CHUNK = +("/*CHUNK*/" || 0) || 0, SIZE = 600000;
const IDB={db:null,async open(){if(this.db)return this.db;return this.db=await new Promise((res,rej)=>{const q=indexedDB.open("nbabt",1);q.onupgradeneeded=()=>q.result.createObjectStore("kv");q.onsuccess=()=>res(q.result);q.onerror=rej;});},async get(k){const db=await this.open();return new Promise(r=>{const q=db.transaction("kv").objectStore("kv").get(k);q.onsuccess=()=>r(q.result);});}};
const games=(await IDB.get("games"))||{}, pbp=(await IDB.get("pbp"))||{};
const lines=[];
for(const id of Object.keys(pbp).filter(id=>games[id]&&games[id].date>=SINCE).sort((a,b)=>games[a].date.localeCompare(games[b].date))) lines.push(...pbp[id]);
const all=lines.join("\n");
({since:SINCE, games:Object.keys(pbp).filter(id=>games[id]&&games[id].date>=SINCE).length, chunk:CHUNK, total:all.length, more:(CHUNK+1)*SIZE<all.length, text:all.slice(CHUNK*SIZE,(CHUNK+1)*SIZE)})
