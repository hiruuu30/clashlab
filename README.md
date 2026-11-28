# ClashLab

ClashLab is an unofficial local battle lab for PokeClash League. Build two teams and test Mega forms, held items, ability ranks, TMs, team order, tactics, and type matchups. Play a match interactively or benchmark it across up to 500 seeds.

## Run locally

Serve the project root over HTTP, for example with `python3 -m http.server 8000`, and open http://localhost:8000. Vercel can deploy the root as a static project with no build step.

## Battle engine and visuals

Interactive battles use the public [PokeClash League](https://pokeclashleague.xyz/) canvas renderer, Clash Arena backdrop, sprite sheets, portraits, and battle effects. ClashLab loads these resources from the game site at runtime. The site must be reachable to load the arena and game data.

The local ruleset and team setup are shared with the benchmark worker. Clash Arena uses the engine's Arena opponent behavior and Arena level cap rules. League uses two controllable teams and its combined level-plus-item cap. Open Sandbox uses League-style combat with unrestricted effective battle levels. Each side can use up to six Pokémon.

Smart Auto Battle is enabled by default for both teams. It estimates damage and survival from engine stats, type multipliers, held items, abilities and TMs; chooses favorable swaps and replacement Pokémon; avoids wasting charged specials on known protection; and requests early Mega Evolution. It keeps the selected lead and respects the engine's swap cooldown. Turn Auto Battle off independently for manual swaps and early Mega activation; the separate Auto Special setting can still be used. The native Arena opponent remains controlled by the upstream game engine. Batch runs use the same local controller as interactive battles. The AI's matchup scores are heuristics, not guaranteed outcomes or a copy of official trainer AI. Both modes read the original sprite frame timings where available. Main-thread drawing and K.O. cards do not change the simulation tick rate or benchmark results for the same inputs.

This is an independent simulator. See the [PokeClash League asset credits](https://pokeclashleague.xyz/#credits) for the original art, including Pokémon sprites and portraits by [PMDCollab/SpriteCollab artists](https://github.com/PMDCollab/SpriteCollab) under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) and battle effects by [pixelfx](https://github.com/patch-gg/pixelfx) under MIT. Pokémon and associated marks belong to their respective owners.

## ClashDex

Open ClashDex to browse the live engine catalog. The scouting screen distinguishes original six-stat base values and BST from PokeClash's four converted battle stats (HP, ATK, DEF, SPD). A level preview shows unbuffed scaled stats; it excludes held items, TMs and ability modifiers. The list can rank original or combat stats separately, include Mega forms, and combine rarity, type, role, ability, TM, range, evolution stage, minimum stat and favorites filters. Profiles show actual engine type multipliers, ability ranks, move names, compatible TMs, item level bonuses and evolution links. Pin two entries to compare their stats. Roster replacement requires selecting an existing slot and confirming. Rankings are attribute rankings, not predicted battle results. Favorites remain in browser storage.
