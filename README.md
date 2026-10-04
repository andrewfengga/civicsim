# CivicSim — Fire/EMS Station Coverage for Georgia's 7th Congressional District

CivicSim shows how well fire/EMS stations cover Georgia's 7th Congressional
District, using real road travel times and real Census population data. Click
anywhere on the map to test a new station location; the coverage numbers
update instantly. An optimizer recommends the best spots for a set number of
new stations.

**Live site:** https://andrewfengga.github.io/civicsim/

## What's in here

```
pipeline/   Python — builds the study-area data from OpenStreetMap + Census
web/        TypeScript — travel-time engine (Dijkstra) and the browser map app
docs/       The built site, served by GitHub Pages
data/       Generated graph data (civicsim_graph.json is committed; the rest is regenerable)
```

The split is deliberate: heavy geodata work happens once, offline, in Python.
Everything a user does in the browser runs against a small pre-built graph,
with no server round-trip.

## Run the site locally

Needs Node.js (for the TypeScript build) and Python 3 (for a local web server).

```bash
cd web
npm install
npm run build:web          # compiles TypeScript and copies the data next to the page
cd ..
python -m http.server 8000 # run from the PROJECT ROOT
```

Then open http://localhost:8000/web/public/index.html

## Rebuild the data (optional, slow)

Only needed if you change the study area or the pipeline. Requires internet
access. The Census API key goes in `pipeline/local_secrets.py` (copy
`local_secrets.example.py`); it is git-ignored.

```bash
cd pipeline
python -m pip install -r requirements.txt
python step1_fetch_roads.py
python step2_fetch_demand.py
python step3_fetch_stations.py
python step4_export_web_data.py
```

Then republish the site: `cd web && npm run publish`, and commit `docs/`.

## Testing the engine

```bash
cd web
npm test
```

Runs correctness checks, including a comparison against NetworkX shortest paths.

## Method and assumptions

- **Study area:** GA-07 boundary from the Census Bureau's TIGER/Line data
  (119th Congress map). The district spans six counties: Fulton, Forsyth,
  Cherokee, Hall, Dawson, and Lumpkin.
- **Population:** 2020 Census block counts. Each block is assigned to the
  district if its centroid falls inside the boundary. The district total is
  765,039 residents.
- **Travel time:** driving network from OpenStreetMap, weighted by road
  length and an estimated speed per road type. Times are free-flow estimates,
  not measured response times.
- **Target:** 5 minutes by default, adjustable with the slider. The default
  is a working benchmark, not a department-verified standard.

## Known limitations

- **Existing stations are unverified.** The 57 stations come from OpenStreetMap
  tags, which can be incomplete or duplicated, and most have no names. A
  hand-verified station list is the top item to improve.
- **Some areas are unreachable.** 53 populated blocks (about 7,500 residents)
  can't be reached by road from any station. These are most likely gaps in the
  OpenStreetMap road data, not real dead ends. They are shown in dark red.
- **Block centroids, not homes.** Each block's population is placed at its
  center, so people are not spread across the block.
- **Free-flow times.** Real response times include turnout, traffic, and
  dispatch delays. The model doesn't include those yet.

## Credits

Map data © OpenStreetMap contributors. Population data: U.S. Census Bureau.
Map rendering: Leaflet.
