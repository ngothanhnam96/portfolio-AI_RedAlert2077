# 01 · Specification: *Tiền Tuyến 2077* (Frontline 2077)

A real-time strategy game for the browser in the classic base-building style (see
[00-RESEARCH](00-RESEARCH.md)). The player (Liên Quân Xanh) builds a base, harvests crystal
ore, produces an army and destroys the AI opponent (Phe Đỏ) on a procedurally generated map.
The UI is in Vietnamese.

Every requirement has an ID. [04-TESTING](04-TESTING.md) has the **verification matrix**
mapping each ID to the automated test or browser check that proves it.

## Functional requirements

| ID | Requirement |
|----|-------------|
| FR-1 | **Skirmish setup:** map size (small 48² / medium 64²), map seed, AI difficulty (Dễ / Thường / Khó), starting credits. |
| FR-2 | **Procedural map:** grass, rock and water (impassable), crystal ore fields; point-symmetric; both bases connected by land. |
| FR-3 | **Economy:** harvesters gather ore (capacity, gather and unload times) and unload at a refinery for credits; ore fields deplete and regrow. A refinery comes with one free harvester. |
| FR-4 | **Construction:** structures are built from the sidebar (one at a time), then placed on clear land within the build radius of your own structures. Structures can be sold for 50 %. |
| FR-5 | **Power:** plants supply power and other structures consume it. With a deficit, production runs at half speed and turrets and radar go offline. |
| FR-6 | **Production:** infantry from barracks and vehicles from the war factory, each with a queue of up to 5 and a rally point. The tech tree gates items behind prerequisites. Cancelling refunds the cost. |
| FR-7 | **Units:** 7 types (2 infantry, 4 combat vehicles incl. artillery, harvester). **Structures:** 8 types incl. a defensive turret. Every unit has hp, speed, sight, armour class, weapon (damage, range, reload, warhead, splash). |
| FR-8 | **Combat:** warhead × armour damage table, projectiles with travel time, artillery splash and minimum range; idle units acquire targets in range; attack-move fights on the way, move ignores enemies. |
| FR-9 | **Movement:** A* pathfinding around terrain and structures, path smoothing, group formations, separation, nearest-reachable fallback for blocked targets. |
| FR-10 | **Fog of war:** per-player shroud (never seen) and fog (seen before); enemies are only drawn and targetable when visible. |
| FR-11 | **Radar:** the minimap works only with a powered radar; clicking it moves the camera. |
| FR-12 | **AI opponent:** builds a base (power-aware), harvests, keeps harvesters, produces a mixed army, defends its base, and attacks in waves. 3 difficulties. Uses the same command API as the player. |
| FR-13 | **Controls:** click / box / shift-add / double-click selection; right-click move/attack/harvest; `A` attack-move, `S` stop; control groups `Ctrl+1..9`; camera by edge scroll, keys, drag and minimap; placement ghost; sell; rally. Touch: tap select/command, drag to pan, box-select toggle. |
| FR-14 | **Victory:** a player is defeated when they have no structures and no units left. End screen with stats (time, units built/lost/killed, ore harvested). |
| FR-15 | Pause, game speed (1× / 1.5× / 2×), sound and music toggles, a how-to-play screen. |

## Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Static site: no build step, no runtime dependencies, no asset files (code-drawn graphics, synthesised audio). |
| NFR-2 | The simulation is pure ES modules with no DOM, unit-tested in Node. |
| NFR-3 | **Deterministic:** same seed + same commands → bit-identical state hash. |
| NFR-4 | **Balance is verified:** the counter triangle holds in cost-equal fights; Khó beats Dễ in AI-vs-AI over several seeds; every AI-vs-AI game ends within the time limit. |
| NFR-5 | **Fair maps:** symmetry, land connectivity and equal ore are verified for many seeds. |
| NFR-6 | **Performance:** one simulation tick with 200 units stays well under the 50 ms tick budget (target < 5 ms in Node); rendering at 60 fps on a mid laptop. |
| NFR-7 | Responsive (desktop first; playable on tablets/phones in landscape), crisp at any DPR, light UI chrome with a dark game view. |
| NFR-8 | CI runs tests on every push; GitHub Pages deploys from `main`. |
| NFR-9 | Original IP only (see research). |

## Out of scope (v1)

Multiplayer (the deterministic core makes lockstep possible later), naval and air units,
a campaign, a map editor, saving a game mid-match.
