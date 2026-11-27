/* Load the upstream browser runtime in a worker so long tests keep the interface responsive. */
self.window = self;
self.PKC_PVP = true;
const upstream = 'https://pokeclashleague.xyz/';
const scripts = ['dex.js', 'evo.js', 'learn.js', 'mega.js', 'forms.js', 'data.js', 'engine.js', 'econ-core.js'];
const skills = {sd:'Swords Dance', id:'Iron Defense', ag:'Agility', fe:'Focus Energy', dt:'Double Team', gd:'Drain Punch', ch:'Charge', rc:'Recover', pr:'Protect', en:'Endure', gi:'Giga Impact'};
const send = (type, data = {}) => postMessage({type, ...data});
let core;
let modes;
let live;
let pending = [[], []];
let batch;

function bootstrap() {
  importScripts(...scripts.map(script => upstream + script));
  if (!self.GD?.SPECIES || typeof self.VE?.Battle !== 'function' || typeof self.EconCore !== 'function') throw Error('The upstream engine did not load.');
  core = self.EconCore(GD);
  modes = [{id:'sandbox',name:'Open sandbox',cap:0,kind:'duel'},
    ...core.CFG.arena.cups.map((cup,i)=>({id:'arena'+i,name:'Clash Arena · '+['Novice','Great','Ultra','Master'][i],cap:cup.cap,kind:'arena'})),
    ...core.CFG.league.ranks.map((rank,i)=>({id:'league'+i,name:'League · '+rank.n,cap:core.CFG.league.cap?.[i] || 0,kind:'league'}))];
  const species = Object.values(GD.SPECIES).map(s => ({
    id:s.id, name:s.name, types:s.types, rarity:GD.RAR[s.rar].n, role:GD.ROLES[s.role].n, ability:s.abN,
    innate:GD.innateOf(s.id), learn:GD.learnOf(s.id),
    mega:[GD.MEGA_SP[s.id]?.name, GD.MEGA_SP2[s.id]?.name].filter(Boolean),
    levels:core.CFG.items.map((item,k)=>core.itemLv({k,r:item.r},s.id))
  }));
  send('ready',{species,skills,modes,types:Object.fromEntries(Object.entries(GD.TYPES).map(([k,v])=>[k,v.n])),
    items:core.CFG.items.map((item,k)=>({k,name:item.n,rarity:core.RAR_N[item.r]}))});
}

function getMode(id) { return modes.find(mode=>mode.id===id) || modes[0]; }
function limit(value,min,max) {
  return Number.isFinite(Number(value)) ? Math.max(min,Math.min(max,Math.trunc(Number(value)))) : min;
}
function equip(m,mode) {
  const id=m.id;
  const base=limit(m.lv,1,50);
  if (!GD.SPECIES[id]) throw Error('A selected Pokémon is unavailable in the upstream engine.');
  const def=m.item==='' || m.item==null ? null : core.CFG.items[Number(m.item)];
  const item=def ? {k:Number(m.item),r:def.r} : null;
  const bonus=core.itemLv(item,id);
  const lv=!mode.cap ? base+bonus : mode.kind==='arena' ? Math.min(base,mode.cap)+bonus : Math.min(base+bonus,mode.cap);
  const abLv=limit(m.ability,1,3);
  const innate=GD.innateOf(id);
  const learned=new Set([innate]);
  const sk=[{k:innate,lv:abLv,innate:true}];
  for(const tm of (m.tms || []).slice(0,base>=12?2:1)){
    if (!GD.learnOf(id).includes(tm.k) || learned.has(tm.k)) continue;
    learned.add(tm.k);
    sk.push({k:tm.k,lv:limit(tm.lv,1,3)});
  }
  const mega=Number(m.mega)===2 && GD.MEGA_SP2[id] ? 2 : Number(m.mega)===1 && GD.MEGA_SP[id] ? true : false;
  return {id,lv,abLv,sk,mega,hb:core.heldFx(item,id)};
}

function build(config,seed,onEvent) {
  const mode=getMode(config.mode);
  const team=config.teams.map(side=>side.filter(Boolean).map(m=>equip(m,mode)));
  for(const entries of team){
    if(!entries.length || entries.length>6 || new Set(entries.map(x=>x.id)).size!==entries.length) throw Error('Each team needs one to six different Pokémon.');
  }
  const tactics=config.tactics.map(t=>Object.hasOwn(GD.TACTICS,t)?t:'equilibrado');
  return new VE.Battle(null,{
    sim:true,names:['Team A','Team B'],teams:team,plans:tactics.map(tactic=>({tactic,swap:'ordem'})),
    ai:[false,false],meter:true,duel:mode.kind!=='arena',seed:limit(seed,0,4294967295),
    swapCd:core.CFG.arena.swapCd,maxTicks:mode.kind==='league'?core.CFG.league.live.sec*60:core.CFG.arena.maxTicks,onEvent
  });
}

function auto(game,side,enabled,orders) {
  const state=game.sides[side];
  if (enabled && state.meter>=1) return [...orders,['f']];
  return orders;
}
function apply(game, automatic, orders=[[],[]]) {
  game.step(auto(game,0,automatic[0],orders[0]),auto(game,1,automatic[1],orders[1]));
}
function view(mon) {
  return mon ? {id:mon.id,name:mon.sp.name,lv:mon.lv,hp:Math.max(0,mon.hp),max:mon.max,slot:mon.slot,isMega:!!mon.isMega,ko:!!mon.ko,state:mon.state} : null;
}
function advance(count,config) {
  const game=live.game;
  for(let i=0;i<count && !game.over;i++){
    const orders=pending;
    pending=[[],[]];
    apply(game,config,orders);
  }
}
function state() {
  const {game,entries}=live;
  send('state',{tick:game.tick,over:game.over,winner:game.winner,
    sides:game.sides.map(s=>({active:view(s.active),meter:s.meter,swap:s.swapT||0,team:s.team.map(view)})),
    entries:entries.splice(0)});
}
function benchmark(config) {
  const count=limit(config.count,1,500);
  batch={done:0,wins:[0,0,0],totalTicks:0,count};
  const current=batch;
  function chunk() {
    if(batch!==current)return;
    const end=performance.now()+70;
    do {
      const game=build(config,(config.seed+current.done)>>>0);
      while(!game.over)apply(game,config.automatic);
      current.wins[game.winner<0?2:game.winner]++;
      current.totalTicks+=game.tick;
      current.done++;
    } while(current.done<count && performance.now()<end);
    send('benchmark',{...current,complete:current.done===count});
    if(current.done<count)setTimeout(chunk,0);
    else batch=null;
  }
  chunk();
}

self.onmessage = ({data}) => {
  try {
    if(!core) throw Error('The upstream battle engine is unavailable.');
    if(data.type==='start'){
      const entries=[];
      const game=build(data.config,data.config.seed,(event,payload)=>{
        if(event==='log')entries.push({tick:game.tick,text:payload.s,kind:payload.k});
      });
      live={game,entries};
      pending=[[],[]];
      state();
    }
    if(data.type==='advance' && live){advance(limit(data.ticks,1,180),data.automatic);state();}
    if(data.type==='order' && live && (data.side===0 || data.side===1))pending[data.side].push(data.order);
    if(data.type==='finish' && live){
      while(!live.game.over)advance(180,data.automatic);
      state();
    }
    if(data.type==='benchmark')benchmark(data.config);
    if(data.type==='cancel-benchmark')batch=null;
  } catch(e){send('error',{message:e.message});}
};
try { bootstrap(); } catch(error) { send('load-error',{message:'Could not load the public PokeClash League engine. '+error.message}); }
