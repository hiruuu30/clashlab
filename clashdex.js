/* ClashDex: local, read-only scouting of the engine catalog. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(v,max)=>Math.min(100,Math.max(0,100*num(v)/Math.max(1,max)));
const color=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v:'#8290b6';
export const metrics=[['hp','Combat HP'],['atk','Combat Attack'],['def','Combat Defense'],['spd','Combat Speed'],['bst','Base stat total (BST)'],['base.hp','Base HP'],['base.atk','Base Attack'],['base.def','Base Defense'],['base.spa','Base Sp. Attack'],['base.spd','Base Sp. Defense'],['base.spe','Base Speed'],['coverage','Basic type coverage'],['resist','Type resistances'],['learn','Compatible TMs'],['bulk','HP × Defense (bulk index)'],['pressure','Nominal ATK / cooldown (not DPS)'],['weak','Type weaknesses']];
const labels=Object.fromEntries(metrics);
export function entriesFor(c){
 return c.species.flatMap(p=>{
  const base={...p,key:p.id+':0',speciesId:p.id,form:0,kind:'base'};
  return [base,...(p.megaForms||[]).map(m=>({...base,...m,id:p.id,key:p.id+':'+m.form,speciesId:p.id,form:m.form,base:m.base||null,kind:'mega'})),...(p.heldForms||[]).map(m=>({...base,...m,id:p.id,key:p.id+':held:'+m.item,speciesId:p.id,form:0,kind:'held',heldItem:m.item}))];
 });
}
function eff(c,a,ts){return ts.reduce((v,t)=>v*(c.typeMatrix?.[a]?.[t]??1),1)}
function outgoing(c,p,t){return Math.max(...p.types.map(a=>eff(c,a,[t])))}
export function metric(c,p,k){
 if(k==='coverage')return Object.keys(c.types).filter(t=>outgoing(c,p,t)>1).length;
 if(k==='resist')return Object.keys(c.types).filter(t=>eff(c,t,p.types)<1).length;
 if(k==='learn')return p.learn.filter(t=>t!==p.innate).length;
 if(k==='bulk')return Math.round(num(p.hp)*num(p.def));
 if(k==='pressure')return Math.round(num(p.atk)/Math.max(.1,(1.7-num(p.spd)*.008)*(p.ranged?1.5:1)));
 if(k==='weak')return Object.keys(c.types).filter(t=>eff(c,t,p.types)>1).length;
 if(k.startsWith('base.'))return num(p.base?.[k.slice(5)]);
 return num(p[k]);
}
export function filterDex(c,entries,f,favorites=new Set()){
 const q=(f.q||'').trim().toLowerCase(),threshold=f.min===''||f.min==null?null:Number(f.min);
 const rows=entries.filter(p=>{
  if(f.forms==='base'&&p.kind!=='base'||f.forms==='mega'&&p.kind!=='mega'||f.forms==='held'&&p.kind!=='held')return false;
  if(f.rarity&&p.rarity!==f.rarity||f.role&&p.role!==f.role||f.type&&!p.types.includes(f.type)||f.type2&&!p.types.includes(f.type2))return false;
  if(f.ability&&p.ability!==f.ability||f.tm&&!p.learn.includes(f.tm)||f.ranged==='ranged'&&!p.ranged||f.ranged==='melee'&&p.ranged)return false;
  if(f.stage==='final'&&p.evolutions?.length||f.stage==='first'&&p.previous)return false;
  if(f.megaOnly&&!p.megaForms?.length||f.dual&&p.types.length<2||f.favorites&&!favorites.has(p.key))return false;
  if(threshold!==null&&Number.isFinite(threshold)&&metric(c,p,f.minStat)<threshold)return false;
  if(f.min2!==''&&f.min2!=null&&Number.isFinite(Number(f.min2))&&metric(c,p,f.minStat2)<Number(f.min2))return false;
  if(f.attackType&&outgoing(c,p,f.attackType)<=1)return false;
  if(f.resistType&&eff(c,f.resistType,p.types)>=1)return false;
  if(f.maxWeak!==''&&f.maxWeak!=null&&metric(c,p,'weak')>Number(f.maxWeak))return false;
  const words=[p.name,p.speciesId,p.ability,p.role,p.rarity,p.ranged?'ranged':'melee',...p.types.map(t=>c.types[t]),...p.learn.map(t=>c.skills[t]),...p.mega].join(' ').toLowerCase();
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
const rangeChip=p=>'<span class="cx-range '+(p.ranged?'cx-range-r':'cx-range-m')+'">'+(p.ranged?'◉ Ranged':'⚔ Melee')+'</span>';
const defaults=()=>({q:'',rarity:'',type:'',type2:'',role:'',ability:'',tm:'',ranged:'',stage:'',forms:'base',sort:'id',dir:'asc',minStat:'spd',min:'',minStat2:'atk',min2:'',attackType:'',resistType:'',maxWeak:'',megaOnly:false,dual:false,favorites:false});
export function mountDex(api){
 const d=document.createElement('dialog');d.className='dex-dialog clashdex-v2';d.setAttribute('aria-labelledby','cx-title');
 d.innerHTML=`<header class="dialog-head cx-head"><div><div class="cx-eyebrow">CLASHLAB / SCOUTING DATABASE</div><h2 id="cx-title">ClashDex</h2></div><button class="icon-btn" data-close aria-label="Close Pokédex">×</button></header>
 <div class="cx-workspace">
 <section class="cx-browser" aria-label="Browse Pokémon">
 <div class="cx-search"><input id="dex-query" type="search" autocomplete="off" placeholder="Search name, #, ability, TM…" aria-label="Search Pokémon"><button class="quiet" data-reset>Reset</button></div>
 <div class="cx-range-switch" aria-label="Attack range"><button data-range="">All <small data-range-count="all"></small></button><button data-range="melee">⚔ Melee <small data-range-count="melee"></small></button><button data-range="ranged">◉ Ranged <small data-range-count="ranged"></small></button></div><div class="cx-quick" aria-label="Quick rankings"><button data-sort="id">Dex #</button><button data-sort="spd">Fastest</button><button data-sort="atk">Attack</button><button data-sort="def">Defense</button><button data-sort="hp">HP</button><button data-sort="bst">BST</button><button data-sort="coverage">Coverage</button><button data-sort="resist">Resistances</button></div><div class="cx-scout-presets"><label>Scout preset<select data-preset><option value="">Custom filters</option><option value="melee">Fast melee</option><option value="ranged">Ranged attackers</option><option value="tank">High bulk</option><option value="coverage">Wide type coverage</option><option value="resist">Low weaknesses</option><option value="mega">Mega power</option></select></label><div class="cx-view-toggle" aria-label="Result view"><button data-layout="list" aria-label="Portrait list">List</button><button data-layout="table" aria-label="Stat table">Stats</button></div></div>
 <div class="cx-sortline"><label>Sort by<select data-filter="sort" aria-label="Sort Pokémon"></select></label><button class="secondary" data-direction aria-label="Change sort direction">↑</button><label>Forms<select data-filter="forms"><option value="base">Base only</option><option value="both">All forms</option><option value="mega">Mega only</option><option value="held">Held-item forms</option></select></label></div>
 <details class="dex-filters cx-filters"><summary>Advanced filters <span data-filter-count></span></summary><div class="cx-filter-grid">
 <label>Rarity<select data-filter="rarity"></select></label><label>Type<select data-filter="type"></select></label><label>Also has type<select data-filter="type2"></select></label><label>Role<select data-filter="role"></select></label><label>Ability<select data-filter="ability"></select></label><label>TM<select data-filter="tm"></select></label><label>Range<select data-filter="ranged"><option value="">Any</option><option value="melee">Melee</option><option value="ranged">Ranged</option></select></label><label>Evolution stage<select data-filter="stage"><option value="">All stages</option><option value="first">First / standalone</option><option value="final">Final stage</option></select></label><label>Minimum stat<select data-filter="minStat"></select></label><label>At least<input data-filter="min" type="number" min="0" max="999999" placeholder="No minimum"></label><label>Second minimum stat<select data-filter="minStat2"></select></label><label>At least<input data-filter="min2" type="number" min="0" max="999999" placeholder="No minimum"></label><label>Super effective against<select data-filter="attackType"></select></label><label>Resists incoming type<select data-filter="resistType"></select></label><label>Max type weaknesses<input data-filter="maxWeak" type="number" min="0" max="18" placeholder="Any"></label></div>
 <div class="cx-checks"><label><input type="checkbox" data-filter="megaOnly"> Mega capable</label><label><input type="checkbox" data-filter="dual"> Dual-type</label><label><input type="checkbox" data-filter="favorites"> Favorites only</label></div></details>
 <div class="cx-active-filters" data-active-filters></div><div class="cx-results-head"><span id="dex-count" role="status"></span><button class="quiet" data-compare-open disabled>Compare (0/2)</button></div><div id="dex-results" class="cx-list"></div><button id="dex-more" class="secondary">Load more</button>
 </section><section class="cx-profile" aria-label="Pokémon profile"><div data-profile></div></section></div>`;
 document.body.append(d);
 const $=s=>d.querySelector(s),all=s=>[...d.querySelectorAll(s)];
 let c,entries=[],byKey=new Map(),bySpecies=new Map(),f=defaults(),favorites=readFavorites(),pins=[],rows=[],limit=30,selected=null,view='profile',tab='battle',level=1,layout='list',section='overview';
 const builds=new Map();let previewSerial=0;
 function buildFor(p){if(!builds.has(p.key))builds.set(p.key,{id:p.speciesId,form:p.form,lv:50,ability:1,item:p.kind==='held'?String(p.heldItem):'',mode:api.getMode(),tactic:'equilibrado',opponentTactic:'equilibrado',hpPct:100,synergy:1,weaknessPolicy:false,tms:[{k:'',lv:1},{k:'',lv:1}]});return builds.get(p.key);}
 function buildControls(p){const b=buildFor(p),tac=[['equilibrado','Balanced'],['agressivo','Aggressive'],['defensivo','Defensive']],tm=[['','None'],...p.learn.filter(k=>k!==p.innate).map(k=>[k,c.skills[k]||k])],ranks=[['1','I'],['2','II'],['3','III']];
 return '<p class="cx-muted">Native ATK / DEF projection for selected conditions, not damage per hit.</p><div class="cx-filter-grid"><label>Ruleset<select data-build="mode">'+options(c.modes.map(m=>[m.id,m.name]),b.mode)+'</select></label><label>Base level<input type="number" data-build="lv" min="1" max="50" value="'+b.lv+'"></label><label>Ability / innate rank<select data-build="ability">'+options(ranks,String(b.ability))+'</select></label><label>Held item<select data-build="item"'+(p.kind==='held'?' disabled':'')+'>'+options([['','None'],...c.items.map(it=>[String(it.k),it.name+(p.activeEffects[it.k]?' • effect':'')])],b.item)+'</select></label>'+b.tms.map((t,i)=>'<label>TM '+(i+1)+'<select data-tm="'+i+'"'+(i===1&&b.lv<12?' disabled':'')+'>'+options(tm.filter(([k])=>!k||k!==b.tms[1-i].k),t.k)+'</select></label><label>TM rank<select data-tm-rank="'+i+'"'+(i===1&&b.lv<12?' disabled':'')+'>'+options(ranks,String(t.lv))+'</select></label>').join('')+'<label>Own tactic<select data-build="tactic">'+options(tac,b.tactic)+'</select></label><label>Opponent tactic<select data-build="opponentTactic">'+options(tac,b.opponentTactic)+'</select></label><label>Remaining HP %<input data-build="hpPct" type="number" min="1" max="100" value="'+b.hpPct+'"></label><label>Team members sharing primary type<select data-build="synergy">'+options([1,2,3,4,5,6].map(n=>[String(n),String(n)]),String(b.synergy))+'</select></label></div><label class="cx-checks"><input type="checkbox" data-build="weaknessPolicy"'+(b.weaknessPolicy?' checked':'')+'> Preview activated Weakness Policy (if equipped)</label><button class="secondary" data-timing>Load actual animation timing</button>';}
 async function refreshBuild(loadTiming=false){const p=byKey.get(selected),out=$('[data-build-output]');if(!p||!out||section!=='items')return;const serial=++previewSerial,b={...buildFor(p),tms:buildFor(p).tms.map(t=>({...t}))};out.textContent='Calculating from the game engine…';try{if(loadTiming)await api.requestDex('dex-timing',{id:p.speciesId});const v=await api.requestDex('dex-preview',{config:b});if(serial!==previewSerial||out!==$('[data-build-output]'))return;const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});const item=v.item?'<p><b>'+esc(v.item)+'</b> · '+(v.heldActive?'Combat effect applies':'No active combat effect for this species')+'<br>'+esc(v.tags.join(' · '))+'</p>':'';const a=v.animation;const cycle=a.available?Math.max(v.cooldownAdjusted,a.seconds+v.recovery):null;const tiles=[['Effective level',v.effective],['Max HP',v.hp],['Current HP',v.currentHP],['Scaled ATK',v.atk],['Scaled DEF',v.def],['Combat SPD',v.spd],['Effective ATK',v.attack],['Effective DEF',v.defense],['First-hit ATK',v.firstHitAttack],['Mega ATK multiplier','×'+v.megaMultiplier],['Crit chance',fmt(v.crit*100)+'%'],['Critical multiplier','×'+v.critMultiplier],['Basic dodge',fmt(v.dodge*100)+'%'],['Special dodge',fmt(v.specialDodge*100)+'%'],['PvP type synergy','×'+v.synergy],['Basic move power',v.basicPower],['Special move power',v.specialPower],['PvP special hit multiplier','×'+fmt(v.specialMultiplier)],['Base cooldown',fmt(v.cooldown)+' s'],['Adjusted cooldown',fmt(v.cooldownAdjusted)+' s'],['Melee recovery',fmt(v.recovery)+' s']];out.innerHTML='<p class="cx-form-note">'+esc(v.mode)+' · '+esc(v.form)+' · +'+v.bonus+' held-item levels before applicable cap · '+(v.read?'Tactic advantage: +15% ATK':'No tactic advantage')+'</p><div class="cx-build-grid">'+tiles.map(([k,n])=>'<div><span>'+esc(k)+'</span><b>'+esc(typeof n==='number'?fmt(n):n)+'</b></div>').join('')+'</div><p>Actual typing: '+v.types.map(t=>typeChip(c,t)).join(' ')+'</p>'+(v.specialType?'<p>Forced Special type: '+typeChip(c,v.specialType)+'</p>':'')+item+'<p>Animation: '+(a.available?esc(a.anim)+' '+fmt(a.seconds)+' s · hit at '+fmt(a.hitSeconds)+' s · idealized cycle ≥ '+fmt(cycle)+' s (excluding movement, interruption, Quick Claw and special use)':'Not loaded / unavailable. Use Load actual animation timing to request this species only.')+'</p><p class="cx-muted">Team synergy is conditional damage, not added to ATK. Dodge excludes the attacker’s accuracy modifier. Protection, regeneration, recoil and reactive effects are conditional. Charge does not speed the PvP meter. Power Herb adds 0.5 meter on first entry. Origin forms keep the original HP and move power. This is a build projection, not simulated DPS.</p>';}catch(e){if(serial===previewSerial&&out===$('[data-build-output]'))out.textContent='Build preview unavailable: '+e.message;}}

 const notice=msg=>{const el=$('[data-dex-notice]');if(el)el.textContent=msg;};
 const updateCount=()=>{const b=$('.cx-results-head [data-compare-open]');b.textContent='Compare ('+pins.length+'/2)';b.disabled=pins.length!==2;};
 function initFilters(){
  const distinct=(key)=>[...new Set(c.species.map(p=>p[key]))].filter(Boolean).sort().map(v=>[v,v]);
  const set=(key,values)=>{$('[data-filter="'+key+'"]').innerHTML=options(values,f[key])};
  set('sort',[['id','Dex number'],['name','Name'],...metrics]);
  set('minStat',metrics);set('minStat2',metrics);
  set('rarity',[['','All rarities'],...distinct('rarity')]);
  set('role',[['','All roles'],...distinct('role')]);
  set('ability',[['','All abilities'],...distinct('ability')]);
  set('tm',[['','All TMs'],...Object.entries(c.skills).sort((a,b)=>a[1].localeCompare(b[1]))]);
  const ts=[['','Any type'],...Object.entries(c.types).sort((a,b)=>a[1].localeCompare(b[1]))];set('type',ts);set('type2',ts);set('attackType',ts);set('resistType',ts);
  sync();
 }
 function sync(){
  if($('#dex-query').value!==f.q)$('#dex-query').value=f.q;
  all('[data-filter]').forEach(el=>{const v=f[el.dataset.filter];if(el.type==='checkbox')el.checked=!!v;else if(el.value!==String(v??''))el.value=v??'';});
  $('[data-direction]').textContent=f.dir==='asc'?'↑':'↓';
  $('[data-direction]').title=f.dir==='asc'?'Ascending · click for descending':'Descending · click for ascending';
  all('[data-sort]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sort===f.sort)));
  const active=['rarity','type','type2','role','ability','tm','ranged','stage','megaOnly','dual','favorites','min','min2','attackType','resistType','maxWeak'].filter(k=>f[k]!==''&&f[k]!==false&&f[k]!=null);
  const count=active.length;
  const names={type:'Type',type2:'Also',rarity:'Rarity',role:'Role',ability:'Ability',tm:'TM',ranged:'Range',stage:'Stage',megaOnly:'Mega capable',dual:'Dual-type',favorites:'Favorites',min:labels[f.minStat]+' ≥',min2:labels[f.minStat2]+' ≥',attackType:'Strong vs',resistType:'Resists',maxWeak:'Weaknesses ≤'};
  $('[data-active-filters]').innerHTML=active.map(k=>'<button data-clear-filter="'+k+'" title="Remove filter">'+esc(names[k])+ (f[k]===true?'':' '+esc(c.types[f[k]]||c.skills[f[k]]||f[k]))+' ×</button>').join('');
  all('[data-range]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.range===f.ranged)));
  const pool=filterDex(c,entries,{...f,ranged:''},favorites);$('[data-range-count="all"]').textContent=pool.length;$('[data-range-count="melee"]').textContent=pool.filter(p=>!p.ranged).length;$('[data-range-count="ranged"]').textContent=pool.filter(p=>p.ranged).length;
  all('[data-layout]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layout===layout)));
  $('[data-filter-count]').textContent=count?count+' active':'';
 }
 function pic(p,cls=''){const src=api.portrait(p.speciesId,p.portrait);return '<img class="'+cls+'" data-portrait="'+esc(p.speciesId)+'" src="'+esc(src)+'" alt="" width="64" height="64">'}
 function renderList(){
  rows=filterDex(c,entries,f,favorites);sync();updateCount();
  $('#dex-count').textContent=rows.length+' '+(f.forms==='base'?'Pokémon':'forms')+' · '+(f.sort==='id'?'Dex #':f.sort==='name'?'Name':labels[f.sort])+' '+(f.dir==='asc'?'↑':'↓');
  const results=$('#dex-results');results.classList.toggle('cx-table-view',layout==='table');
  if(layout==='table'&&rows.length){const cols=[['hp','HP'],['atk','ATK'],['def','DEF'],['spd','SPD'],['bst','BST']];results.innerHTML='<div class="cx-table-scroll"><table class="cx-stat-table"><thead><tr><th scope="col">Pokémon / range</th>'+cols.map(([k,l])=>'<th scope="col"><button data-table-sort="'+k+'" aria-label="Sort by '+esc(labels[k])+'">'+l+(f.sort===k?(f.dir==='asc'?' ↑':' ↓'):'')+'</button></th>').join('')+'</tr></thead><tbody>'+rows.slice(0,limit).map(p=>'<tr'+(selected===p.key?' class="cx-table-selected"':'')+'><th scope="row"><button class="cx-table-name" data-pokemon="'+esc(p.key)+'"><strong>'+esc(p.name)+'</strong>'+rangeChip(p)+'</button></th>'+cols.map(([k])=>'<td>'+num(p[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  else results.innerHTML=rows.slice(0,limit).map((p,i)=>{
   const value=f.sort==='id'?'#'+p.speciesId:f.sort==='name'?'#'+p.speciesId:metric(c,p,f.sort);
   const ordinal=['id','name'].includes(f.sort)?i+1:rows.findIndex(x=>metric(c,x,f.sort)===value)+1;
   return '<article class="cx-row'+(selected===p.key?' cx-selected':'')+'" style="--rar:'+color(p.rarityColor)+'"><button class="cx-open" data-pokemon="'+esc(p.key)+'" aria-label="View '+esc(p.name)+' profile" aria-current="'+(selected===p.key?'true':'false')+'"><span class="cx-rank">'+(f.sort==='id'?'#'+esc(p.speciesId):String(ordinal).padStart(2,'0'))+'</span>'+pic(p)+'<span class="cx-row-text"><strong>'+esc(p.name)+'</strong><span class="cx-rarity">'+esc(p.rarity)+(p.kind==='mega'?' · Mega':p.kind==='held'?' · Held form':'')+'</span><span class="cx-type-line">'+p.types.map(t=>typeChip(c,t)).join('')+rangeChip(p)+'</span></span><span class="cx-metric">'+esc(value)+'<small>'+esc(f.sort==='id'||f.sort==='name'?'Dex':labels[f.sort]?.replace('Combat ','').replace('Base stat total (BST)','BST'))+'</small></span></button><button class="cx-star" data-favorite="'+esc(p.key)+'" aria-label="'+(favorites.has(p.key)?'Remove':'Add')+' '+esc(p.name)+' favorite" aria-pressed="'+favorites.has(p.key)+'">'+(favorites.has(p.key)?'★':'☆')+'</button></article>';
  }).join('')||'<div class="cx-empty"><strong>No matching Pokémon</strong><p>Try removing a filter or clearing the search.</p><button class="secondary" data-reset>Clear all filters</button></div>';
  $('#dex-more').hidden=rows.length<=limit;$('#dex-more').textContent='Load '+Math.min(30,Math.max(0,rows.length-limit))+' more ('+Math.min(rows.length,limit)+' / '+rows.length+')';
  api.requestPortraits();
 }
 function showProfile(key,move=true){
  if(!byKey.has(key))return;
  selected=key;view='profile';section='overview';
  if(move)d.classList.add('cx-detail-open');
  renderProfile();all('[data-pokemon]').forEach(b=>{const active=b.dataset.pokemon===key;b.setAttribute('aria-current',String(active));b.closest('.cx-row')?.classList.toggle('cx-selected',active);b.closest('tr')?.classList.toggle('cx-table-selected',active)});
  if(move){$('.cx-profile').scrollTop=0;const back=$('[data-profile] button');if(matchMedia('(max-width:760px)').matches)back?.focus({preventScroll:true});}
  api.requestPortraits();
 }
 function statGroup(p){
  const base=byKey.get(p.speciesId+':0'),factor=1+.05*(level-1);
  const stats=tab==='base'?[['HP','hp'],['Attack','atk'],['Defense','def'],['Sp. Attack','spa'],['Sp. Defense','spd'],['Speed','spe']]:[['HP','hp'],['Attack','atk'],['Defense','def'],['Speed','spd']];
  return stats.map(([label,k],i)=>{
   const val=tab==='base'?num(p.base?.[k]):Math.round(num(p[k])*(k==='spd'?1:factor));
   const max=tab==='base'?Math.max(255,...entries.map(e=>num(e.base?.[k]))):Math.ceil(Math.max(...entries.map(e=>num(e[k])))*(k==='spd'?1:factor)/10)*10;
   const delta=p.kind!=='base'?(tab==='base'?val-num(base.base?.[k]):val-Math.round(num(base[k])*(k==='spd'?1:factor))):null;
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
  const base=bySpecies.get(p.speciesId), forms=entries.filter(e=>e.speciesId===p.speciesId);
  const pool=entries.filter(e=>e.kind===p.kind),rank=1+pool.filter(e=>e.spd>p.spd).length;
  const rankRows=['hp','atk','def','spd','bst'].map(k=>{const v=metric(c,p,k),n=1+pool.filter(e=>metric(c,e,k)>v).length;return '<div><span>'+esc(labels[k].replace('Combat ','').replace('Base stat total (BST)','BST'))+'</span><b>#'+n+'</b><small>of '+pool.length+'</small></div>'}).join('');
  const abilities=(p.abilityEffects||[]).map((v,i)=>'<div><b>Rank '+['I','II','III'][i]+'</b><span>'+esc(v)+'</span></div>').join('');
  const moves=p.moves||[];
  const itemRows=c.items.map(it=>({it,bonus:num(p.levels?.[it.k]),active:!!p.activeEffects?.[it.k]})).filter(x=>x.bonus>0||x.active).sort((a,b)=>b.bonus-a.bonus||Number(b.active)-Number(a.active)).slice(0,8);
  const pinned=pins.includes(p.key);
  $('[data-profile]').innerHTML=`<div class="cx-profile-nav"><button class="quiet cx-back" data-back>← Browse</button><button class="quiet" data-prev aria-label="Previous Pokémon">←</button><button class="quiet" data-next aria-label="Next Pokémon">→</button><button class="quiet" data-pin aria-pressed="${pinned}">${pinned?'✓ Pinned':'＋ Compare'}</button>${pins.length===2?'<button class="secondary" data-compare-open>Compare now</button>':''}<button class="quiet" data-favorite="${esc(p.key)}" aria-label="Toggle favorite" aria-pressed="${favorites.has(p.key)}">${favorites.has(p.key)?'★':'☆'}</button></div>
 <div class="cx-hero" style="--rar:${color(p.rarityColor)}"><div class="cx-hero-art">${pic(p,'cx-hero-sprite')}<span>#${esc(p.speciesId)}</span></div><div><div class="cx-rarity">${esc(p.rarity)} ${p.kind==='mega'?' / MEGA':p.kind==='held'?' / HELD FORM':''}</div><h3>${esc(p.name)}</h3><div class="cx-type-line">${p.types.map(t=>typeChip(c,t)).join('')}</div><div class="cx-hero-role">${rangeChip(p)} <span>${esc(p.role)}</span></div><p class="cx-muted">${p.ranged?'Attacks from range (basic range < 300; base cooldown ×1.5).':'Fights up close (basic range < 62; standard base cooldown).'}</p><p class="cx-muted">${esc(p.roleDescription||'')}</p></div></div>
 ${forms.length>1?'<div class="cx-forms">'+forms.map(e=>'<button data-pokemon="'+esc(e.key)+'" aria-pressed="'+(e.key===selected)+'">'+esc(e.kind==='base'?'Base form':e.name)+'</button>').join('')+'</div>':''}
 ${p.stone?'<p class="cx-muted">Mega stone: '+esc(p.stone)+' · Once per team per battle; +10% ATK multiplier after evolution.</p>':''}
 ${p.kind==='held'?'<p class="cx-form-note">Requires '+esc(p.requiredItem)+'. '+(p.specialType?'Special type: '+esc(c.types[p.specialType])+'; defensive typing unchanged.':'Combat stats / typing reflect this item. Original base stats remain those of the species.')+'</p>':''}
 <div class="cx-section-nav" role="group" aria-label="Profile sections">${[['overview','Stats'],['matchups','Matchups'],['moves','Moves & TMs'],['items','Items & team']].map(([k,l])=>'<button data-section="'+k+'" aria-pressed="'+(section===k)+'">'+l+'</button>').join('')}</div><section class="cx-panel" data-pane="overview"><div class="cx-panel-head"><h3>Statistics</h3><b class="cx-bst">BST ${num(p.bst)}</b></div><div class="cx-tabs"><button data-tab="battle" aria-pressed="${tab==='battle'}">Battle stats</button><button data-tab="base" aria-pressed="${tab==='base'}">Original base stats</button></div>
 ${tab==='battle'?'<div class="cx-level"><label for="cx-level">Preview level <b>'+level+'</b></label><input id="cx-level" type="range" min="1" max="50" value="'+level+'" aria-label="Preview battle level"><output>Lv '+level+'</output></div>':'<p class="cx-muted">Six original base stats; total is independent of level.</p>'}
 <div class="cx-stat-list" data-stat-list>${statGroup(p)}</div><p class="cx-muted">${tab==='battle'?'Unbuffed form stats at the selected effective level, before level bonuses or cap rules. HP, ATK and DEF scale with level; SPD stays fixed. See Items & Team for a fully configured build. Combat Speed is capped at 130; original Speed is available separately.':'Shared 0–255+ scale. Form deltas compare with the species. Held forms show the species’ original six stats.'}</p><div class="cx-summary"><span>Speed rank <b>#${rank}/${pool.length}</b></span><span>Coverage <b>${metric(c,p,'coverage')}/18</b></span><span>Resists <b>${metric(c,p,'resist')}/18</b></span></div><h4 class="cx-rank-heading">Catalog ranks · ${p.kind==='mega'?'Mega forms':p.kind==='held'?'Held-item forms':'Base Pokémon'}</h4><div class="cx-rank-grid">${rankRows}</div><p class="cx-muted">Tied values share a rank. Bulk and attack-rate indexes are scouting proxies, not combat predictions.</p></section>
 <section class="cx-panel" data-pane="matchups"><h3>Type matchups</h3>${matchup(p)}<p class="cx-muted">Actual type-only multipliers for this form. Air Balloon and other conditional modifiers are excluded; standard immunities are ×0.25 per immune type.</p></section>
 <section class="cx-panel" data-pane="moves"><h3>Ability · ${esc(p.ability)}</h3><div class="cx-ability">${abilities||'<span class="cx-muted">No rank descriptions supplied.</span>'}</div><h4>Attacks by type</h4>${p.specialType?'<p class="cx-form-note">Techno Blast is forced to '+esc(c.types[p.specialType])+' with '+esc(p.requiredItem)+'. Basic attacks still select the better native type.</p>':''}<div class="cx-moves">${moves.map(m=>'<div>'+typeChip(c,m.type)+'<span>Basic <b>'+esc(m.basic)+'</b></span><span>Special <b>'+esc(m.special)+'</b></span></div>').join('')}</div></section>
 <section class="cx-panel" data-pane="moves"><h3>Innate & compatible TMs</h3><p class="cx-innate">Innate · ${esc(c.skills[p.innate]||p.innate)}</p><div class="cx-tms">${p.learn.map(k=>'<details><summary>'+esc(c.skills[k]||k)+(k===p.innate?' · Innate':'')+'</summary>'+[1,2,3].map(l=>'<p>Rank '+['I','II','III'][l-1]+' · '+esc(api.tmEffect(k,l))+'</p>').join('')+'</details>').join('')}</div></section>
 <section class="cx-panel cx-build" data-pane="items"><h3>Engine build preview</h3>${buildControls(p)}<div data-build-output role="status" class="cx-build-output"></div></section><section class="cx-panel" data-pane="items"><h3>Item scouting</h3><p class="cx-muted">Highest effective-level bonuses for the species, not a power ranking. Tags describe the item generally; the build preview resolves effects for the selected species.</p><div class="cx-items">${itemRows.map(({it,bonus,active})=>'<details><summary>'+esc(it.name)+' <b>+'+bonus+' Lv</b></summary><p>'+esc((it.tags||[]).join(' · ')||'No listed combat effect')+'</p><p>'+ (active?'Combat effect applies to this species.':'No species-specific active effect confirmed.')+'</p></details>').join('')||'<p>No applicable items found.</p>'}</div></section>
 <section class="cx-panel" data-pane="overview"><h3>Evolution line</h3><div class="cx-evo">${evolution(p)}</div></section>
 <section class="cx-panel cx-team-panel" data-pane="items"><h3>Build your team</h3><div class="cx-team-grid">${teamActions(p)}</div><p class="cx-muted" data-dex-notice role="status">Choose a replacement if the roster is full. Adds level, ability rank, TMs, held item and selected form. Preview tactics, HP, synergy and ruleset are hypothetical and do not alter match settings.</p></section>`;
  all('[data-pane]').forEach(el=>el.hidden=el.dataset.pane!==section);
  if(section==='items')refreshBuild();
  updateCount();
 }
 function renderCompare(){
  const pair=pins.map(k=>byKey.get(k));if(pair.some(p=>!p)){view='profile';renderProfile();return;}
  view='compare';d.classList.add('cx-detail-open');const keys=['hp','atk','def','spd','bst','coverage','resist','bulk','pressure','weak'];
  $('[data-profile]').innerHTML='<div class="cx-profile-nav"><button class="quiet" data-back>← Browse</button><button class="quiet" data-end-compare>Back to profile</button><button class="quiet" data-clear-pins>Clear pins</button></div><section class="cx-panel"><h3>Head-to-head scouting</h3><div class="cx-compare-pair">'+pair.map(p=>'<div>'+pic(p,'cx-compare-art')+'<h4>'+esc(p.name)+'</h4>'+p.types.map(t=>typeChip(c,t)).join('')+'<p>'+rangeChip(p)+'</p></div>').join('')+'</div>'+keys.map(k=>{const vs=pair.map(p=>metric(c,p,k)),max=Math.max(1,...entries.map(p=>metric(c,p,k)));return '<div class="cx-compare-stat"><h4>'+esc(labels[k])+'</h4>'+statBar(pair[0].name,vs[0],max,'cx-side-a')+statBar(pair[1].name,vs[1],max,'cx-side-b')+'</div>'}).join('')+'<p class="cx-muted">Level 1 battle stats and original BST. Attribute comparison, not a win prediction.</p></section>';
  api.requestPortraits();
 }
 function update(reset=true){if(reset)limit=30;renderList();if(view==='compare')renderCompare();else if(selected)renderProfile();}
 d.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-close')){d.close();return;}
  if(b.hasAttribute('data-reset')){f=defaults();$('[data-preset]').value='';update();return;}
  if(b.hasAttribute('data-range')){f.ranged=b.dataset.range;$('[data-preset]').value='';update();return;}
  if(b.dataset.layout){layout=b.dataset.layout;renderList();return;}
  if(b.dataset.tableSort){$('[data-preset]').value='';f.dir=f.sort===b.dataset.tableSort&&f.dir==='desc'?'asc':'desc';f.sort=b.dataset.tableSort;update();return;}
  if(b.dataset.clearFilter){const k=b.dataset.clearFilter;f[k]=defaults()[k];$('[data-preset]').value='';update();return;}
  if(b.hasAttribute('data-timing')){refreshBuild(true);return;}
  if(b.dataset.section){section=b.dataset.section;renderProfile();$('[data-section="'+section+'"]')?.focus({preventScroll:true});api.requestPortraits();return;}
  if(b.dataset.sort){$('[data-preset]').value='';f.sort=b.dataset.sort;f.dir=f.sort==='id'||f.sort==='name'?'asc':'desc';update();return;}
  if(b.hasAttribute('data-direction')){$('[data-preset]').value='';f.dir=f.dir==='asc'?'desc':'asc';update();return;}
  if(b.dataset.pokemon){showProfile(b.dataset.pokemon);return;}
  if(b.dataset.favorite){const k=b.dataset.favorite;favorites.has(k)?favorites.delete(k):favorites.add(k);saveFavorites(favorites);update(false);return;}
  if(b.id==='dex-more'){limit+=30;renderList();return;}
  if(b.hasAttribute('data-back')){d.classList.remove('cx-detail-open');if(view==='compare'){view='profile';renderProfile();}all('[data-pokemon]').find(x=>x.dataset.pokemon===selected&&x.closest('.cx-row'))?.focus({preventScroll:true});return;}
  if(b.hasAttribute('data-prev')||b.hasAttribute('data-next')){const list=rows.length?rows:entries;let at=list.findIndex(p=>p.key===selected);at=(at+(b.hasAttribute('data-prev')?-1:1)+list.length)%list.length;showProfile(list[at].key);return;}
  if(b.dataset.tab){tab=b.dataset.tab;renderProfile();return;}
  if(b.hasAttribute('data-pin')&&selected){if(pins.includes(selected))pins=pins.filter(k=>k!==selected);else{if(pins.length===2)pins.shift();pins.push(selected);}renderProfile();updateCount();return;}
  if(b.hasAttribute('data-compare-open')&&pins.length===2){renderCompare();return;}
  if(b.hasAttribute('data-end-compare')){view='profile';renderProfile();return;}
  if(b.hasAttribute('data-clear-pins')){pins=[];view='profile';renderProfile();updateCount();return;}
  if(b.dataset.addTeam!==undefined&&selected){const i=Number(b.dataset.addTeam),p=byKey.get(selected),team=api.getTeams()[i];let slot=team.findIndex(m=>!m);if(slot<0){const v=$('[data-slot="'+i+'"]')?.value;if(v===''||v==null){notice('Choose which Pokémon to replace first.');return;}slot=Number(v);if(!confirm('Replace '+(bySpecies.get(team[slot]?.id)?.name||'this Pokémon')+' in Team '+(i?'B':'A')+' with '+p.name+'?'))return;}const result=api.add(p.speciesId,p.form,i,slot,buildFor(p));renderProfile();notice(result);return;}
 });
 d.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='cx-level'){level=Number(el.value);$('[data-stat-list]').innerHTML=statGroup(byKey.get(selected));el.previousElementSibling.querySelector('b').textContent=level;el.nextElementSibling.textContent='Lv '+level;return;}
  if(el.id==='dex-query'){$('[data-preset]').value='';f.q=el.value;limit=30;renderList();return;}
  if(el.dataset.filter&&el.type==='number'){$('[data-preset]').value='';f[el.dataset.filter]=el.value;limit=30;renderList();}
 });
 d.addEventListener('change',e=>{const el=e.target,k=el.dataset.filter;
 if(el.dataset.build||el.dataset.tm!==undefined||el.dataset.tmRank!==undefined){const p=byKey.get(selected);if(!p)return;const b=buildFor(p);if(el.dataset.tm!==undefined)b.tms[Number(el.dataset.tm)].k=el.value;else if(el.dataset.tmRank!==undefined)b.tms[Number(el.dataset.tmRank)].lv=Number(el.value);else{const key=el.dataset.build;b[key]=el.type==='checkbox'?el.checked:['lv','ability','hpPct','synergy'].includes(key)?Math.max(1,Math.min(key==='lv'?50:key==='hpPct'?100:key==='synergy'?6:3,Math.trunc(Number(el.value)||1))):el.value;}renderProfile();return;}if(el.hasAttribute('data-preset')){const v=el.value;if(!v)return;const preset={melee:{ranged:'melee',sort:'spd'},ranged:{ranged:'ranged',sort:'pressure'},tank:{sort:'bulk'},coverage:{sort:'coverage'},resist:{sort:'weak',dir:'asc'},mega:{forms:'mega',sort:'bst'}}[v];if(preset){f={...defaults(),...preset,dir:preset.dir||'desc'};update();}return;}if(!k||el.type==='number')return;$('[data-preset]').value='';f[k]=el.type==='checkbox'?el.checked:el.value;if(k==='sort')f.dir=['id','name','weak'].includes(f.sort)?'asc':'desc';update();});
 return {open(){
  c=api.getCatalog();if(!c)return;
  entries=entriesFor(c);byKey=new Map(entries.map(p=>[p.key,p]));bySpecies=new Map(entries.filter(p=>p.kind==='base').map(p=>[p.id,p]));
  pins=pins.filter(k=>byKey.has(k));favorites=readFavorites();initFilters();d.classList.remove('cx-detail-open');view='profile';limit=30;
  if(!d.open)d.showModal();if(!selected||!byKey.has(selected))selected=filterDex(c,entries,f,favorites)[0]?.key||null;renderList();renderProfile();api.requestPortraits();
 }};
}
