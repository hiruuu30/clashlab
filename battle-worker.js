/* Load the upstream browser runtime in a worker so long tests keep the interface responsive. */
self.window = self;
self.PKC_PVP = true;
const upstream = 'https://pokeclashleague.xyz/';
const scripts = ['dex.js', 'evo.js', 'learn.js', 'mega.js', 'forms.js', 'data.js', 'engine.js', 'econ-core.js'];
const skills = {sd:'Swords Dance', id:'Iron Defense', ag:'Agility', fe:'Focus Energy', dt:'Double Team', gd:'Drain Punch', ch:'Charge', rc:'Recover', pr:'Protect', en:'Endure', gi:'Giga Impact'};
const send = (type, data = {}) => postMessage({type, ...data});
let runtime;
const loadedTimings = new Set();
let batch;

function bootstrap() {
  importScripts(...scripts.map(script => upstream + script));
  if (!self.GD?.SPECIES || typeof self.VE?.Battle !== 'function' || typeof self.EconCore !== 'function') throw Error('The upstream engine did not load.');
  importScripts('./battle-runtime.js');
  runtime = createBattleRuntime(self);
  const {core,modes} = runtime;
  self.SPRITE_T = {};
  // The engine reads timings separately from images. Workers only need the frame data.
  self.SPR = (id, animations) => { self.SPRITE_T[id] = animations; };
  // Expose the game catalog as data, not a separate hardcoded Pokédex.
  const statData = (p,b) => ({hp:p.hp,atk:p.atk,def:p.def,spd:p.spd,bst:p.bst,
    base:b?{hp:b.hp,atk:b.atk,def:b.def,spa:b.spa,spd:b.spd,spe:b.spe}:null});
  const movesFor=(id,types)=>types.map(t=>{const m=GD.moveOf(id,t);return {type:t,basic:m[0],special:m[1]};});
  const megaData=(p,f)=>p?{id:p.id,form:f,name:p.name,types:p.types,stone:p.stone,moves:movesFor(p.base,p.types),
    portrait:typeof p.por==='string'&&p.por.startsWith('data:image/png;base64,')?p.por:null,...statData(p,p.b)}:null;
  const heldFormsFor=s=>Object.entries(self.FORMS?.[s.id]||{}).flatMap(([key,f])=>{const k=core.CFG.items.findIndex(it=>it.k===key);if(k<0)return [];const item=core.CFG.items[k],h=core.heldFx({k,r:item.r},s.id);if(!h)return [];const types=h.ty||s.types;return [{item:k,name:h.st?s.name+' (Origin Forme)':s.name+' ('+item.n+')',id:f.id,types,portrait:f.por,requiredItem:item.n,specialType:h.mty||null,...statData({...s,...h.st},s.base),moves:movesFor(s.id,types)}];});
  const species = Object.values(GD.SPECIES).map(s => ({
    id:s.id,name:s.name,types:s.types,rarity:GD.RAR[s.rar].n,rarityColor:GD.RAR[s.rar].c,
    role:GD.ROLES[s.role].n,roleDescription:GD.ROLES[s.role].d,ranged:!!GD.ROLES[s.role].ranged,ability:s.abN,abilityKey:s.ab,
    ...statData(s,s.base),abilityEffects:[1,2,3].map(l=>GD.ABIL[s.ab]?.d(l)||''),
    innate:GD.innateOf(s.id), learn:GD.learnOf(s.id),
    mega:[GD.MEGA_SP[s.id]?.name, GD.MEGA_SP2[s.id]?.name].filter(Boolean),
    megaForms:[megaData(GD.MEGA_SP[s.id],1),megaData(GD.MEGA_SP2[s.id],2)].filter(Boolean),
    heldForms:heldFormsFor(s),
    previous:GD.PRE[s.id]||null,evolutions:(GD.EVO[s.id]||[]).map(e=>({to:e.to,lv:e.lv||null,how:e.how||null})),
    moves:movesFor(s.id,s.types),
    levels:core.CFG.items.map((item,k)=>core.itemLv({k,r:item.r},s.id)),
    activeEffects:core.CFG.items.map((item,k)=>Boolean(core.heldFx({k,r:item.r},s.id)))
  }));
  send('ready',{species,skills,modes,types:Object.fromEntries(Object.entries(GD.TYPES).map(([k,v])=>[k,v.n])),
    typeColors:Object.fromEntries(Object.entries(GD.TYPES).map(([k,v])=>[k,v.c])),
    typeMatrix:Object.fromEntries(Object.keys(GD.TYPES).map(a=>[a,Object.fromEntries(Object.keys(GD.TYPES).map(b=>[b,GD.eff(a,[b])]))])),
    items:core.CFG.items.map((item,k)=>({k,name:item.n,rarity:core.RAR_N[item.r],tags:core.heldTags({k,r:item.r}),hasBattleEffect:!!core.heldDef({k,r:item.r})}))});
}


