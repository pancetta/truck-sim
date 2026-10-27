# Truck Sim

A browser game about driving a delivery truck through a city: take orders, load and unload at spots, obey the traffic rules, earn money and rank, and spend it on the truck. UI words are German; this glossary gives the German word where the player sees one.

## Language

### Game and progress

**Sim**:
The headless simulation of the city, the truck, the traffic and the rules; everything the player sees is drawn from its state.
_Avoid_: engine, game loop, world

**Profile**:
The player's lasting progress: money, rank points, distance driven, bought upgrades and visuals. It is what the **Save** stores.
_Avoid_: account, player data

**Save** ("Spielstand"):
The one stored copy of the **Profile** per browser; an unreadable or outdated one starts a fresh **Profile**.
_Avoid_: savegame, slot, autosave (as a noun)

**Rank** ("Rang"):
The player's standing, a **Tier** reached by collecting rank points from deliveries.
_Avoid_: level (that word belongs to **Upgrades**), XP

**Tier**:
One step of the **Rank** ladder with its own title; it unlocks **Upgrade** levels, **Order types** and more traffic.

**Money** ("Kontostand"):
The player's euros, earned by deliveries and spent in the **Werkstatt** or on **Fines**; it never goes below 0.
_Avoid_: balance, cash, credits

**Distance driven** ("Gesamtstrecke"):
The total distance the truck has ever driven, kept in the **Profile**.
_Avoid_: odometer, mileage. Not the same as an **Offer**'s route length.

### Orders

**Offer**:
A proposed delivery the player may accept, with its **Order type**, cargo, **Pickup**, **Drop-off**, pay and **Expected time**.
_Avoid_: job, mission, quest

**Order** ("Auftrag"):
An accepted **Offer** being driven: first to its **Pickup**, then to its **Drop-off**.
_Avoid_: active offer, job

**Order type**:
The kind of delivery: normal ("Normal"), heavy ("Schwerlast"), fragile ("Zerbrechlich"), dock ("Rampe") or fragile dock.

**Pickup** ("Beladestelle") / **Drop-off** ("Entladestelle"):
The **Spots** where an **Order**'s cargo is loaded and unloaded.
_Avoid_: source/target, from/to

**Expected time** ("Soll-Zeit"):
The time an **Order** should take; finishing sooner earns the **Time bonus**.

**Pay lines**:
The parts of a delivery's payment: base pay, **Time bonus** ("Zeitbonus"), fragile premium ("Zerbrechlich-Prämie") and **Dock bonus** ("Rampenbonus").
_Avoid_: reward, payout

**Damage** ("Schaden"):
Harm to fragile cargo from hard braking and **Hits**; it lowers the fragile premium. The truck itself takes no damage.

### Places

**Spot**:
A place in the city where cargo is loaded or unloaded, with a **Zone** on the road beside it.
_Avoid_: location, stop, station (a petrol station will be its own kind of **Spot**)

**Zone**:
The patch of road at a **Spot** where the truck must stand still while loading or unloading.
_Avoid_: area, marker

**Dock** ("Rampe"):
A **Spot** with a **Dock bay** the truck can back into.

**Dock bay**:
The bay of a **Dock**; reversing straight into it at the **Drop-off** earns the **Dock bonus**.
_Avoid_: ramp (in English), loading bay

**Werkstatt**:
The garage where the player buys **Upgrades** and **Visuals**; open only while the truck stands still with no **Order**.
_Avoid_: garage, shop, showroom (the showroom is only its camera)

**Upgrade** ("Technik"):
A bought improvement to how the truck drives (motor, brakes, tyres, suspension, cargo bed), in levels ("Stufe").
_Avoid_: tuning, part

**Visual** ("Aussehen"):
A bought cosmetic item for one slot of the truck: paint, livery, light bar, lucky charm, rims or chrome.
_Avoid_: skin, cosmetic

### Traffic and rules

**AI car**:
A car of the city's traffic, driven by the **Sim**.
_Avoid_: NPC, bot, traffic car

**Police car** ("Polizei"):
An **AI car** on patrol whose presence makes **Rule fines** possible.
_Avoid_: cop, patrol

**Parked car**:
A car standing still at the kerb as an obstacle; it never moves.

**Junction**:
A place where three or more roads meet.
_Avoid_: intersection

**Light junction**:
A **Junction** controlled by traffic lights.

**Crossing**:
A **Junction** without traffic lights, where **Right before left** applies.
_Avoid_: using "crossing" for any junction

