function createBattleRuntime({GD, VE, EconCore}) {
  const core = EconCore(GD);
  const modes = [{id:'sandbox',name:'Open sandbox',cap:0,kind:'duel'},
    ...core.CFG.arena.cups.map((cup,i)=>({id:'arena'+i,name:'Clash Arena · '+['Novice','Great','Ultra','Master'][i],cap:cup.cap,kind:'arena'})),
    ...core.CFG.league.ranks.map((rank,i)=>({id:'league'+i,name:'League · '+rank.n,cap:core.CFG.league.cap?.[i] || 0,kind:'league'}))];

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

  function build(config, seed, {canvas = null, onEvent} = {}) {
    const mode=getMode(config.mode);
    const team=config.teams.map(side=>side.filter(Boolean).map(m=>equip(m,mode)));
    for(const entries of team){
      if(!entries.length || entries.length>6 || new Set(entries.map(x=>x.id)).size!==entries.length) throw Error('Each team needs one to six different Pokémon.');
    }
    const tactics=config.tactics.map(t=>Object.hasOwn(GD.TACTICS,t)?t:'equilibrado');
    const game = new VE.Battle(canvas,{
      sim:!canvas,scene:'stadium',arena:'pvp',names:['Team A','Team B'],teams:team,plans:tactics.map((tactic,i)=>({tactic,swap:mode.kind==='arena'&&i===1?'vantagem':'ordem'})),
      ai:[false,mode.kind==='arena'],meter:true,duel:mode.kind!=='arena',seed:limit(seed,0,4294967295),
      swapCd:core.CFG.arena.swapCd,maxTicks:mode.kind==='league'?core.CFG.league.live.sec*60:core.CFG.arena.maxTicks,onEvent
    });
    return attachCoach(game,config,mode);
  }

  // Local coach only: estimates never consume the engine RNG or modify combat stats.
  const policies = new WeakMap();
  const clamp = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const rank = (g,u,k,values)=>values[g.skl(u,k)]||0;
  const ability = (u,k,values)=>u.ab===k?(values[(u.abLv||1)-1]||0):0;
  const usable = u=>u&&!u.ko&&u.hp>0&&!['enter','recall','faint'].includes(u.state);
  function projected(g,u,entering=false) {
    let p={...u,fury:entering||!Number.isFinite(u.fury)?1+ability(u,'grito',[.10,.14,.18]):u.fury};
    if(entering)p.metN=0;
    if(u.mega&&!u.isMega&&!g.sides[u.side].megaDone){
      const m=GD.megaOf(u.id,u.megaF);
      if(m){const k=1+.05*(u.lv-1),max=Math.round(m.hp*k);
        p={...p,sp:m,hp:Math.max(1,Math.round(p.hp/p.max*max)),max,atk:m.atk*k,def:m.def*k,spd:m.spd,type:m.type,types:m.types,isMega:true,megaMul:1.1};
      }
    }
    return p;
  }
  function hitEstimate(g,u,f,special=false) {
    const sh=u.hb||{},th=f.hb||{},ty=g.aT(u,f,special),e=GD.atkEff([ty],f.types);
    const balloon=!!(th.ball&&!f.popped&&ty==='terra');
    const shield=(f.grdT||0)>0||(f.prot===undefined?g.skl(f,'pr'):f.prot)>0;
    if(balloon)return {mean:0,raw:0,shield,balloon};
    let atk=g.atkOf(u);
    if(u.firstHit!==false)atk*=1+ability(u,'mira',[.4,.55,.7]);
    const base=Math.max(20,Math.round(u.sp.atk*.55/5)*5);
    const power=special?Math.sqrt(Math.round(base*2.1/10)*10/95):Math.sqrt(base/45);
    const mult=special?1.3*2.1*(1+ability(u,'explosao',[.2,.35,.5]))*(1+rank(g,u,'gi',[0,.2,.3,.4])):u.ranged?.9:1;
    let raw=atk*mult*power*1.25*120/(120+g.defOf(f))*e;
    raw*=(sh.tdm?.[ty]||1)*(e>1?sh.se||1:1)*(special?1:sh.basic||1)*(1+Math.min(sh.metMax||100,(sh.met||0)*(u.metN||0))/100);
    raw*=(th.taken||1)*(u.ranged?th.vsR||1:1)*(1-ability(f,'pele',[.10,.15,.20]))*g.tyTeam(u);
    let dodge=(g.plans[f.side].tactic==='defensivo'?.08:0)+ability(f,'esquiva',[.12,.17,.22])+rank(g,f,'dt',[0,.05,.08,.12])+(th.eva||0)/100;
    if(special)dodge*=.5;
    if(sh.acc)dodge=Math.max(0,1-(1-dodge)*sh.acc);
    const crit=clamp(.06+ability(u,'certeiro',[.12,.18,.24])+rank(g,u,'fe',[0,.06,.10,.15])+(sh.crit||0)/100,0,1);
    raw=Math.max(1,raw);
    return {raw,mean:raw*(1-clamp(dodge,0,1))*(1+crit*(u.ab==='certeiro'?.8:.5)),shield,balloon};
  }
  function dps(g,u,f) {
    const hit=hitEstimate(g,u,f);
    const h=u.hb||{};
    const speed=(1+ability(u,'troca',[.12,.18,.24])+rank(g,u,'ag',[0,.15,.22,.3]))*(h.spd||1);
    const cd=Math.max(.35,(1.7-u.spd*.008)*(u.ranged?1.5:1)/Math.max(.2,speed));
    return hit.mean/Math.max(u.ranged?.85:1.05,cd+(u.ranged?.22:.65));
  }
  function durability(g,u,foe,incoming) {
    const h=u.hb||{},hits=u.prot===undefined?g.skl(u,'pr'):u.prot;
    let hp=u.hp+Math.max(0,hits||0)*hitEstimate(g,foe,u).mean;
    if(!u.recovered)hp+=Math.min(u.max*.3,u.max*rank(g,u,'rc',[0,.25,.35,.45]));
    if(!u.ate&&h.berry)hp+=u.max*(h.berry[1]||0)/100*.7;
    if(!u.endured&&g.skl(u,'en'))hp+=u.max*rank(g,u,'en',[0,.05,.15,.25]);
    const healing=u.max*(ability(u,'cura',[.06,.08,.10])+(h.regen||0)/100)/5;
    return hp+Math.min(u.max*.35,healing*hp/Math.max(1,incoming));
  }
  function matchup(g,mon,foe,entering=false) {
    const u=projected(g,mon,entering),f=projected(g,foe);
    const attack=dps(g,u,f),incoming=dps(g,f,u);
    const drain=(u.hb?.drain||0)/100+rank(g,u,'gd',[0,.08,.12,.16]);
    const sustain=clamp(attack*drain,0,incoming*.45);
    const hp=durability(g,u,f,incoming),enemyHp=durability(g,f,u,attack);
    const kill=enemyHp/Math.max(.2,attack),survive=hp/Math.max(.2,incoming-sustain);
    const special=hitEstimate(g,u,f,true);
    // Logarithmic relative race, so a strong tank and a fast attacker are comparable.
    const score=Math.log(clamp(survive/Math.max(.1,kill),.02,50))+.18*u.hp/u.max+(g.sides[u.side].meter>=1&&!special.shield? .28*Math.min(1,special.mean/Math.max(1,f.hp)):0);
    return {score,kill,survive,special};
  }
  function bestBench(g,side,foe) {
    const state=g.sides[side];
    return state.team.filter(m=>m!==state.active&&!m.ko&&m.hp>0).map(m=>({m,...matchup(g,m,foe,true)})).sort((a,b)=>b.score-a.score||a.m.slot-b.m.slot)[0];
  }
  function attachCoach(g,config,mode) {
    const state={full:[config.fullAI?.[0]!==false,mode.kind!=='arena'&&config.fullAI?.[1]!==false],ready:[null,null],last:[-10000,-10000]};
    policies.set(g,state);
    const nativeNext=g.nextFor.bind(g);
    g.nextFor=function(side) {
      const own=g.sides[side], foe=g.sides[1-side].active||g.sides[1-side].team.find(m=>!m.ko);
      // Keep the selected lead; after a KO choose the best surviving counter.
      if(!state.full[side]||!foe||foe.ko||!own.team.some(m=>m.ko))return nativeNext(side);
      return bestBench(g,side,foe)?.m||nativeNext(side);
    };
    return g;
  }
  function auto(game,side,enabled,orders) {
    const state=game.sides[side],u=state.active,f=game.sides[1-side].active;
    const coach=policies.get(game);
    if(game.opt.ai[side]||orders.length)return orders; // Keep native Arena rival and explicit manual commands.
    if(!usable(u))return orders;
    const full=coach?.full[side];
    if(!full)return enabled&&state.meter>=1&&!u.forceSp?[['f']]:orders;
    if(state.meter>=1){if(coach.ready[side]===null)coach.ready[side]=game.tick;}else coach.ready[side]=null;
    if(!usable(f)||u.forceSp||u.pend||!['idle','walk'].includes(u.state))return orders;
    // Take legal actions at most every 0.2 s, without touching the underlying hit engine.
    if(game.tick-coach.last[side]<12)return orders;
    coach.last[side]=game.tick;
    const choose=(cmd,why)=>{game.log(game.opt.names[side]+' AI: '+why,'info');return [cmd];};
    if(game.canMega(side))return choose(['m'],'Mega Evolve '+u.sp.name+'.');
    const current=matchup(game,u,f),charge=state.meter>=1;
    const waited=coach.ready[side]===null?0:(game.tick-coach.ready[side])/60;
    const imminent=f.state==='special'||f.forceSp||game.proj?.some(p=>p.tg===u&&p.kind==='special'&&!p.done);
    const enemySpecial=hitEstimate(game,projected(game,f),projected(game,u),true);
    const threatening=imminent&&!enemySpecial.shield&&enemySpecial.raw>=u.hp*.8;
    const killSoon=current.kill<2&&current.survive>current.kill*.95;
    const best=!(state.swapT>0)&&game.opt.swapCd?bestBench(game,side,f):null;
    const canFinish=charge&&!current.special.shield&&!current.special.balloon&&current.special.raw*.9>=f.hp&&!(!f.endured&&game.skl(f,'en'));
    if(best&&!canFinish&&!killSoon){
      const improvement=best.score-current.score;
      const losing=current.survive<current.kill*.85;
      const poor=current.score<-.35;
      const safer=best.survive>current.survive*1.25;
      const save=u.hp/u.max<.24&&safer&&best.score>current.score+.45;
      const betterSpecial=charge&&!best.special.shield&&!best.special.balloon&&(current.special.balloon||best.special.mean>current.special.mean*1.8)&&improvement>.2;
      if((improvement>.70&&(losing||poor||safer))||save||betterSpecial||(threatening&&safer&&improvement>.25)){
        return choose(['s',best.m.slot],'Switch to '+best.m.sp.name+' for a better matchup.');
      }
    }
    if(!charge)return orders;
    // Protect and Air Balloon are real engine hit blockers. Let basics clear them, or switch.
    if(current.special.shield||current.special.balloon)return orders;
    const near=u.ranged||Math.hypot(u.x-f.x,u.y-f.y)<78;
    const pendingBasic=game.proj?.some(p=>p.tg===f&&p.src===u&&p.kind!=='special'&&!p.done);
    if(pendingBasic&&hitEstimate(game,u,f).raw*.9>=f.hp&&waited<2&&!threatening)return orders;
    // Hold briefly when the opponent is almost down or a better opportunity is likely, not indefinitely.
    if(!canFinish&&!threatening&&current.kill<1.4&&waited<2)return orders;
    if(!near&&waited<2&&current.survive>2.5)return orders;
    return choose(['f'],canFinish?'Use Special for a likely knockout.':'Use Special against '+f.sp.name+'.');
  }
  function apply(game, automatic, orders=[[],[]]) {
    game.step(auto(game,0,automatic[0],orders[0]),auto(game,1,automatic[1],orders[1]));
  }
  function view(mon) {
    return mon ? {id:mon.id,portrait:mon.sp.por,types:mon.types,name:mon.sp.name,lv:mon.lv,hp:Math.max(0,mon.hp),max:mon.max,slot:mon.slot,isMega:!!mon.isMega,ko:!!mon.ko,state:mon.state} : null;
  }
  function snapshot(game, entries) {
    return {type:'state',tick:game.tick,over:game.over,winner:game.winner,
      sides:game.sides.map((side, index)=>({
        active:view(side.active),meter:side.meter,swap:side.swapT||0,team:side.team.map(view),
        canMega:game.canMega(index),megaDone:side.megaDone,read:game.read[index],
        canSpecial:side.meter>=1 && Boolean(side.active && !side.active.ko && !side.active.forceSp &&
          !['enter','recall','faint'].includes(side.active.state))
      })),entries};
  }

  function spriteIds(config) {
    const ids = new Set();
    for (const slot of config.teams.flat().filter(Boolean)) {
      ids.add(slot.id);
      const held = equip(slot, getMode(config.mode)).hb;
      const form = globalThis.FORMS?.[slot.id]?.[held?.k]?.id;
      const mega = slot.mega && GD.megaOf(slot.id,Number(slot.mega))?.sid;
      if (form) ids.add(form);
      if (mega) ids.add(mega);
    }
    return [...ids];
  }

  return {core,modes,build,apply,snapshot,spriteIds};
}

globalThis.createBattleRuntime = createBattleRuntime;
