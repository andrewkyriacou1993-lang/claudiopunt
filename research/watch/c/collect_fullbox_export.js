// page: https://www.espn.com/nba/  — export the 'fullbox' cache (collect_fullbox.js) as pipe-separated text.
// /*SINCE*/ = first US date to include (YYYYMMDD). Daily use: yesterday's US date -> one day's rows (~25 KB), returned
// inline; append them to raw/fullbox_2026.psv (bottomup.py build drops duplicate game ids). For a full re-export set
// SINCE to 20251020 and read the result in chunks (/*CHUNK*/ 0,1,2... of 600 KB; `more` says when to stop).
// Lines: game_id|date|away|home|away_score|home_score|athlete_id|name|team|pos|starter|dnp|min|fgm-fga|3pm-3pa|ftm-fta|oreb|dreb|reb|ast|stl|blk|tov|pf|plusminus|pts
const SINCE = "/*SINCE*/", CHUNK = +("/*CHUNK*/" || 0) || 0, SIZE = 600000;
const IDB={db:null,async open(){if(this.db)return this.db;return this.db=await new Promise((res,rej)=>{const q=indexedDB.open("nbabt",1);q.onupgradeneeded=()=>q.result.createObjectStore("kv");q.onsuccess=()=>res(q.result);q.onerror=rej;});},async get(k){const db=await this.open();return new Promise(r=>{const q=db.transaction("kv").objectStore("kv").get(k);q.onsuccess=()=>r(q.result);});}};
const games=(await IDB.get("games"))||{}, full=(await IDB.get("fullbox"))||{};
const lines=[];
for(const id of Object.keys(full).filter(id=>games[id]&&games[id].date>=SINCE).sort((a,b)=>games[a].date.localeCompare(games[b].date))){const g=games[id], b=full[id];
  const head=[id,g.date,g.away,g.home,b.score[g.away]??"",b.score[g.home]??""].join("|");
  for(const r of b.rows) lines.push(head+"|"+r.join("|"));}
const all=lines.join("\n");
({since:SINCE, games:new Set(lines.map(l=>l.split("|")[0])).size, chunk:CHUNK, total:all.length, more:(CHUNK+1)*SIZE<all.length, text:all.slice(CHUNK*SIZE,(CHUNK+1)*SIZE)})
