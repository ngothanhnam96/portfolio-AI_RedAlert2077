# 04 · Testing and spec verification

```bash
npm test          # node --test, no dependencies · 71 tests, 18 suites, ~17 s
```

## Verification matrix

Every requirement in [01-SPEC](01-SPEC.md) and the evidence that proves it. **Auto** = runs in
CI on every push. **E2E** = headless Edge driven by real mouse events (see below).

| ID | Requirement | Evidence | Kind | Result |
|----|-------------|----------|------|--------|
| FR-1 | Skirmish setup | Menu → start with seed 4242 / Thường; seed shown on the pause and end screens | E2E | ✅ |
| FR-2 | Procedural maps | `mapgen.test.js`: deterministic, point-symmetric terrain and ore, connected bases, no pockets, all ore reachable, clear base area (30 seeds × 2 sizes) | Auto | ✅ |
| FR-3 | Economy | `economy.test.js`: free harvester; **ore removed = credits + cargo exactly**; ≥ 1400 credits in 2 min from one harvester; docks queue; regrowth to the cap | Auto | ✅ |
| FR-4 | Construction | `economy.test.js`: cost and exact build time, one at a time, placement rules (radius, ore, units, structures, owner), place blocks tiles, cancel refund, sell 50 %, HQ loss refund. E2E: build → ghost → place by mouse | Auto + E2E | ✅ |
| FR-5 | Power | Deficit → exactly 2× build time; radar needs power; turret offline without power (`combat.test.js`) | Auto | ✅ |
| FR-6 | Production | Queue of 5, in order, spawn near producer, walk to rally, cancel refund, pause without producer, tech-tree gating. E2E: infantry tab queue | Auto + E2E | ✅ |
| FR-7 | Units/structures | Complete stats for every unit, multiplier for every warhead × armour | Auto | ✅ |
| FR-8 | Combat | Idle units engage in range, projectile flight time, artillery never fires inside min range and splash spares friends, move vs attack-move, fight back, victory | Auto | ✅ |
| FR-9 | Movement | A* matches Dijkstra on 40 random maps, no corner cutting, closest-reachable fallback, smoothing keeps line of sight; detour time ≤ 1.5× ideal; 12-unit formation without overlap; **no unit ever on rock/water/structure in a full AI game** | Auto | ✅ |
| FR-10 | Fog of war | Sight radius, explored persists, hidden enemies, structures seen when any tile is visible, cannot attack the unseen | Auto | ✅ |
| FR-11 | Radar | Radar + power turns on the minimap (`radar-off` hidden) | Auto + E2E | ✅ |
| FR-12 | AI | Core base within 4 min with power positive ≥ 95 % of the time; legal, non-boxed placement; defeats a passive player; replaces harvesters; emergency sell when broke; growing waves | Auto | ✅ |
| FR-13 | Controls | E2E: real mouse box-drag selects 4 units, right-click gives 4 move orders, placement by click; touch tools shown on phones | E2E | ✅ |
| FR-14 | Victory | `combat.test.js`: defeat, winner, frozen commands. E2E: "🏆 CHIẾN THẮNG" with stats table | Auto + E2E | ✅ |
| FR-15 | Pause / speed / sound | E2E: pause panel "Tạm dừng"; speed ×2 used throughout the E2E | E2E | ✅ |
| NFR-1 | Static, no assets | Repo has no image or audio files. `index.html` + modules only | Review | ✅ |
| NFR-2 | Pure core | `src/core` imports no DOM. All core tests run in Node | Auto | ✅ |
| NFR-3 | Determinism | `game.test.js`: same seed + scripted commands → 12 identical hashes over 3000 ticks; AI vs AI replays identically; another seed differs | Auto | ✅ |
| NFR-4 | Balance | `balance.test.js`: counter triangle, swap-sides check, Khó beats Dễ from both sides, Thường beats Dễ, Khó beats Thường in ≥ 5/6, mirror matches end in < 35 min on both sizes | Auto | ✅ |
| NFR-5 | Fair maps | Symmetry + equal ore near each base (≥ 35k each) for 60 maps | Auto | ✅ |
| NFR-6 | Performance | 200-unit battle < 5 ms per tick (budget 50 ms) | Auto | ✅ |
| NFR-7 | Responsive | E2E desktop 1280 × 800, phone landscape 844 × 390, phone portrait 390 × 844: 0 px horizontal overflow, no console errors | E2E | ✅ |
| NFR-8 | CI / Pages | `.github/workflows/ci.yml` (Node 20/22/24), `pages.yml` | Config | ✅ |
| NFR-9 | Original IP | `game.test.js` scans every `src` file + `index.html` for franchise names | Auto | ✅ |

