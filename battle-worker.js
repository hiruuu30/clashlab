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
  const species = Object.values(GD.SPECIES).map(s => ({
    id:s.id, name:s.name, types:s.types, rarity:GD.RAR[s.rar].n, role:GD.ROLES[s.role].n, ability:s.abN, hp:s.hp, atk:s.atk, def:s.def, spd:s.spd, bst:s.bst, abilityEffects:[1,2,3].map(l=>GD.ABIL[s.ab]?.d(l)||''),
    innate:GD.innateOf(s.id), learn:GD.learnOf(s.id),
    mega:[GD.MEGA_SP[s.id]?.name, GD.MEGA_SP2[s.id]?.name].filter(Boolean),
    levels:core.CFG.items.map((item,k)=>core.itemLv({k,r:item.r},s.id)),
    activeEffects:core.CFG.items.map((item,k)=>Boolean(core.heldFx({k,r:item.r},s.id)))
  }));
  send('ready',{species,skills,modes,types:Object.fromEntries(Object.entries(GD.TYPES).map(([k,v])=>[k,v.n])),
    typeMatrix:Object.fromEntries(Object.keys(GD.TYPES).map(a=>[a,Object.fromEntries(Object.keys(GD.TYPES).map(b=>[b,GD.eff(a,[b])]))])),
    items:core.CFG.items.map((item,k)=>({k,name:item.n,rarity:core.RAR_N[item.r],tags:core.heldTags({k,r:item.r}),hasBattleEffect:!!core.heldDef({k,r:item.r})}))});
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
    if(data.type==='benchmark')benchmark(data.config,data.job);
    if(data.type==='cancel-benchmark')batch=null;
  } catch(e){send('error',{message:e.message});}
};
try { bootstrap(); } catch(error) { send('load-error',{message:'Could not load the public PokeClash League engine. '+error.message}); }
