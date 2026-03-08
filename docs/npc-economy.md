[← Back to index](/README.md)

# NPC Economy

> The economy feels alive because of one physical truth: **shipping takes
> time.** A planet consumes goods continuously, but resupply arrives in
> discrete bursts. Between deliveries, prices rise. When a ship arrives,
> prices drop. This sawtooth pattern — not random noise, not scripted
> events — is the heartbeat of the economy. Every NPC hauler is an
> independent actor making greedy decisions based on what they can see.
> There is no fleet coordinator. No central dispatch. Just supply,
> demand, shipping delays, and capitalism.

---

## 1. The Three-Layer Model

The economy is built in layers. Each layer must work before the next
one is turned on. You don't add seasoning to a dish that isn't cooked.

| Layer | What | Status |
|-------|------|--------|
| **Layer 0** | Production + consumption + NPC routes sized for equilibrium | **Must work first** |
| **Layer 1** | Jitter on consumption rates, departure timing, cargo volume | Makes it organic |
| **Layer 2** | Disruptions, anomalies, solar system events | Dramatic moments |

**Layer 0** is the game. If the economy needs disruptions to function,
the baseline is broken. Layer 0 alone should produce healthy sawtooth
oscillation on every commodity that has production, consumption, and
at least one trade route.

**Layer 1** adds variation. Consumption rates drift slightly each tick.
Departure jitter prevents NPCs from moving in lockstep. Cargo volumes
vary based on market conditions. Layer 1 makes the sawtooth irregular
and organic instead of robotic.

**Layer 2** is optional drama. A mining accident halts production.
A demand surge doubles consumption. These are events ON TOP of a
healthy baseline — they create player opportunities and narrative
moments, but they are not load-bearing.

**Right now, the engine runs Layer 0 with Layer 1 jitter built into
the NPC brain (departure jitter and trip time jitter are always on).
Layer 2 disruptions exist but are disabled for baseline validation.**

---

## 2. The Sawtooth

This is the fundamental price pattern. If you understand this, you
understand the entire economy.

```
Fill %
  │
 65├─────╮         ╭─────╮         ╭─────╮
  │      │        ╱      │        ╱      │
  │      │       ╱       │       ╱       │
 50├      │      ╱        │      ╱        │
  │      │     ╱         │     ╱         │
  │      │    ╱          │    ╱          │
 35├      ╰──╱           ╰──╱           ╰──
  │
  └──────┬──────┬─────────┬──────┬──────── Time
         ▲      ▲         ▲      ▲
      delivery  delivery  delivery
```

Between deliveries, consumption drains the market. Fill drops, price
rises. Then an NPC ship arrives and dumps cargo — fill jumps up,
price drops. Consumption resumes draining. Repeat.

The sawtooth emerges naturally from three inputs:

1. **Consumption rate** — how fast the planet eats through stock
2. **Route trip time** — how long between deliveries
3. **Cargo volume** — how much the NPC delivers per trip

These three values determine the shape of the wave:

- **Frequency** = trip time + cooldown. Longer routes = slower waves.
- **Amplitude** = cargo volume relative to capacity. Bigger ships = bigger swings.
- **Baseline** = where fill settles. Determined by the balance between
  consumption rate and total delivery rate across all routes.

### Why Multiple Destinations Matter

One route to one destination makes a simple, predictable sawtooth.
Interesting, but limited.

Spread routes across multiple destinations and the **source planet**
becomes a contested resource:

```
Velkar (produces iron)
  ├── Route → Arctis    (30 min, 15 units — short hop, standard freighter)
  └── Route → Zephyra   (55 min, 22 units — long haul, bulk carrier)
```

Two NPCs pulling from the same source. When both depart close together,
Velkar's stock drops hard — triggering the **source depletion recovery**
behavior (see Section 5). One NPC might be blocked because Velkar
dropped below the 25% safety threshold. It waits. Velkar's production
refills. It goes again.

Because the two routes have different trip times (30 min vs 55 min),
their delivery cycles naturally desynchronize. No two economic cycles
look the same. Add a second commodity (steel from Arctis to Nexara
and Zephyra) and you get interference patterns between the two
pipelines.

This is **emergent gameplay** from simple rules.

### One Route = One Trade Channel

