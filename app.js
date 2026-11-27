const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const presets = [
  ['0483','0445','0589','0473','0195','0303'],
  ['0484','0530','0560','0143','0160','0040']
];
const tactic = [['equilibrado','Balanced'],['agressivo','Aggressive'],['defensivo','Defensive']];
const sides = ['a','b'];
const title = side => 'Team '+sides[side].toUpperCase();
const member = id => ({id,lv:50,ability:1,item:'',mega:0,tms:[{k:'',lv:1},{k:'',lv:1}]});
const integer = (value,min,max) => Math.min(max,Math.max(min,Number.isFinite(Number(value))?Math.trunc(Number(value)):min));
const initial = () => ({teams:presets.map(x=>x.map(member)),tactics:['equilibrado','equilibrado'],mode:'sandbox',seed:498271,automatic:[true,true]});
let config = initial();
let workers;
let catalog;
let species;
let items;
let live;
let events=[];
let starting=false;
let arena;
let knockoutUntil=0;
let battleStartsAt=0;
const compactBattle=matchMedia('(max-width: 760px), (orientation: landscape) and (max-height: 520px)');
let benchmarkJob=0;
const arenaFrame=$('arena-frame');
const portraitRequests=new Set();
let playing=false;
let bench=false;
let finishing=false;
let running=false;
let edit;
let lastFrame=0;
let leftover=0;
let tickBudget=0;
const editor=$('editor');

