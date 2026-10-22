# Warehouse Sim

A 3D supply chain that runs itself. Factories make boxes, trucks bring them to a warehouse where robots store every box on a shelf and remember where it is, and more trucks carry them on to stores where customers buy them. You can watch it all live in the browser.

Built in week 2 of "a new AI project every week".

## The supply chain

- **3 to 8 factories** (setting) each make a few of the 12 products on two production lines. Zoom in and the roof opens: workers run the machines and forklifts carry pallets from the lines to the racks and out to the waiting truck.
- **The warehouse orders from the factories** when stock runs low, in full truck loads, and never more than fits.
- **3 to 8 stores** (setting) sell to customers from 8:00 to 20:00, busiest at lunch and after work, and order from the warehouse when shelves run low.
- **A new map on every start**: factories and stores sit at random spots around a ring road, facing it from any side. Add `?seed=123` to the address to get the same map again.
- **Trucks** drive on the right, keep their distance, take turns at crossings, corners and docks (one truck at a time, and only when there is room on the far side), back up to docks, and only leave when there is a reason: a full load, or a store waiting too long. They never drive through each other.
- **The day clock** runs 30 times faster than the robots: one real minute is half an hour.

## What you can do

- **Watch** 10 robots with lifts drive the aisles, lift boxes onto shelves 2 to 5 levels high and bring them to the shipping conveyors.
- **Switch views**: Region, Factories, Warehouse, Truck docks, Shipping, Top-down, Stores, and **Ride along** (see the warehouse through a robot's eyes).
- **Click** a truck to see its route and cargo and follow it, a robot to see its job, or a box to see what it is and which store ordered it.
- **Read the screens** in the hall: the big capacity board and a sign on every rack row.
- **Speed up** time from 1x to 5x, or pause with the space bar.
- **Change the settings** (no code): robots, factories, stores, customers per hour, how full to keep the warehouse, day or night look.

## How the "brain" works

All of this is in `src/sim/` and has no 3D code, so it can be tested on its own.

| Part | What it does |
| --- | --- |
| Traffic planner (`pathfinding.js`) | Finds the shortest route with A* and books every cell a robot will use, tick by tick. A route may only use free cells, so robots never crash or block each other head-on. |
| Dispatcher (`sim.js`) | Gives each free robot the best job: the nearest one, with urgent orders and full docks first. |
| Smart storage (`sim.js`) | Popular products go close to shipping and low on the rack, rare ones further away and higher up. |
| Stock list (`sim.js`) | Remembers the exact shelf of every box and always ships the oldest box first. |
| Supply chain (`world.js`, `map.js`) | Factories, stores, purchasing, store orders, the road network and every truck on it. |
| Real life | Store orders can arrive for products that are not in stock yet, and every order has a due time. |

## Tests

- `npm test`: the warehouse, the supply chain (3 days on four maps, fails if two trucks ever touch), every random map's roads, and the factory floors.
- `npm run backtest`: a longer check on many random maps and settings, 5 simulated days each.

## Run it on your computer

You need [Node.js](https://nodejs.org). Then:

```bash
npm start        # opens a small web server on http://localhost:8080
npm test         # runs the warehouse and the whole chain for days and checks for crashes, jams and overflow
```

## Put it online (Vercel, free)

1. Go to [vercel.com/new](https://vercel.com/new) and import this repository.
2. Leave every setting as it is and click **Deploy**.

There is no build step and no API key. Three.js is included in `vendor/` (MIT licence).