A route represents a **trade lane** between two planets for one
commodity. It is not duplicated for behavior variation. You don't
create two iron routes from Velkar → Arctis at different trip times —
that's one trade channel.

All the behavioral variation (cargo size, departure timing, trip
duration jitter) comes from the NPC brain operating on that single
route. The NPC decides how much to load based on conditions. It
departs at different times based on jitter. Its trip takes ±15%
different each time.

The variety comes from behavior, not from multiplying infrastructure.

---

## 3. The NPC Brain: 6 Rules

Every tick, each idle NPC hauler evaluates whether to depart. The
decision is dead simple — 6 rules evaluated in order. No pathfinding,
no planning, no memory. Just "look at the numbers and decide."

### Rule 0: Emergency Dispatch

```
IF destination fill < 10% → GO IMMEDIATELY, load as much as possible
```

A critically empty market is a guaranteed profit. NPC captains don't
hesitate when a planet is starving — they load up and go. This only
respects cooldown and source safety. Skips margin check and jitter.

Even in an emergency, the NPC is practical: they can't take more than
the source can spare (surplus above 25% safety) or the destination
can hold. They load the maximum of those constraints.

This prevents markets from staying permanently halted at 0%.

### Rule 1: Destination Check (The Most Important Rule)

```
IF destination fill > 65% → SKIP ("market well-stocked")
```

This is what breaks the clockwork. Without it, NPCs always go, prices
stay flat. With it, NPCs wait for consumption to drain the destination
below 65% before resupplying.

The 0.65 threshold means: once an NPC delivers and fills the market
above 65%, ALL NPCs on that route stop. Consumption drains the market.
Eventually fill drops below 65% again, and NPCs resume.

**This IS the sawtooth.** The threshold controls the oscillation:
- Lower threshold (0.55) = NPCs wait longer = bigger price swings
- Higher threshold (0.75) = NPCs go sooner = flatter prices

### Rule 2: Source Safety

```
IF source fill < 25% → SKIP ("protect local supply")
```

Prevents NPCs from stripping their home planet bare. If too many
haulers drain the same source, fill drops below 25% and they ALL
stop — letting the source planet's production catch up.

This creates the **source depletion recovery** cycle: demand pulls
from source → source runs low → NPCs stop → production refills →
NPCs resume.

### Rule 3: Cargo Scaling

A real hauler thinks about three things before loading:

1. **"How much can the source spare?"** — stock above the 25% safety line.
   If the source is at 30%, that's only 5% surplus. The NPC won't buy
   out the remaining shelves.

2. **"How much room does the destination have?"** — empty capacity.
   No point loading 15 units if the destination only has room for 8.

3. **"How much can my ship carry?"** — the route's volume per trip.

Take the smallest of those three as the **ceiling** — the maximum
useful cargo. Then scale by how urgent and profitable the run is:

```
source_surplus = source_stock - (source_capacity × 25%)
dest_room      = dest_capacity - dest_quantity
ceiling        = min(source_surplus, dest_room, ship_capacity)

urgency = 1 - destination_fill    (0 = full, 1 = empty)
greed   = margin / 2              (0 = break-even, 1 = 200%+ margin)
factor  = clamp(urgency × 0.6 + greed × 0.4,  0.15,  1.0)

cargo   = max(MIN_CARGO, ceiling × factor)
```

| Scenario | Source Fill | Dest Fill | Margin | Ceiling | Factor | Cargo |
|----------|-----------|-----------|--------|---------|--------|-------|
| Healthy source, starving dest | 80% | 20% | 50% | 15 (ship) | 58% | ~8.7 |
| Tight source, starving dest | 30% | 20% | 50% | 6.25 (surplus) | 58% | ~3.6 |
| Healthy source, nearly full dest | 80% | 55% | 10% | 15 (ship) | 29% | ~4.4 |
| Both middling | 50% | 45% | 15% | 15 (ship) | 37% | ~5.5 |

The key insight: **source conditions constrain the load.** When a
source planet is running low, the NPC takes less — they can see the
shelves are bare. When the destination is nearly full, they don't
overshoot. The urgency/greed scaling still applies within these
physical constraints.

This creates **variable delivery sizes** that respond to real
conditions — not just destination hunger, but the whole picture.
Two deliveries from the same route will rarely carry the same amount.

