import {mountDex} from './clashdex.js';
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
const initial = () => ({teams:presets.map(x=>x.map(member)),tactics:['equilibrado','equilibrado'],mode:'sandbox',seed:498271,automatic:[true,true],fullAI:[true,true],autoBattleVersion:2});
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
  const ids=[...new Set([...config.teams.flat().filter(Boolean).map(slot=>slot.id),...Array.from(document.querySelectorAll('dialog[open] [data-portrait]'),img=>img.dataset.portrait)])]
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
  clean.fullAI=clean.fullAI.map((_,i)=>saved.autoBattleVersion===2?saved.fullAI?.[i]!==false:true);
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
  const hp=mon?Math.ceil(mon.hp)+' / '+Math.ceil(mon.max):lead?'Ready':'Empty';
  return '<div class="active-heading"><img data-portrait="'+escape(id)+'" src="'+portrait(id,mon?.portrait)+'" alt=""><div><strong title="'+escape(name)+'">'+escape(name)+'</strong><small>'+escape(typeNames)+'</small></div><b>'+escape(level)+'</b></div><div class="hp" aria-label="'+title(i)+' health">'+(mon?healthFill(mon):'<i style="width:0"></i>')+'<b>'+hp+'</b></div><div class="buffs">'+(current?.read?'<span>READ</span>':'')+(ability?'<span>'+escape(ability)+'</span>':'')+'</div>';
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
    const lead=!live&&battleIndex===0;
    return '<div class="slot'+(lead?' lead-slot':'')+(active?' selected':'')+(mon?.ko?' knocked':'')+'"><button class="slot-main" '+(running?'data-swap="'+battleIndex+'"':'data-edit="'+index+'"')+disabled(running?!canSwapTo(current,battleIndex,aiControlled):bench||starting)+' aria-label="'+escape(action)+'" title="'+escape(action+' · '+details)+'"><img data-portrait="'+escape(s.id)+'" src="'+portrait(s.id,mon?.portrait)+'" alt=""><span class="slot-content"><strong>'+escape(displayed)+'</strong><small>'+escape(details)+'</small>'+(live?'<span class="mini" aria-hidden="true">'+healthFill(mon)+'</span>':'')+'</span></button>'
      +(locked?'':'<div class="slot-buttons"><button data-reorder="'+index+',-1" aria-label="Move '+escape(s.name)+' up"'+disabled(index===0)+'>↑</button><button data-reorder="'+index+',1" aria-label="Move '+escape(s.name)+' down"'+disabled(index===5)+'>↓</button></div>')+'</div>';
  }).join('');
  target.innerHTML='<div class="active-card">'+activeCard(i,current)+'</div><header class="team-head"><h2>'+title(i)+'</h2><select aria-label="'+title(i)+' tactic" data-tactic'+disabled(locked)+'>'+options(tactic,config.tactics[i])+'</select></header><div class="team-list" role="group" aria-label="'+title(i)+' lineup">'+list+'</div><div class="team-controls"><label><select data-auto aria-label="'+title(i)+' Special control"'+disabled(aiControlled||bench||starting)+'>'+options([['on',aiControlled?'Auto battle active':'Auto Special'],['off','Manual Special']],aiControlled||config.automatic[i]?'on':'off')+'</select></label><label class="auto-toggle" title="Smart AI chooses swaps, specials, Mega timing and replacements. Turn off to control this team manually; dodges are passive."><input type="checkbox" data-full-ai'+(config.fullAI[i]||isArenaOpponent?' checked':'')+disabled(locked||isArenaOpponent)+'> Auto battle</label></div>';
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
    panel.classList.toggle('auto-controlled',ai);
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
  if(starting!==($('start').dataset.preparing==='true')){$('start').dataset.preparing=String(starting);$('start').innerHTML=starting?'Preparing battle…':'<span aria-hidden="true">▶</span> Start battle';}
  if(document.querySelector('.lab-tools'))document.querySelector('.lab-tools').hidden=starting||running||bench||Boolean(live?.over);
  document.querySelector('.transport').hidden=!running;
  document.querySelector('.match-tools').hidden=!running&&!bench&&$('result').hidden;
  document.querySelector('.log-panel').hidden=!running&&!live?.over;
  document.querySelector('.setup').hidden=starting||running||Boolean(live?.over);
  if(bench)document.querySelector('.advanced-settings').open=true;
  $('benchmark').disabled=starting||running||!alive;
  $('benchmark').textContent=bench?'Cancel benchmark':'Run benchmark';
  $('benchmark-count').disabled=starting||running||bench;
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

