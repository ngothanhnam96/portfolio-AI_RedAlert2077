# 02 · Design (plan + analysis)

## Architecture

```text
index.html ─► src/main.js   menu demo · fixed-step loop · camera · input · sidebar · minimap · alerts
                 │  game.command(player, cmd)     ▲ game.takeEvents()          src/ui/
                 ▼                                │                            render.js   canvas renderer
            src/core/game.js ─ the simulation (20 ticks/s, deterministic)      effects.js  particles/tracers
                 ├─ mapgen.js   symmetric procedural maps (+ map.js grid)      audio.js    WebAudio sfx + music
                 ├─ pathfind.js A* + smoothing                                 storage.js  settings
                 ├─ ai.js       skirmish AI (same command API as the player)
                 └─ rules.js    every balance number
```

`src/core/*` has no DOM and no `Math.random`. The UI renders the game at 60 fps and steps it
with a fixed-timestep accumulator (×1, ×1.5, ×2). Unit positions are interpolated between ticks.
Everything a player can do (move, attack, build, place, sell, rally, hold…) is a
`command(playerId, cmd)` that returns `{ ok, reason }`. **The AI uses exactly the same entry
point**, so it cannot cheat by touching the state directly.

## Simulation tick (order matters for determinism)

```text
tick += 1 → rebuild spatial hash → production (both players) → AI think (alternating order)
→ update units and structures (alternating order) → projectiles → ore regrowth (every 6 s)
→ remove the dead → fog of war (every 4 ticks) → victory check
```

The processing order alternates every tick (0,1 / 1,0 and forward / reverse entity order), so
neither player always shoots first. Measured: the slot-1 advantage in mirror matches disappeared
after this change.

## World

- Tiles: grass, rock, water. Crystal ore lives on grass and regrows 25 credits every 6 s up to
  each tile's original amount.
- **Maps** are value-noise terrain on one half, rotated 180° onto the other. Bases get a cleared
  radius. A carved corridor is added if the bases are not connected, and each ore field gets a
  corridor to its base if needed. Unreachable land becomes rock. Each side gets three fields: near
  the base, a flank field and a contested middle field. That is about 100k credits per map.
- **Structures** block their tiles. Placement needs clear grass, no ore, no units, and a gap of at
  most 4 tiles to one of your own structures.

## Movement

A* over the tile grid (8 directions, octile heuristic, no diagonal corner cutting). It falls back
to the reachable tile closest to the goal, and the path is smoothed with line-of-sight checks.
A group order spreads units over distinct free tiles (formation slots). Soft separation, capped
at 0.08 tiles per tick, stops stacking. Units re-path after 1 s without progress and give up
after 3 attempts or when within 1.6 tiles of the goal.

## Combat

Damage = weapon damage × `WARHEADS[warhead][armour]`. Bullets hit instantly. Rockets and cannon
rounds fly and track their target. Artillery shells (`arc`) fly to the spot the target was at,
so they can be dodged. Splash falls off to 50 % at the edge and never hurts friends.

| Stance / order | Behaviour |
|----------------|-----------|
| Idle | Shoots enemies within range + 2, chases a little, returns to its guard spot. Fights back when hit. |
| Move | Ignores enemies |
| Attack-move | Engages anything within range + 2 on the way, then resumes the path |
| Attack | Chases a specific visible target (re-paths every 1.5 s) |
| Hold (`G`) | Never moves; fires in range (or holds fire) |

Target priority: things that shoot back first, then the closest.

## Units and structures (from `rules.js`)

