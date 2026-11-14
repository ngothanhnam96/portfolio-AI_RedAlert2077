# 00 · Research: what makes a classic base-building RTS work

The brief: "based on Red Alert". *Command & Conquer: Red Alert* (Westwood, 1996) is an EA
trademark, and its factions, units, names, art and music are protected. **What can be used is
the genre:** the mechanics and design ideas shared by the whole 1990s base-building RTS family.
This document lists those ideas, the engineering techniques behind them, and the IP boundary.

## Genre pillars (what players expect)

| Pillar | How the classics do it | What this game does |
|--------|------------------------|---------------------|
| **Build-and-place** | A sidebar builds a structure; when ready, you place it near your base | Same: queue → "ready" → place within build radius of your buildings |
| **Harvester economy** | Harvesters gather ore from fields and unload at a refinery, which turns it into credits; fields deplete and slowly regrow | Same loop: crystal ore fields, harvester capacity, unload time, regrowth |
| **Power grid** | Power plants supply power; a deficit slows production and shuts down defences and radar | Same: deficit → production at half speed, turrets and radar offline |
| **Tech tree** | Structures unlock structures and units | 8 structures, 7 units, 3 tiers |
| **Rock-paper-scissors** | Anti-infantry, anti-armour, artillery, armour classes | 4 warheads × 4 armour classes, checked by an automated counter test |
| **Fog of war** | Black shroud for unexplored areas, grey fog for areas not currently seen | Shroud + fog per player, sight radius per unit |
| **Radar minimap** | The minimap needs a radar building and power | Same, a real reason to build a radar |
| **Skirmish AI** | A scripted opponent that builds a base, harvests, defends and attacks in waves | Same, 3 difficulties, playing **through the same command API as the human** |
| **Controls** | Box select, right-click to act, control groups, attack-move, rally points | Same (+ touch fallbacks) |

## Engineering references

- **Fixed-tick deterministic simulation.** Classic RTS engines run game logic at a low fixed rate
  (about 15 Hz) and render faster. A deterministic tick from (seed, commands) is also the basis of
  lockstep multiplayer (Bettner & Terrano, "1500 Archers on a 28.8", GDC 2001). Here: 20 ticks/s,
  seeded RNG, commands applied at tick boundaries, and a **state hash** test proves replays match.
- **Grid A\*** with an octile heuristic, 8 directions and no diagonal corner cutting. Paths are
  smoothed by a line-of-sight pass so units don't zig-zag.
- **Separation steering** (Reynolds, "Steering Behaviors", 1999) keeps groups from stacking on
  one point, plus formation slots around a group's destination.
- **Spatial hashing** for target acquisition and separation, so cost grows with local density,
  not with the square of all units.
- **Symmetric procedural maps:** point-symmetric (180° rotation) terrain gives both players
  identical distances to ore and to each other.

## IP boundary (what is *not* used)

No EA names, factions or units (no Allies or Soviets, no named heroes or signature units), no
art, sprites, sounds or music, and no maps. Everything in this game is original: the setting
(the year 2077, crystal ore), the two factions (**Liên Quân Xanh** and **Phe Đỏ**), the unit
designs, the code-drawn graphics and the synthesised audio. A test fails if names from the
original franchise appear in the game data.