### Rule 4: Margin Check

```
IF price margin < 5% → SKIP ("not worth the fuel")
```

NPCs need at least a 5% spread between source and destination price
to justify the trip. This means deliveries only happen when there's
a real price difference — not when both planets are at equilibrium.

### Rule 5: Departure Jitter

```
IF random() < 15% → SKIP ("captain is at the bar")
```

15% chance per tick to just... not go. Even when all conditions are
met. This prevents the **convoy problem** where multiple NPCs all
see the same opportunity and depart simultaneously.

In real markets, not everyone reacts at the same speed. Some captains
are haggling over fuel. Some are sleeping off last night. This rule
simulates that human element.

### Rule 6: Cooldown

```
IF time since last departure < trip duration × 1.2 → SKIP ("turnaround")
```

After completing a trip, the NPC needs turnaround time: docking,
refueling, crew rest. A 60-minute route has a 72-minute cooldown
before the NPC considers another trip.

### Decision Flow

```
NPC is docked and idle
        │
        ▼
  Cooldown elapsed? ─────── NO ──→ WAIT
        │ YES
        ▼
  Dest fill < 10%? ──── YES ──→ EMERGENCY (max available, go now)
        │ NO
        ▼
  Dest fill < 65%? ─────── NO ──→ SKIP (well-stocked)
        │ YES
        ▼
  Source fill > 25%? ────── NO ──→ SKIP (protect source)
        │ YES
        ▼
  Margin > 5%? ────────── NO ──→ SKIP (not profitable)
        │ YES
        ▼
  Random > 15%? ───────── NO ──→ SKIP (jitter delay)
        │ YES
        ▼
  Calculate cargo (source surplus, dest room, urgency, greed)
        │
        ▼
  Cargo > 3 units? ────── NO ──→ SKIP (too small)
        │ YES
        ▼
  ✅ DEPART with cargo + jittered trip time
```

---

## 4. Cargo Locking

When an NPC departs, two values are **locked** for the trip:

1. **Cargo quantity** — removed from source inventory at departure.
   Added to destination inventory on arrival. Not recalculated
   during transit.

2. **Trip duration** — the base trip time ± 15% jitter. A 60-minute
   route might take anywhere from 51 to 69 minutes on any given trip.

This matters because **market conditions change during transit**:

1. Destination is at 30% fill. Two NPCs see the opportunity.
2. NPC A departs with 12 units. NPC B departs 2 minutes later with 11 units.
3. NPC A arrives first. Destination jumps to 42%. Good delivery.
4. NPC B arrives 5 minutes later. Destination is now 40% (consumed a bit).
   Still a useful delivery.
5. But if three more NPCs departed? The third and fourth arrivals
   might find the market already at 60%+. They delivered, but the
   margin evaporated during transit.

This is the **convoy problem** — multiple NPCs see the same signal,
all commit, and collectively overshoot. It creates temporary
oversupply spikes and price crashes. This is realistic and desirable.

---

## 5. Emergent Behaviors

None of these behaviors are programmed. They emerge from the 6 rules:

### 5.1 Natural Sawtooth
Consumption drains → fill drops below 65% → NPCs depart → delivery
arrives → fill jumps above 65% → NPCs stop → consumption drains
again. This is the fundamental oscillation.

### 5.2 Convoy Oversupply
Multiple NPCs see the same opportunity → all depart (staggered by
jitter) → first arrivals profit → later arrivals hit saturated
market → temporary oversupply → prices crash briefly.

### 5.3 Source Depletion Recovery
Too many NPCs drain the source → source fill drops below 25% →
all NPCs stop → source production catches up → NPCs resume. This
creates a slow breathing pattern at the source planet.

### 5.4 Variable Amplitude
Short routes deliver small, frequent loads = gentle oscillation.
Long routes deliver big, infrequent loads = dramatic swings.
Overlapping routes create complex, non-repeating patterns.

### 5.5 Margin-Chasing
When a planet is desperate (very low fill), margins are huge, so
NPCs load maximum cargo. As the planet recovers, margins shrink,
NPCs load lighter. Delivery sizes naturally taper off — big loads
when it matters, small loads when it doesn't.

---

## 6. Route Design

