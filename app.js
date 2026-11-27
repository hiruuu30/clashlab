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
const initial = () => ({teams:presets.map(x=>x.map(member)),tactics:['equilibrado','equilibrado'],mode:'sandbox',seed:498271,automatic:[true,true],fullAI:[false,false]});
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
  const ids=[...new Set([...config.teams.flat().filter(Boolean).map(slot=>slot.id),...Array.from(document.querySelectorAll('dialog[open] [data-portrait], #dex-results [data-portrait]'),img=>img.dataset.portrait)])]
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
  clean.fullAI=clean.fullAI.map((_,i)=>saved.fullAI?.[i]===true);
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
  const aiControlled=isArenaOpponent||config.fullAI[i];
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
    return '<div class="slot'+(active?' selected':'')+(mon?.ko?' knocked':'')+'"><button class="slot-main" '+(running?'data-swap="'+battleIndex+'"':'data-edit="'+index+'"')+disabled(running?!canSwapTo(current,battleIndex,aiControlled):bench||starting)+' aria-label="'+escape(action)+'" title="'+escape(action)+'"><img data-portrait="'+escape(s.id)+'" src="'+portrait(s.id,mon?.portrait)+'" alt=""><span class="slot-content"><strong>'+escape(displayed)+'</strong><small>'+escape(details)+'</small>'+(live?'<span class="mini" aria-hidden="true">'+healthFill(mon)+'</span>':'')+'</span></button>'
      +(locked?'':'<div class="slot-buttons"><button data-reorder="'+index+',-1" aria-label="Move '+escape(s.name)+' up"'+disabled(index===0)+'>↑</button><button data-reorder="'+index+',1" aria-label="Move '+escape(s.name)+' down"'+disabled(index===5)+'>↓</button></div>')+'</div>';
  }).join('');
  target.innerHTML='<div class="active-card">'+activeCard(i,current)+'</div><header class="team-head"><h2>'+title(i)+'</h2><select aria-label="'+title(i)+' tactic" data-tactic'+disabled(locked)+'>'+options(tactic,config.tactics[i])+'</select></header><div class="team-list" role="group" aria-label="'+title(i)+' lineup">'+list+'</div><div class="team-controls"><label><select data-auto aria-label="'+title(i)+' Special control"'+disabled(aiControlled||bench||starting)+'>'+options([['on',isArenaOpponent?'Game AI':'Auto Special'],['off','Manual Special']],aiControlled||config.automatic[i]?'on':'off')+'</select></label><label class="auto-toggle" title="Auto special and cooldown-aware type switching; dodges and Mega are native engine mechanics"><input type="checkbox" data-full-ai'+(config.fullAI[i]||isArenaOpponent?' checked':'')+disabled(locked||isArenaOpponent)+'> Auto battle</label></div>';
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
  const isArenaOpponent=(mode().kind==='arena'&&i===1)||config.fullAI[i];
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
    const ai=(mode().kind==='arena'&&i===1)||config.fullAI[i];
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
    catalog=message;refTypes=Object.keys(message.typeMatrix||{});species=Object.fromEntries(message.species.map(x=>[x.id,x]));items=Object.fromEntries(message.items.map(x=>[x.k,x]));
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
  if(button && running && !finishing && !config.fullAI[Number(button.dataset.side)])arena.order(Number(button.dataset.side),[button.dataset.command]);
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
    const state=arena.advance(ticks,config.automatic.map((on,i)=>on&&!config.fullAI[i]),!finishing);
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
    if(running && !finishing && !config.fullAI[i] && button.dataset.swap!==undefined)arena.order(i,['s',Number(button.dataset.swap)]);
  });
  panel.addEventListener('change',e=>{
    if(e.target.hasAttribute('data-tactic'))config.tactics[i]=e.target.value;
    if(e.target.hasAttribute('data-auto'))config.automatic[i]=e.target.value==='on';
    if(e.target.hasAttribute('data-full-ai')&&!running&&!starting&&!bench){config.fullAI[i]=e.target.checked;renderTeam(i);}
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

const dex=document.createElement('dialog');
dex.style.width='min(850px,calc(100% - 24px))';
dex.innerHTML='<header class="dialog-head"><h2>ClashDex</h2><button class="icon-btn" data-close>×</button></header><div class="editor-fields"><input id="dex-query" type="search" placeholder="Search name, ability or TM"><div class="form-grid"><label>Rarity<select id="dex-rarity"></select></label><label>Type<select id="dex-type"></select></label><label>Role<select id="dex-role"></select></label><label>Sort<select id="dex-sort"><option value="name">Name</option><option value="coverage">Native type coverage</option><option value="bst">Base stat total</option><option value="hp">HP</option><option value="atk">Attack</option><option value="def">Defense</option><option value="spd">Speed</option><option value="learn">TM versatility</option><option value="mega">Mega options</option><option value="id">Dex number</option></select></label></div><label><span><input type="checkbox" id="dex-mega"> Mega available only</span></label><p id="dex-count" class="hint"></p><div id="dex-results" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px"></div><button class="secondary" id="dex-more">Show more</button></div>';
document.body.append(dex);
const toolsBar=document.createElement('div');toolsBar.className='actions';toolsBar.style.flexWrap='wrap';
toolsBar.innerHTML='<button class="secondary" id="dex-open">Pokédex</button><button class="secondary" id="team-inspect">Team overview</button><button class="secondary" id="team-export">Export teams</button><button class="secondary" id="team-import">Import JSON</button><button class="secondary" id="trainer-import">Import trainer</button><button class="secondary" id="compare-open">Compare Pokémon</button><button class="secondary" id="presets-open">Saved teams</button><button class="secondary" id="counter-open">Counter Finder</button><button class="secondary" id="rank-open">Rarity rankings</button><button class="secondary" id="build-open">Build Advisor</button>';
document.querySelector('.setup').append(toolsBar);
let dexLimit=36;
function dexRender(){
  const q=$('dex-query').value.trim().toLowerCase(), rarity=$('dex-rarity').value,type=$('dex-type').value,role=$('dex-role').value,sort=$('dex-sort').value;
  const rows=catalog.species.filter(s=>(!rarity||s.rarity===rarity)&&(!type||s.types.map(String).includes(type))&&(!role||s.role===role)&&(!$('dex-mega').checked||s.mega.length)&&[s.name,s.id,s.ability,...s.learn.map(k=>catalog.skills[k])].join(' ').toLowerCase().includes(q));
  const metric=s=>sort==='learn'?s.learn.length:sort==='mega'?s.mega.length:sort==='coverage'&&supported(s)?coverage(s):['hp','atk','def','spd','bst'].includes(sort)?Number(s[sort])||0:0;
  rows.sort((a,b)=>sort==='id'?Number(a.id)-Number(b.id):metric(b)-metric(a)||a.name.localeCompare(b.name));
  $('dex-count').textContent=rows.length+' Pokémon · sorting uses catalog attributes, not win-rate predictions';
  $('dex-results').innerHTML=rows.slice(0,dexLimit).map(s=>'<article class="slot" style="display:block;padding:8px"><img data-portrait="'+escape(s.id)+'" src="'+portrait(s.id)+'" alt="" width="48" height="48" style="float:left;margin-right:8px"><strong>'+escape(s.name)+'</strong><p>'+escape(s.rarity+' · '+s.role)+'</p><p>'+escape(s.types.map(t=>catalog.types[t]).join(' / '))+'</p><p>'+escape(s.ability)+'</p><p>HP '+escape(s.hp)+' · ATK '+escape(s.atk)+' · DEF '+escape(s.def)+' · SPD '+escape(s.spd)+'</p><details><summary>Moves & forms</summary><p>'+escape('Innate: '+(catalog.skills[s.innate]||s.innate))+'</p><p>'+escape(s.learn.map(k=>catalog.skills[k]||k).join(', '))+'</p><p>'+escape(s.mega.join(', ')||'No Mega')+'</p></details><div><button class="quiet" data-add="0" data-id="'+escape(s.id)+'">+ A</button> <button class="quiet" data-add="1" data-id="'+escape(s.id)+'">+ B</button></div></article>').join('');
  $('dex-more').hidden=rows.length<=dexLimit;requestPortraits();
}
$('dex-open').onclick=()=>{if(!catalog)return;for(const [id,values] of [['dex-rarity',catalog.species.map(s=>[s.rarity,s.rarity])],['dex-role',catalog.species.map(s=>[s.role,s.role])],['dex-type',Object.entries(catalog.types)]]){optionList(id,[['','All'],...new Map(values)],'');}dexLimit=36;dexRender();dex.showModal();};
dex.querySelector('[data-close]').onclick=()=>dex.close();
dex.addEventListener('input',e=>{if(e.target.id!=='dex-more'){dexLimit=36;dexRender();}});
$('dex-more').onclick=()=>{dexLimit+=36;dexRender();};
dex.addEventListener('click',e=>{const b=e.target.closest('[data-add]');if(!b||running||starting||bench)return;const side=Number(b.dataset.add);if(config.teams[side].some(m=>m?.id===b.dataset.id)){ $('dex-count').textContent='Already on '+title(side);return;}const index=config.teams[side].findIndex(m=>!m);if(index<0){$('dex-count').textContent=title(side)+' is full. Remove a Pokémon first.';return;}config.teams[side][index]=member(b.dataset.id);persist();clearBattle();$('dex-count').textContent='Added to '+title(side);});
$('team-inspect').onclick=()=>{if(!catalog)return;const d=document.createElement('dialog');d.innerHTML='<header class="dialog-head"><h2>Team overview</h2><button class="icon-btn">×</button></header><div class="editor-fields">'+config.teams.map((team,i)=>{const roster=team.filter(Boolean).map(m=>species[m.id]);const counts={};for(const p of roster)for(const t of p.types)counts[t]=(counts[t]||0)+1;return '<h2>'+title(i)+'</h2><p>'+escape(Object.entries(counts).map(([t,n])=>catalog.types[t]+': '+n).join(' · ')||'Empty')+'</p><p>'+escape(roster.map(p=>p.name+' — '+p.role).join(' / '))+'</p>';}).join('')+'<p class="hint">Roster type distribution only; not a weakness or matchup score.</p></div>';document.body.append(d);d.querySelector('button').onclick=()=>d.close();d.onclose=()=>d.remove();d.showModal();};
$('team-export').onclick=()=>{if(!catalog)return;const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='clashlab-team.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('team-import').onclick=()=>{if(!catalog||running||starting||bench)return;const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const data=JSON.parse(await input.files[0].text());if(!Array.isArray(data.teams)||data.teams.length!==2||!data.teams.every(t=>Array.isArray(t)&&t.length<=6&&t.filter(Boolean).every(m=>species[m.id])))throw Error('Invalid team file');localStorage.setItem('clashlab-1',JSON.stringify(data));restore();$('rules').value=config.mode;$('seed').value=config.seed;persist();clearBattle();}catch(e){notify('Import failed: '+e.message);}};input.click();};
function tmEffect(k,l){
 const i=Math.max(0,Math.min(2,l-1)),p=arr=>arr[i];
 const effects={sd:'+'+p([12,18,25])+'% attack',id:'+'+p([12,18,25])+'% defense',ag:'+'+p([15,22,30])+'% attack cooldown speed',fe:'+'+p([6,10,15])+' percentage points critical chance',dt:'+'+p([5,8,12])+' percentage points dodge chance (halved for specials)',gd:'Heal '+p([8,12,16])+'% of damage dealt',ch:'+'+p([15,25,35])+'% timed special cooldown speed; does not accelerate PvP meter in audited engine',rc:'Below 30% HP: heal '+p([25,35,45])+'% max HP once',pr:'Block '+(i+1)+' hit(s)',en:'Survive lethal hit once at 1 HP'+(i?' and heal '+p([0,10,20])+'% max HP':''),gi:'+'+p([20,30,40])+'% special attack multiplier'};
 return effects[k]||'Effect unavailable';
}
function updateEquipmentHints(){
 if(!edit||!catalog)return;
 for(const id of ['item','tm-one','tm-two']){
  const el=$(id);let text;
  if(id==='item'){const item=items[el.value];const bonus=species[edit.draft.id].levels[el.value]||0;text=item?item.name+' · '+item.rarity+' · Effective level bonus: '+bonus+' · '+(item.tags?.join(' / ')||'No listed battle effects')+(item.hasBattleEffect&&!species[edit.draft.id].activeEffects?.[Number(el.value)]?' · Conditional combat effect not active for this Pokémon':''):'No held item equipped.';}
  else {const k=el.value;text=k?(catalog.skills[k]||k)+' · '+tmEffect(k,Number($(id+'-level').value))+' · Compatible with '+species[edit.draft.id].name:'No TM equipped.';}
  el.title=text;for(const option of el.options){if(id==='item'){const it=items[option.value];option.title=it?.tags?.join(' / ')||'';}else{option.title=option.value?tmEffect(option.value,Number($(id+'-level').value)):'';}}let hint=el.parentElement.querySelector('.equipment-hint');if(!hint){hint=document.createElement('small');hint.className='hint equipment-hint';el.after(hint);}hint.textContent=text;
 }
}
editor.addEventListener('change',updateEquipmentHints);
new MutationObserver(()=>{if(editor.open)updateEquipmentHints();}).observe(editor,{attributes:true,attributeFilter:['open']});

function openTool(label,body){
 const d=document.createElement('dialog');d.style.width='min(720px,calc(100% - 24px))';
 d.innerHTML='<header class="dialog-head"><h2>'+escape(label)+'</h2><button class="icon-btn" aria-label="Close">×</button></header><div class="editor-fields">'+body+'</div>';
 document.body.append(d);d.querySelector('button').onclick=()=>d.close();d.onclose=()=>d.remove();d.showModal();return d;
}
$('compare-open').onclick=()=>{
 if(!catalog)return;
 const list=catalog.species.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>[p.id,p.name]);
 const d=openTool('Pokémon comparison','<div class="form-grid"><label>First Pokémon<select data-first>'+options(list,config.teams[0].find(Boolean)?.id)+'</select></label><label>Second Pokémon<select data-second>'+options(list,config.teams[1].find(Boolean)?.id)+'</select></label></div><div data-comparison class="form-grid"></div><p class="hint">Live catalog attributes, not simulated win probabilities.</p>');
 const draw=()=>{d.querySelector('[data-comparison]').innerHTML=['first','second'].map(k=>{const p=species[d.querySelector('[data-'+k+']').value];return '<section class="slot" style="display:block;padding:10px"><img data-portrait="'+escape(p.id)+'" src="'+portrait(p.id)+'" alt="" width="72" height="72"><h2>'+escape(p.name)+'</h2><p>'+escape(p.rarity+' · '+p.role)+'</p><p>Type: '+escape(p.types.map(t=>catalog.types[t]).join(' / '))+'</p><p>HP '+escape(p.hp)+' · ATK '+escape(p.atk)+' · DEF '+escape(p.def)+' · SPD '+escape(p.spd)+'</p><p>Ability: '+escape(p.ability)+'</p><p>Innate: '+escape(catalog.skills[p.innate]||p.innate)+'</p><p>Compatible TMs ('+p.learn.length+'): '+escape(p.learn.map(k=>catalog.skills[k]||k).join(', '))+'</p><p>Mega: '+escape(p.mega.join(', ')||'None')+'</p></section>';}).join('');requestPortraits();};
 d.addEventListener('change',draw);draw();
};
function savedTeams(){try{const a=JSON.parse(localStorage.getItem('clashlab-presets')||'[]');return Array.isArray(a)?a:[];}catch{return [];}}
$('presets-open').onclick=()=>{
 if(!catalog||running||starting||bench)return;
 const d=openTool('Saved team setups','<label>Preset name<input data-name maxlength="60" placeholder="My competitive team"></label><button class="primary" data-save>Save current setup</button><div data-list></div><p class="hint" data-note>Saved in this browser.</p>');
 const render=()=>{d.querySelector('[data-list]').innerHTML=savedTeams().map((p,i)=>'<div class="slot" style="padding:7px"><span>'+escape(p.name)+'</span><span><button class="quiet" data-load="'+i+'">Load</button><button class="quiet" data-delete="'+i+'">Delete</button></span></div>').join('')||'No saved setups.';};
 d.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;try{let list=savedTeams();if(b.hasAttribute('data-save')){const name=d.querySelector('[data-name]').value.trim();if(!name)return;list.push({name,config:structuredClone(config)});localStorage.setItem('clashlab-presets',JSON.stringify(list));render();}else if(b.dataset.delete!==undefined){list.splice(Number(b.dataset.delete),1);localStorage.setItem('clashlab-presets',JSON.stringify(list));render();}else if(b.dataset.load!==undefined){const p=list[Number(b.dataset.load)];if(!p)return;localStorage.setItem('clashlab-1',JSON.stringify(p.config));restore();$('rules').value=config.mode;$('seed').value=config.seed;persist();clearBattle();d.close();}}catch(err){d.querySelector('[data-note]').textContent=err.message;}});
 render();
};
const logExport=document.createElement('button');logExport.className='quiet';logExport.textContent='Export log';document.querySelector('.log-head').append(logExport);
logExport.onclick=()=>{if(!events.length)return;const url=URL.createObjectURL(new Blob([events.map(e=>clock(e.tick)+' '+e.text).join('\n')],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='clashlab-battle-log.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

/* Type multipliers supplied by the live PokeClash engine. */
let refTypes=[];
const typeNames=p=>p.types.map(String);
const supported=p=>p&&typeNames(p).length>0&&typeNames(p).every(t=>Object.hasOwn(catalog.typeMatrix||{},t));
function effectiveness(a,targets){return targets.reduce((v,t)=>v*catalog.typeMatrix[a][t],1);}
function offense(p,op){return Math.max(...typeNames(p).map(t=>effectiveness(t,typeNames(op))));}
function coverage(p){return refTypes.filter(t=>typeNames(p).some(a=>effectiveness(a,[t])>1)).length;}
function resistCount(p){return refTypes.filter(t=>effectiveness(t,typeNames(p))<1).length;}
function threatCount(p){return refTypes.filter(t=>effectiveness(t,typeNames(p))>1).length;}
const referenceNote='Uses PokeClash native battle type multipliers. Standard immunities deal ×0.25 per immune type. Held-item exceptions, stats and special move types are not included in this type-only score.';
const speciesOptions=()=>catalog.species.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>[p.id,p.name]);
const rarityOptions=()=>[['','All rarities'],...Array.from(new Set(catalog.species.map(p=>p.rarity))).sort().map(r=>[r,r])];
function metricText(value){return value+'×';}
function cardName(p){return '<img data-portrait="'+escape(p.id)+'" src="'+portrait(p.id)+'" alt="" width="42" height="42" style="vertical-align:middle;margin-right:8px"><strong>'+escape(p.name)+'</strong> <small>'+escape(p.rarity+' · '+p.role)+'</small>';}
$('counter-open').onclick=()=>{
 if(!catalog)return;
 const d=openTool('Counter Finder','<div class="form-grid"><label>Opponent<select data-target>'+options(speciesOptions(),config.teams[1].find(Boolean)?.id)+'</select></label><label>Rarity<select data-rarity>'+options(rarityOptions(),'')+'</select></label></div><label><span><input type="checkbox" data-defensive> Resist incoming types only</span></label><p class="hint">'+escape(referenceNote)+'</p><div data-results></div>');
 function draw(){const opponent=species[d.querySelector('[data-target]').value],rarity=d.querySelector('[data-rarity]').value;
 const results=d.querySelector('[data-results]');if(!supported(opponent)){results.textContent='Native type data unavailable for this opponent.';return;}
 const rows=catalog.species.filter(p=>p.id!==opponent.id&&supported(p)&&(!rarity||p.rarity===rarity)).map(p=>({p,attack:offense(p,opponent),incoming:offense(opponent,p)})).filter(r=>!d.querySelector('[data-defensive]').checked||r.incoming<1);
 rows.sort((a,b)=>(b.attack-a.attack)||(a.incoming-b.incoming)||b.p.learn.length-a.p.learn.length||a.p.name.localeCompare(b.p.name));
 results.innerHTML='<p class="hint">'+rows.length+' candidates · highest offensive matchup first, then lowest incoming type multiplier</p>'+rows.slice(0,40).map(({p,attack,incoming},i)=>'<div class="slot" style="display:block;padding:8px"><span>#'+(i+1)+' </span>'+cardName(p)+'<p>Outgoing type '+metricText(attack)+' · Incoming type '+metricText(incoming)+'</p><p class="hint">'+escape(p.types.map(t=>catalog.types[t]).join(' / '))+'</p></div>').join('');
 requestPortraits();
 }
 d.addEventListener('change',draw);draw();};
$('rank-open').onclick=()=>{
 if(!catalog)return;
 const d=openTool('Rarity rankings','<div class="form-grid"><label>Rarity<select data-rarity>'+options(rarityOptions().slice(1),catalog.species[0]?.rarity)+'</select></label><label>Rank by<select data-metric><option value="coverage">Type coverage (game)</option><option value="resist">Type resistances (game)</option><option value="tm">TM versatility (game catalog)</option><option value="mega">Mega options (game catalog)</option></select></label></div><p class="hint">Rankings reflect the selected attribute, not overall combat strength. '+escape(referenceNote)+'</p><div data-results></div>');
 function draw(){const rarity=d.querySelector('[data-rarity]').value,m=d.querySelector('[data-metric]').value;
 const score=p=>m==='tm'?p.learn.length:m==='mega'?p.mega.length:m==='resist'?resistCount(p):coverage(p);
 const rows=catalog.species.filter(p=>p.rarity===rarity&&(['tm','mega'].includes(m)||supported(p))).map(p=>({p,value:score(p)})).sort((a,b)=>b.value-a.value||a.p.name.localeCompare(b.p.name));
 let rank=0,last=null;
 d.querySelector('[data-results]').innerHTML=rows.slice(0,60).map(({p,value},i)=>{if(value!==last)rank=i+1;last=value;return '<div class="slot" style="display:block;padding:8px">#'+rank+' '+cardName(p)+'<p>Score: '+value+'</p></div>';}).join('')||'No matching Pokémon.';requestPortraits();}
 d.addEventListener('change',draw);draw();};
$('team-inspect').onclick=()=>{
 if(!catalog)return;
 const d=openTool('Team analyzer','<label>Roster<select data-side><option value="0">Team A</option><option value="1">Team B</option></select></label><p class="hint">'+escape(referenceNote)+'</p><div data-results></div>');
 function draw(){const i=Number(d.querySelector('[data-side]').value), roster=config.teams[i].filter(Boolean).map(m=>species[m.id]),valid=roster.filter(supported);
 const stats=refTypes.map(t=>({t,weak:valid.filter(p=>effectiveness(t,typeNames(p))>1),resist:valid.filter(p=>effectiveness(t,typeNames(p))<1),hits:valid.filter(p=>typeNames(p).some(a=>effectiveness(a,[t])>1))})).sort((a,b)=>(b.weak.length-b.resist.length)-(a.weak.length-a.resist.length));
 d.querySelector('[data-results]').innerHTML='<h2>'+escape(title(i))+'</h2><p>'+valid.length+'/'+roster.length+' members with recognized game types.</p><p>Offensive coverage: '+stats.filter(t=>t.hits.length).length+' / '+refTypes.length+' single types</p><p>Uncovered shared weaknesses: '+escape(stats.filter(t=>t.weak.length&&!t.resist.length).map(t=>catalog.types[t.t]).join(', ')||'None')+'</p>'+stats.map(t=>'<div class="slot" style="display:block;padding:7px"><strong>'+escape((catalog.types[t.t]||t.t).toUpperCase())+'</strong><p>Weak: '+t.weak.length+' · Resist: '+t.resist.length+' · Can hit super effectively by type: '+t.hits.length+'</p><small>'+escape(t.weak.map(p=>p.name).join(', '))+'</small></div>').join('');
 }d.addEventListener('change',draw);draw();};
$('build-open').onclick=()=>{
 if(!catalog||running||starting||bench)return;
 const entries=config.teams.flatMap((t,i)=>t.flatMap((m,j)=>m?[[i+':'+j,title(i)+' · '+species[m.id].name]]:[]));
 if(!entries.length){notify('Add Pokémon before using Build Advisor.');return;}
 const d=openTool('Build Advisor','<label>Team Pokémon<select data-member>'+options(entries,entries[0][0])+'</select></label><p class="hint">Ranks held items by actual effective level under the selected ruleset; not overall combat power. TM effects and damage are not scored.</p><div data-results></div>');
 function draw(){const [i,j]=d.querySelector('[data-member]').value.split(':').map(Number),m=config.teams[i][j],p=species[m.id],baseline=levelFor({...m,item:''});
 const rows=catalog.items.map(it=>({it,lv:levelFor({...m,item:String(it.k)})})).sort((a,b)=>b.lv-a.lv||a.it.name.localeCompare(b.it.name));
 d.querySelector('[data-results]').innerHTML='<h2>'+escape(p.name)+'</h2><p>No item: Lv '+baseline+' · Current build: Lv '+levelFor(m)+'</p><h2>Held items by effective level</h2>'+rows.slice(0,15).map(({it,lv})=>'<div class="slot" style="padding:7px"><span>'+escape(it.name)+' · Lv '+lv+' (+'+(lv-baseline)+')</span><button class="quiet" data-equip="'+escape(it.k)+'">Equip</button></div>').join('')+'<h2>Compatible TMs</h2><p>'+escape(p.learn.filter(k=>k!==p.innate).map(k=>catalog.skills[k]||k).join(', ')||'None')+'</p><p class="hint">Second TM unlocks at Lv 12. Use the Pokémon editor to select ranks and moves.</p>';
 }d.addEventListener('change',draw);d.addEventListener('click',e=>{const b=e.target.closest('[data-equip]');if(!b||running||starting||bench)return;const [i,j]=d.querySelector('[data-member]').value.split(':').map(Number);if(!items[b.dataset.equip])return;config.teams[i][j].item=b.dataset.equip;persist();clearBattle();draw();});draw();};

$('trainer-import').onclick=()=>{
 if(!catalog||running||starting||bench)return;
 const d=openTool('Import trainer','<label>Trainer username or ID<input data-trainer-query placeholder="@username or numeric trainer ID" maxlength="80"></label><button class="primary" data-trainer-search>Find trainer</button><p class="hint">Search synced ranking names or recent public activity, or enter a numeric trainer ID. Sync the official leaderboard once to find ranked players by name.</p><p class="hint" data-trainer-status role="status"></p><div data-trainer-results></div><div data-trainer-profile></div><details open><summary>Sync official leaderboard</summary><p>On desktop, drag the bookmark below onto your bookmarks bar. Open the official League or Arena ranking, then click the bookmark. It opens ClashLab with the visible names and IDs only. No credentials are transferred.</p><p><a class="secondary" data-board-bookmark>ClashLab · Sync rankings</a> <button class="quiet" data-copy-bookmark>Copy bookmark code</button></p><p><a href="https://pokeclashleague.xyz/" target="_blank" rel="noopener">Open PokeClash League</a></p><p class="hint" data-board-count></p><button class="secondary" data-board-show>Browse synced rankings</button></details>');
 const query=d.querySelector('[data-trainer-query]'),status=d.querySelector('[data-trainer-status]'),results=d.querySelector('[data-trainer-results]'),profile=d.querySelector('[data-trainer-profile]'),search=d.querySelector('[data-trainer-search]');
 let selected=null,serial=0;
 const bookmark="javascript:(()=>{if(location.origin!=='https://pokeclashleague.xyz'){alert('Open the official PokeClash League or Arena ranking page first.');return;}const rows=[...document.querySelectorAll('.pv-lad .pv-lr')].filter(e=>e.getClientRects().length).map(e=>{const b=e.querySelector('[data-who]');return b?[b.dataset.who,b.textContent.trim().replace(/^@/,''),e.querySelector('.pv-li')?.textContent.trim()||'']:null;}).filter(Boolean);if(!rows.length){alert('No visible ranked trainers. Open the live League or Arena ranking page first.');return;}const url='https://clashlab.vercel.app/#trainer-board='+encodeURIComponent(JSON.stringify(rows.slice(0,200)));window.open(url,'_blank','noopener');})();";
 d.querySelector('[data-board-bookmark]').href=bookmark;
 d.querySelector('[data-copy-bookmark]').onclick=async()=>{try{await navigator.clipboard.writeText(bookmark);status.textContent='Bookmark code copied. Create a bookmark with this code as its URL.';}catch{status.textContent='Drag the bookmark link onto your bookmarks bar instead.';}};
 const local=boardRows();d.querySelector('[data-board-count]').textContent=local.length?local.length+' synced trainers (last imported ranking snapshot).':'No ranking synced yet.';
 const renderMatches=rows=>{results.innerHTML=rows.map(m=>'<button class="secondary" data-trainer-id="'+escape(m.id)+'">'+(m.rank?'#'+escape(m.rank)+' · ':'')+'@'+escape(m.name)+'</button>').join(' ');};
 d.querySelector('[data-board-show]').onclick=()=>{selected=null;profile.replaceChildren();renderMatches(local);status.textContent=local.length?'Select a ranked trainer.':'Sync a ranking first.';};
 async function request(params){
  const response=await fetch('/api/trainer?'+new URLSearchParams(params),{cache:'no-store',signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>null);if(!response.ok||!body)throw Error(body?.error||'Trainer service unavailable');return body;
 }
 async function load(id){
  const n=++serial;selected=null;profile.replaceChildren();status.textContent='Loading trainer profile…';search.disabled=true;
  try{
   const p=await request({id});if(n!==serial||!d.open)return;
   const seen=new Set();let valid=[];
   for(const m of p.six||[]){if(!species[m.id]||seen.has(m.id)||!Number.isInteger(m.lv)||m.lv<1||m.lv>50)continue;seen.add(m.id);valid.push({...m,mega:integer(m.mega,0,species[m.id].mega.length)});}
   if(!valid.length)throw Error('No supported public Pokémon in this trainer’s current six.');
   if(valid.length!==(p.six||[]).length)throw Error('Some public lineup entries are incompatible with the current catalog. Import stopped rather than dropping Pokémon.');
   selected={name:p.name,id:p.id,six:valid};
   profile.innerHTML='<h2>@'+escape(p.name)+'</h2>'+valid.map(m=>'<div class="slot" style="display:block;padding:6px"><strong>'+escape(species[m.id].name)+'</strong> · Lv '+m.lv+(m.mega?' · '+escape(species[m.id].mega[m.mega-1]):'')+(m.shiny?' · Shiny':'')+'</div>').join('')+'<p class="hint">Public current six in returned order. Items, TMs, ability rank and tactics are not shown: imported with no items/TMs, ability rank I, and existing team tactics. Shiny is listed but not simulated. These are editable estimates, not the trainer’s verified complete build.</p><div class="form-grid"><button class="secondary" data-trainer-side="0">Replace Team A</button><button class="primary" data-trainer-side="1">Replace Team B</button></div>';
   status.textContent='Public profile loaded.';
  }catch(e){if(n===serial)status.textContent=e.message;}finally{if(n===serial)search.disabled=false;}
 }
 async function find(){
  const v=query.value.trim().replace(/^@+/,'');if(/^\d+$/.test(v))return load(v);
  if(v.length<2){status.textContent='Enter at least two username characters.';return;}
  const rank=v.match(/^(?:top\s*|rank\s*|#)(\d+)$/i);const matches=local.filter(m=>rank?Number(m.rank)===Number(rank[1]):m.name.toLowerCase().includes(v.toLowerCase()));
  const exactLocal=matches.filter(m=>rank||m.name.toLowerCase()===v.toLowerCase());
  if(exactLocal.length===1){results.replaceChildren();return load(exactLocal[0].id);}
  if(matches.length){selected=null;profile.replaceChildren();renderMatches(matches);status.textContent='Select a trainer from your synced ranking.';return;}
  const n=++serial;selected=null;profile.replaceChildren();results.replaceChildren();status.textContent='Searching public activity…';search.disabled=true;
  try{
   const p=await request({q:v});if(n!==serial||!d.open)return;
   const rows=Array.isArray(p.matches)?p.matches:[];
   const exact=rows.filter(m=>m.name.toLowerCase()===v.toLowerCase());
   if(exact.length===1)return load(exact[0].id);
   status.textContent=rows.length?'Select a matching trainer.':'Not found in recent public activity. Sync the official ranking below to search that trainer by name.';
   results.innerHTML=rows.map(m=>'<button class="secondary" data-trainer-id="'+escape(m.id)+'">@'+escape(m.name)+'</button>').join(' ');
  }catch(e){if(n===serial)status.textContent=e.message;}finally{if(n===serial)search.disabled=false;}
 }
 search.onclick=find;query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();find();}});
 d.addEventListener('click',e=>{
  const id=e.target.closest('[data-trainer-id]');if(id){load(id.dataset.trainerId);return;}
  const b=e.target.closest('[data-trainer-side]');if(!b||!selected||running||starting||bench)return;
  const side=Number(b.dataset.trainerSide);
  config.teams[side]=Array.from({length:6},(_,i)=>{const m=selected.six[i];return m?{...member(m.id),lv:m.lv,mega:m.mega}:null;});
  persist();clearBattle();d.close();
 });
 query.focus();
};

const boardKey='clashlab-trainer-board-v1';
function boardRows(){try{const a=JSON.parse(localStorage.getItem(boardKey)||'[]');return Array.isArray(a)?a:[];}catch{return [];}}
function parseBoardLink(){
 if(!location.hash.startsWith('#trainer-board='))return;
 try{const raw=JSON.parse(decodeURIComponent(location.hash.slice('#trainer-board='.length)));if(!Array.isArray(raw))throw Error('Invalid ranking');
 const rows=raw.slice(0,200).filter(v=>Array.isArray(v)&&/^\d{1,15}$/.test(String(v[0]))&&typeof v[1]==='string'&&v[1].trim()).map(v=>({id:String(v[0]),name:v[1].trim().slice(0,80),rank:String(v[2]||'').slice(0,12)}));
 if(!rows.length)throw Error('No valid ranked trainers');localStorage.setItem(boardKey,JSON.stringify(rows));history.replaceState(null,'',location.pathname+location.search);return rows.length;
 }catch(e){history.replaceState(null,'',location.pathname+location.search);return 0;}
}
const importedBoardCount=parseBoardLink();
if(importedBoardCount){const timer=setInterval(()=>{if(catalog){clearInterval(timer);$('trainer-import').click();}},250);setTimeout(()=>clearInterval(timer),20000);}
