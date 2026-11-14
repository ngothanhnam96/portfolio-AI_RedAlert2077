# Tiền Tuyến 2077: Frontline 2077

An original **real-time strategy** game for the browser, in the classic base-building style of
the 1990s. Build a base, harvest crystal ore, manage power, climb a tech tree and destroy the AI
opponent on a procedurally generated map. Vietnamese UI.

- **Economy:** harvesters, refineries, regrowing ore fields.
- **Base building:** sidebar construction, a power grid, 8 structures, 7 unit types, 3 tech tiers.
- **Combat:** a warhead × armour damage table with a verified counter triangle, plus artillery
  splash, stances and attack-move.
- **Movement:** A* pathfinding, formations, separation.
- **Information:** fog of war (shroud + fog), and a radar minimap that needs power.
- **AI:** a skirmish AI with 3 difficulties that plays **through the same command API as you**.
- **Controls:** box select, control groups, rally points, selling; touch controls on phones and
  tablets.
- **Polish:** a live AI-vs-AI battle behind the menu, synthesised sound and music, and
  code-drawn graphics. Zero dependencies, no build step, no asset files.

## Play

```bash
npm start      # http://127.0.0.1:5173
```

| Input | Action |
|-------|--------|
| Left click / drag | Select (Shift adds, double-click selects all of a type on screen) |
| Right click | Move · attack · harvest ore · set rally point (with a factory selected) |
| `A` then click | Attack-move |
| `S` / `G` | Stop / hold position |
| `Ctrl+1…9`, `1…9` | Create / select a control group (press twice to jump to it) |
| Arrows, screen edge, middle drag, minimap | Move the camera · wheel zooms |
| `H` | Jump to your base |
| `P` · `M` · `N` | Pause · sound · music |

## Test

```bash
npm test       # 71 tests, ~17 s
```

The suite doesn't just test functions. It **verifies the design**:

- **Maps:** symmetric, connected and fair on 60 maps.
- **Pathfinding:** A* is optimal against Dijkstra on 40 random maps.
- **Economy:** ore is conserved exactly.
- **Determinism:** the same seed and commands give identical replays.
- **Balance:** the counter triangle holds in cost-equal fights.
- **AI ladder:** Hard beats Normal beats Easy across seeds, and no AI-vs-AI game stalls.
- **Performance:** a 200-unit battle steps in under 5 ms.

See the [verification matrix](docs/04-TESTING.md).

## Project layout

```text
index.html, styles.css     UI shell
src/main.js                loop, camera, input, sidebar, minimap, alerts, menus
src/ui/                    render.js · effects.js · audio.js · storage.js
src/core/                  the simulation (no DOM, deterministic)
  rules.js                 every balance number
  game.js                  entities, commands, production, combat, fog, victory
  map.js, mapgen.js        tile grid, symmetric procedural maps
  pathfind.js              A*, smoothing
  ai.js                    skirmish AI
tests/                     node:test suites + support/ (arena helpers, cost-equal fights)
```

## Engineering process

0. [Research](docs/00-RESEARCH.md): genre pillars, techniques, IP boundary
1. [Spec](docs/01-SPEC.md): requirements with IDs
2. [Design](docs/02-DESIGN.md): architecture, tick order, combat, balance, AI
3. [Tasks](docs/03-TASKS.md): traceable task list and backlog
4. Implementation: `src/`
5. [Testing](docs/04-TESTING.md): verification matrix, balance evidence, bugs found
6. [Deploy](docs/05-DEPLOY.md): GitHub Pages, CI

## Credits and license

Inspired by the classic base-building RTS genre. The name, factions, units, art, sound and music
are original; no franchise names or assets are used. Licensed under the GNU GPL v3 (see
`LICENSE`).

## Analytics

Optional, anonymous play counts via [GoatCounter](https://www.goatcounter.com): no cookies and no
personal data. It is off until you set `GOATCOUNTER_CODE` in `src/ui/analytics.js`. Events are
sent when a game starts and when it ends; see the `track(...)` calls in `src/main.js`.
