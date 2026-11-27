# ClashLab

Unofficial local battle lab for PokeClash League. Build two teams and test Mega forms, held items, ability ranks, TMs, team order, tactics, and type matchups. Battles can be played interactively or benchmarked on up to 500 seeds.

## Running locally

Serve the project root over HTTP, for example with `python3 -m http.server 8000`, and open http://localhost:8000. Vercel can deploy the root as a static project with no build step.

## Mechanics

A Web Worker loads the upstream scripts as classic scripts directly from [PokeClash League](https://pokeclashleague.xyz/). The public game runtime resolves hit timing, types, battle decisions, held-item effects, Mega activation and seeded outcomes. Clash Arena uses the engine's Arena opponent behavior and Arena level cap rules. League uses two controllable trainers and its combined level-plus-item cap. Open sandbox uses League-style combat with unrestricted battle levels and allows short teams.

Auto Special issues a local Special command when the engine meter is full. Bench swaps are manual during interactive play. Batch runs use fixed team order and honor the sides' Auto Special settings. Arena's engine controls the opponent's Special. Local controls apply on the next simulation tick. Online queueing, server latency, rewards and PvP ratings are outside the app.

ClashLab is an independent tool. The upstream game code is loaded at runtime and belongs to its respective authors. Pokémon sprites shown in the interface are externally hosted via [PokeAPI's sprites repository](https://github.com/PokeAPI/sprites). Pokémon and associated marks and artwork belong to their respective owners.