function mode() {return catalog?.modes.find(x=>x.id===config.mode) || catalog?.modes[0];}
function portrait(id, alternate, mood='Normal') {
  const portraits=window.PORTRAITS?.[id];
  const src=alternate || portraits?.[mood] || portraits?.Normal;
  return typeof src==='string' && src.startsWith('data:image/png;base64,') ? src : './mark.svg';
}
function requestPortraits() {
  const ids=[...new Set(config.teams.flat().filter(Boolean).map(slot=>slot.id))]
    .filter(id=>!window.PORTRAITS?.[id] && !portraitRequests.has(id));
  if(!ids.length)return;
  ids.forEach(id=>portraitRequests.add(id));
  const script=document.createElement('script');
  script.src='https://pokeclashleague.xyz/por.js?ids='+ids.map(encodeURIComponent).join(',');
  script.onload=()=>{
    for(const img of document.querySelectorAll('img[data-portrait]')){
      const src=portrait(img.dataset.portrait);
      if(src!=='./mark.svg' && img.getAttribute('src')==='./mark.svg')img.src=src;
    }
    script.remove();
  };
  script.onerror=()=>{
    ids.forEach(id=>portraitRequests.delete(id));
    script.remove();
  };
  document.head.appendChild(script);
}
function options(vals,selected) {
  return vals.map(([key,name])=>'<option value="'+escape(key)+'"'+(String(selected)===String(key)?' selected':'')+'>'+escape(name)+'</option>').join('');
}
function optionList(target,vals,selected) {$(target).innerHTML=options(vals,selected);}
function persist() {try{localStorage.setItem('clashlab-1',JSON.stringify(config));}catch{}}
function restore() {
  let saved;
  try {saved=JSON.parse(localStorage.getItem('clashlab-1'));} catch {}
  if(!saved?.teams || saved.teams.length!==2)return;
  const clean=initial();
  clean.mode=catalog.modes.some(x=>x.id===saved.mode)?saved.mode:'sandbox';
  clean.seed=integer(saved.seed,0,4294967295);
  clean.tactics=clean.tactics.map((fallback,i)=>tactic.some(([key])=>key===saved.tactics?.[i])?saved.tactics[i]:fallback);
  clean.automatic=clean.automatic.map((_,i)=>saved.automatic?.[i]!==false);
  clean.teams=clean.teams.map((base,i)=>Array.isArray(saved.teams[i])?Array.from({length:6},(_,j)=>{
    const x=saved.teams[i][j];
    if(!x || !species[x.id])return null;
    const option=member(x.id);
    option.lv=integer(x.lv,1,50);
    option.ability=integer(x.ability,1,3);
    option.item=x.item!=='' && items[String(x.item)] ? String(x.item) : '';
    option.mega=integer(x.mega,0,species[x.id].mega.length);
    option.tms=option.tms.map((_,n)=>({k:species[x.id].learn.includes(x.tms?.[n]?.k)?x.tms[n].k:'',lv:integer(x.tms?.[n]?.lv,1,3)}));
    return option;
  }):base);
  config=clean;
}
function levelFor(slot) {
  const s=species[slot.id];const lev=integer(slot.lv,1,50);const rule=mode();const boost=s.levels[slot.item]||0;
  if(!rule.cap)return lev+boost;
  if(rule.kind==='arena')return Math.min(lev,rule.cap)+boost;
  return Math.min(lev+boost,rule.cap);
}
function notify(text) {
  $('load-message').textContent=text;
  $('load-error').hidden=false;
  $('retry').hidden=Boolean(catalog);
}
function clearNotice() {$('load-error').hidden=true;}
function disabled(value) {return value?' disabled':'';}
function healthPercent(mon) {
  return mon ? Math.round(100 * Math.max(0,Math.min(1,mon.hp/mon.max))) : 100;
}
function healthColor(percent) {
  return percent>50?'#46d65a':percent>22?'#f0c23a':'#ea4a3a';
}
function healthFill(mon) {
  const percent=healthPercent(mon);
  return '<i style="width:'+percent+'%;background:'+healthColor(percent)+'"></i>';
}
function renderTeams() {
  sides.forEach((_,i)=>renderTeam(i));
  requestPortraits();
}
function canSwapTo(current, index, isArenaOpponent) {
  const active=current?.active;
  return running && !finishing && !isArenaOpponent && active && !active.ko && current.swap<=0 &&
    active.slot!==index && !current.team[index]?.ko && !['enter','recall','faint'].includes(active.state);
}
function activeCard(i,current) {
  const mon=current?.active;
  const lead=config.teams[i].find(Boolean);
  const leadSpecies=species[lead?.id];
  const id=mon?.id || lead?.id;
  const typeNames=(mon?.types || leadSpecies?.types || []).map(type=>catalog.types[type]).join(' / ');
  const ability=mon?.isMega?'Mega evolved':species[id]?.ability;
  const name=mon?.name || (live?'Waiting…':leadSpecies?.name || 'No lead');
  const level=mon?'Lv '+mon.lv:lead && !live?'Lv '+levelFor(lead):'';
  const hp=mon?Math.ceil(mon.hp)+' / '+Math.ceil(mon.max):'—';
  return '<div class="active-heading"><img data-portrait="'+escape(id)+'" src="'+portrait(id,mon?.portrait)+'" alt=""><div><strong title="'+escape(name)+'">'+escape(name)+'</strong><small>'+escape(typeNames)+'</small></div><b>'+escape(level)+'</b></div><div class="hp" aria-label="'+title(i)+' health">'+healthFill(mon)+'<b>'+hp+'</b></div><div class="buffs">'+(current?.read?'<span>READ</span>':'')+(ability?'<span>'+escape(ability)+'</span>':'')+'</div>';
}
function renderTeam(i) {
  const target=$('team-'+sides[i]);
  const current=live?.sides?.[i];
  const isArenaOpponent=mode().kind==='arena'&&i===1;
  const locked=running||bench||starting;
  let memberIndex=0;
  const list=config.teams[i].map((slot,index)=>{
    if(!slot)return locked?'':'<div class="slot"><button class="slot-main" data-edit="'+index+'"><span class="slot-content"><strong>+ Add Pokémon</strong></span></button></div>';
    const s=species[slot.id];
    const battleIndex=memberIndex++;
    const mon=current?.team?.[battleIndex];
    const active=current?.active?.slot===battleIndex;
    const displayed=mon?.name || (slot.mega?s.mega[slot.mega-1]:s.name);
    const details='Lv '+(mon?.lv ?? levelFor(slot))+(live?'':' · '+s.types.map(t=>catalog.types[t]).join('/')+(items[slot.item]?' · '+items[slot.item].name:''));
    const action=(running?'Switch to ':'Edit ')+s.name;
    return '<div class="slot'+(active?' selected':'')+(mon?.ko?' knocked':'')+'"><button class="slot-main" '+(running?'data-swap="'+battleIndex+'"':'data-edit="'+index+'"')+disabled(running?!canSwapTo(current,battleIndex,isArenaOpponent):bench||starting)+' aria-label="'+escape(action)+'" title="'+escape(action)+'"><img data-portrait="'+escape(s.id)+'" src="'+portrait(s.id,mon?.portrait)+'" alt=""><span class="slot-content"><strong>'+escape(displayed)+'</strong><small>'+escape(details)+'</small>'+(live?'<span class="mini" aria-hidden="true">'+healthFill(mon)+'</span>':'')+'</span></button>'
      +(locked?'':'<div class="slot-buttons"><button data-reorder="'+index+',-1" aria-label="Move '+escape(s.name)+' up"'+disabled(index===0)+'>↑</button><button data-reorder="'+index+',1" aria-label="Move '+escape(s.name)+' down"'+disabled(index===5)+'>↓</button></div>')+'</div>';
  }).join('');
  target.innerHTML='<div class="active-card">'+activeCard(i,current)+'</div><header class="team-head"><h2>'+title(i)+'</h2><select aria-label="'+title(i)+' tactic" data-tactic'+disabled(locked)+'>'+options(tactic,config.tactics[i])+'</select></header><div class="team-list" role="group" aria-label="'+title(i)+' lineup">'+list+'</div><div class="team-controls"><label><select data-auto aria-label="'+title(i)+' Special control"'+disabled(isArenaOpponent||bench||starting)+'>'+options([['on',isArenaOpponent?'Game AI':'Auto Special'],['off','Manual Special']],isArenaOpponent||config.automatic[i]?'on':'off')+'</select></label></div>';
}

