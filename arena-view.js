import './battle-runtime.js';

function createView() {
  const canvas = document.getElementById('arena');
  const runtime = createBattleRuntime(window);
  const preview = new VE.Battle(canvas, {
    arena:'pvp', names:['Team A','Team B'], teams:[[],[]],
    plans:[{tactic:'equilibrado'}, {tactic:'equilibrado'}]
  });
  let game;
  let pending = [[],[]];
  let events = [];
  let knockout;

  function previewArena() {
    game = null;
    preview.draw();
  }

  function prepare(config) {
    return VE.ensure(runtime.spriteIds(config));
  }

  function start(config) {
    events = [];
    knockout = null;
    pending = [[],[]];
    game = runtime.build(config, config.seed, {
      canvas,
      onEvent(event, payload) {
        if (event === 'log') events.push({tick:game.tick,text:payload.s,kind:payload.k});
        if (event === 'ko') {
          const {id, side, sp} = payload.u;
          knockout = {id,side,name:sp.name};
        }
      }
    });
    return runtime.snapshot(game, events.splice(0));
  }

  function advance(ticks, automatic, showKnockouts) {
    knockout = null;
    for (let i = 0; i < ticks && !game.over; i++) {
      runtime.apply(game, automatic, pending);
      pending = [[],[]];
      if (knockout && showKnockouts) break;
    }
    return {...runtime.snapshot(game, events.splice(0)),knockout};
  }

  function draw() { (game || preview).draw(); }
  function order(side, command) { pending[side].push(command); }
  previewArena();

  return {previewArena,prepare,start,advance,draw,order};
}

try {
  await Promise.allSettled([
    document.fonts.load('20px "Press Start 2P"'),
    document.fonts.load('16px "VT323"')
  ]);
  window.arenaView = createView();
} catch (error) {
  window.arenaError = error.message;
} finally {
  frameElement.dispatchEvent(new Event('arena-ready'));
}