// Read-only native build projection. No battle loop, account API, or RNG-based damage sampling.
function dexPreview(q) {
 const {core,modes}=runtime,sp=GD.SPECIES[q.id];
 if(!sp)throw Error('Species unavailable.');
 const integer=(v,a,b)=>Math.max(a,Math.min(b,Math.trunc(Number(v)||a)));
 const lv=integer(q.lv,1,50),abLv=integer(q.ability,1,3),mode=modes.find(m=>m.id===q.mode)||modes[0];
 const k=q.item===''?-1:Number(q.item),def=core.CFG.items[k],it=def?{k,r:def.r}:null,hb=core.heldFx(it,q.id),bonus=core.itemLv(it,q.id);
 const effective=!mode.cap?lv+bonus:mode.kind==='arena'?Math.min(lv,mode.cap)+bonus:Math.min(lv+bonus,mode.cap);
 const innate=GD.innateOf(q.id),used=new Set([innate]),sk=[{k:innate,lv:abLv,innate:true}];
 for(const t of (q.tms||[]).slice(0,lv>=12?2:1)){if(!GD.learnOf(q.id).includes(t.k)||used.has(t.k))continue;used.add(t.k);sk.push({k:t.k,lv:integer(t.lv,1,3)});}
 const mega=q.form===2&&GD.MEGA_SP2[q.id]?2:q.form===1&&GD.MEGA_SP[q.id]?true:false;
 const t=Object.hasOwn(GD.TACTICS,q.tactic)?q.tactic:'equilibrado',ot=Object.hasOwn(GD.TACTICS,q.opponentTactic)?q.opponentTactic:'equilibrado';
 const mon={id:q.id,lv:effective,abLv,sk,mega,hb},game=new VE.Battle(null,{sim:true,meter:true,duel:true,seed:1,names:['Preview','Opponent'],teams:[[mon],[{id:q.id,lv:1,abLv:1}]],plans:[{tactic:t,swap:'ordem'},{tactic:ot,swap:'ordem'}]});
 const u=game.sides[0].team[0];game.sides[0].active=u;u.state='idle';u.fury=u.ab==='grito'?1+[.10,.14,.18][abLv-1]:1;
 if(mega)game.megaEvo(0);
 u.hp=Math.max(1,Math.round(u.max*integer(q.hpPct,1,100)/100));
 if(hb?.wp&&q.weaknessPolicy)u.wpMul=hb.wp;
 const skill=k=>game.skl(u,k),cooldown=(1.7-u.spd*.008)*(u.ranged?1.5:1),speedMul=(1+(u.ab==='troca'?[.12,.18,.24][abLv-1]:0)+[0,.15,.22,.3][skill('ag')])*(hb?.spd||1);
 const crit=.06+(u.ab==='certeiro'?[.12,.18,.24][abLv-1]:0)+[0,.06,.10,.15][skill('fe')]+(hb?.crit||0)/100;
 const dodge=(t==='defensivo'?.08:0)+(u.ab==='esquiva'?[.12,.17,.22][abLv-1]:0)+[0,.05,.08,.12][skill('dt')]+(hb?.eva||0)/100;
 const same=integer(q.synergy,1,6),synergy=[0,0,0,.05,.08,.12,.15][same]+1;
 const basicPower=Math.max(20,Math.round(u.sp.atk*.55/5)*5);
 const specialPower=Math.round(basicPower*2.1/10)*10;
 const tags=it?core.heldTags(it):[];
 return {effective,bonus,mode:mode.name,form:mega?u.sp.name:sp.name,types:u.types,specialType:hb?.mty||null,
   hp:u.max,currentHP:u.hp,atk:u.atk,def:u.def,spd:u.spd,attack:game.atkOf(u),defense:game.defOf(u),megaMultiplier:u.megaMul||1,
   firstHitAttack:game.atkOf(u)*(u.ab==='mira'?1+[.4,.55,.7][abLv-1]:1),
   cooldown,cooldownAdjusted:cooldown/speedMul,recovery:u.ranged?0:.5,speedMul,crit:Math.min(1,crit),critMultiplier:u.ab==='certeiro'?1.8:1.5,dodge:Math.min(1,dodge),specialDodge:Math.min(1,dodge/2),
   synergy,basicPower,specialPower,specialMultiplier:1.3*2.1*(u.ab==='explosao'?1+[.2,.35,.5][abLv-1]:1)*(1+[0,.2,.3,.4][skill('gi')]),
   item:it?def.n:null,tags,heldActive:!!hb,held:hb||null,skills:sk,read:game.read[0],ability:sp.abN,
   animation:timingFor(q.id,u.ranged)};
}
function timingFor(id,ranged,load=false){
 const anim=ranged?'Shoot':'Attack';
 if(load&&!loadedTimings.has(id)){try{importScripts(upstream+'sp/'+encodeURIComponent(id)+'.js');if(self.SPRITE_T[id])loadedTimings.add(id);}catch{}}
 const t=self.SPRITE_T?.[id],a=t&&(t[anim]||t.Idle);
 if(!a||!Array.isArray(a.d)||!a.d.length)return {available:false,anim};
 const frames=a.d.reduce((sum,v)=>sum+v,0);
 return {available:true,anim,seconds:frames/60,hitSeconds:a.hit==null?frames/60*.45:a.d.slice(0,a.hit).reduce((sum,v)=>sum+v,0)/60};
}

