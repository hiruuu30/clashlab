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
 const tags=it&&!q.rankFast?core.heldTags(it):[];
 return {effective,bonus,mode:mode.name,form:mega?u.sp.name:sp.name,types:u.types,specialType:hb?.mty||null,
   hp:u.max,currentHP:u.hp,atk:u.atk,def:u.def,spd:u.spd,attack:game.atkOf(u),defense:game.defOf(u),megaMultiplier:u.megaMul||1,
   damageTaken:(hb?.taken||1)*(u.ab==='pele'?1-[.10,.15,.20][abLv-1]:1),rangedDamageTaken:hb?.vsR||1,ranged:u.ranged,abilityKey:u.ab,abilityRank:abLv,
   firstHitAttack:game.atkOf(u)*(u.ab==='mira'?1+[.4,.55,.7][abLv-1]:1),
   cooldown,cooldownAdjusted:cooldown/speedMul,recovery:u.ranged?0:.5,speedMul,crit:Math.min(1,crit),critMultiplier:u.ab==='certeiro'?1.8:1.5,dodge:Math.min(1,dodge),specialDodge:Math.min(1,dodge/2),
   synergy,basicPower,specialPower,specialMultiplier:1.3*2.1*(u.ab==='explosao'?1+[.2,.35,.5][abLv-1]:1)*(1+[0,.2,.3,.4][skill('gi')]),
   item:it?def.n:null,tags,heldActive:!!hb,held:hb||null,skills:sk,read:game.read[0],ability:sp.abN,
   animation:timingFor(q.id,u.ranged)};
}