| Unit | Cost | HP | Speed | Weapon | Role |
|------|------|----|-------|--------|------|
| Lính súng trường | 100 | 60 | 1.3 | bullet 10 / 1.0 s, r4 | anti-infantry |
| Lính tên lửa | 250 | 55 | 1.1 | rocket 40 / 2.2 s, r5 | anti-armour |
| Xe trinh sát | 350 | 200 | 3.2 | bullet 9 / 0.5 s, r4.5 | scout, infantry hunter |
| Xe tăng Báo | 700 | 360 | 2.0 | cannon 34 / 1.6 s, r4.8, splash 0.6 | main tank |
| Xe tăng Voi | 1200 | 750 | 1.35 | cannon 60 / 2.0 s, r5.2, splash 0.7 | heavy tank (tech) |
| Pháo tự hành | 900 | 170 | 1.4 | shell 80 / 4.0 s, r9.5 (min 3), splash 1.4 | siege (tech) |
| Xe khai thác | 1000 | 650 | 1.4 | — | 700 credits per load |

Structures: HQ (+20 power, builds structures), power plant (+100), refinery (free harvester),
barracks, war factory, radar (minimap), turret (cannon, offline on low power), tech centre.
**Extra producers** speed up production by +75 % each, counted up to 3.

## Balance targets and how they were reached

| Target | Measured (cost-equal fights, value left to the winner) |
|--------|----------------------------------------------------------|
| Riflemen beat rocket troopers | 90 % |
| Rocket troopers beat Báo tanks | 57 % |
| Báo tanks beat riflemen | 71 % |
| Scouts hunt riflemen | 37 % |
| Rocket troopers beat the Voi | 40 % |

The first measurement broke the triangle: riflemen beat tanks (they kept 59 %). Fixes: tank
cannons got a small splash and a higher multiplier against infantry, bullets got weaker against
armour, and scouts got more hp. The balance tests now fail if any counter flips.

## AI

Every think (Dễ 3 s, Thường 1.5 s, Khó 0.75 s) the AI:
1. **Places** any finished structure. The search keeps a one-tile lane around buildings, puts
   refineries near ore and turrets toward the enemy.
2. **Builds** from a fixed order: power, refinery, barracks, power, factory… Before any consumer
   it checks that power stays positive. When the order is done and it is rich, it adds production.
3. **Economy first:** it keeps 1–2 harvesters per refinery and saves for a missing one. With no
   harvester and no money, it **sells** its least useful building (tech, radar, turret, barracks,
   spare power plant) and pauses all other spending until a harvester is queued.
4. **Trains** a weighted mix (60/40 rifle/rocket; tanks, plus heavy and artillery with tech).
   Queues get deeper as its bank grows.
5. **Defends** (Thường/Khó) when its base or a harvester is hit.
6. **Attacks** when the home army reaches the wave size (Dễ 5 → Khó 8, growing every wave). Wave
   units that arrive push on to the next nearest enemy structure. With a dead economy it throws in
   everything.

Bugs found by simulation and fixed: an economy death spiral when harvesters died with < 1000
credits; maps running out of ore so a better economy meant nothing; a $30k bank because queues
were capped at 2; a sell-and-rebuild loop during the emergency.

## Rendering

Terrain is pre-rendered once into an offscreen canvas (grass shading, rock facets, water ripples,
shadows, shorelines). Ore crystals, structures, units, projectiles and effects are drawn each
frame, only inside the view. Fog of war uses one pixel per tile, scaled up with smoothing for
soft edges: black for unexplored, 50 % for not visible now. Enemy structures stay drawn once
explored, and enemy units only while visible. The minimap reuses the terrain cache and needs a
powered radar.

## Risks

| Risk | Mitigation |
|------|------------|
| Unfair or broken maps | Symmetry, connectivity and ore-equality tests over 30 seeds × 2 sizes |
| A balance change silently breaks the game | Counter-triangle tests, AI ladder over seeds, stalemate test |
| AI stalls the game | Stalemate test + emergency sell + all-in when broke |
| Desync if multiplayer is added | Determinism test (hash per 250 ticks, scripted human + AI) |
| Units clipping into rock or buildings | A full AI-vs-AI game checked every 10 ticks |
| Performance with big armies | Spatial hash; 200-unit battle test < 5 ms per tick (measured ≈ 0.1–0.6 ms) |
| IP | Original names/art/audio; a test bans franchise names in all source files |
