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
    return new VE.Battle(canvas,{
      sim:!canvas,scene:'stadium',arena:'pvp',names:['Team A','Team B'],teams:team,plans:tactics.map((tactic,i)=>({tactic,swap:config.fullAI?.[i]||(mode.kind==='arena'&&i===1)?'vantagem':'ordem'})),
      ai:[false,mode.kind==='arena'],meter:true,duel:mode.kind!=='arena',seed:limit(seed,0,4294967295),
      swapCd:core.CFG.arena.swapCd,maxTicks:mode.kind==='league'?core.CFG.league.live.sec*60:core.CFG.arena.maxTicks,onEvent
    });
  }

  function auto(game,side,enabled,orders) {
    const state=game.sides[side];
    const u=state.active, f=game.sides[1-side].active;
    if(game.opt.ai[side])return orders; // Arena rival retains native delayed specials and native swap logic.
    const full=game.plans[side].swap==='vantagem';
    if(!u||u.ko||['enter','recall','faint'].includes(u.state))return orders;
    if(full && f && !f.ko && u.state==='idle' && !u.forceSp && !(state.swapT>0) && game.tick%30===0){
      const score=m=>GD.atkEff(m.types,f.types)*2-GD.atkEff(f.types,m.types)+m.hp/m.max*0.3;
      const candidates=state.team.filter(m=>m!==u&&!m.ko).sort((a,b)=>score(b)-score(a));
      const best=candidates[0];
      if(best && score(best)>score(u)+0.75 && (GD.atkEff(f.types,u.types)>1 || u.hp/u.max<0.35))return [...orders,['s',best.slot]];
    }
    if ((enabled||full) && state.meter>=1 && !u.forceSp) return [...orders,['f']];
    return orders;
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