/* Build optimizer: exhaustive distinct item effects for the objective; monotone TM bonuses. */
const rankPriorities={
 expectedCooldown:['ag','sd','id','dt'],spd:['ag','sd','id','dt'],
 evadeBulk:['id','dt','sd','ag'],bulk:['id','dt','sd','ag'],
 hp:['id','dt','sd','ag'],atk:['sd','ag','fe','id'],firstHit:['sd','ag','fe','id'],
 def:['id','dt','sd','ag'],crit:['fe','sd','ag','id'],dodge:['dt','id','sd','ag']
};
function rankTms(sp,q,lv,priority=rankPriorities[q.metric]||rankPriorities.evadeBulk){
 const innate=GD.innateOf(sp.id),learn=new Set(GD.learnOf(sp.id)),slots=lv>=12?2:1;
 const raw=[q.tm1??'auto',q.tm2??'auto'],ranks=[Number(q.tm1rank)||3,Number(q.tm2rank)||3],used=new Set([innate]);
 const out=[null,null];
 if(slots===1&&raw[1]&&raw[1]!=='auto')return null;
 for(let i=0;i<slots;i++){const k=raw[i];if(!k||k==='auto')continue;if(used.has(k)||!learn.has(k))return null;used.add(k);out[i]={k,lv:Math.max(1,Math.min(3,ranks[i]))};}
 // Auto ranks are fixed to the requested rank; assign the strongest available rank to the primary skill.
 const free=Array.from({length:slots},(_,i)=>i).filter(i=>raw[i]==='auto').sort((a,b)=>ranks[b]-ranks[a]||a-b);
 for(const i of free){const k=priority.find(k=>learn.has(k)&&!used.has(k));if(k){out[i]={k,lv:Math.max(1,Math.min(3,ranks[i]))};used.add(k);}}
 // Preserve empty first slots in the editable build, but exclude them from native skill inputs.
 return out.map(t=>t||{k:'',lv:1});
}
// For a given native item/form/level projection, added TMs are independent multipliers.
// This avoids rebuilding the native Battle object for each pair of legal skills.
function withRankTms(base,tms){
 const v={...base,skills:[...base.skills,...tms.filter(t=>t.k)]},k=key=>tms.find(t=>t.k===key)?.lv||0;
 const sd=1+[0,.12,.18,.25][k('sd')],id=1+[0,.12,.18,.25][k('id')];
 v.attack*=sd;v.firstHitAttack*=sd;v.defense*=id;
 v.speedMul+=([0,.15,.22,.30][k('ag')])*(v.held?.spd||1);v.cooldownAdjusted=v.cooldown/v.speedMul;
 v.crit=Math.min(1,v.crit+[0,.06,.10,.15][k('fe')]);
 v.dodge=Math.min(1,v.dodge+[0,.05,.08,.12][k('dt')]);
 v.specialDodge=Math.min(1,v.specialDodge+[0,.05,.08,.12][k('dt')]/2);
 v.specialMultiplier*=1+[0,.2,.3,.4][k('gi')];return v;
}
function rankOne(q,sp,form,item,tms,baseline=null){
 const {core}=runtime,def=core.CFG.items[Number(item)],v=baseline?withRankTms(baseline,tms):dexPreview({...q,id:sp.id,form,item,rankFast:true,tms:tms.filter(t=>t.k)});
 const chance=Math.min(1,Math.max(0,(v.held?.qc||0)/100));
 const expectedCooldown=((1-chance)*v.cooldown+chance*.3)/v.speedMul;
 const incoming=q.incoming&&Object.hasOwn(GD.TYPES,q.incoming)?GD.eff(q.incoming,v.types):1;
 const taken=v.damageTaken*(q.attackerRange==='ranged'?v.rangedDamageTaken:1),dodge=q.incomingKind==='special'?v.specialDodge:v.dodge;
 const bulk=v.currentHP*(120+v.defense)/120/Math.max(.0001,taken*incoming),evadeBulk=bulk/Math.max(.0001,1-dodge);
 const forced=item!==''&&Object.entries(self.FORMS?.[sp.id]||{}).some(([key])=>key===def?.k);
 const key=form?sp.id+':'+form:forced&&v.heldActive?sp.id+':held:'+item:sp.id+':0';
 return {key,id:sp.id,form,name:v.form,types:v.types,ranged:v.ranged,ability:sp.abN,innate:GD.innateOf(sp.id),rarity:GD.RAR[sp.rar].n,effective:v.effective,bonus:v.bonus,hp:v.hp,currentHP:v.currentHP,atk:v.attack,def:v.defense,spd:v.spd,cooldown:v.cooldownAdjusted,expectedCooldown,bulk,evadeBulk,crit:v.crit*100,dodge:dodge*100,firstHit:v.firstHitAttack,basicMultiplier:(v.held?.basic||1)*Math.max(1,...v.types.map(t=>v.held?.tdm?.[t]||1)),combat:{held:v.held||{},ability:v.abilityKey,rank:v.abilityRank,skills:v.skills,critMultiplier:v.critMultiplier,basicPower:v.basicPower,specialPower:v.specialPower,specialMultiplier:v.specialMultiplier,specialType:v.specialType,firstHit:v.firstHitAttack,damageTaken:v.damageTaken,rangedDamageTaken:v.rangedDamageTaken,specialDodge:v.specialDodge,recovery:v.recovery,animation:v.animation},active:v.heldActive,protect:v.skills.find(t=>t.k==='pr')?.lv||0,recover:v.skills.find(t=>t.k==='rc')?.lv||0,balloon:!!(v.held?.ball&&q.incoming==='terra'),build:{item,tms,form}};
}
function rankItemChoices(q,sp){
 const {core}=runtime,indices=q.item==='auto'?['',...core.CFG.items.map((_,i)=>String(i))]:[q.item??''];
 // Only merge items with identical score-relevant effect and effective level. Keep a concrete representative.
 const seen=new Set(),out=[];
 for(const item of indices){
  const d=item===''?null:core.CFG.items[Number(item)],it=d?{k:Number(item),r:d.r}:null,h=core.heldFx(it,sp.id);
  if(q.activeOnly&&(!it||!h))continue;
  const mode=runtime.modes.find(m=>m.id===q.mode)||runtime.modes[0],bonus=core.itemLv(it,sp.id),effective=!mode.cap?q.lv+bonus:mode.kind==='arena'?Math.min(q.lv,mode.cap)+bonus:Math.min(q.lv+bonus,mode.cap);
  const signature=JSON.stringify([effective,!!h,h?.st||null,h?.ty||null,h?.mty||null,h?.spd||1,h?.qc||0,h?.dmg||1,h?.wp||1,h?.taken||1,h?.vsR||1,h?.crit||0,h?.eva||0]);
  if(seen.has(signature))continue;seen.add(signature);out.push(item);
 }
 return out;
}
function dexRank(q) {
 const candidates=[],skipped={incompatible:0,inactive:0},lv=Math.max(1,Math.min(50,Math.trunc(Number(q.lv)||1))),metric=Object.hasOwn(rankPriorities,q.metric)?q.metric:'expectedCooldown';
 q={...q,lv,metric};
 if(lv<12&&q.tm2&&q.tm2!=='auto')throw Error('Second TM requires base level 12.');
 if(q.tm1&&q.tm1!=='auto'&&q.tm1===q.tm2)throw Error('Select two different TMs.');
 const dir=metric==='expectedCooldown'?1:-1;
 let evaluated=0;
 const better=(a,b)=>!b||dir*(a[metric]-b[metric])< -1e-9||Math.abs(a[metric]-b[metric])<=1e-9&&(a.atk>b.atk+1e-9||Math.abs(a.atk-b.atk)<=1e-9&&a.evadeBulk>b.evadeBulk+1e-9);
 for(const sp of Object.values(GD.SPECIES)){
  if(q.rarity&&GD.RAR[sp.rar].n!==q.rarity||q.range&&Boolean(GD.ROLES[sp.role].ranged)!==(q.range==='ranged')||q.innate&&GD.innateOf(sp.id)!==q.innate||q.abilityName&&sp.abN!==q.abilityName)continue;
  const tms=rankTms(sp,q,lv);if(!tms){skipped.incompatible++;continue;}
  const variants=[tms];if(metric==='evadeBulk'){const alt=rankTms(sp,q,lv,['dt','id','sd','ag']);if(alt&&JSON.stringify(alt)!==JSON.stringify(tms))variants.push(alt);}
  const items=rankItemChoices(q,sp);if(!items.length){skipped.inactive++;continue;}
  const forms=[0,...(GD.MEGA_SP[sp.id]?[1]:[]),...(GD.MEGA_SP2[sp.id]?[2]:[])].filter(f=>q.forms==='mega'?f>0:q.forms==='all'?true:f===0);
  let best=null;
  for(const form of forms)for(const item of items)for(const tms of variants){const row=rankOne(q,sp,form,item,tms);evaluated++;if(better(row,best))best=row;}
  if(best)candidates.push(best);
 }
 return {rows:candidates,skipped,evaluated,metric};
}
/* Budgeted roster planning. All acquisition costs are planning estimates, not live offers. */
// Targeted counter planning: native stat projections, analytical exchanges, not simulated wins.
function counterTargets(q,mode){
 const rows=[],seen=new Set();let mega=false;
 for(const [slot,m] of (q.opponent||[]).slice(0,6).entries()){
  if(!m||!GD.SPECIES[m.id]||seen.has(m.id))continue;seen.add(m.id);
  const sp=GD.SPECIES[m.id],lv=Math.max(1,Math.min(50,Math.trunc(Number(m.lv)||1))),ability=Math.max(1,Math.min(3,Math.trunc(Number(m.ability)||1))),item=m.item!=null&&m.item!==''&&runtime.core.CFG.items[Number(m.item)]?String(m.item):'';
  const form=!mega?(Number(m.mega)===2&&GD.MEGA_SP2[m.id]?2:Number(m.mega)===1&&GD.MEGA_SP[m.id]?1:0):0;if(form)mega=true;
  const used=new Set([GD.innateOf(m.id)]),tms=[0,1].map(i=>{const t=m.tms?.[i];if(!t?.k||i===1&&lv<12||used.has(t.k)||!GD.learnOf(m.id).includes(t.k))return {k:'',lv:1};used.add(t.k);return {k:t.k,lv:Math.max(1,Math.min(3,Math.trunc(Number(t.lv)||1)))};});
  const v=rankOne({lv,ability,mode:mode.id,tactic:q.opponentTactic||'equilibrado',opponentTactic:q.tactic||'equilibrado',hpPct:100,synergy:1},sp,form,item,tms);
  rows.push({...v,slot,itemName:item===''?'None':runtime.core.CFG.items[Number(item)].n,tmNames:tms.filter(t=>t.k).map(t=>(skills[t.k]||t.k)+' '+['I','II','III'][t.lv-1])});
 }
 for(const r of rows)r.teamBoost=1+([0,0,0,.05,.08,.12,.15][rows.filter(x=>x.types.includes(r.types[0])).length]||0);
 return rows;
}
function counterExchange(a,b){
 const hit=(u,v,special)=>{
  const c=u.combat||{},d=v.combat||{},h=c.held||{},th=d.held||{},attacks=special&&c.specialType?[c.specialType]:u.types;
  const t=attacks.reduce((best,t)=>GD.eff(t,v.types)>GD.eff(best,v.types)?t:best,attacks[0]),eff=GD.eff(t,v.types);
  const power=special?Math.sqrt((c.specialPower||95)/95):Math.sqrt((c.basicPower||45)/45);
  const crit=1+(u.crit||0)/100*((c.critMultiplier||1.5)-1);
  const dodge=special?(d.specialDodge||0):(v.dodge||0)/100;
  const accuracy=Math.min(1,Math.max(0,(1-dodge)*(h.acc||1)));
  const mult=special?(c.specialMultiplier||2.73):u.ranged?.9:1;
  return Math.max(.01,u.atk*mult*power*1.25*120/(120+v.def)*eff*(h.tdm?.[t]||1)*(eff>1?h.se||1:1)*(special?1:h.basic||1)*(d.damageTaken||1)*(u.ranged?(d.rangedDamageTaken||1):1)*crit*accuracy*(u.teamBoost||1));
 };
 const cycle=u=>Math.max(.25,u.expectedCooldown,(u.combat?.animation?.available?u.combat.animation.seconds:.5)+(u.combat?.recovery||0));
 const basicA=hit(a,b,false),basicB=hit(b,a,false),specialA=hit(a,b,true),specialB=hit(b,a,true);
 // Approximate sustained exchanges; meter, movement, interruptions and switching remain dynamic.
 const dpsA=basicA/cycle(a)+specialA/26,dpsB=basicB/cycle(b)+specialB/26;
 const hp=(u,incoming,ownDps,enemy)=>{
  const c=u.combat||{},h=c.held||{},k=key=>c.skills?.find(t=>t.k===key)?.lv||0;
  const healing=u.hp*((c.ability==='cura'?[.06,.08,.10][(c.rank||1)-1]:0)+(h.regen||0)/100)/5;
  const drain=ownDps*((h.drain||0)/100+[0,.08,.12,.16][k('gd')]);
  const horizon=Math.min(20,u.hp/Math.max(1,incoming));
  const extras=u.hp*([0,.25,.35,.45][k('rc')]*.65+(h.berry?.[1]||0)/100*.65)+Math.min(.35*u.hp,k('pr')*incoming*cycle(enemy));
  return Math.max(u.hp*.25,u.hp+extras+Math.min(.5*u.hp,(healing+drain)*horizon)-u.hp*(h.rec||0)/100*horizon/cycle(u));
 };
 const kill=hp(b,dpsA,dpsB,a)/Math.max(.01,dpsA),survive=hp(a,dpsB,dpsA,b)/Math.max(.01,dpsB);
 const ratio=Math.min(20,Math.max(.05,survive/Math.max(.01,kill)));
 return {ratio,out:Math.max(...a.types.map(t=>GD.eff(t,b.types))),incoming:Math.max(...b.types.map(t=>GD.eff(t,a.types))),specialOut:a.combat?.specialType?GD.eff(a.combat.specialType,b.types):Math.max(...a.types.map(t=>GD.eff(t,b.types))),specialIn:b.combat?.specialType?GD.eff(b.combat.specialType,a.types):Math.max(...b.types.map(t=>GD.eff(t,a.types)))};
}
function counterReport(team,foes){
 const projected=team.map(r=>({...r,teamBoost:1+([0,0,0,.05,.08,.12,.15][team.filter(x=>x.types.includes(r.types[0])).length]||0)}));
 return foes.map((f,i)=>{const ranked=projected.map(r=>({id:r.id,name:r.name,...counterExchange(r,f)})).sort((a,b)=>b.ratio-a.ratio||a.name.localeCompare(b.name));return {id:f.id,name:f.name,slot:f.slot,types:f.types,item:f.itemName,tms:f.tmNames,effective:f.effective,form:f.form,best:ranked[0]||null,backup:ranked[1]||null};});
}
function teamPlan(q,progress=()=>{}){
 const {core,modes}=runtime,C=core.CFG;
 const bounded=(v,lo,hi,def)=>Number.isFinite(Number(v))?Math.min(hi,Math.max(lo,Number(v))):def;
 const budget=Math.floor(bounded(q.budget,0,1e12,500000)),lv=Math.floor(bounded(q.lv,1,50,50)),size=Math.floor(bounded(q.size,1,6,6));
 const rank=Math.floor(bounded(q.rank,1,3,2)),mult=bounded(q.priceFactor,0.1,50,1),tmReserve=bounded(q.tmReserve,0,1e9,C.shop.tm),solBudget=bounded(q.solBudget,0,1e6,0);
 const candyBudget=q.candyBudget===''||q.candyBudget==null?Infinity:Math.floor(bounded(q.candyBudget,0,1e9,0));
 const maxRarity=bounded(q.maxRarity,0,4,4),minRarity=bounded(q.minRarity,0,4,0),maxMega=q.mega==='off'?0:1;
 const mode=modes.find(m=>m.id===q.mode)||modes[0],all=Object.values(GD.SPECIES),types=Object.keys(GD.TYPES);
 const overrides=q.overrides&&typeof q.overrides==='object'?q.overrides:{},own=overrides.owned||{},priceMap=overrides.pokemon||{},itemMapOverride=overrides.items||{},tmMap=overrides.tms||{};
 const lookup=(map,key,name)=>{const v=Object.hasOwn(map,key)?map[key]:Object.hasOwn(map,name)?map[name]:null;return v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Math.ceil(Number(v)):null;};
 const price=id=>lookup(priceMap,id,GD.SPECIES[id].name)??Math.max(100,Math.round(core.mkRef(id)*mult));
 const itemCost=k=>k===''?0:lookup(itemMapOverride,C.items[Number(k)].k,C.items[Number(k)].n)??Math.max(100,Math.round(core.mkRef('it:'+k)*mult));
 const odds=core.TM_ODDS,tmPrices=Object.fromEntries(Object.entries(GD.SKILL_R).map(([k,r])=>[k,lookup(tmMap,k,skills[k])??(q.tmPricing==='manual'?tmReserve:Math.ceil(C.shop.tm*100*Object.values(GD.SKILL_R).filter(x=>x===r).length/(3*odds[r])))])),tmPrice=k=>tmPrices[k];
 const tmCost=t=>t.k?Math.ceil(tmPrice(t.k)*3**(t.lv-1)):0;
 const xpTo=(a,b)=>{let xp=0;for(let l=a;l<b;l++)xp+=Math.round(40+l*12+l*l*1.5);return xp;};
 const train=(a,b)=>Math.ceil(xpTo(a,b)/C.train.xp)*C.train.candy;
 const abilityCandy=C.abCandy*(rank===3?3:rank===2?1:0);
 const memo=new Map();
 // Acquisition routes use level-1 market purchases. An owned species is only used directly,
 // not consumed by another route, preventing accidental double-spending of owned Pokémon.
 function routes(id,seen=new Set()){
  if(memo.has(id))return memo.get(id);
  if(seen.has(id)||!GD.SPECIES[id])return [];
  const sp=GD.SPECIES[id],nextSeen=new Set([...seen,id]),out=[];
  if(!core.tradeEvo(id))out.push({pkl:price(id),level:1,training:0,xp:0,source:sp.name,steps:['Buy '+sp.name+' (Lv 1)'],evoItems:[]});
  if(q.evolution!=='direct'){
   for(const p of all){const edge=(GD.EVO[p.id]||[]).find(e=>e.to===id);if(!edge)continue;
    const kind=core.evoKind(edge);
    if(kind==='trade'){if(core.tradeEvo(p.id)?.to===id)out.push({pkl:price(p.id),level:1,training:0,xp:0,source:p.name,steps:['Buy '+p.name+' on Market → '+sp.name+' (automatic trade evolution)'],evoItems:[]});continue;}
    for(const base of routes(p.id,nextSeen)){
     const add=(cost,level,candy,xp,note,item,copy=1)=>{if(level>lv)return;out.push({pkl:base.pkl*copy+cost,level,training:base.training*copy+candy,xp:base.xp*copy+xp,source:base.source,steps:[...(copy===3?['Acquire 3 non-Shiny copies via: '+base.steps.join(' → ')]:base.steps),note+' → '+sp.name],evoItems:[...Array.from({length:copy},()=>base.evoItems).flat(),...(item?[item]:[])]});};
     if(kind==='stone'){const st=C.stones.find(x=>x.n===edge.how);if(st){const reserve=lookup(overrides.stones||{},st.k,st.n)??Math.ceil(C.shop.stone*C.stones.reduce((n,x)=>n+x.w,0)/st.w);add(reserve,base.level,0,0,'Consume '+st.n+' (estimated acquisition)',st.n);}}
     else {const target=Math.max(base.level,core.evoLv(edge));if(target<=lv)add(0,target,train(base.level,target),xpTo(base.level,target),'Train to Lv '+target+' and evolve');if(q.allowMerge!==false)add(0,Math.min(50,base.level+1),0,0,'Merge 3 non-Shiny copies',null,3);}
     const k=core.evoItem(p.id,id),ik=C.items.findIndex(x=>x.k===k);if(ik>=0)add(itemCost(String(ik)),base.level,0,0,'Consume '+C.items[ik].n,C.items[ik].n);
    }
   }
  }
  // Retain distinct acquisition level/candy frontiers, avoid exponential evolution chains.
  out.sort((a,b)=>a.pkl-b.pkl||a.training-b.training||b.level-a.level);const frontier=[];
  for(const x of out){if(!frontier.some(y=>y.pkl<=x.pkl&&y.training<=x.training&&y.level>=x.level))frontier.push(x);}
  memo.set(id,frontier);return frontier;
 }
 function acquire(id){
  const sp=GD.SPECIES[id],list=routes(id).slice(),owned=lookup(own,id,sp.name);
  if(owned!==null&&owned>=1&&owned<=lv)list.push({pkl:0,level:Math.floor(owned),training:0,xp:0,source:sp.name,steps:['Use owned '+sp.name+' at Lv '+Math.floor(owned)],evoItems:[]});
  return list.map(a=>({...a,training:a.training+train(a.level,lv),xp:a.xp+xpTo(a.level,lv),candy:a.training+train(a.level,lv)+abilityCandy,steps:[...a.steps,...(a.level<lv?['Train to Lv '+lv]:[])]})).filter(a=>a.candy<=candyBudget).sort((a,b)=>a.pkl-b.pkl||a.candy-b.candy);
 }
 const objective=q.objective||'balanced',goals=objective==='balanced'?['expectedCooldown','evadeBulk','atk','def']:objective==='offense'?['atk','expectedCooldown','crit']:objective==='tank'?['evadeBulk','def','atk']:['expectedCooldown','atk','evadeBulk'];
 const candidates=[];let evaluated=0,scanned=0;
 const foes=q.counterTeam?counterTargets(q,mode):[];if(q.counterTeam&&!foes.length)throw Error('The selected opponent has no valid Pokémon.');
 const counterTypes=Array.isArray(q.counterTypes)?[...new Set(q.counterTypes.filter(t=>types.includes(t)))].slice(0,2):[];
 const incomingRanged=q.counterRange==='ranged'?1:q.counterRange==='melee'?0:.5;
 const strength=(v)=>{
  const c=v.combat||{},h=c.held||{},k=key=>c.skills?.find(t=>t.k===key)?.lv||0,rank=c.rank||1;
  // Shared reference matchup: approximate neutral attacker and a 20-second engagement.
  // The engine uses actual sprite durations; use its fallback 0.5s until timings are cached.
  const anim=c.animation?.available?c.animation.seconds:.5,cycle=Math.max(.1,v.expectedCooldown,anim+(c.recovery||0));
  const targets=counterTypes.length?[counterTypes]:[[]],horizon=20;
  const hit=(ts,special)=>{const attacks=special&&c.specialType?[c.specialType]:v.types;
   const t=attacks.slice().sort((a,b)=>GD.eff(b,ts)-GD.eff(a,ts))[0],eff=ts.length?GD.eff(t,ts):1;
   const power=special?Math.sqrt((c.specialPower||95)/95):Math.sqrt((c.basicPower||45)/45);
   const crit=1+v.crit/100*((c.critMultiplier||1.5)-1),accuracy=Math.min(1,.9*(h.acc||1));
   return v.atk*(special?(c.specialMultiplier||2.73):v.ranged?.9:1)*power*1.25*.5*eff*(h.tdm?.[t]||1)*(eff>1?h.se||1:1)*(special?1:h.basic||1)*crit*accuracy;
  };
  const hits=targets.map(ts=>[hit(ts,false),hit(ts,true)]),basic=hits.reduce((n,x)=>n+x[0],0)/hits.length,special=hits.reduce((n,x)=>n+x[1],0)/hits.length;
  const basicCount=horizon/cycle,expectedSpecials=(horizon/26+.22*basic*basicCount/900+.14*.8+(h.ph?.5:0));
  const ramp=1+Math.min(h.metMax||100,(h.met||0)*basicCount*.5)/100;
  const lowHP=c.ability==='sangue'?1+[.25,.35,.45][rank-1]*.25:1;
  const damage=(basic*basicCount+special*expectedSpecials)*ramp*lowHP+(c.firstHit-v.atk>0?(c.firstHit-v.atk)*basic/Math.max(1,v.atk):0);
  const incomingType=counterTypes.length?Math.max(...counterTypes.map(t=>GD.eff(t,v.types))):1;
  const received=(c.damageTaken||1)*(1-incomingRanged+incomingRanged*(c.rangedDamageTaken||1))*incomingType;
  const dodge=(v.dodge/100*.8+(c.specialDodge||0)*.2),defFactor=(120+v.def)/120/Math.max(.03,received*(1-dodge));
  // Conditional resources are weighted, not treated as guaranteed full healing.
  const heal=v.hp*((c.ability==='cura'?[.06,.08,.10][rank-1]:0)+(h.regen||0)/100)*horizon/5*.65;
  const drain=damage*((h.drain||0)/100+[0,.08,.12,.16][k('gd')])*.65;
  const once=v.hp*([0,.25,.35,.45][k('rc')]*.75+(h.berry?.[1]||0)/100*.75+[0,0,.10,.20][k('en')]*.7);
  const block=(k('pr')+(h.ball&&counterTypes.includes('terra')?.7:0)+(h.band||0)/100+k('en')*.5)*v.hp*.045;
  const recoil=v.hp*(h.rec||0)/100*(basicCount+3*expectedSpecials);
  const reflected=v.hp*(c.ability==='contra'?[.15,.2,.25][rank-1]*.5:0)+v.hp*(h.helm||0)/100*(1-incomingRanged)*basicCount*.45;
  const bulk=Math.max(v.hp*.25,v.hp+heal+drain+once+block-recoil)*defFactor;
  const attack=Math.max(.01,(damage+reflected)/horizon),speed=1/cycle;
  const utility=1+Math.min(.12,(h.fl||0)/100*.25+((h.ej||h.rc)?.03:0));
  const score=(objective==='offense'?attack**.8*speed**.2*bulk**.18:objective==='tank'?bulk**.8*attack**.25:objective==='speed'?speed**.85*attack**.4*bulk**.2:attack**.55*speed**.15*bulk**.4)*utility;
  const exchanges=foes.map(f=>counterExchange(v,f).ratio);const counterScore=exchanges.length?Math.exp(exchanges.reduce((n,x)=>n+Math.log(x),0)/exchanges.length):1;
  return {score:score*(exchanges.length?Math.pow(counterScore,.85):1),dps:attack,bulk,cycle,exchanges};
 };
 for(const sp of all){
  if(++scanned%24===0)progress({scanned,total:all.length,evaluated,phase:'builds'});
  if(sp.rar<minRarity||sp.rar>maxRarity||q.range&&Boolean(GD.ROLES[sp.role].ranged)!==(q.range==='ranged')||q.type&&!sp.types.includes(q.type)||q.finalOnly&&(GD.EVO[sp.id]||[]).length)continue;
  const acquisitions=acquire(sp.id).filter(a=>a.pkl<=budget);if(!acquisitions.length)continue;const acq=acquisitions[0];
  const megaChance=(C.mega.ok[sp.rar]||0)/100,attempts=q.megaCost==='attempt'?1:q.megaCost==='90'?megaChance>=1?1:Math.ceil(Math.log(.1)/Math.log(1-Math.max(.01,megaChance))):1/Math.max(.01,megaChance);
  const forms=[0,...(maxMega&&GD.MEGA_SP[sp.id]?[1]:[]),...(maxMega&&GD.MEGA_SP2[sp.id]?[2]:[])];
  const config={lv,ability:rank,mode:mode.id,hpPct:100,tactic:q.tactic||'equilibrado',opponentTactic:foes.length?q.opponentTactic||'equilibrado':'equilibrado',synergy:1,incoming:'',attackerRange:'melee',incomingKind:'basic',weaknessPolicy:false};
  const variants=new Map(),learn=GD.learnOf(sp.id).filter(k=>k!==GD.innateOf(sp.id)&&k!=='ch'),ranks=Array.from({length:rank},(_,i)=>i+1),empty={k:'',lv:1};
  const addTm=(a,b=empty)=>{const t=[a,b],key=JSON.stringify(t);variants.set(key,t);};
  addTm(empty);
  // Enumerate all single skills and rank choices. Pairs are searched across the objective's strongest skill pool.
  const poolSkills=new Set(goals.flatMap(g=>rankPriorities[g]||[]).concat(['gd','rc','pr','en','gi','fe','dt']));
  const pairSkills=learn.filter(k=>poolSkills.has(k));
  const pairRankSets=q.searchDepth==='deep'?ranks:[1,rank].filter((v,i,a)=>a.indexOf(v)===i);
  for(const k of learn)for(const l of ranks)addTm({k,lv:l});
  if(lv>=12)for(let i=0;i<pairSkills.length;i++)for(let j=i+1;j<pairSkills.length;j++)for(const l of pairRankSets)for(const m of pairRankSets)addTm({k:pairSkills[i],lv:l},{k:pairSkills[j],lv:m});
  const choices=['',...C.items.map((it,k)=>String(k)).filter(k=>C.items[Number(k)].r<=bounded(q.maxItemRarity,0,5,5))];
  // Prune items only when their full native held effect and effective level agree; retain cheaper representative.
  const itemMap=new Map();
  for(const item of choices){const it=item===''?null:{k:Number(item),r:C.items[Number(item)].r},h=core.heldFx(it,sp.id),bonus=core.itemLv(it,sp.id),eff=!mode.cap?lv+bonus:mode.kind==='arena'?Math.min(lv,mode.cap)+bonus:Math.min(lv+bonus,mode.cap),key=JSON.stringify([eff,h?Object.fromEntries(Object.entries(h).filter(([k])=>k!=='k'&&k!=='n')):null]);if(!itemMap.has(key)||itemCost(item)<itemCost(itemMap.get(key)))itemMap.set(key,item);}
  const options=[];
  for(const form of forms){
   const megaPKL=form?Math.ceil(C.mega.price*attempts):0,sol=form?C.mega.sol*attempts:0;if(sol>solBudget+1e-9||acq.pkl+megaPKL>budget)continue;
   let skillChoices=[...variants.values()];
   // Standard search keeps the best economical skill combinations plus diverse conditional-skill variants.
   if(q.searchDepth!=='deep'&&skillChoices.length>24){const base=dexPreview({...config,id:sp.id,form,item:'',tms:[],rankFast:true});const tests=skillChoices.map(tms=>({tms,cost:tms.reduce((n,t)=>n+tmCost(t),0),score:strength(rankOne(config,sp,form,'',tms,base)).score})).filter(x=>acq.pkl+megaPKL+x.cost<=budget).sort((a,b)=>b.score-a.score||a.cost-b.cost);const chosen=new Map(),add=x=>{if(x)chosen.set(JSON.stringify(x.tms),x.tms);};for(const cap of [0,budget/48,budget/24,budget/12,budget/6,budget/3,budget])tests.filter(x=>x.cost<=cap).slice(0,3).forEach(add);for(const k of ['ag','id','sd','dt','gd','rc','pr','en','gi','fe'])add(tests.find(x=>x.tms.some(t=>t.k===k)));skillChoices=[...chosen.values()];}
   for(const item of itemMap.values()){
    const equipment=itemCost(item);if(acq.pkl+megaPKL+equipment>budget)continue;
    const baseline=dexPreview({...config,id:sp.id,form,item,tms:[],rankFast:true});
    for(const tms of skillChoices){
     const tm=tms.reduce((sum,t)=>sum+tmCost(t),0),cost=acq.pkl+equipment+tm+megaPKL;if(cost>budget)continue;
     const v=rankOne(config,sp,form,item,tms,baseline);evaluated++;
     for(const route of acquisitions){const total=route.pkl+equipment+tm+megaPKL;if(total>budget)continue;const estimate=strength(v);const row={...v,...estimate,cost:total,sol,candy:route.candy,acquisition:route,equipment,tm,megaPKL,megaChance:form?megaChance:null,build:{id:sp.id,lv,ability:rank,item,tms,mega:form}};options.push(row);}
    }
   }
  }
  // Pareto frontier for each form: budget and battle score; preserve diverse transformed typing.
  const groups=new Map();for(const r of options){const specialist=foes.length?r.exchanges.indexOf(Math.max(...r.exchanges)):-1;const k=JSON.stringify([r.form,r.types,r.candy,specialist]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  for(const group of groups.values()){group.sort((a,b)=>a.cost-b.cost||b.score-a.score);let best=-Infinity;for(const r of group)if(r.score>best+1e-9){candidates.push(r);best=r.score;}}
 }
 const maxScore=candidates.reduce((m,r)=>Math.max(m,r.score),1),norm=r=>r.score/maxScore;
 for(const r of candidates){r.hits=types.map(t=>r.types.some(a=>GD.eff(a,[t])>1));r.incoming=types.map(t=>GD.eff(t,r.types));}
 // Beam search: multiple price/score lanes, distinct species, at most one Mega, coverage and shared weaknesses.
 function evaluate(team){
  const covered=types.filter((t,i)=>team.some(r=>r.hits[i])).length;
  const exposed=types.reduce((n,t,i)=>n+Math.max(0,team.filter(r=>r.incoming[i]>1).length-team.filter(r=>r.incoming[i]<1).length-1),0);
  const ranged=team.filter(r=>r.ranged).length,blend=q.mixed&&team.length>1&&(ranged===0||ranged===team.length)?-.06:0;
  const general=team.reduce((n,r)=>{const count=team.filter(x=>x.types.includes(r.types[0])).length,mult=1+[0,0,0,.05,.08,.12,.15][count];return n+norm(r)*mult**.5;},0)+.32*covered/Math.max(1,types.length)-.035*exposed+blend;
  if(!foes.length)return general;
  // Reward coverage of EVERY foe, and a backup counter rather than one specialist for all threats.
  const cover=foes.reduce((sum,f,i)=>{const values=team.map(r=>Math.log(r.exchanges[i]||.05)).sort((a,b)=>b-a);return sum+Math.min(2,values[0]??-3)+.25*Math.min(1,values[1]??-3);},0)/foes.length;
  return general+2.2*cover;
 }
 // Restrict search to a broad, budget-aware shortlist: best builds per price band, type and role, plus cheapest.
 const shortlist=new Map(),put=r=>shortlist.set(r.id+':'+r.form+':'+r.build.item+':'+r.candy+':'+JSON.stringify(r.build.tms),r);
 const bands=[budget/24,budget/12,budget/8,budget/6,budget/4,budget/2,budget];
 for(const cap of bands){const pool=candidates.filter(r=>r.cost<=cap).sort((a,b)=>b.score-a.score||a.cost-b.cost);pool.slice(0,55).forEach(put);for(const t of types)pool.filter(r=>r.types.includes(t)).slice(0,3).forEach(put);for(let i=0;i<foes.length;i++)pool.slice().sort((a,b)=>b.exchanges[i]-a.exchanges[i]||a.cost-b.cost).slice(0,5).forEach(put);}
 candidates.slice().sort((a,b)=>a.cost-b.cost||b.score-a.score).slice(0,80).forEach(put);
 if(Number.isFinite(candyBudget))candidates.slice().sort((a,b)=>a.candy-b.candy||a.cost-b.cost||b.score-a.score).slice(0,100).forEach(put);
 const pool=[...shortlist.values()];
 // Always retain the cheapest feasible baseline as a fallback when beam pruning misses it.
 const cheapest=[];for(const r of candidates.slice().sort((a,b)=>a.cost-b.cost||a.candy-b.candy||b.score-a.score)){if(cheapest.length>=size)break;if(cheapest.some(x=>x.id===r.id)||r.form||cheapest.reduce((n,x)=>n+x.cost,0)+r.cost>budget||cheapest.reduce((n,x)=>n+x.candy,0)+r.candy>candyBudget)continue;cheapest.push(r);}
 let beam=[{team:[],cost:0,sol:0,candy:0,mega:0,value:0}],deepest=beam;
 for(let depth=0;depth<size;depth++){
  progress({scanned:all.length,total:all.length,evaluated,phase:'roster',depth,size});
  const buckets=new Map(),seen=new Set();
  for(const state of beam)for(const r of pool){if(state.cost+r.cost>budget||state.candy+r.candy>candyBudget||state.sol+r.sol>solBudget+1e-9||state.mega+Boolean(r.form)>maxMega||state.team.some(x=>x.id===r.id))continue;
   const team=[...state.team,r],cost=state.cost+r.cost,sol=state.sol+r.sol,candy=state.candy+r.candy,mega=state.mega+Number(!!r.form),sig=team.map(x=>x.id+':'+x.form+':'+x.cost+':'+x.candy+':'+x.score).sort().join('|');if(seen.has(sig))continue;seen.add(sig);
   const value=evaluate(team),bin=Math.min(15,Math.floor(cost/Math.max(1,budget)*16)),key=bin+':'+mega+':'+(Number.isFinite(candyBudget)?Math.min(3,Math.floor(candy/Math.max(1,candyBudget)*4)):0);
   const bucket=buckets.get(key)||[];bucket.push({team,cost,sol,candy,mega,value});bucket.sort((a,b)=>b.value-a.value||a.cost-b.cost);if(bucket.length>3)bucket.pop();buckets.set(key,bucket);
  }
  beam=[...buckets.values()].flat().sort((a,b)=>b.value-a.value||a.cost-b.cost).slice(0,48);if(!beam.length)break;deepest=beam;
 }
 if(cheapest.length>deepest[0].team.length||cheapest.length===deepest[0].team.length&&evaluate(cheapest)>deepest[0].value)deepest.unshift({team:cheapest,cost:cheapest.reduce((n,x)=>n+x.cost,0),sol:0,candy:cheapest.reduce((n,x)=>n+x.candy,0),value:evaluate(cheapest)});
 const order=team=>team.slice().sort((a,b)=>foes.length?(b.exchanges[0]||0)-(a.exchanges[0]||0)||b.score-a.score:b.score-a.score||a.expectedCooldown-b.expectedCooldown);
 const best=deepest[0],alternatives=[];for(const state of deepest){if(alternatives.length>=3)break;const sig=state.team.map(x=>x.id).sort().join('|');if(alternatives.some(a=>a.signature===sig))continue;alternatives.push({signature:sig,team:order(state.team),counterReport:foes.length?counterReport(state.team,foes):[],cost:state.cost,sol:state.sol,candy:state.candy,score:state.value});}return {alternatives,team:order(best.team),counterReport:foes.length?counterReport(best.team,foes):[],opponentCount:foes.length,cost:best.cost,sol:best.sol,score:best.value,complete:best.team.length===size,size,budget,evaluated,candidates:candidates.length,shortlist:pool.length,coverage:types.filter(t=>best.team.some(r=>r.types.some(a=>GD.eff(a,[t])>1))),weak:types.filter(t=>best.team.some(r=>GD.eff(t,r.types)>1)&&!best.team.some(r=>GD.eff(t,r.types)<1)),candy:best.candy,candyBudget:Number.isFinite(candyBudget)?candyBudget:null,trainingCandy:best.team.reduce((n,r)=>n+r.acquisition.training,0),abilityCandy:best.team.length*abilityCandy,trainingXP:best.team.reduce((n,r)=>n+r.acquisition.xp,0),tmPricing:q.tmPricing==='manual'?'manual':'expected',tmUnitCosts:Object.fromEntries(Object.keys(GD.SKILL_R).map(k=>[k,tmPrice(k)])),tmReserve,priceFactor:mult,megaCost:q.megaCost,mode:mode.name,stone:C.shop.stone,tmCase:C.shop.tm,megaAttempt:C.mega.price,megaSOL:C.mega.sol};
}

/* Explainable, read-only roster coach. Scores are rubric scores, never win probabilities. */
function teamRate(q){
 const {core,modes}=runtime,mode=modes.find(m=>m.id===q.mode)||modes[0],all=Object.values(GD.SPECIES),types=Object.keys(GD.TYPES);
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),integer=(v,a,b)=>clamp(Math.trunc(Number(v)||a),a,b);
 const round=(n,p=0)=>Number(n.toFixed(p)),raw=Array.isArray(q.team)?q.team.slice(0,6):[],other=Array.isArray(q.opponent)?q.opponent.slice(0,6):[];
 const normalizeTactic=k=>Object.hasOwn(GD.TACTICS,k)?k:'equilibrado',tactic=normalizeTactic(q.tactic),opponentTactic=q.compare===false?tactic:normalizeTactic(q.opponentTactic);
 const issues=[],strengths=[],suggestions=[],rows=[],ids=new Set();let usedMega=false,megaCount=0;
 const issue=(severity,title,detail,slot=null)=>issues.push({severity,title,detail,slot});
 function clean(m,slot,report){
  if(!m||!GD.SPECIES[m.id])return null;
  const sp=GD.SPECIES[m.id],lv=integer(m.lv,1,50),ability=integer(m.ability,1,3),item=m.item!=null&&m.item!==''&&core.CFG.items[Number(m.item)]?String(Number(m.item)):'',form=Number(m.mega)===2&&GD.MEGA_SP2[m.id]?2:Number(m.mega)>=1&&GD.MEGA_SP[m.id]?1:0;
  const seen=new Set([GD.innateOf(m.id)]),tms=[0,1].map(i=>{const t=m.tms?.[i];if(!t?.k)return {k:'',lv:1};if((i===1&&lv<12)||seen.has(t.k)||!GD.learnOf(m.id).includes(t.k)){if(report)issue('high',sp.name+' has an unavailable TM','Slot '+(i+1)+' cannot use '+(skills[t.k]||t.k)+' at this level or duplicates its innate/other TM.',slot);return {k:'',lv:1};}seen.add(t.k);return {k:t.k,lv:integer(t.lv,1,3)};});
  if(report&&m.item!==''&&m.item!=null&&!core.CFG.items[Number(m.item)])issue('high',sp.name+' has an unknown item','Select a valid held item.',slot);
  if(report&&Number(m.mega)>0&&!form)issue('high',sp.name+' has an unavailable Mega','Select an available Mega form or disable it.',slot);
  return {id:m.id,lv,ability,item,tms,mega:form};
 }
 const cfg=(m,form,tac=tactic,ot=opponentTactic)=>({id:m.id,lv:m.lv,ability:m.ability,item:m.item,form,mode:mode.id,tactic:tac,opponentTactic:ot,hpPct:100,synergy:1,incoming:'',attackerRange:'melee',incomingKind:'basic',weaknessPolicy:false});
 function projection(m,slot,form,tac=tactic,ot=opponentTactic){
  const sp=GD.SPECIES[m.id],v=rankOne(cfg(m,form,tac,ot),sp,form,m.item,m.tms);
  const combat=v.combat,h= combat.held||{},cycle=Math.max(.1,v.expectedCooldown, (combat.animation?.available?combat.animation.seconds:.5)+(combat.recovery||0));
  // Neutral target with DEF 120. No critical/dodge randomness, animation fetches or battle simulation.
  const crit=1+v.crit/100*((combat.critMultiplier||1.5)-1),power=Math.sqrt(combat.basicPower/45);
  const pressure=v.atk*1.25*.5*power*(h.basic||1)*crit/cycle;
  const bulk=v.evadeBulk;
  const role=GD.ROLES[sp.role].n;
  return {...v,slot,role,cycle,pressure,bulk,configured:m,megaRequested:m.mega,itemName:m.item===''?'None':core.CFG.items[Number(m.item)].n,
   tmNames:m.tms.filter(t=>t.k).map(t=>(skills[t.k]||t.k)+' '+['I','II','III'][t.lv-1])};
 }
 for(let i=0;i<raw.length;i++){
  const m=clean(raw[i],i,true);if(!m){if(raw[i])issue('high','Unknown Pokémon in slot '+(i+1),'Replace the invalid roster entry.',i);continue;}
  if(ids.has(m.id)){issue('high','Duplicate species: '+GD.SPECIES[m.id].name,'The roster should contain distinct species.',i);continue;}ids.add(m.id);
  if(m.mega)megaCount++;const form=m.mega&&!usedMega?m.mega:0;if(form)usedMega=true;
  rows.push(projection(m,i,form));
 }
 if(!rows.length)return {empty:true,mode:mode.name,issues:[{severity:'high',title:'Empty roster',detail:'Add Pokémon to the selected team before rating.'}]};
 const n=rows.length;
 if(n<6)issue('high','Only '+n+' of 6 roster slots filled','Complete the roster for standard six-Pokémon battles; fewer members reduce depth.');
 if(megaCount>1)issue('medium',megaCount+' Mega candidates selected','Only one may Mega Evolve per battle. This rating projects the first selected Mega; the others use their non-Mega forms.');
 if(usedMega)strengths.push('One Mega form is included as an already-evolved projection.');
 const out=(r,target)=>Math.max(...r.types.map(t=>GD.eff(t,target)));
 const incoming=(r,attacks)=>Math.max(...attacks.map(t=>GD.eff(t,r.types)));
 const targetTable=types.map(t=>({type:t,hit:rows.filter(r=>out(r,[t])>1).length,weak:rows.filter(r=>GD.eff(t,r.types)>1).length,resist:rows.filter(r=>GD.eff(t,r.types)<1).length,worst:Math.max(...rows.map(r=>GD.eff(t,r.types))),weakSlots:rows.filter(r=>GD.eff(t,r.types)>1).map(r=>r.slot),resistSlots:rows.filter(r=>GD.eff(t,r.types)<1).map(r=>r.slot)}));
 const uncovered=targetTable.filter(x=>x.weak>0&&!x.resist),shared=targetTable.filter(x=>x.weak>=2&&x.weak>x.resist),gaps=targetTable.filter(x=>!x.hit),covered=types.length-gaps.length;
 const tname=t=>GD.TYPES[t]?.n||t,joinTypes=a=>a.map(x=>tname(x.type)).join(', ');
 if(uncovered.length)issue('high','Uncovered weaknesses: '+joinTypes(uncovered),'At least one member is weak to each listed type and no member resists it by defensive typing. Held-item immunities and temporary effects are excluded from this table.');
 if(shared.length)issue('medium','Shared weakness pressure','Multiple members are weak to '+joinTypes(shared)+' with fewer resistant switch-ins.');
 if(gaps.length)issue('medium','Offensive coverage gaps','No native basic attack is super effective against single-type '+joinTypes(gaps)+'. Neutral attacks may still be strong.');
 if(covered>=12)strengths.push('Strong native single-type coverage: '+covered+'/'+types.length+' types.');
 if(!uncovered.length)strengths.push('Every represented type weakness has at least one resistant teammate.');
 const ranged=rows.filter(r=>r.ranged).length,defenders=rows.filter(r=>['Defender','Bulky'].includes(r.role)).length,speedsters=rows.filter(r=>r.role==='Speedster').length;
 if(n>=3&&(ranged===0||ranged===n))issue('medium',ranged?'All ranged roster':'All melee roster','One attack range is not inherently bad, but leaves fewer positioning options. Compare a mixed-range alternative.');
 else if(ranged>0&&ranged<n)strengths.push('Mixed melee and ranged options ('+(n-ranged)+' / '+ranged+').');
 if(n>=3&&!defenders)issue('info','No native Defender or Bulky role','A strong defensive build can compensate; inspect the actual bulk scores before adding a tank.');
 if(defenders)strengths.push(defenders+' native Defender/Bulky role'+(defenders===1?'':'s')+'.');
 for(const r of rows){
  r.synergyCount=rows.filter(x=>x.types.includes(r.types[0])).length;r.synergy=1+([0,0,0,.05,.08,.12,.15][r.synergyCount]||0);
  r.pressure*=r.synergy;
  if(r.configured.item!==''&&!r.active){const it={k:Number(r.configured.item),r:core.CFG.items[Number(r.configured.item)].r};issue(core.heldDef(it)?'medium':'info',r.name+' has no active held-item combat effect',r.itemName+' may still grant effective levels; compare a compatible combat item.',r.slot);}
  if(r.configured.item==='')issue('info',r.name+' has no held item','A compatible held item may improve its effective level or combat performance.',r.slot);
  const legal=GD.learnOf(r.id).filter(k=>k!==r.innate),used=r.configured.tms.filter(t=>t.k).length,slots=r.configured.lv>=12?2:1;
  r.openTM=Math.min(slots,legal.length)-used;
  if(r.openTM>0)issue('info',r.name+' has '+r.openTM+' unused TM slot'+(r.openTM===1?'':'s'),'Compatible skills can improve the build; use the suggested loadout below.',r.slot);
 }
 if(rows.some(r=>r.synergy>1))strengths.push('Native same-primary-type damage bonus up to '+round((Math.max(...rows.map(r=>r.synergy))-1)*100)+'% in the projected forms.');
 // A transparent reference: no-item, innate-only Pokémon of the same rarity at the member's base level/rank/ruleset/tactic.
 // Cache by rarity and level to avoid repeated catalog scans. Compare against non-Mega peers (not top meta teams).
 const refs=new Map();
 function reference(r){
  const m=r.configured,key=[GD.SPECIES[r.id].rar,m.lv,m.ability].join(':');if(refs.has(key))return refs.get(key);
  const list=all.filter(p=>p.rar===GD.SPECIES[r.id].rar).map(p=>projection({...m,id:p.id,item:'',tms:[{k:'',lv:1},{k:'',lv:1}],mega:0},-1,0));
  const median=k=>{const a=list.map(x=>x[k]).sort((a,b)=>a-b);return a[Math.floor(a.length/2)]||1;},ref={pressure:median('pressure'),bulk:median('bulk'),count:list.length};refs.set(key,ref);return ref;
 }
 const blendScore=(a,b)=>clamp(50+35*Math.log2(Math.max(.01,a/b)),0,100);
 for(const r of rows){const ref=reference(r);r.ref=ref;r.attackGrade=blendScore(r.pressure,ref.pressure);r.bulkGrade=blendScore(r.bulk,ref.bulk);r.memberGrade=round(.55*r.attackGrade+.45*r.bulkGrade);}
 const avg=k=>rows.reduce((s,r)=>s+r[k],0)/n;
 const grades={offense:round(.55*avg('attackGrade')+.45*100*covered/types.length),defense:round(.65*avg('bulkGrade')+.35*100*(1-uncovered.length/types.length)),coverage:round(100*covered/types.length),balance:round(clamp(100-60*uncovered.length/types.length-40*shared.length/types.length-(n>=3&&(ranged===0||ranged===n)?12:0),0,100)),
 loadout:round(100*rows.reduce((sum,r)=>sum+(.55*(r.active?1:r.configured.item!==''?.5:0)+.45*(r.openTM<=0?1:1-r.openTM/(r.configured.lv>=12?2:1))),0)/n),depth:round(100*n/6)};
 const score=round(.23*grades.offense+.23*grades.defense+.18*grades.coverage+.14*grades.balance+.12*grades.loadout+.10*grades.depth);
 // Build coach: test legal item candidates and objective-relevant skills. Preserve the user's level, ability and projected Mega.
 function utility(r,purpose){const ref=r.ref||{pressure:1,bulk:1};return purpose==='tank'?Math.log(Math.max(1e-9,r.bulk/ref.bulk))*.75+Math.log(Math.max(1e-9,r.pressure/ref.pressure))*.25:Math.log(Math.max(1e-9,r.pressure/ref.pressure))*.7+Math.log(Math.max(1e-9,r.bulk/ref.bulk))*.3;}
 for(const r of rows){
  const m=r.configured,sp=GD.SPECIES[r.id],purpose=['Defender','Bulky'].includes(r.role)?'tank':'attack';
  const q1={...cfg(m,r.form),metric:purpose==='tank'?'evadeBulk':'expectedCooldown',tm1:'auto',tm2:'auto',tm1rank:m.ability,tm2rank:m.ability};
  const recommended=rankTms(sp,q1,m.lv)||m.tms,alternates=[m.tms,recommended];
  const alt=rankTms(sp,{...q1,metric:purpose==='tank'?'def':'atk'},m.lv);if(alt)alternates.push(alt);
  const items=['',...core.CFG.items.map((_,i)=>String(i))],before={...r,pressure:r.pressure/r.synergy},baseScore=utility(before,purpose);
  let best=before,bestScore=baseScore;
  for(const item of items)for(const tms of alternates){const v=projection({...m,item,tms},r.slot,r.form);v.ref=r.ref;const value=utility(v,purpose);if(value>bestScore+1e-8){best=v;bestScore=value;}}
  if(bestScore>baseScore+Math.log(1.04)){
   suggestions.push({kind:'build',slot:r.slot,name:r.name,title:'Optimize '+r.name+' for '+purpose,
    detail:'Tested compatible held items and a small set of role-relevant TM combinations at the current level/rank. Neutral pressure '+round(before.pressure,1)+' → '+round(best.pressure,1)+'; passive bulk '+round(before.bulk)+' → '+round(best.bulk)+'.',
    item:best.itemName,tms:best.tmNames,build:best.configured,gain:round((Math.exp(bestScore-baseScore)-1)*100,1)});
  }
 }
 // Candidate replacement coach: identify actual gaps and rank a same-or-lower rarity shortlist by marginal typing improvement.
 const priority=targetTable.filter(x=>!x.hit||x.weak>x.resist);
 if(priority.length){
  const pick=rows.slice().sort((a,b)=>a.memberGrade-b.memberGrade)[0],sp=GD.SPECIES[pick.id],candidates=[];
  function teamTypingScore(list){let value=0;for(const t of types){const hit=list.some(r=>out(r,[t])>1),weak=list.filter(r=>GD.eff(t,r.types)>1).length,resist=list.filter(r=>GD.eff(t,r.types)<1).length;value+=hit?1:0;value-=weak&&!resist?1.3:0;value-=Math.max(0,weak-resist-1)*.35;}return value;}
  const before=teamTypingScore(rows),remaining=rows.filter(r=>r.slot!==pick.slot);
  for(const p of all){if(ids.has(p.id)||p.rar>sp.rar)continue;const v=projection({...pick.configured,id:p.id,item:'',mega:0,tms:[{k:'',lv:1},{k:'',lv:1}]},pick.slot,0);const improvement=teamTypingScore([...remaining,v])-before;if(improvement>.1)candidates.push({v,improvement});}
  candidates.sort((a,b)=>b.improvement-a.improvement||b.v.pressure-a.v.pressure||b.v.bulk-a.v.bulk||a.v.name.localeCompare(b.v.name));
  for(const {v,improvement} of candidates.slice(0,3))suggestions.push({kind:'replacement',slot:pick.slot,name:v.name,title:'Consider '+v.name+' instead of '+pick.name,detail:'Same or lower rarity, no held item or additional TMs assumed. Improves the type-coverage/switch-in rubric by '+round(improvement,1)+' points; not a guaranteed stronger combatant.',build:v.configured,gain:round(improvement,1)});
 }
 // Optional actual opponent: inspect dual-typing and forced special typing separately, not win probability.
 const foe=[];let foeMega=false;
 if(q.compare!==false)for(let i=0;i<other.length;i++){const m=clean(other[i],i,false);if(!m)continue;const form=m.mega&&!foeMega?m.mega:0;if(form)foeMega=true;foe.push(projection(m,i,form,opponentTactic,tactic));}
 const matchups=foe.map(f=>{
  const counters=rows.map(r=>({slot:r.slot,name:r.name,out:out(r,f.types),in:incoming(r,f.types),special:r.combat.specialType?GD.eff(r.combat.specialType,f.types):out(r,f.types),enemySpecial:f.combat.specialType?GD.eff(f.combat.specialType,r.types):incoming(r,f.types),pressure:r.pressure}));
  counters.sort((a,b)=>Math.log2(Math.max(b.out,b.special)/Math.max(b.in,b.enemySpecial))-Math.log2(Math.max(a.out,a.special)/Math.max(a.in,a.enemySpecial))||b.pressure-a.pressure||a.slot-b.slot);
  const best=counters[0],threat=counters.every(x=>Math.max(x.in,x.enemySpecial)>Math.max(x.out,x.special));
  if(threat)issue('high','Difficult matchup: '+f.name,'Every member has a worse best-type exchange against this opponent. Inspect stats, item effects and actual battle positioning.');
  return {name:f.name,id:f.id,types:f.types,slot:f.slot,best,threat,counters};
 });
 if(matchups.length&&GD.TACTICS[opponentTactic].beats===tactic){const counter=Object.keys(GD.TACTICS).find(k=>GD.TACTICS[k].beats===opponentTactic);issue('medium','Opponent reads your tactic','The opposing tactic has a native +15% ATK read advantage. Consider '+(GD.TACTICS[counter]?.n||counter)+' to gain the read instead; compare the corresponding ATK/DEF tradeoffs.');}
 const lead=matchups.length?matchups[0].best:rows.slice().sort((a,b)=>b.memberGrade-a.memberGrade)[0];
 if(lead)strengths.push('Suggested lead: '+lead.name+(matchups.length?' for the opposing first slot based on type exchange.':' based on the neutral member rubric.'));
 const severity={high:0,medium:1,info:2};issues.sort((a,b)=>severity[a.severity]-severity[b.severity]);
 return {empty:false,score,letter:score>=90?'S':score>=80?'A':score>=70?'B':score>=60?'C':score>=45?'D':'E',grades,rows:rows.map(({combat,ref,...r})=>({...r,pressure:round(r.pressure,2),bulk:round(r.bulk),cycle:round(r.cycle,3),attackGrade:round(r.attackGrade),bulkGrade:round(r.bulkGrade),referenceCount:ref.count})),issues,strengths,suggestions,targetTable,matchups,mode:mode.name,n,megaCount,ranged,defenders,speedsters,covered,uncovered:uncovered.length,lead:lead?.slot??null,tactic,opponentTactic,reference:'Median unheld, innate-only non-Mega peers of the same rarity, base level and ability rank, under the selected ruleset and tactics. Scores are an explainable heuristic, not a predicted win rate.'};
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
    if(data.type==='team-rate'){try{send('team-rate',{job:data.job,result:teamRate(data.config)});}catch(e){send('team-rate',{job:data.job,error:e.message});}return;}
    if(data.type==='team-plan'){try{send('team-plan',{job:data.job,result:teamPlan(data.config,p=>send('team-plan-progress',{job:data.job,progress:p}))});}catch(e){send('team-plan',{job:data.job,error:e.message});}return;}
    if(data.type==='dex-rank'){try{send('dex-rank',{job:data.job,result:dexRank(data.config)});}catch(e){send('dex-rank',{job:data.job,error:e.message});}return;}
    if(data.type==='dex-preview'){try{send('dex-preview',{job:data.job,result:dexPreview(data.config)});}catch(e){send('dex-preview',{job:data.job,error:e.message});}return;}
    if(data.type==='dex-timing'){const id=String(data.id);if(!GD.SPECIES[id])return;send('dex-timing',{job:data.job,result:timingFor(id,GD.ROLES[GD.SPECIES[id].role].ranged,true)});return;}
    if(data.type==='benchmark')benchmark(data.config,data.job);
    if(data.type==='cancel-benchmark')batch=null;
  } catch(e){send('error',{message:e.message});}
};
try { bootstrap(); } catch(error) { send('load-error',{message:'Could not load the public PokeClash League engine. '+error.message}); }
