/* ClashDex: local, read-only scouting of the engine catalog. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(v,max)=>Math.min(100,Math.max(0,100*num(v)/Math.max(1,max)));
const color=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v:'#8290b6';
export const metrics=[['hp','Combat HP'],['atk','Combat Attack'],['def','Combat Defense'],['spd','Combat Speed'],['bst','Base stat total (BST)'],['base.hp','Base HP'],['base.atk','Base Attack'],['base.def','Base Defense'],['base.spa','Base Sp. Attack'],['base.spd','Base Sp. Defense'],['base.spe','Base Speed'],['coverage','Type coverage'],['resist','Type resistances'],['learn','Compatible TMs']];
const labels=Object.fromEntries(metrics);
export function entriesFor(c){
 return c.species.flatMap(p=>{
  const base={...p,key:p.id+':0',speciesId:p.id,form:0};
  return [base,...(p.megaForms||[]).map(m=>({...base,...m,id:p.id,key:p.id+':'+m.form,speciesId:p.id,form:m.form,base:m.base||null}))];
 });
}
function eff(c,a,ts){return ts.reduce((v,t)=>v*(c.typeMatrix?.[a]?.[t]??1),1)}
function outgoing(c,p,t){return Math.max(...p.types.map(a=>eff(c,a,[t])))}
export function metric(c,p,k){
 if(k==='coverage')return Object.keys(c.types).filter(t=>outgoing(c,p,t)>1).length;
 if(k==='resist')return Object.keys(c.types).filter(t=>eff(c,t,p.types)<1).length;
 if(k==='learn')return p.learn.filter(t=>t!==p.innate).length;
 if(k.startsWith('base.'))return num(p.base?.[k.slice(5)]);
 return num(p[k]);
}
export function filterDex(c,entries,f,favorites=new Set()){
 const q=(f.q||'').trim().toLowerCase(),threshold=f.min===''||f.min==null?null:Number(f.min);
 const rows=entries.filter(p=>{
  if(f.forms==='base'&&p.form||f.forms==='mega'&&!p.form)return false;
  if(f.rarity&&p.rarity!==f.rarity||f.role&&p.role!==f.role||f.type&&!p.types.includes(f.type)||f.type2&&!p.types.includes(f.type2))return false;
  if(f.ability&&p.ability!==f.ability||f.tm&&!p.learn.includes(f.tm)||f.ranged==='ranged'&&!p.ranged||f.ranged==='melee'&&p.ranged)return false;
  if(f.stage==='final'&&p.evolutions?.length||f.stage==='first'&&p.previous)return false;
  if(f.megaOnly&&!p.megaForms?.length||f.dual&&p.types.length<2||f.favorites&&!favorites.has(p.key))return false;
  if(threshold!==null&&Number.isFinite(threshold)&&metric(c,p,f.minStat)<threshold)return false;
  const words=[p.name,p.speciesId,p.ability,p.role,p.rarity,...p.types.map(t=>c.types[t]),...p.learn.map(t=>c.skills[t]),...p.mega].join(' ').toLowerCase();
  return !q||q.split(/\s+/).every(w=>words.includes(w)||String(Number(p.speciesId))===w);
 });
 const dir=f.dir==='asc'?1:-1;
 return rows.sort((a,b)=>{
  const delta=f.sort==='name'?a.name.localeCompare(b.name):f.sort==='id'?Number(a.speciesId)-Number(b.speciesId)||a.form-b.form:metric(c,a,f.sort)-metric(c,b,f.sort);
  return delta*dir||a.name.localeCompare(b.name)||a.key.localeCompare(b.key);
 });
}
function options(rows,selected){return rows.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(l)+'</option>').join('')}
function typeChip(c,t){return '<span class="cx-type" style="--chip:'+color(c.typeColors?.[t])+'">'+esc(c.types[t]||t)+'</span>'}
function statBar(label,v,max,kind,delta=null){return '<div class="cx-stat"><span>'+esc(label)+'</span><div class="cx-track" role="meter" aria-label="'+esc(label)+'" aria-valuemin="0" aria-valuemax="'+max+'" aria-valuenow="'+num(v)+'"><i class="cx-fill '+kind+'" style="--fill:'+pct(v,max).toFixed(1)+'%"></i></div><strong>'+num(v)+'</strong>'+(delta!==null?'<small class="'+(delta>0?'cx-pos':delta<0?'cx-neg':'')+'">'+(delta>0?'+':'')+delta+'</small>':'')+'</div>'}
function readFavorites(){try{return new Set(JSON.parse(localStorage.getItem('clashdex-favorites-v1')||'[]').filter(v=>typeof v==='string'))}catch{return new Set()}}
function saveFavorites(v){try{localStorage.setItem('clashdex-favorites-v1',JSON.stringify([...v]))}catch{}}
const defaults=()=>({q:'',rarity:'',type:'',type2:'',role:'',ability:'',tm:'',ranged:'',stage:'',forms:'base',sort:'id',dir:'asc',minStat:'spd',min:'',megaOnly:false,dual:false,favorites:false});
export function mountDex(api){
 const d=document.createElement('dialog');d.className='dex-dialog clashdex-v2';d.setAttribute('aria-labelledby','cx-title');
 d.innerHTML=`<header class="dialog-head cx-head"><div><div class="cx-eyebrow">CLASHLAB / SCOUTING DATABASE</div><h2 id="cx-title">ClashDex</h2></div><button class="icon-btn" data-close aria-label="Close Pokédex">×</button></header>
 <div class="cx-workspace">
 <section class="cx-browser" aria-label="Browse Pokémon">
 <div class="cx-search"><input id="dex-query" type="search" autocomplete="off" placeholder="Search name, #, ability, TM…" aria-label="Search Pokémon"><button class="quiet" data-reset>Reset</button></div>
 <div class="cx-quick" aria-label="Quick rankings"><button data-sort="id">Dex #</button><button data-sort="spd">Fastest</button><button data-sort="atk">Attack</button><button data-sort="def">Defense</button><button data-sort="hp">HP</button><button data-sort="bst">BST</button><button data-sort="coverage">Coverage</button><button data-sort="resist">Resistances</button></div>
 <div class="cx-sortline"><label>Sort by<select data-filter="sort" aria-label="Sort Pokémon"></select></label><button class="secondary" data-direction aria-label="Change sort direction">↑</button><label>Forms<select data-filter="forms"><option value="base">Base only</option><option value="both">Base + Mega</option><option value="mega">Mega only</option></select></label></div>
 <details class="dex-filters cx-filters"><summary>Advanced filters <span data-filter-count></span></summary><div class="cx-filter-grid">
 <label>Rarity<select data-filter="rarity"></select></label><label>Type<select data-filter="type"></select></label><label>Second type<select data-filter="type2"></select></label><label>Role<select data-filter="role"></select></label><label>Ability<select data-filter="ability"></select></label><label>TM<select data-filter="tm"></select></label><label>Range<select data-filter="ranged"><option value="">Any</option><option value="melee">Melee</option><option value="ranged">Ranged</option></select></label><label>Evolution stage<select data-filter="stage"><option value="">All stages</option><option value="first">First stage</option><option value="final">Final stage</option></select></label><label>Minimum stat<select data-filter="minStat"></select></label><label>At least<input data-filter="min" type="number" min="0" max="9999" placeholder="No minimum"></label></div>
 <div class="cx-checks"><label><input type="checkbox" data-filter="megaOnly"> Mega capable</label><label><input type="checkbox" data-filter="dual"> Dual-type</label><label><input type="checkbox" data-filter="favorites"> Favorites only</label></div></details>
 <div class="cx-results-head"><span id="dex-count" role="status"></span><button class="quiet" data-compare-open disabled>Compare (0/2)</button></div><div id="dex-results" class="cx-list"></div><button id="dex-more" class="secondary">Load more</button>
 </section><section class="cx-profile" aria-label="Pokémon profile"><div data-profile></div></section></div>`;
 document.body.append(d);
 const $=s=>d.querySelector(s),all=s=>[...d.querySelectorAll(s)];
 let c,entries=[],byKey=new Map(),bySpecies=new Map(),f=defaults(),favorites=readFavorites(),pins=[],rows=[],limit=30,selected=null,view='profile',tab='battle',level=1;
 const notice=msg=>{const el=$('[data-dex-notice]');if(el)el.textContent=msg;};
 const updateCount=()=>{const b=$('[data-compare-open]');b.textContent='Compare ('+pins.length+'/2)';b.disabled=pins.length!==2;};
 function initFilters(){
  const distinct=(key)=>[...new Set(c.species.map(p=>p[key]))].filter(Boolean).sort().map(v=>[v,v]);
  const set=(key,values)=>{$('[data-filter="'+key+'"]').innerHTML=options(values,f[key])};
  set('sort',[['id','Dex number'],['name','Name'],...metrics]);
  set('minStat',metrics);
  set('rarity',[['','All rarities'],...distinct('rarity')]);
  set('role',[['','All roles'],...distinct('role')]);
  set('ability',[['','All abilities'],...distinct('ability')]);
  set('tm',[['','All TMs'],...Object.entries(c.skills).sort((a,b)=>a[1].localeCompare(b[1]))]);
  const ts=[['','Any type'],...Object.entries(c.types).sort((a,b)=>a[1].localeCompare(b[1]))];set('type',ts);set('type2',ts);
  sync();
 }
 function sync(){
  $('#dex-query').value=f.q;
  all('[data-filter]').forEach(el=>{const v=f[el.dataset.filter];if(el.type==='checkbox')el.checked=!!v;else el.value=v??'';});
  $('[data-direction]').textContent=f.dir==='asc'?'↑':'↓';
  $('[data-direction]').title=f.dir==='asc'?'Ascending · click for descending':'Descending · click for ascending';
  all('[data-sort]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sort===f.sort)));
  const count=['rarity','type','type2','role','ability','tm','ranged','stage','megaOnly','dual','favorites','min'].filter(k=>f[k]!==''&&f[k]!==false&&f[k]!=null).length;
  $('[data-filter-count]').textContent=count?count+' active':'';
 }
 function pic(p,cls=''){const src=api.portrait(p.speciesId,p.portrait);return '<img class="'+cls+'" data-portrait="'+esc(p.speciesId)+'" src="'+esc(src)+'" alt="" width="64" height="64">'}
 function renderList(){
  rows=filterDex(c,entries,f,favorites);sync();updateCount();
  $('#dex-count').textContent=rows.length+' '+(f.forms==='base'?'Pokémon':'forms')+' · '+(f.sort==='id'?'Dex #':f.sort==='name'?'Name':labels[f.sort])+' '+(f.dir==='asc'?'↑':'↓');
  $('#dex-results').innerHTML=rows.slice(0,limit).map((p,i)=>{
   const value=f.sort==='id'?'#'+p.speciesId:f.sort==='name'?'#'+p.speciesId:metric(c,p,f.sort);
   return '<article class="cx-row'+(selected===p.key?' cx-selected':'')+'" style="--rar:'+color(p.rarityColor)+'"><button class="cx-open" data-pokemon="'+esc(p.key)+'" aria-label="View '+esc(p.name)+' profile" aria-current="'+(selected===p.key?'true':'false')+'"><span class="cx-rank">'+(f.sort==='id'?'#'+esc(p.speciesId):String(i+1).padStart(2,'0'))+'</span>'+pic(p)+'<span class="cx-row-text"><strong>'+esc(p.name)+'</strong><span class="cx-rarity">'+esc(p.rarity)+(p.form?' · Mega':'')+'</span><span class="cx-type-line">'+p.types.map(t=>typeChip(c,t)).join('')+'</span></span><span class="cx-metric">'+esc(value)+'<small>'+esc(f.sort==='id'||f.sort==='name'?'Dex':labels[f.sort]?.replace('Combat ','').replace('Base stat total (BST)','BST'))+'</small></span></button><button class="cx-star" data-favorite="'+esc(p.key)+'" aria-label="'+(favorites.has(p.key)?'Remove':'Add')+' '+esc(p.name)+' favorite" aria-pressed="'+favorites.has(p.key)+'">'+(favorites.has(p.key)?'★':'☆')+'</button></article>';
  }).join('')||'<div class="cx-empty"><strong>No matching Pokémon</strong><p>Try removing a filter or clearing the search.</p><button class="secondary" data-reset>Clear all filters</button></div>';
  $('#dex-more').hidden=rows.length<=limit;$('#dex-more').textContent='Load '+Math.min(30,Math.max(0,rows.length-limit))+' more ('+Math.min(rows.length,limit)+' / '+rows.length+')';
  api.requestPortraits();
 }
 function showProfile(key,move=true){
  if(!byKey.has(key))return;
  selected=key;view='profile';
  if(move)d.classList.add('cx-detail-open');
  renderProfile();all('[data-pokemon]').forEach(b=>{const active=b.dataset.pokemon===key;b.setAttribute('aria-current',String(active));b.closest('.cx-row').classList.toggle('cx-selected',active)});
  if(move)$('[data-profile]').scrollIntoView({block:'nearest'});
  api.requestPortraits();
 }
 function statGroup(p){
  const base=byKey.get(p.speciesId+':0'),factor=1+.05*(level-1);
  const stats=tab==='base'?[['HP','hp'],['Attack','atk'],['Defense','def'],['Sp. Attack','spa'],['Sp. Defense','spd'],['Speed','spe']]:[['HP','hp'],['Attack','atk'],['Defense','def'],['Speed','spd']];
  return stats.map(([label,k],i)=>{
   const val=tab==='base'?num(p.base?.[k]):Math.round(num(p[k])*(k==='spd'?1:factor));
   const max=tab==='base'?Math.max(255,...entries.map(e=>num(e.base?.[k]))):Math.ceil(Math.max(...entries.map(e=>num(e[k])))*(k==='spd'?1:factor)/10)*10;
   const delta=p.form?(tab==='base'?val-num(base.base?.[k]):val-Math.round(num(base[k])*(k==='spd'?1:factor))):null;
   return statBar(label,val,max,'cx-c'+i,delta);
  }).join('');
 }
 function matchup(p){
  const groups=[['Weak to',v=>v>1],['Resists',v=>v<1],['Neutral',v=>v===1]];
  return groups.map(([label,test])=>{const cells=Object.keys(c.types).map(t=>[t,eff(c,t,p.types)]).filter(([,v])=>test(v)).sort((a,b)=>b[1]-a[1]);return '<div class="cx-matchup"><h4>'+label+' <small>'+cells.length+'</small></h4><div class="cx-effect-grid">'+(cells.map(([t,v])=>'<div>'+typeChip(c,t)+'<b class="'+(v>1?'cx-neg':v<1?'cx-pos':'')+'">×'+v+'</b></div>').join('')||'<span class="cx-muted">None</span>')+'</div></div>'}).join('');
 }
 function evolution(p){
  const list=[];if(p.previous&&bySpecies.has(p.previous))list.push('<button class="secondary" data-pokemon="'+esc(p.previous+':0')+'">← '+esc(bySpecies.get(p.previous).name)+'</button>');
  for(const e of p.evolutions||[])if(bySpecies.has(e.to))list.push('<button class="secondary" data-pokemon="'+esc(e.to+':0')+'">'+esc(bySpecies.get(e.to).name)+' → <small>'+esc(e.lv?'Lv '+e.lv:e.how||'Evolution')+'</small></button>');
  return list.join('')||'<span class="cx-muted">No linked evolutions in the game catalog.</span>';
 }
 function teamActions(p){
  return api.getTeams().map((team,i)=>{
   const duplicate=team.some(m=>m?.id===p.speciesId),empty=team.findIndex(m=>!m),name='Team '+(i?'B':'A');
   const choices=team.flatMap((m,j)=>m?[[String(j),(j+1)+'. '+(bySpecies.get(m.id)?.name||m.id)]]:[]);
   const select=empty<0&&!duplicate?'<select data-slot="'+i+'" aria-label="Replace '+name+' slot"><option value="">Choose replacement…</option>'+options(choices,'')+'</select>':'';
   return '<div class="cx-team-action">'+select+'<button class="'+(i?'secondary':'primary')+'" data-add-team="'+i+'"'+(duplicate||!api.canEdit()?' disabled':'')+'>'+ (duplicate?'Already in '+name:empty<0?'Replace in '+name:'Add to '+name)+'</button></div>';
  }).join('');
 }
 function renderProfile(){
  const p=byKey.get(selected);if(!p){$('[data-profile]').innerHTML='<div class="cx-empty"><h3>Select a Pokémon</h3><p>Click a name to scout stats, moves, matchups and Mega forms.</p></div>';return}
  const base=bySpecies.get(p.speciesId), forms=[base,...(base.megaForms||[]).map(m=>byKey.get(base.id+':'+m.form)).filter(Boolean)];
  const speeds=entries.filter(e=>!e.form),rank=1+speeds.filter(e=>e.spd>base.spd).length;
  const abilities=(p.abilityEffects||[]).map((v,i)=>'<div><b>Rank '+['I','II','III'][i]+'</b><span>'+esc(v)+'</span></div>').join('');
  const moves=(p.form?p.formMoves:p.moves)||p.moves||[];
  const itemRows=c.items.map(it=>({it,bonus:num(p.levels?.[it.k]),active:!!p.activeEffects?.[it.k]})).filter(x=>x.bonus>0||x.active).sort((a,b)=>b.bonus-a.bonus||Number(b.active)-Number(a.active)).slice(0,8);
  const pinned=pins.includes(p.key);
  $('[data-profile]').innerHTML=`<div class="cx-profile-nav"><button class="quiet cx-back" data-back>← Browse</button><button class="quiet" data-prev aria-label="Previous Pokémon">←</button><button class="quiet" data-next aria-label="Next Pokémon">→</button><button class="quiet" data-pin aria-pressed="${pinned}">${pinned?'✓ Pinned':'＋ Compare'}</button><button class="quiet" data-favorite="${esc(p.key)}" aria-label="Toggle favorite" aria-pressed="${favorites.has(p.key)}">${favorites.has(p.key)?'★':'☆'}</button></div>
 <div class="cx-hero" style="--rar:${color(p.rarityColor)}"><div class="cx-hero-art">${pic(p,'cx-hero-sprite')}<span>#${esc(p.speciesId)}</span></div><div><div class="cx-rarity">${esc(p.rarity)} ${p.form?' / MEGA':''}</div><h3>${esc(p.name)}</h3><div class="cx-type-line">${p.types.map(t=>typeChip(c,t)).join('')}</div><p>${esc(p.role)} · ${p.ranged?'Ranged':'Melee'}</p><p class="cx-muted">${esc(p.roleDescription||'')}</p></div></div>
 ${forms.length>1?'<div class="cx-forms">'+forms.map(e=>'<button data-pokemon="'+esc(e.key)+'" aria-pressed="'+(e.key===selected)+'">'+esc(e.form?e.name:'Base form')+'</button>').join('')+'</div>':''}
 ${p.stone?'<p class="cx-muted">Mega stone: '+esc(p.stone)+'</p>':''}
 <section class="cx-panel"><div class="cx-panel-head"><h3>Statistics</h3><b class="cx-bst">BST ${num(p.bst)}</b></div><div class="cx-tabs"><button data-tab="battle" aria-pressed="${tab==='battle'}">Battle stats</button><button data-tab="base" aria-pressed="${tab==='base'}">Original base stats</button></div>
 ${tab==='battle'?'<div class="cx-level"><label for="cx-level">Preview level <b>'+level+'</b></label><input id="cx-level" type="range" min="1" max="50" value="'+level+'" aria-label="Preview battle level"><output>Lv '+level+'</output></div>':'<p class="cx-muted">Six original base stats; total is independent of level.</p>'}
 <div class="cx-stat-list" data-stat-list>${statGroup(p)}</div><p class="cx-muted">${tab==='battle'?'Unbuffed PokeClash stats. HP, ATK and DEF scale with level; SPD stays fixed. No items, abilities or TM buffs.':'Shared 0–255+ scale. Mega deltas compare with the base form.'}</p><div class="cx-summary"><span>Base speed rank <b>#${rank}/${speeds.length}</b></span><span>Coverage <b>${metric(c,p,'coverage')}/18</b></span><span>Resists <b>${metric(c,p,'resist')}/18</b></span></div></section>
 <section class="cx-panel"><h3>Type matchups</h3>${matchup(p)}<p class="cx-muted">Actual PokeClash type-only multipliers. Items and other modifiers are excluded; immunities deal reduced damage.</p></section>
 <section class="cx-panel"><h3>Ability · ${esc(p.ability)}</h3><div class="cx-ability">${abilities||'<span class="cx-muted">No rank descriptions supplied.</span>'}</div><h4>Attacks by type</h4><div class="cx-moves">${moves.map(m=>'<div>'+typeChip(c,m.type)+'<span>Basic <b>'+esc(m.basic)+'</b></span><span>Special <b>'+esc(m.special)+'</b></span></div>').join('')}</div></section>
 <section class="cx-panel"><h3>Innate & compatible TMs</h3><p class="cx-innate">Innate · ${esc(c.skills[p.innate]||p.innate)}</p><div class="cx-tms">${p.learn.map(k=>'<details><summary>'+esc(c.skills[k]||k)+(k===p.innate?' · Innate':'')+'</summary>'+[1,2,3].map(l=>'<p>Rank '+['I','II','III'][l-1]+' · '+esc(api.tmEffect(k,l))+'</p>').join('')+'</details>').join('')}</div></section>
 <section class="cx-panel"><h3>Item scouting</h3><p class="cx-muted">Highest effective-level bonuses for the species, not a power ranking. Combat effect tags are game data.</p><div class="cx-items">${itemRows.map(({it,bonus,active})=>'<details><summary>'+esc(it.name)+' <b>+'+bonus+' Lv</b></summary><p>'+esc((it.tags||[]).join(' · ')||'No listed combat effect')+'</p><p>'+ (active?'Combat effect applies to this species.':'No species-specific active effect confirmed.')+'</p></details>').join('')||'<p>No applicable items found.</p>'}</div></section>
 <section class="cx-panel"><h3>Evolution line</h3><div class="cx-evo">${evolution(p)}</div></section>
 <section class="cx-panel cx-team-panel"><h3>Build your team</h3><div class="cx-team-grid">${teamActions(p)}</div><p class="cx-muted" data-dex-notice role="status">Choose a replacement if the roster is full. Adds the selected form; no other equipment is changed.</p></section>`;
  updateCount();
 }
 function renderCompare(){
  const pair=pins.map(k=>byKey.get(k));if(pair.some(p=>!p)){view='profile';renderProfile();return;}
  view='compare';d.classList.add('cx-detail-open');const keys=['hp','atk','def','spd','bst','coverage','resist'];
  $('[data-profile]').innerHTML='<div class="cx-profile-nav"><button class="quiet" data-back>← Browse</button><button class="quiet" data-end-compare>Back to profile</button><button class="quiet" data-clear-pins>Clear pins</button></div><section class="cx-panel"><h3>Head-to-head scouting</h3><div class="cx-compare-pair">'+pair.map(p=>'<div>'+pic(p,'cx-compare-art')+'<h4>'+esc(p.name)+'</h4>'+p.types.map(t=>typeChip(c,t)).join('')+'</div>').join('')+'</div>'+keys.map(k=>{const vs=pair.map(p=>metric(c,p,k)),max=Math.max(1,...entries.map(p=>metric(c,p,k)));return '<div class="cx-compare-stat"><h4>'+esc(labels[k])+'</h4>'+statBar(pair[0].name,vs[0],max,'cx-side-a')+statBar(pair[1].name,vs[1],max,'cx-side-b')+'</div>'}).join('')+'<p class="cx-muted">Level 1 battle stats and original BST. Attribute comparison, not a win prediction.</p></section>';
  api.requestPortraits();
 }
 function update(reset=true){if(reset)limit=30;renderList();if(view==='compare')renderCompare();else if(selected)renderProfile();}
 d.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-close')){d.close();return;}
  if(b.hasAttribute('data-reset')){f=defaults();update();return;}
  if(b.dataset.sort){f.sort=b.dataset.sort;f.dir=f.sort==='id'||f.sort==='name'?'asc':'desc';update();return;}
  if(b.hasAttribute('data-direction')){f.dir=f.dir==='asc'?'desc':'asc';update();return;}
  if(b.dataset.pokemon){showProfile(b.dataset.pokemon);return;}
  if(b.dataset.favorite){const k=b.dataset.favorite;favorites.has(k)?favorites.delete(k):favorites.add(k);saveFavorites(favorites);update(false);return;}
  if(b.id==='dex-more'){limit+=30;renderList();return;}
  if(b.hasAttribute('data-back')){d.classList.remove('cx-detail-open');if(view==='compare'){view='profile';renderProfile();}return;}
  if(b.hasAttribute('data-prev')||b.hasAttribute('data-next')){const list=rows.length?rows:entries;let at=list.findIndex(p=>p.key===selected);at=(at+(b.hasAttribute('data-prev')?-1:1)+list.length)%list.length;showProfile(list[at].key);return;}
  if(b.dataset.tab){tab=b.dataset.tab;renderProfile();return;}
  if(b.hasAttribute('data-pin')&&selected){if(pins.includes(selected))pins=pins.filter(k=>k!==selected);else{if(pins.length===2)pins.shift();pins.push(selected);}renderProfile();updateCount();return;}
  if(b.hasAttribute('data-compare-open')&&pins.length===2){renderCompare();return;}
  if(b.hasAttribute('data-end-compare')){view='profile';renderProfile();return;}
  if(b.hasAttribute('data-clear-pins')){pins=[];view='profile';renderProfile();updateCount();return;}
  if(b.dataset.addTeam!==undefined&&selected){const i=Number(b.dataset.addTeam),p=byKey.get(selected),team=api.getTeams()[i];let slot=team.findIndex(m=>!m);if(slot<0){const v=$('[data-slot="'+i+'"]')?.value;if(v===''||v==null){notice('Choose which Pokémon to replace first.');return;}slot=Number(v);if(!confirm('Replace '+(bySpecies.get(team[slot]?.id)?.name||'this Pokémon')+' in Team '+(i?'B':'A')+' with '+p.name+'?'))return;}const result=api.add(p.speciesId,p.form,i,slot);renderProfile();notice(result);return;}
 });
 d.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='cx-level'){level=Number(el.value);$('[data-stat-list]').innerHTML=statGroup(byKey.get(selected));el.previousElementSibling.querySelector('b').textContent=level;el.nextElementSibling.textContent='Lv '+level;return;}
  if(el.id==='dex-query'){f.q=el.value;limit=30;renderList();return;}
  if(el.dataset.filter&&el.type==='number'){f[el.dataset.filter]=el.value;limit=30;renderList();}
 });
 d.addEventListener('change',e=>{const el=e.target,k=el.dataset.filter;if(!k||el.type==='number')return;f[k]=el.type==='checkbox'?el.checked:el.value;if(k==='sort')f.dir=['id','name'].includes(f.sort)?'asc':'desc';update();});
 return {open(){
  c=api.getCatalog();if(!c)return;
  entries=entriesFor(c);byKey=new Map(entries.map(p=>[p.key,p]));bySpecies=new Map(c.species.map(p=>[p.id,{...p,key:p.id+':0',speciesId:p.id,form:0}]));
  pins=pins.filter(k=>byKey.has(k));favorites=readFavorites();initFilters();d.classList.remove('cx-detail-open');view='profile';limit=30;
  if(!d.open)d.showModal();renderList();if(!selected||!byKey.has(selected))selected=rows[0]?.key||null;renderProfile();api.requestPortraits();
 }};
}