function benchmark(config, job) {
  const count = Math.max(1, Math.min(500, Math.trunc(Number(config.count)) || 1));
  for (const id of new Set(config.teams.flat().filter(Boolean).map(slot => slot.id))) {
    if (loadedTimings.has(id)) continue;
    try {
      importScripts(upstream + 'sp/' + encodeURIComponent(id) + '.js');
      loadedTimings.add(id);
    } catch {
      // The game engine supplies default timings when a sheet is unavailable.
    }
  }
  batch={done:0,wins:[0,0,0],totalTicks:0,count};
  const current=batch;
  function chunk() {
    if(batch!==current)return;
    const end=performance.now()+70;
    do {
      const game=runtime.build(config,(config.seed+current.done)>>>0);
      while(!game.over)runtime.apply(game,config.automatic);
      current.wins[game.winner<0?2:game.winner]++;
      current.totalTicks+=game.tick;
      current.done++;
    } while(current.done<count && performance.now()<end);
    send('benchmark',{...current,job,complete:current.done===count});
    if(current.done<count)setTimeout(chunk,0);
    else batch=null;
  }
  setTimeout(chunk,0);
}

self.onmessage = ({data}) => {
  try {
    if(!runtime) throw Error('The upstream battle engine is unavailable.');
    if(data.type==='dex-preview'){try{send('dex-preview',{job:data.job,result:dexPreview(data.config)});}catch(e){send('dex-preview',{job:data.job,error:e.message});}return;}
    if(data.type==='dex-timing'){const id=String(data.id);if(!GD.SPECIES[id])return;send('dex-timing',{job:data.job,result:timingFor(id,GD.ROLES[GD.SPECIES[id].role].ranged,true)});return;}
    if(data.type==='benchmark')benchmark(data.config,data.job);
    if(data.type==='cancel-benchmark')batch=null;
  } catch(e){send('error',{message:e.message});}
};
try { bootstrap(); } catch(error) { send('load-error',{message:'Could not load the public PokeClash League engine. '+error.message}); }
