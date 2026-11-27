# ClashLab

ClashLab is an unofficial local battle lab for PokeClash League. Build two teams and test Mega forms, held items, ability ranks, TMs, team order, tactics, and type matchups. Play a match interactively or benchmark it across up to 500 seeds.

## Run locally

Serve the project root over HTTP, for example with `python3 -m http.server 8000`, and open http://localhost:8000. Vercel can deploy the root as a static project with no build step.

## Battle engine and visuals

Interactive battles use the public [PokeClash League](https://pokeclashleague.xyz/) canvas renderer, Clash Arena backdrop, sprite sheets, portraits, and battle effects. ClashLab loads these resources from the game site at runtime. The site must be reachable to load the arena and game data.

The local ruleset and team setup are shared with the benchmark worker. Clash Arena uses the engine's Arena opponent behavior and Arena level cap rules. League uses two controllable teams and its combined level-plus-item cap. Open Sandbox uses League-style combat with unrestricted effective battle levels. Each side can use up to six Pokémon.

Manual swaps, Special, and early Mega activation are available during interactive play. Auto Special issues a local command when the meter is full. Batch runs use fixed team order and honor Auto Special settings. Arena's engine controls the opponent's Special. Both modes read the original sprite frame timings where available. Main-thread drawing and K.O. cards do not change the simulation tick rate or benchmark results for the same inputs.

This is an independent simulator. See the [PokeClash League asset credits](https://pokeclashleague.xyz/#credits) for the original art, including Pokémon sprites and portraits by [PMDCollab/SpriteCollab artists](https://github.com/PMDCollab/SpriteCollab) under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) and battle effects by [pixelfx](https://github.com/patch-gg/pixelfx) under MIT. Pokémon and associated marks belong to their respective owners.