## Balance and AI evidence

Cost-equal fights (`tests/support/fight.js`, open field, both sides attack-move):

| Matchup | Cost | Winner keeps |
|---------|------|--------------|
| 10 riflemen vs 4 rocket troopers | 1000 / 1000 | 90 % |
| 6 rocket troopers vs 2 Báo | 1500 / 1400 | 57 % |
| 2 Báo vs 14 riflemen | 1400 / 1400 | 71 % |
| 2 scouts vs 7 riflemen | 700 / 700 | 37 % |
| 5 rocket troopers vs 1 Voi | 1250 / 1200 | 40 % |

AI ladder from the development matrix (28 games, small map): Khó and Thường beat Dễ 16/16 from
both slots, Khó beats Thường 7/8, Thường mirrors split 2–2. Games end in 4–15 minutes, with
even Khó mirrors up to about 28 minutes.

## Browser end-to-end check

Headless Edge over the DevTools protocol, using `Input.dispatchMouseEvent` for real pointer
events (drag, right-click, placement clicks), on seed 4242 against Thường:

| Step | Result |
|------|--------|
| Menu shows over a live AI-vs-AI demo battle | ✅ |
| Order power plant from the sidebar (credits 3000 → 2700), wait, enter placement, ghost shown, click to place | ✅ |
| Drag a selection box over the starting squad → 4 selected → right-click → 4 `move` orders | ✅ |
| Refinery placed → free harvester appears; 2 riflemen queued from the infantry tab | ✅ |
| Radar + power → minimap on | ✅ |
| Pause panel, resume; enemy removed → victory screen with stats | ✅ |
| Phone landscape and portrait: sidebar laid out, touch tools visible, no overflow | ✅ |
| Console errors / exceptions | none |

## Found by testing (and fixed)

| Found by | Problem | Fix |
|----------|---------|-----|
| AI-vs-AI smoke run | Both AIs lost their harvesters with < 1000 credits and the game stalled forever | Harvester priority, emergency selling, all-in when broke |
| AI matrix | Easy beat Hard: the map ran out of ore at minute 8, so Hard's better economy was worthless | Three richer fields per side, faster regrowth |
| AI matrix | Hard as player 2 lost to Normal; mirrors favoured player 1 | Alternate processing order per tick; Hard gets a 3rd refinery and fewer turrets |
| Stalemate case | Hard banked $30k because queues were capped at 2 and extra factories did nothing | Producer speed bonus, deeper queues when rich, surplus production buildings |
| `ai.test.js` emergency scenario | The AI sold a building and immediately rebuilt it from its build order | All spending pauses until a harvester is queued |
| `balance.test.js` | Riflemen beat tanks and scouts lost to riflemen (triangle broken) | Cannon splash and anti-infantry multiplier, weaker bullets against armour, tougher scouts |
| `mapgen.test.js` | An ore field inside a rock pocket was deleted, so one side had less ore (medium, seed 23) | Corridors from each field to the base before cleanup |
| `movement` review | The stuck counter was reset on every re-path, so "give up" never triggered | Keep the count across re-paths |
| Combat tests | Test dummies had no passive stance | A real **hold** stance (`G`), with a hold-fire option |
| E2E screenshots | The radar message split into pieces; the phone-landscape sidebar squashed its panels | Wrap the text; `flex-shrink: 0` on sidebar panels |

Test mistakes that were fixed in the tests, not the game: an optimal 7-step detour asserted as
"> 7 steps", a nearest-tile distance of 2 asserted as ≤ 1.5, a placement map that put ore under
the "valid" spot, and an artillery test that forbade the correct back-off-then-fire behaviour.

### Notes on the headless harness

Three browser-automation issues made the game look frozen. None were game bugs:
- Headless Edge on Windows marks a page `hidden` after a few seconds. The game auto-pauses on
  hidden pages, a feature (FR-15), and animation frames stop.
- Windows occlusion detection throttles the headless window.
- A synthetic mouse move sent with `buttons: 4` looks like a held middle button.

The harness uses focus emulation, `Page.bringToFront`, `--disable-features=CalculateNativeWinOcclusion`
and `buttons: 0` for plain moves.