function updateHp(bar,mon) {
  if(!mon)return;
  const percent=healthPercent(mon);
  bar.style.width=percent+'%';
  bar.style.background=healthColor(percent);
}
function updateLiveTeam(i) {
  const panel=$('team-'+sides[i]);
  const current=live.sides[i];
  const previous=panel.querySelector('.active-card');
  const mon=current.active;
  const identity=mon ? mon.slot+':'+mon.name : '';
  const hp=mon?.hp ?? 0;
  if(previous.dataset.fighter!==identity) {
    previous.innerHTML=activeCard(i,current);
    previous.dataset.fighter=identity;
  } else if(mon) {
    updateHp(previous.querySelector('.hp i'),mon);
    previous.querySelector('.hp b').textContent=Math.ceil(hp)+' / '+Math.ceil(mon.max);
    if(hp<Number(previous.dataset.hp) && !finishing && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      previous.animate([{transform:'translateX(-3px)'},{transform:'translateX(3px)'},{transform:'none'}],{duration:200,easing:'steps(3)'});
    }
  }
  previous.dataset.hp=hp;
  const isArenaOpponent=mode().kind==='arena'&&i===1;
  for(const button of panel.querySelectorAll('[data-swap]')) {
    const index=Number(button.dataset.swap);
    const member=current.team[index];
    const slot=button.closest('.slot');
    button.disabled=!canSwapTo(current,index,isArenaOpponent);
    slot.classList.toggle('selected',mon?.slot===index);
    slot.classList.toggle('knocked',member.ko);
    updateHp(button.querySelector('.mini i'),member);
    const name=button.querySelector('strong');
    if(name.textContent!==member.name) {
      name.textContent=member.name;
      button.querySelector('img').src=portrait(member.id,member.portrait);
    }
  }
}
function updateBattleActions() {
  const actions=$('battle-actions');
  actions.hidden=!running;
  if(!running){
    actions.replaceChildren();
    return;
  }
  if(!actions.children.length)actions.innerHTML=sides.map((side,i)=>{
    const mega=config.teams[i].some(slot=>slot?.mega);
    return '<div class="battle-control '+side+'"><span class="control-name">'+title(i)+'</span><button class="pv-sp" data-command="f" data-side="'+i+'" aria-label="'+title(i)+' Special"><i></i><span><b>SPECIAL</b><small></small></span></button>'+
      (mega?'<button class="pv-mg" data-command="m" data-side="'+i+'" aria-label="'+title(i)+' Mega"><b>MEGA</b><small></small></button>':'')+
      '<span class="swap-state"><small>Swap</small><b></b></span></div>';
  }).join('');
  sides.forEach((_,i)=>{
    const panel=actions.children[i];
    const state=live.sides[i];
    const ai=mode().kind==='arena'&&i===1;
    const charge=Math.floor((state.meter||0)*100);
    const special=panel.querySelector('.pv-sp');
    const ready=state.canSpecial&&!ai&&!finishing;
    special.disabled=!ready;
    special.classList.toggle('ready',ready);
    special.querySelector('i').style.width=charge+'%';
    special.querySelector('small').textContent=ready?'tap now':charge+'%';
    const mega=panel.querySelector('.pv-mg');
    const canMega=state.canMega&&!ai&&!finishing;
    if(mega){
      mega.disabled=!canMega;
      mega.classList.toggle('ready',canMega);
      mega.querySelector('small').textContent=state.megaDone?'used':canMega?'tap now':'wait';
    }
    panel.querySelector('.swap-state b').textContent=ai?'AI':state.swap>0?Math.ceil(state.swap)+'s':'ready';
  });
}
function eventRows() {
  const log=$('log');
  if(!events.length){log.innerHTML='<p class="empty-log">Start a battle to see how it plays out.</p>';return;}
  const key=$('log-filter').value==='key';
  const rows=events.filter(row=>!key||['end','send','ko','special'].includes(row.kind)).slice(-120);
  log.innerHTML=rows.length?rows.map(row=>'<p class="event-'+escape(row.kind)+'"><time>'+clock(row.tick)+'</time>'+escape(row.text)+'</p>').join(''):'<p class="empty-log">No key moments yet.</p>';
  log.scrollTop=log.scrollHeight;
}
function clock(tick) {const seconds=Math.floor(tick/60);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
function showKnockout(mon) {
  const overlay=$('knockout');
  overlay.classList.toggle('team-a-ko',mon.side===0);
  overlay.innerHTML='<div class="ko-stripe"></div><div class="ko-portrait"><img src="'+portrait(mon.id,null,'Pain')+'" alt=""></div><b>'+escape(mon.name)+'</b><strong>K.O.!</strong><p>'+escape(mon.name)+' fainted!</p>';
  overlay.hidden=false;
  knockoutUntil=performance.now()+1000/Math.max(1,Number($('speed').value)/1.5);
  leftover=0;
}
function clearKnockout() {
  knockoutUntil=0;
  $('knockout').hidden=true;
}
function show() {
  document.body.classList.toggle('match-view',starting||running||Boolean(live?.over));
  const tick=live?.tick||0;
  $('clock').value=clock(tick);
  const caption=starting?'Loading sprites…':battleStartsAt?'Get ready':bench?'Benchmark in progress':live?.over?'Battle complete':running?(finishing?'Resolving the battle…':playing?tactic.find(([key])=>key===config.tactics[0])[1]+' vs '+tactic.find(([key])=>key===config.tactics[1])[1]:'Paused'):mode()?.name||'Set your teams to begin';
  $('match-caption').textContent=caption;
  const alive=config.teams.every(x=>x.some(Boolean));
  $('start').disabled=!arena||starting||running||bench||!alive;
  $('benchmark').disabled=starting||running||!alive;
  $('benchmark').textContent=bench?'Cancel benchmark':'Run benchmark';
  $('rules').disabled=starting||running||bench;
  $('seed').disabled=starting||running||bench;
  $('random').disabled=starting||running||bench;
  $('pause').disabled=!running||finishing||Boolean(battleStartsAt);
  $('pause').textContent=playing?'Pause':'Resume';
  $('step').disabled=!running||playing||finishing||Boolean(battleStartsAt);
  $('finish').disabled=!running||finishing;
  sides.forEach((side,i)=>{
    const state=live?.sides[i];
    const roster=state?.team || config.teams[i].filter(Boolean);
    $('count-'+side).textContent=roster.filter(mon=>!mon.ko).length;
    $('markers-'+side).innerHTML=roster.map(mon=>'<i'+(mon.ko?' class="out"':'')+'></i>').join('');
  });
}
function clearBattle() {
  live=null;events=[];playing=false;running=false;finishing=false;leftover=0;
  clearKnockout();
  battleStartsAt=0;
  $('countdown').hidden=true;
  $('battle-result').hidden=true;
  arena?.previewArena();
  $('result').hidden=true;
  renderTeams();show();eventRows();updateBattleActions();
}
function configPayload() {
  config.seed=integer($('seed').value,0,4294967295);
  $('seed').value=config.seed;
  persist();return config;
}
function ensureTeams() {
  for(let i=0;i<2;i++){
    const list=config.teams[i].filter(Boolean);
    if(!list.length || new Set(list.map(x=>x.id)).size!==list.length){notify(title(i)+' needs one to six different Pokémon.');return false;}
  }
  clearNotice();return true;
}

function handle(message) {
  if(message.type==='ready'){
    catalog=message;species=Object.fromEntries(message.species.map(x=>[x.id,x]));items=Object.fromEntries(message.items.map(x=>[x.k,x]));
    for(let i=0;i<2;i++)for(let j=0;j<presets[i].length;j++)if(!species[presets[i][j]])presets[i][j]=message.species[(i*6+j)%message.species.length].id;
    config=initial();
    for(const [side,id,itemName,mega] of [[0,'0483','Adamant Orb',0],[0,'0445','Choice Band',1],[0,'0589','Rocky Helmet',0],[1,'0484','Lustrous Orb',0],[1,'0160','',1]]){
      const slot=config.teams[side].find(x=>x.id===id);
      if(!slot)continue;
      slot.item=String(catalog.items.find(x=>x.name===itemName)?.k ?? '');
      slot.mega=species[id].mega.length?mega:0;
    }
    restore();clearNotice();
    optionList('rules',catalog.modes.map(x=>[x.id,x.name]),config.mode);
    $('seed').value=config.seed;
    $('workspace').inert=false;
    $('engine-status').className='engine-status ready';$('engine-status').lastChild.textContent=' Engine connected';
    renderTeams();show();
  }
  if(message.type==='load-error'){
    $('engine-status').className='engine-status error';$('engine-status').lastChild.textContent=' Engine unavailable';
    notify(message.message);
  }
  if(message.type==='error'){
    bench=false;starting=false;clearBattle();notify(message.message);
  }
  if(message.type==='state'){
    live=message;
    events.push(...message.entries);
    if(message.entries.length)eventRows();
    if(message.over){
      running=false;playing=false;finishing=false;
      const winner=$('battle-winner');
      winner.textContent=message.winner<0?'Draw':title(message.winner)+' wins!';
      $('battle-result').dataset.winner=message.winner;
      const survivors=message.sides.map(side=>side.team.filter(mon=>!mon.ko).length);
      $('battle-stats').textContent='Pokémon standing '+survivors.join(' : ')+' · '+clock(message.tick);
      $('battle-result').hidden=false;
      winner.focus({preventScroll:true});
    }
    if(message.over || message.tick===0)renderTeams();
    if(message.over || message.tick>=tickBudget){
      if(running)sides.forEach((_,i)=>updateLiveTeam(i));
      updateBattleActions();show();tickBudget=message.tick+9;
    }
  }
  if(message.type==='benchmark' && bench && message.job===benchmarkJob){
    const {wins,count,done,totalTicks}=message;
    $('result').hidden=false;
    $('result').textContent=message.complete
      ? count+' battles · Team A '+wins[0]+' ('+Math.round(wins[0]/count*100)+'%) · Team B '+wins[1]+' ('+Math.round(wins[1]/count*100)+'%) · '+wins[2]+' draws · Average '+clock(totalTicks/count)
      : 'Benchmarking '+done+' / '+count+' battles…';
    if(message.complete){bench=false;renderTeams();show();}
  }
}
function connect() {
  workers?.terminate();
  workers=new Worker('./battle-worker.js');
  workers.onmessage=({data})=>handle(data);
  workers.onerror=()=>handle({type:catalog?'error':'load-error',message:'The battle worker stopped unexpectedly. Reload to reconnect.'});
}
$('retry').onclick=connect;
$('rules').onchange=()=>{config.mode=$('rules').value;persist();clearBattle();};
$('seed').onchange=configPayload;
$('random').onclick=()=>{$('seed').value=crypto.getRandomValues(new Uint32Array(1))[0];configPayload();};
$('log-filter').onchange=eventRows;
function connectArena() {
  arena=arenaFrame.contentWindow.arenaView;
  $('arena-message').hidden=Boolean(arena);
  if(!arena)$('arena-message').textContent='The PokeClash arena could not load. Reload to try again.';
  if(catalog)show();
}
arenaFrame.addEventListener('arena-ready',connectArena);
if(arenaFrame.contentWindow.arenaView || arenaFrame.contentWindow.arenaError)connectArena();
async function startBattle(){
  if(!arena||!ensureTeams())return;
  clearBattle();
  starting=true;renderTeams();show();
  if(compactBattle.matches){
    window.scrollTo(0,0);
    $('match-head').focus({preventScroll:true});
  }
  const payload=configPayload();
  try {
    await arena.prepare(payload);
    starting=false;running=true;playing=true;tickBudget=0;leftover=0;
    if(mode().kind==='league')battleStartsAt=performance.now()+3000;
    handle(arena.start(payload));
    arena.draw();
  } catch(error) {
    handle({type:'error',message:error.message});
  }
}
$('start').onclick=startBattle;
$('rematch').onclick=startBattle;
$('edit-teams').onclick=()=>{
  clearBattle();
  window.scrollTo(0,0);
  $('rules').focus({preventScroll:true});
};
$('pause').onclick=()=>{playing=!playing;leftover=0;show();};
$('step').onclick=()=>advance(60);
$('finish').onclick=()=>{
  playing=false;finishing=true;battleStartsAt=0;
  $('countdown').hidden=true;
  clearKnockout();show();updateBattleActions();
};
$('battle-actions').onclick=event=>{
  const button=event.target.closest('button[data-command]');
  if(button && running && !finishing)arena.order(Number(button.dataset.side),[button.dataset.command]);
};
$('benchmark').onclick=()=>{
  if(bench){workers.postMessage({type:'cancel-benchmark'});bench=false;renderTeams();show();$('result').textContent='Benchmark cancelled.';return;}
  if(!ensureTeams())return;
  clearBattle();bench=true;renderTeams();show();
  $('result').textContent='Benchmarking…';$('result').hidden=false;
  workers.postMessage({type:'benchmark',job:++benchmarkJob,config:{...configPayload(),count:Number($('benchmark-count').value)}});
};
function advance(ticks){
  if(!running)return;
  try {
    const state=arena.advance(ticks,config.automatic,!finishing);
    handle(state);
    if(state.knockout && !finishing && !state.over)showKnockout(state.knockout);
    if(!finishing || !running)arena.draw();
  } catch(error) {
    handle({type:'error',message:error.message});
  }
}
function animation(now) {
  const elapsed=Math.min(190,now-lastFrame);
  lastFrame=now;
  if(battleStartsAt){
    const seconds=Math.ceil((battleStartsAt-now)/1000);
    $('countdown').hidden=seconds<=0;
    if(seconds>0)$('countdown').value=seconds;
    else {battleStartsAt=0;show();}
  }
  if(knockoutUntil && now>=knockoutUntil)clearKnockout();
  if(running && finishing)advance(480);
  else if(running && playing && !knockoutUntil && !battleStartsAt){
    leftover=Math.min(180,leftover+elapsed*0.06*Number($('speed').value));
    if(leftover>=1){const ticks=Math.floor(leftover);leftover-=ticks;advance(ticks);}
  }
  requestAnimationFrame(animation);
}
requestAnimationFrame(animation);

for(let i=0;i<2;i++){
  const panel=$('team-'+sides[i]);
  panel.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button)return;
    if(button.dataset.edit!==undefined)openEditor(i,Number(button.dataset.edit));
    if(button.dataset.reorder!==undefined){
      const [from,delta]=button.dataset.reorder.split(',').map(Number);const to=from+delta;
      [config.teams[i][from],config.teams[i][to]]=[config.teams[i][to],config.teams[i][from]];
      persist();clearBattle();
    }
    if(running && !finishing && button.dataset.swap!==undefined)arena.order(i,['s',Number(button.dataset.swap)]);
  });
  panel.addEventListener('change',e=>{
    if(e.target.hasAttribute('data-tactic'))config.tactics[i]=e.target.value;
    if(e.target.hasAttribute('data-auto'))config.automatic[i]=e.target.value==='on';
    persist();
  });
}
function localSlots(slot) {return ['',...species[slot.id].learn.filter(n=>n!==species[slot.id].innate)];}
function openEditor(side,index) {
  const slot=config.teams[side][index];
  edit={side,index,draft:structuredClone(slot||member(catalog.species[0].id))};
  $('slot-label').textContent=title(side)+' · Slot '+(index+1);
  $('species-search').value='';
  $('remove').hidden=!slot;
  speciesList();
  optionList('item',[['','No held item'],...catalog.items.map(x=>[x.k,x.name+' · '+x.rarity])],edit.draft.item);
  editFields();editor.showModal();$('species-search').focus();
}
function speciesList() {
  const q=$('species-search').value.trim().toLowerCase();
  const list=catalog.species.filter(s=>s.name.toLowerCase().includes(q));
  optionList('species',list.map(x=>[x.id,x.name+' · '+x.rarity]),edit.draft.id);
}
function editFields() {
  const x=edit.draft;const s=species[x.id];
  $('level').value=x.lv;$('ability').value=x.ability;$('item').value=x.item;
  $('species-info').textContent=s.types.map(t=>catalog.types[t]).join(' / ')+' · '+s.role+' · '+s.ability+' · Innate '+catalog.skills[s.innate];
  optionList('mega',[[0,'No Mega'],...s.mega.map((label,j)=>[j+1,label])],x.mega);
  for(const [i,key] of ['one','two'].entries()){
    const choices=localSlots(x).filter(t=>!t || t!==x.tms[1-i].k).map(k=>[k,k?catalog.skills[k]:'No TM']);
    optionList('tm-'+key,choices,x.tms[i].k);$('tm-'+key+'-level').value=x.tms[i].lv;
    $('tm-'+key).disabled=i===1 && x.lv<12;
    $('tm-'+key+'-level').disabled=!x.tms[i].k || (i===1&&x.lv<12);
  }
  const note=x.lv<12?' · TM slot 2 unlocks at Lv 12':'';
  $('effective').textContent='Effective battle level '+levelFor(x)+note;
}
$('species-search').oninput=speciesList;
$('species').onchange=()=>{
  if(!species[$('species').value])return;
  Object.assign(edit.draft,{id:$('species').value,mega:0,tms:[{k:'',lv:1},{k:'',lv:1}]});editFields();
};
function readLevel() {
  if($('level').value==='')return;
  const x=edit.draft;
  x.lv=integer($('level').value,1,50);
  const locked=x.lv<12;
  $('tm-two').disabled=locked;
  $('tm-two-level').disabled=locked||!x.tms[1].k;
  $('effective').textContent='Effective battle level '+levelFor(x)+(locked?' · TM slot 2 unlocks at Lv 12':'');
}
$('level').oninput=readLevel;
for(const [key,id] of Object.entries({ability:'ability',item:'item',mega:'mega'}))$(id).onchange=()=>{edit.draft[key]=id==='item'?$(id).value:integer($(id).value,key==='mega'?0:1,key==='ability'?3:2);editFields();};
for(const [i,key] of ['one','two'].entries()){
  $('tm-'+key).onchange=()=>{edit.draft.tms[i].k=$('tm-'+key).value;editFields();};
  $('tm-'+key+'-level').onchange=()=>{edit.draft.tms[i].lv=Number($('tm-'+key+'-level').value);};
}
$('editor-form').onsubmit=e=>{
  if(!edit)return;
  const action=e.submitter?.value;
  if(action!=='save' && action!=='remove')return;
  e.preventDefault();
  if(action==='save')readLevel();
  if(action==='save' && config.teams[edit.side].some((m,j)=>j!==edit.index&&m?.id===edit.draft.id)){
    $('effective').textContent='This Pokémon is already on '+title(edit.side)+'.';
    return;
  }
  config.teams[edit.side][edit.index]=action==='remove'?null:edit.draft;
  persist();editor.close();clearBattle();
};
connect();