**Approach**:
One road leading into a **Junction**, with its own light or sign.
_Avoid_: arm (until the **Road graph**, where **Junction arm** is the term)

**Stop line** ("Haltlinie"):
The line before a **Light junction** where traffic stops on red, a few metres before the signal post (German layout).

**Right before left** ("Rechts vor links"):
At a **Crossing**, traffic yields to vehicles approaching from its right.
_Avoid_: priority to the right, yield right

**Left-turn yield**:
At a **Light junction**, an **AI car** turning left on green waits for oncoming traffic.

**Don't block the box**:
An **AI car** doesn't drive into a **Junction** it can't leave again.

**Junction rule**:
The rule of the next **Junction** ahead, shown on the HUD: "Ampel" or "Rechts vor links".

**Speed limit** ("Höchstgeschwindigkeit"):
The fastest the truck may drive where it is.

**Contact**:
The truck touching an **AI car**; it is made either by the car or by the truck.
_Avoid_: collision (ambiguous), crash, accident (that is the **Fine** reason's player-facing name)

**Hit**:
The truck running into something solid fast enough to cause **Damage**.

**Fine** ("Bußgeld"):
Money taken for breaking a rule or for a **Contact** the truck made.
_Avoid_: penalty, ticket

**Rule fine**:
A **Fine** for breaking a traffic rule, charged only when a **Police car** **Witnesses** it. Today there are two:
the red light (entering a **Light junction** on red, having crossed its **Stop line** on red too, after a short grace
at the start of red) and speeding (over the **Speed limit** by more than a tolerance; at most one
**Fine** per cooldown).

**Witness**:
A **Police car** within range of the truck with a clear line of sight at the moment of a rule break.
_Avoid_: seen by, spotted

### Views and controls

**Chase view** / **Cab view**:
The camera behind and above the truck, and the driver's seat inside the cab ("Kamera" switches them).
_Avoid_: third person / first person

**HUD**:
The overlay showing speed, **Speed limit**, **Junction rule**, gear and money; the cab view shows its own 3D instruments instead.
_Avoid_: dash, dashboard (the dashboard is the cab's 3D one)

**Minimap**:
The small map of the city from above, with **Spots**, the truck and its route.

**Reset to road** ("Zurück auf die Straße"):
Putting a stuck truck back on the nearest free road.
_Avoid_: respawn, teleport

**Autopilot**:
The developer-only driver used to measure performance; never part of play.

### The Monti map (spec #59)

**Monti**:
The city map: the real streets of Rione Monti in Rome, from OpenStreetMap.

**Road graph**:
The city's drivable streets as **Edges** meeting at **Junctions**.
_Avoid_: network, navmesh

**Edge**:
A stretch of street between two **Junctions**, dead ends or **Edge exits**, with one **Road class**, name and width.
_Avoid_: segment, way (OpenStreetMap's word for its raw data)

**Lane**:
One direction of travel along an **Edge**; a one-way **Edge** has one, a two-way **Edge** has two.

**Junction arm**:
One **Edge** meeting a **Junction** on the **Road graph**; a **Junction** may have any number.

**Road class**:
A street's importance from OpenStreetMap (secondary, tertiary, residential, service); it sets the street's width, **Speed limit** and **Priority**.

**Priority**:
Which traffic goes first at a **Junction** without lights: the higher **Road class**, and **Right before left** between equal classes. An **AI car** that has given way for long goes next all the same, so a steady stream can't hold it up for good.

**Edge exit**:
A street leaving the map, where **AI cars** come and go and the truck meets a barrier.

**Spot table**:
The hand-picked list of **Spots** on **Monti**, each with a made-up business name on a real street; a **Dock**'s
**Dock bay** is at the end of a dead-end street or lane, which the truck backs down.

**Start spot**:
The **Spot** where a new game puts the truck, in its lane.

## Relationships

- A **Profile** has one **Rank**; the **Rank**'s **Tier** gates **Upgrade** levels, **Order types** and the amount of traffic.
- An **Offer** becomes an **Order** when accepted; an **Order** has one **Pickup** and one **Drop-off**, both **Spots**.
- A **Dock** is a **Spot** with a **Dock bay**; dock **Order types** drop off at a **Dock**.
- A **Rule fine** needs a **Witness**; a **Fine** for a **Contact** the truck made does not.
- An **Edge**'s **Road class** sets its width, **Speed limit** and **Priority**.