const dexPending=new Map();let dexJob=0;
function requestDex(type,payload,onProgress){return new Promise((resolve,reject)=>{if(!workers||!catalog){reject(Error('Engine unavailable'));return;}const job=++dexJob;const timer=setTimeout(()=>{dexPending.delete(job);reject(Error('Engine request timed out'));},type==='team-plan'?180000:type==='dex-rank'?60000:15000);dexPending.set(job,{resolve,reject,timer,onProgress});workers.postMessage({type,job,...payload});});}
function handle(message) {
  if(message.type==='team-plan-progress'){dexPending.get(message.job)?.onProgress?.(message.progress);return;}
  if(message.type==='dex-preview'||message.type==='dex-timing'||message.type==='dex-rank'||message.type==='team-plan'){const p=dexPending.get(message.job);if(p){clearTimeout(p.timer);dexPending.delete(message.job);if(message.error)p.reject(Error(message.error));else p.resolve(message.result);}return;}
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
const logPanel=document.querySelector('.log-panel');
function setLogOpen(open){$('log-toggle').setAttribute('aria-expanded',String(open));logPanel.classList.toggle('log-collapsed',!open);$('log').hidden=!open;$('log-toggle').querySelector('span').textContent=open?'▾':'▸';if(open)$('log').scrollTop=$('log').scrollHeight;}
setLogOpen(!matchMedia('(max-width:760px)').matches);
$('log-toggle').onclick=()=>setLogOpen($('log-toggle').getAttribute('aria-expanded')!=='true');
$('settings-done').onclick=()=>{document.querySelector('.advanced-settings').open=false;document.querySelector('.advanced-settings summary').focus();};
const settings=document.querySelector('.advanced-settings');
settings.addEventListener('click',e=>{if(e.target===settings&&settings.open)settings.open=false;});
settings.addEventListener('keydown',e=>{if(e.key==='Escape'&&settings.open){e.preventDefault();settings.open=false;settings.querySelector('summary').focus();}});
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
  $('species-search').value='';$('species-search').hidden=true;$('species-find').setAttribute('aria-expanded','false');$('species-find').textContent='Search';$('editor-equipment').open=false;
  $('remove').hidden=!slot;
  speciesList();
  optionList('item',[['','No held item'],...catalog.items.map(x=>[x.k,x.name+' · '+x.rarity])],edit.draft.item);
  editFields();editor.showModal();editor.querySelector('.dialog-head button').focus({preventScroll:true});
}
function speciesList() {
  const q=$('species-search').value.trim().toLowerCase();
  const list=catalog.species.filter(s=>s.name.toLowerCase().includes(q));
  const choices=list.map(x=>[x.id,x.name+' · '+x.rarity]);
  if(!list.some(x=>x.id===edit.draft.id)){const current=species[edit.draft.id];choices.unshift([current.id,current.name+' · '+current.rarity+' (current)']);}
  optionList('species',choices,edit.draft.id);
}
function editFields() {
  const x=edit.draft;const s=species[x.id];
  $('level').value=x.lv;$('ability').value=x.ability;$('item').value=x.item;
  $('species-info').textContent=s.types.map(t=>catalog.types[t]).join(' / ')+' · '+s.role+' · '+(s.ranged?'Ranged':'Melee')+' · '+s.ability+' · Innate '+catalog.skills[s.innate];
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
$('species-find').onclick=()=>{const input=$('species-search'),show=input.hidden;input.hidden=!show;$('species-find').setAttribute('aria-expanded',String(show));$('species-find').textContent=show?'Done':'Search';if(show){input.focus();}else{input.value='';speciesList();$('species-find').focus();}};
$('species-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('species').focus();}};
$('species').onchange=()=>{
  if(!species[$('species').value])return;
  Object.assign(edit.draft,{id:$('species').value,mega:0,tms:[{k:'',lv:1},{k:'',lv:1}]});$('species-search').value='';$('species-search').hidden=true;$('species-find').setAttribute('aria-expanded','false');$('species-find').textContent='Search';speciesList();editFields();
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

const toolsBar=document.createElement('nav');toolsBar.className='lab-tools';toolsBar.setAttribute('aria-label','ClashLab tools');
toolsBar.innerHTML='<button class="secondary dex-launch" id="dex-open" aria-label="Open ClashDex">ClashDex <span>Pokédex</span></button><details class="tool-menu"><summary>Analysis</summary><div class="tool-menu-content"><button class="secondary" id="team-inspect">Team analyzer</button><button class="secondary" id="compare-open">Compare Pokémon</button><button class="secondary" id="counter-open">Counter Finder</button><button class="secondary" id="rank-open">Rarity rankings</button><button class="secondary" id="smart-team-open">Smart Team Builder</button><button class="secondary" id="build-open">Build Advisor</button></div></details><details class="tool-menu"><summary aria-label="Manage teams"><span class="desktop-menu-label">Manage teams</span><span class="mobile-menu-label">Teams</span></summary><div class="tool-menu-content"><button class="secondary" id="smart-team-manage">Smart Team Builder</button><button class="secondary" id="presets-open">Saved teams</button><button class="secondary" id="team-import">Import JSON</button><button class="secondary" id="team-export">Export JSON</button></div></details>';
toolsBar.addEventListener('click',e=>{if(e.target.closest('button'))for(const d of toolsBar.querySelectorAll('details'))d.open=false;});
toolsBar.addEventListener('toggle',e=>{if(e.target.tagName==='DETAILS'&&e.target.open)for(const d of toolsBar.querySelectorAll('details'))if(d!==e.target)d.open=false;},true);
document.querySelector('.setup').before(toolsBar);
const clashDex=mountDex({
 getCatalog:()=>catalog,getTeams:()=>config.teams,getMode:()=>config.mode,portrait,requestPortraits,tmEffect,requestDex,
 canEdit:()=>Boolean(catalog&&!running&&!starting&&!bench),
 add(id,form,side,slot,build={}){
  if(!catalog||running||starting||bench)return 'Team editing is unavailable during a battle.';
  const team=config.teams[side];if(!team||!Number.isInteger(slot)||slot<0||slot>=6||!species[id])return 'Invalid team selection.';
  if(team.some((m,j)=>m?.id===id&&j!==slot))return 'This species is already on '+title(side)+'.';
  const draft={...member(id),lv:integer(build.lv??50,1,50),ability:integer(build.ability??1,1,3),item:build.item!==''&&items[String(build.item)]?String(build.item):'',mega:integer(form,0,species[id].mega.length)};
  const seen=new Set([species[id].innate]);draft.tms=draft.tms.map((v,i)=>{const t=build.tms?.[i];if((i===1&&draft.lv<12)||!t||!species[id].learn.includes(t.k)||seen.has(t.k))return v;seen.add(t.k);return {k:t.k,lv:integer(t.lv,1,3)};});team[slot]=draft;
  persist();clearBattle();return species[id].name+' added to '+title(side)+'.';
 }
});
$('dex-open').onclick=()=>clashDex.open();
$('team-export').onclick=()=>{if(!catalog)return;const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='clashlab-team.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('team-import').onclick=()=>{if(!catalog||running||starting||bench)return;const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const data=JSON.parse(await input.files[0].text());if(!Array.isArray(data.teams)||data.teams.length!==2||!data.teams.every(t=>Array.isArray(t)&&t.length<=6&&t.filter(Boolean).every(m=>species[m.id])))throw Error('Invalid team file');localStorage.setItem('clashlab-1',JSON.stringify(data));restore();$('rules').value=config.mode;$('seed').value=config.seed;persist();clearBattle();}catch(e){notify('Import failed: '+e.message);}};input.click();};
function tmEffect(k,l){
 const i=Math.max(0,Math.min(2,l-1)),p=arr=>arr[i];
 const effects={sd:'+'+p([12,18,25])+'% attack',id:'+'+p([12,18,25])+'% defense',ag:'+'+p([15,22,30])+'% attack cooldown speed',fe:'+'+p([6,10,15])+' percentage points critical chance',dt:'+'+p([5,8,12])+' percentage points dodge chance (halved for specials)',gd:'Heal '+p([8,12,16])+'% of damage dealt',ch:'+'+p([15,25,35])+'% timed special cooldown speed; does not accelerate PvP meter in audited engine',rc:'Below 30% HP: heal '+p([25,35,45])+'% max HP once',pr:'Block '+(i+1)+' hit(s)',en:'Survive lethal hit once at 1 HP'+(i?' and heal '+p([0,10,20])+'% max HP':''),gi:'+'+p([20,30,40])+'% special attack multiplier'};
 return effects[k]||'Effect unavailable';
}
function updateEquipmentHints(){
 if(!edit||!catalog)return;
 const effects=[];
 for(const id of ['item','tm-one','tm-two']){
  const el=$(id);let text;
  if(id==='item'){const item=items[el.value];const bonus=species[edit.draft.id].levels[el.value]||0;text=item?item.name+' · '+item.rarity+' · Effective level bonus: '+bonus+' · '+(item.tags?.join(' / ')||'No listed battle effects')+(item.hasBattleEffect&&!species[edit.draft.id].activeEffects?.[Number(el.value)]?' · Conditional combat effect not active for this Pokémon':''):'No held item equipped.';}
  else {const k=el.value;text=k?(catalog.skills[k]||k)+' · '+tmEffect(k,Number($(id+'-level').value))+' · Compatible with '+species[edit.draft.id].name:'No TM equipped.';}
  el.title=text;for(const option of el.options){if(id==='item'){const it=items[option.value];option.title=it?.tags?.join(' / ')||'';}else{option.title=option.value?tmEffect(option.value,Number($(id+'-level').value)):'';}}if(el.value)effects.push('<p class="hint equipment-hint">'+escape(text)+'</p>');
 }
 $('editor-effect-list').innerHTML=effects.join('');$('editor-equipment').hidden=!effects.length;if(!effects.length)$('editor-equipment').open=false;
}
editor.addEventListener('change',updateEquipmentHints);
new MutationObserver(()=>{if(editor.open)updateEquipmentHints();}).observe(editor,{attributes:true,attributeFilter:['open']});

function openTool(label,body){
 const d=document.createElement('dialog');d.className='analysis-dialog';d.setAttribute('aria-label',label);
 d.innerHTML='<header class="dialog-head"><h2>'+escape(label)+'</h2><button class="icon-btn" aria-label="Close">×</button></header><div class="editor-fields">'+body+'</div>';
 const fields=d.querySelector('.editor-fields'),output=fields.querySelector('[data-results], [data-comparison], [data-list]'),controls=document.createElement('div'),scroll=document.createElement('div');controls.className='analysis-controls';scroll.className='analysis-scroll';scroll.tabIndex=0;scroll.setAttribute('aria-label','Results');
 for(const el of [...fields.children]){if(el===output||el.matches('[data-note]'))scroll.append(el);else if(el.classList.contains('hint')){const details=document.createElement('details');details.className='analysis-note';details.innerHTML='<summary>About these results</summary>';details.append(el);controls.append(details);}else controls.append(el);}
 fields.append(controls,scroll);
 document.body.append(d);d.querySelector('.dialog-head button').onclick=()=>d.close();d.onclose=()=>d.remove();d.showModal();return d;
}
$('compare-open').onclick=()=>{
 if(!catalog)return;
 const list=catalog.species.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>[p.id,p.name]);
 const d=openTool('Pokémon comparison','<div class="form-grid"><label>First Pokémon<select data-first>'+options(list,config.teams[0].find(Boolean)?.id)+'</select></label><label>Second Pokémon<select data-second>'+options(list,config.teams[1].find(Boolean)?.id)+'</select></label></div><div data-comparison class="analysis-comparison"></div><p class="hint">Live catalog attributes, not simulated win probabilities.</p>');
 const draw=()=>{const pair=['first','second'].map(k=>species[d.querySelector('[data-'+k+']').value]);const head='<div class="analysis-compare-head">'+pair.map(p=>'<div>'+cardName(p)+'<small>'+escape(p.types.map(t=>catalog.types[t]).join(' / '))+'</small></div>').join('')+'</div>';const stats=[['hp','HP'],['atk','ATK'],['def','DEF'],['spd','SPD'],['bst','BST']].map(([k,label])=>{const values=pair.map(p=>Number(p[k])||0),max=Math.max(1,...values);return '<div class="analysis-compare-stat"><b>'+values[0]+'</b><div><span>'+label+'</span><div class="analysis-compare-bars"><i style="width:'+100*values[0]/max+'%"></i><i style="width:'+100*values[1]/max+'%"></i></div></div><b>'+values[1]+'</b></div>';}).join('');d.querySelector('[data-comparison]').innerHTML=head+stats+'<div class="analysis-compare-details">'+pair.map(p=>'<div><strong>'+escape(p.ability)+'</strong><small>Innate: '+escape(catalog.skills[p.innate]||p.innate)+'</small><details><summary>TMs & Mega</summary><p>'+escape(p.learn.map(k=>catalog.skills[k]||k).join(', '))+'</p><p>'+escape(p.mega.join(', ')||'No Mega')+'</p></details></div>').join('')+'</div>';requestPortraits();};
 d.addEventListener('change',draw);draw();
};
function savedTeams(){try{const a=JSON.parse(localStorage.getItem('clashlab-presets')||'[]');return Array.isArray(a)?a:[];}catch{return [];}}
$('presets-open').onclick=()=>{
 if(!catalog||running||starting||bench)return;
 const d=openTool('Saved team setups','<label>Preset name<input data-name maxlength="60" placeholder="My competitive team"></label><button class="primary" data-save>Save current setup</button><div data-list></div><p class="hint" data-note>Saved in this browser.</p>');
 const render=()=>{d.querySelector('[data-list]').innerHTML=savedTeams().map((p,i)=>'<div class="analysis-preset-row"><strong>'+escape(p.name)+'</strong><span><button class="quiet" data-load="'+i+'">Load</button><button class="quiet" data-delete="'+i+'">Delete</button></span></div>').join('')||'No saved setups.';};
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
function cardName(p){return '<span class="analysis-mon"><img data-portrait="'+escape(p.id)+'" src="'+portrait(p.id)+'" alt="" width="32" height="32"><span><strong>'+escape(p.name)+'</strong><small>'+escape(p.rarity+' · '+p.role+' · '+(p.ranged?'Ranged':'Melee'))+'</small></span></span>';}
$('counter-open').onclick=()=>{
 if(!catalog)return;
 const d=openTool('Counter Finder','<div class="form-grid"><label>Opponent<select data-target>'+options(speciesOptions(),config.teams[1].find(Boolean)?.id)+'</select></label><label>Rarity<select data-rarity>'+options(rarityOptions(),'')+'</select></label></div><label><span><input type="checkbox" data-defensive> Resist incoming types only</span></label><p class="hint">'+escape(referenceNote)+'</p><div data-results></div>');
 function draw(){const opponent=species[d.querySelector('[data-target]').value],rarity=d.querySelector('[data-rarity]').value;
 const results=d.querySelector('[data-results]');if(!supported(opponent)){results.textContent='Native type data unavailable for this opponent.';return;}
 const rows=catalog.species.filter(p=>p.id!==opponent.id&&supported(p)&&(!rarity||p.rarity===rarity)).map(p=>({p,attack:offense(p,opponent),incoming:offense(opponent,p)})).filter(r=>!d.querySelector('[data-defensive]').checked||r.incoming<1);
 rows.sort((a,b)=>(b.attack-a.attack)||(a.incoming-b.incoming)||b.p.learn.length-a.p.learn.length||a.p.name.localeCompare(b.p.name));
 results.innerHTML='<p class="hint">'+rows.length+' candidates · highest offensive matchup first, then lowest incoming type multiplier</p>'+rows.slice(0,40).map(({p,attack,incoming},i)=>'<div class="analysis-row counter-row"><span class="analysis-rank">'+(i+1)+'</span>'+cardName(p)+'<span class="analysis-match"><b>Out '+metricText(attack)+'</b><small>In '+metricText(incoming)+'</small></span><small class="analysis-types">'+escape(p.types.map(t=>catalog.types[t]).join(' / '))+'</small></div>').join('');
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
 d.querySelector('[data-results]').innerHTML=rows.slice(0,60).map(({p,value},i)=>{if(value!==last)rank=i+1;last=value;return '<div class="analysis-row rank-row"><span class="analysis-rank">'+rank+'</span>'+cardName(p)+'<b class="analysis-score">'+value+'</b></div>';}).join('')||'No matching Pokémon.';requestPortraits();}
 d.addEventListener('change',draw);draw();};
$('team-inspect').onclick=()=>{
 if(!catalog)return;
 const d=openTool('Team analyzer','<label>Roster<select data-side><option value="0">Team A</option><option value="1">Team B</option></select></label><p class="hint">'+escape(referenceNote)+'</p><div data-results></div>');
 function draw(){const i=Number(d.querySelector('[data-side]').value), roster=config.teams[i].filter(Boolean).map(m=>species[m.id]),valid=roster.filter(supported);
 const stats=refTypes.map(t=>({t,weak:valid.filter(p=>effectiveness(t,typeNames(p))>1),resist:valid.filter(p=>effectiveness(t,typeNames(p))<1),hits:valid.filter(p=>typeNames(p).some(a=>effectiveness(a,[t])>1))})).sort((a,b)=>(b.weak.length-b.resist.length)-(a.weak.length-a.resist.length));
 d.querySelector('[data-results]').innerHTML='<div class="analysis-overview"><div><small>Team members</small><b>'+valid.length+'/'+roster.length+'</b></div><div><small>Coverage</small><b>'+stats.filter(t=>t.hits.length).length+'/'+refTypes.length+'</b></div></div><p class="analysis-uncovered">Uncovered: '+escape(stats.filter(t=>t.weak.length&&!t.resist.length).map(t=>catalog.types[t.t]).join(', ')||'None')+'</p><table class="analysis-type-table"><thead><tr><th>Type</th><th>Weak</th><th>Resist</th><th>Hit</th></tr></thead><tbody>'+stats.map(t=>'<tr><th scope="row"><details><summary>'+escape(catalog.types[t.t]||t.t)+'</summary><small>'+escape(t.weak.length?'Weak: '+t.weak.map(p=>p.name).join(', '):'No weak members')+'</small></details></th><td class="analysis-danger">'+t.weak.length+'</td><td class="analysis-good">'+t.resist.length+'</td><td>'+t.hits.length+'</td></tr>').join('')+'</tbody></table>';
 }d.addEventListener('change',draw);draw();};
$('build-open').onclick=()=>{
 if(!catalog||running||starting||bench)return;
 const entries=config.teams.flatMap((t,i)=>t.flatMap((m,j)=>m?[[i+':'+j,title(i)+' · '+species[m.id].name]]:[]));
 if(!entries.length){notify('Add Pokémon before using Build Advisor.');return;}
 const d=openTool('Build Advisor','<label>Team Pokémon<select data-member>'+options(entries,entries[0][0])+'</select></label><p class="hint">Ranks held items by actual effective level under the selected ruleset; not overall combat power. TM effects and damage are not scored.</p><div data-results></div>');
 function draw(){const [i,j]=d.querySelector('[data-member]').value.split(':').map(Number),m=config.teams[i][j],p=species[m.id],baseline=levelFor({...m,item:''});
 const rows=catalog.items.map(it=>({it,lv:levelFor({...m,item:String(it.k)})})).sort((a,b)=>b.lv-a.lv||a.it.name.localeCompare(b.it.name));
 d.querySelector('[data-results]').innerHTML='<h2>'+escape(p.name)+'</h2><p>No item: Lv '+baseline+' · Current build: Lv '+levelFor(m)+'</p><h2>Held items by effective level</h2>'+rows.slice(0,15).map(({it,lv})=>'<div class="analysis-item-row"><span><strong>'+escape(it.name)+'</strong><small>Lv '+lv+' · +'+(lv-baseline)+'</small></span><button class="quiet" data-equip="'+escape(it.k)+'">Equip</button></div>').join('')+'<h2>Compatible TMs</h2><p>'+escape(p.learn.filter(k=>k!==p.innate).map(k=>catalog.skills[k]||k).join(', ')||'None')+'</p><p class="hint">Second TM unlocks at Lv 12. Use the Pokémon editor to select ranks and moves.</p>';
 }d.addEventListener('change',draw);d.addEventListener('click',e=>{const b=e.target.closest('[data-equip]');if(!b||running||starting||bench)return;const [i,j]=d.querySelector('[data-member]').value.split(':').map(Number);if(!items[b.dataset.equip])return;config.teams[i][j].item=b.dataset.equip;persist();clearBattle();draw();});draw();};

/* Smart Team Builder: local acquisition planner, never purchases or modifies the official game. */
function openSmartTeam(){
 if(!catalog||running||starting||bench)return;
 const rarities=['Common','Uncommon','Rare','Epic','Legendary'],opts=(a,v)=>options(a,v),rar=rarities.map((r,i)=>[String(i),r]);
 const d=openTool('Smart Team Builder','<div class="stb-primary form-grid"><label>PKL budget<input data-plan="budget" type="number" min="0" max="1000000000000" value="500000"></label><label>Strategy<select data-plan="objective"><option value="balanced">Balanced / coverage</option><option value="offense">Offensive pressure</option><option value="tank">Tank / passive bulk</option><option value="speed">Fast attackers</option></select></label><label>Max Pokémon rarity<select data-plan="maxRarity">'+opts(rar,'4')+'</select></label><label>Ruleset<select data-plan="mode">'+opts(catalog.modes.map(m=>[m.id,m.name]),config.mode)+'</select></label></div><details class="stb-options"><summary>Budget, evolution & advanced filters</summary><div class="form-grid"><label>Min Pokémon rarity<select data-plan="minRarity">'+opts(rar,'0')+'</select></label><label>Max item rarity<select data-plan="maxItemRarity">'+opts([...rar,['5','Mythic']],'5')+'</select></label><label>Team size<select data-plan="size">'+opts([3,4,5,6].map(n=>[String(n),String(n)]),'6')+'</select></label><label>Base level<input data-plan="lv" type="number" min="1" max="50" value="50"></label><label>Ability / max TM rank<select data-plan="rank">'+opts([['1','I'],['2','II'],['3','III']],'2')+'</select></label><label>Attack range<select data-plan="range">'+opts([['','Any'],['melee','Melee only'],['ranged','Ranged only']],'')+'</select></label><label>Required species type<select data-plan="type">'+opts([['','Any'],...Object.entries(catalog.types)],'')+'</select></label><label>Evolution path<select data-plan="evolution">'+opts([['cheapest','Cheapest purchase or evolve'],['direct','Buy final selection directly']],'cheapest')+'</select></label><label>Mega option<select data-plan="mega">'+opts([['off','No Mega'],['on','Allow one Mega']],'off')+'</select></label><label>SOL budget<input data-plan="solBudget" type="number" min="0" step="0.1" value="0"></label><label>Mega PKL/SOL reserve<select data-plan="megaCost">'+opts([['expected','Expected attempts'],['attempt','One attempt (may fail)']],'expected')+'</select></label><label>Market reference multiplier<input data-plan="priceFactor" type="number" min="0.1" max="50" step="0.1" value="1"></label><label>PKL reserve per rank-I TM copy<input data-plan="tmReserve" type="number" min="0" value="7000"></label><label>Battle tactic<select data-plan="tactic">'+opts([['equilibrado','Balanced'],['agressivo','Aggressive'],['defensivo','Defensive']],'equilibrado')+'</select></label></div><div class="stb-checks"><label><span><input type="checkbox" data-plan="mixed" checked> Prefer mixed melee/ranged</span></label><label><span><input type="checkbox" data-plan="finalOnly"> Final evolutions only</span></label></div></details><button class="primary" data-plan-run>Generate smart team</button><p class="stb-status" data-plan-status role="status">Prices are adjustable planning estimates, not live listings.</p><div data-results></div><p class="hint">Uses official market reference formulas, not verified listing prices. Evo stone allowance uses the expected cost of randomly drawing the required stone from geodes; actual spending can differ. TM reserve is user-defined per rank-I copy; rank II needs three and rank III nine copies. Ability candy, training time and Mega luck are separate constraints. A team can Mega Evolve only once in a battle. The optimizer searches a shortlist of objective-relevant legal builds and balances coverage and cost; it does not guarantee a globally optimal team or actual market availability.</p>');
 d.classList.add('stb-dialog');let result=null,busy=false,appliedConfig=null;
 const get=()=>Object.fromEntries([...d.querySelectorAll('[data-plan]')].map(el=>[el.dataset.plan,el.type==='checkbox'?el.checked:el.value]));
 const fmt=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:2}),pkl=v=>fmt(v)+' PKL',status=d.querySelector('[data-plan-status]'),out=d.querySelector('[data-results]');
 function render(){const r=result;if(!r)return;
  out.innerHTML='<div class="stb-total"><div><small>Estimated total</small><strong>'+pkl(r.cost)+'</strong></div><div><small>Remaining</small><strong>'+pkl(r.budget-r.cost)+'</strong></div><div><small>Roster</small><strong>'+r.team.length+'/'+r.size+'</strong></div><div><small>Coverage</small><strong>'+r.coverage.length+'/'+Object.keys(catalog.types).length+'</strong></div></div><p class="stb-notice">'+escape(r.complete?'Team fits the planning budget.':'Only '+r.team.length+' of '+r.size+' slots could be filled under these constraints.')+'</p><p class="hint">'+fmt(r.sol)+' SOL reserved for Mega · '+fmt(r.candy)+' ability candy · '+escape(r.mode)+' · '+fmt(r.evaluated)+' builds evaluated</p>'+r.team.map((x,i)=>{const p=species[x.id],it=items[x.build.item],tms=x.build.tms.filter(t=>t.k).map(t=>(catalog.skills[t.k]||t.k)+' '+['I','II','III'][t.lv-1]);return '<article class="stb-member"><div class="stb-member-head"><img data-portrait="'+escape(x.id)+'" src="'+portrait(x.id)+'" width="38" height="38" alt=""><div><strong>'+escape(x.name)+'</strong><small>'+escape(x.rarity+' · '+(x.ranged?'Ranged':'Melee')+' · Lv '+x.effective)+'</small></div><b>'+pkl(x.cost)+'</b></div><div class="stb-loadout"><span>Item <b>'+escape(it?.name||'None')+'</b></span><span>Innate <b>'+escape(catalog.skills[x.innate]||x.innate)+' '+['I','II','III'][x.build.ability-1]+'</b></span><span>TMs <b>'+escape(tms.join(' · ')||'None')+'</b></span><span>Ability <b>'+escape(x.ability)+'</b></span></div><div class="stb-statline"><span>ATK '+fmt(x.atk)+'</span><span>DEF '+fmt(x.def)+'</span><span>HP '+fmt(x.hp)+'</span><span>CD '+fmt(x.expectedCooldown)+'s</span></div><details><summary>Cost & evolution path</summary><div class="stb-cost"><span>Pokémon / evolution</span><b>'+pkl(x.acquisition.pkl)+'</b><span>Held item</span><b>'+pkl(x.equipment)+'</b><span>TM reserve</span><b>'+pkl(x.tm)+'</b><span>Mega reserve</span><b>'+pkl(x.megaPKL)+'</b></div><p>'+x.acquisition.steps.map(escape).join(' → ')+'</p>'+(x.form?'<p>Mega: '+fmt(x.megaChance*100)+'% success per attempt; '+fmt(x.sol)+' SOL reserved.</p>':'')+'</details></article>';}).join('')+'<details class="stb-coverage"><summary>Coverage & unprotected weaknesses</summary><p>Hits super effectively: '+escape(r.coverage.map(t=>catalog.types[t]).join(', ')||'None')+'</p><p>Unprotected weaknesses: '+escape(r.weak.map(t=>catalog.types[t]).join(', ')||'None')+'</p></details><div class="stb-apply"><button class="primary" data-plan-apply="0" '+(!r.team.length?'disabled':'')+'>Apply to Team A</button><button class="secondary" data-plan-apply="1" '+(!r.team.length?'disabled':'')+'>Apply to Team B</button></div>';requestPortraits();}
 d.addEventListener('change',e=>{if(e.target.dataset.plan)status.textContent='Settings changed. Generate a new team to apply them.';});
 d.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-plan-run')){if(busy)return;const q=get();if(Number(q.minRarity)>Number(q.maxRarity)){status.textContent='Minimum rarity cannot exceed maximum rarity.';return;}if(!Number.isFinite(Number(q.budget))||Number(q.budget)<0){status.textContent='Enter a valid PKL budget.';return;}busy=true;b.disabled=true;b.textContent='Searching builds…';status.textContent='Evaluating legal budgeted teams locally…';out.innerHTML='';result=null;
   try{result=await requestDex('team-plan',{config:q},p=>{status.textContent=p.phase==='roster'?'Assembling roster · slot '+(p.depth+1)+' / '+p.size:'Scanning '+p.scanned+' / '+p.total+' species · '+fmt(p.evaluated)+' builds evaluated';});appliedConfig=q;status.textContent='Search completed · '+fmt(result.candidates)+' budget-efficient candidates.';render();d.querySelector('.analysis-scroll').scrollTop=0;}catch(err){status.textContent='Unable to generate: '+err.message;}finally{busy=false;b.disabled=false;b.textContent='Generate smart team';}return;}
  if(b.dataset.planApply!==undefined&&result&&appliedConfig){if(running||starting||bench)return;const side=Number(b.dataset.planApply);if(!confirm('Replace '+title(side)+' with the generated '+result.team.length+' Pokémon?'+(config.mode!==appliedConfig.mode?' The match ruleset will also change.':'')))return;
   const roster=result.team.map(x=>({...member(x.id),...x.build,tms:x.build.tms.map(t=>({...t}))}));config.teams[side]=Array.from({length:6},(_,i)=>roster[i]||null);config.mode=appliedConfig.mode;config.tactics[side]=appliedConfig.tactic;$('rules').value=config.mode;persist();d.close();clearBattle();return;}
 });
}
$('smart-team-open').onclick=openSmartTeam;$('smart-team-manage').onclick=openSmartTeam;