Routes are **infrastructure** — authorized trade lanes between planets.
NPC behavior is **how ships act** on those lanes. These are separate
concepts. You don't multiply routes for behavioral variation. You
design routes based on geography, planet roles, and commodity flows.

### Routes Are Trade Channels

Each route is one trade channel: one commodity, one source, one
destination. Trip time is the **distance** between the two planets.
Volume is the **character** of the trade lane — what kind of ship
makes sense for that run.

```
          Zephyra (research, remote)
         ╱              ╲
       ╱   55 min         ╲  50 min
     ╱                      ╲
  Velkar (mining)           Nexara (trade hub)
     ╲                         │
      ╲  30 min                │ 15 min (almost a moon)
        ╲                      │
          Arctis (industrial) ─╯
```

| Route | Trip | Volume | Character |
|-------|------|--------|-----------|
| Velkar → Arctis | 30 min | 15 | Standard ore freighter. Well-traveled lane, short hop. |
| Velkar → Zephyra | 55 min | 22 | Long haul to the research station. Bigger ship to justify the trip. |
| Arctis → Nexara | 15 min | 10 | Supply shuttle. They're neighbors. Small fast ship, frequent hops. |
| Arctis → Zephyra | 50 min | 20 | Long haul to the research outpost. Bigger ship, less frequent. |

You send a shuttle on a 15-minute hop and a bulk carrier on a 55-minute
run. That's just logistics. The volume isn't calculated from a formula —
it's set by what makes sense for the trade lane.

### Sizing for Equilibrium

The goal is total delivery capacity that roughly matches total
consumption, so markets oscillate around a stable midpoint.

The NPC brain handles the throttling automatically. You don't need
to calculate exact delivery rates. Set production at roughly 1.5-2×
the sum of all consumption rates. The destination check (Rule 1)
ensures NPCs only go when needed.

If a market trends toward empty: add production or increase route
volume. If it trends toward full: add consumption or reduce production.

### Example: Iron Pipeline

```
Goal: Organic iron market at Arctis + Zephyra
      Source: Velkar (mining planet)

Production:   set_production_rate(velkar, iron, production=1.5)
Consumption:  set_production_rate(arctis, iron, consumption=0.4)
              set_production_rate(zephyra, iron, consumption=0.2)

Routes:
  create_route(iron, velkar→arctis, 30min, 15 units)
  create_route(iron, velkar→zephyra, 55min, 22 units)

Expected behavior:
  - Arctis drains at 0.4/tick. Drops below 65% → NPC departs → 30 min later, delivery.
  - Zephyra drains at 0.2/tick (slower). Drops below 65% → NPC departs → 55 min later, delivery.
  - Both NPCs pull from Velkar. When both go at once, Velkar stock dips.
  - Velkar refills at 1.5/tick — enough to feed both routes.
  - The two routes have different cycle times, so they naturally desynchronize.
```

---

## 7. Tuning Constants

All NPC behavior is controlled by 9 constants in
`worker/src/economy/trade-routes.ts`:

| Constant | Value | What It Controls |
|----------|-------|-----------------|
| `DEST_FILL_SKIP` | 0.65 | **Primary oscillation control.** Lower = bigger swings. |
| `DEST_FILL_EMERGENCY` | 0.10 | Emergency dispatch threshold. |
| `SOURCE_FILL_PROTECT` | 0.25 | Source depletion safety. Lower = more aggressive. |
| `DEPARTURE_JITTER` | 0.15 | Convoy prevention. Higher = more desync. |
| `TRIP_TIME_JITTER` | 0.15 | Delivery spread. Higher = more arrival variation. |
| `MIN_MARGIN` | 0.05 | Minimum profitability. Higher = fewer but fatter trips. |
| `MIN_CARGO` | 3 | Minimum load to justify departure. |
| `URGENCY_WEIGHT` | 0.6 | How much destination emptiness affects cargo size. |
| `GREED_WEIGHT` | 0.4 | How much margin affects cargo size. |

### Tuning Guide

**Economy too flat (no visible price variation):**
- Lower `DEST_FILL_SKIP` (e.g., 0.55) — NPCs wait longer before going
- Increase consumption rate — market drains faster between deliveries
- Reduce number of routes — fewer deliveries = bigger drain between them
- Reduce `BASE_CARGO` — smaller deliveries = less price recovery per trip

