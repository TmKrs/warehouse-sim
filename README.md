# Warehouse Sim

A 3D warehouse that runs itself. Trucks arrive (some of them late), robots store every box on a shelf and remember where it is, and when an order comes in they pick the boxes and bring them to shipping. You can watch it all live in the browser.

Built in week 2 of "a new AI project every week".

## What you can do

- **Watch** 10 robots with lifts drive the aisles, lift boxes onto shelves 2 to 5 levels high and bring them to the shipping conveyors.
- **Switch views**: Overview, Truck docks, Shipping, Top-down, and **Ride along** (see the warehouse through a robot's eyes).
- **Click** a robot to see its job, or a box to see what it is, where it came from and which order it belongs to.
- **Read the screens** in the hall: the big capacity board and a sign on every rack row.
- **Speed up** time from 1x to 5x, or pause with the space bar.
- **Change the settings** (no code): number of robots, how often trucks and orders arrive, how full to keep the warehouse, day or night look.

## How the "brain" works

All of this is in `src/sim/` and has no 3D code, so it can be tested on its own.

| Part | What it does |
| --- | --- |
| Traffic planner (`pathfinding.js`) | Finds the shortest route with A* and books every cell a robot will use, tick by tick. A route may only use free cells, so robots never crash or block each other head-on. |
| Dispatcher (`sim.js`) | Gives each free robot the best job: the nearest one, with urgent orders and full docks first. |
| Smart storage (`sim.js`) | Popular products go close to shipping and low on the rack, rare ones further away and higher up. |
| Stock list (`sim.js`) | Remembers the exact shelf of every box and always ships the oldest box first. |
| Purchasing (`sim.js`) | Orders trucks for products that run low, and never more than fits, so the warehouse does not overflow. |
| Real life (`sim.js`) | About 3 in 10 trucks are late, orders can arrive for products that are not in stock yet, and every order has a due time. |

## Run it on your computer

You need [Node.js](https://nodejs.org). Then:

```bash
npm start        # opens a small web server on http://localhost:8080
npm test         # runs the warehouse for hours of warehouse time and checks for crashes and jams
```

## Put it online (Vercel, free)

1. Go to [vercel.com/new](https://vercel.com/new) and import this repository.
2. Leave every setting as it is and click **Deploy**.

There is no build step and no API key. Three.js is included in `vendor/` (MIT licence).
