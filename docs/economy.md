# The economy run

`scripts/economy.js` plays the game headless: the Sim on the real Monti map, driven by the autopilot (`src/autopilot.js`) as a simple player, for hours of play (`profile.timePlayed`) on several seeds. It reports what the economy in `src/tables.js` does over that time, for tuning it (#58).

```bash
node scripts/economy.js 4 1,2,3,4            # 4 h of play on seeds 1–4, about 20 s a seed
node scripts/economy.js 4 1,2,3,4 careless   # the same player, but it never refuels: the tow is its only fuel
```

`scripts/economy.test.js` runs it briefly in `npm test` to check for a soft lock: from 0, 50 or 100,000 €, with a dry tank and an exhausted driver, the careless player keeps delivering and getting paid.

## The player

- **Orders:** it takes the first offer. Offers are random, so its deliveries are the average one.
- **Fuel:** below 30 % of the tank, if it can pay for a full one, it refuels at the nearest station by road, with a snack if the driver is below 70 % energy and it keeps 300 €.
- **Rest:** when tired it drives to the nearer of home (sleep, free) and the restaurant (a meal, if it can pay).
- **Upgrades:** whenever it may and can afford an upgrade level, keeping 300 €, it drives home and buys the cheapest ones.
- **Driving:** it drives like the autopilot: at the street's limit, waiting only for cars ahead. It ignores red lights, give-way and stop signs, so its rule fines are a careless driver's. It also drives into AI cars more often than a player would (collision fines).
- **Stuck:** where the autopilot can't turn, it jumps on along its route. A leg it can't finish in 10 minutes jumps into the target's zone (a dock's bay) and counts as a rescue (a handful in 4 h).

A human drives slower and less directly than the autopilot, so their money and rank per hour are lower. The shares (costs against pay, deliveries per tank) carry over better than the rates.

## What it reports

Per seed:
- money from start to end, and its lowest;
- deliveries per hour;
- pay per hour by line, and running costs per hour (fuel, food, tows and fines) with their share of the pay;
- litres per delivery, and how many deliveries the base tank lasts;
- stops per hour (fuel, snacks, meals, sleeps);
- tows and fines per hour, fines by reason;
- money at each full hour;
- when each rank tier was reached, and when each upgrade level was bought.

## Tuning, October 2026 (#58)

Averages over seeds 1–4, 4 h each, on main after #48–#55 (before) and with #58's tables (after). The per-seed numbers are in the closing comment of #58.

| | before | after |
|---|---|---|
| deliveries / h | 11.6 | 11.6 |
| pay / h | 4,457 € | 4,344 € |
| night line / rain line | 4.8 % / 2.6 % of pay | 4.4 % / 3.4 % of pay |
| running costs / h | 1,346 € (30 % of pay) | 1,428 € (33 % of pay) |
| fuel / h | 984 € in 2.5 stops | 964 € in 2.5 stops |
| litres / delivery, deliveries per 400 L tank | 86 L, 4.7 | 87 L, 4.6 |
| food / h | 87 € | 126 € |
| fines / h: collision, rule fines | 216 €, 44 € | 207 €, 132 € |
| pay less running costs / h | 3,111 € | 2,916 € |
| careless (never refuels): tows / h, pay less running costs / h | 9.1, 1,778 € | 9.0, 1,637 € |
| rank tiers 1 / 2 / 3 / 4 reached at | 0.2 / 0.6 / 1.1 / 2.0 h | 0.4 / 1.5 / 3.5 / 6.6 h (tier 4 from 10 h runs, seeds 1–2) |
| upgrades bought in 4 h | 9,800–11,800 € | 9,800–11,800 € |

Over 10 h (seeds 1–2, after), the player buys an upgrade level every 30–60 minutes: 25,000–29,000 € in 13–14 of the 18 levels, the rest about 9 h later. It keeps about 2,900–3,200 € an hour after running costs, all 10 h.

What changed, and why:
- **Rank tiers** 30 / 80 / 160 / 300 → 60 / 200 / 500 / 1,000 points. Before, the top tier came after 2 h, while the upgrades it unlocks take 10 h or more to afford. Now the tiers come with the upgrade levels they unlock.
- **Rule fines** (red light, give-way, stop) 100 → 150 €, about 40 % of an average delivery. They need a police witness, so even the careless player meets one only about once an hour, and they took barely 1 % of its pay. Speeding (50 €, at most every 30 s) and collision (150 €) stay.
- **Rain line** 15 → 20 %: it's rarer than night (3 % of pay against 4–5 %) and the driving is harder. The night line stays 15 %.
- **Food:** snack 15 → 20 €, meal 40 → 60 €. Food was 2 % of pay, too little to notice; now a meal is about a sixth of a delivery. Sleep at home stays free, so food never blocks a player.
- **Kept:** fuel use (a 400 L tank lasts 4.6 average deliveries, inside 4–5), the fuel price (fuel is about 22 % of pay), the tow fee (250 €: the careless player pays about half its earnings in tows, so running dry clearly costs), energy drain (20 minutes of driving), and the upgrade prices (a level every 30–60 minutes).