**Economy too volatile (permanent crisis / markets crashing):**
- Raise `DEST_FILL_SKIP` (e.g., 0.75) — NPCs respond sooner
- Increase production at source — more headroom for NPC departures
- Add more routes — more delivery capacity overall
- Increase `BASE_CARGO` — bigger deliveries stabilize markets faster

**Convoy problem too severe (massive oversupply spikes):**
- Increase `DEPARTURE_JITTER` (e.g., 0.25) — spread departures more
- Increase `TRIP_TIME_JITTER` (e.g., 0.25) — spread arrivals more
- Use routes with different trip times — natural desynchronization

**Markets permanently draining to zero:**
- Total delivery rate is too low for the consumption rate
- Add more routes or increase volumePerTrip
- Or reduce consumption rate

**Markets permanently stuck at 100%:**
- Production is too high relative to consumption + exports
- Reduce production rate
- Add consumption on more planets
- Add routes FROM this planet TO consumers

---

## 8. Setting Up a Commodity (Step by Step)

This is the practical guide for configuring a working commodity
pipeline from scratch.

### Step 1: Choose the Topology

Decide which planets produce and which consume based on their roles:
- **1 primary producer** with a strong production rate
- **2-3 consumers** with moderate consumption rates
- **1 route per (commodity, source, destination) pair** — one trade channel each

### Step 2: Set Production

```
set_production_rate(velkar, iron, production=1.5)
```

Start with a production rate that can keep up with total consumption
across all consumers. Rule of thumb: production should be 1.5-2× the
sum of all consumption rates.

### Step 3: Set Consumption

```
set_production_rate(arctis, iron, consumption=0.4)
set_production_rate(zephyra, iron, consumption=0.2)
```

Consumption is what creates demand. Without it, production just fills
the planet to 100% and sits there.

### Step 4: Create Routes

```
create_route(iron, velkar→arctis, 30min, 15 units)
create_route(iron, velkar→zephyra, 55min, 22 units)
```

One route per trade channel. Trip time = distance between planets.
Volume = what makes sense for that lane (shuttle for short hop, bulk
carrier for long haul). Each route is an independent NPC actor.

### Step 5: Observe

```
inspect_commodity(arctis, iron)    — health check
query_history(arctis, iron)        — watch the sawtooth develop
get_event_log(iron)                — see NPC departures/arrivals
query_routes(commodity=iron)       — check route activity + margins
```

Give it 30-60 minutes for the first delivery cycle. The sawtooth
should be visible in the price history within 1-2 hours.

### Step 6: Adjust

If the market is draining too fast, reduce consumption or increase
route volume. If it's stuck at full, add consumption or reduce
production. The NPC brain handles all the behavioral variation —
cargo sizes, departure timing, trip jitter.

The economy is a live system. Adjust, observe, adjust again.

---

## 9. What's NOT Built Yet

These features are described in the architecture vision but are not
implemented. Do not build them until Layer 0 is fully validated:

- **Inter-region trade** — queues connecting separate EconomyRegion DOs
- **Dynamic route creation** — NPCs discovering new trade opportunities
- **NPC memory** — captains remembering bad trips and becoming cautious
- **Fleet coordination** — limited communication between NPCs at port
- **Fuel costs** — longer routes costing more, affecting margin calculation
- **Space weather** — named events affecting trip duration (currently
  modeled as ±15% random jitter)
- **Multiple ship patterns per route** — cycling between different
  ship sizes on the same lane

---

## 10. Source Files

| File | What It Does |
|------|-------------|
| `worker/src/economy/trade-routes.ts` | NPC brain — all 6 rules, cargo calculation, trip jitter |
| `worker/src/economy/pricing.ts` | Sigmoid price curve, external export drain |
| `worker/src/economy/disruptions.ts` | Disruption modifiers (Layer 2, currently disabled) |
| `worker/src/economy-region.ts` | Tick engine, state management, API handlers, warmup |
| `worker/src/data/commodities.ts` | 20 commodity definitions |
| `worker/src/data/planet-economies.ts` | 4 planet identities |

For the technical details of the tick engine, SQLite schema, MCP tools,
and deployment, see [Economy Engine](./economy-engine.md).
