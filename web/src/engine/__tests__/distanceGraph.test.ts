/**
 * Verifies asDistanceGraph() actually changes ROUTING, not just the units
 * on an otherwise-identical path — the whole point of Time vs Distance mode
 * is that a fast, roundabout route (highway) and a slow, direct route
 * (local street) can each win under a different metric.
 *
 * Graph: node 0 (station) can reach node 1 two ways —
 *   direct:  0 -> 1            100m,  120s (slow local road)
 *   detour:  0 -> 2 -> 1       300m,   60s (fast "highway", longer but quicker)
 *
 * By TIME, the detour wins (60s < 120s). By DISTANCE, the direct road wins
 * (100m < 300m). If asDistanceGraph() were a no-op or wired wrong, both
 * would pick the same route and this test would catch it.
 */
import { parseBundle } from "../loadGraph.js";
import { multiSourceDijkstra } from "../dijkstra.js";
import { asDistanceGraph } from "../graph.js";
import { CivicSimBundle } from "../types.js";

let failures = 0;
function assertTrue(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

function makeBundle(): CivicSimBundle {
  return {
    meta: { nodeCount: 3, edgeCount: 6, demandCount: 1, totalPopulation: 100, existingStationCount: 1, candidateCount: 0 },
    nodes: [
      [-84.30, 34.07],
      [-84.29, 34.07],
      [-84.295, 34.075],
    ],
    edges: [
      // [from, to, seconds, meters]
      [0, 1, 120, 100], [1, 0, 120, 100], // direct: slow, short
      [0, 2, 30, 200], [2, 0, 30, 200], // half of the detour: fast, long
      [2, 1, 30, 100], [1, 2, 30, 100], // other half of the detour
    ],
    demand: [{ nodeIdx: 1, population: 100, blockId: "block-A" }],
    existingStations: [{ nodeIdx: 0, name: "Station" }],
    candidateSites: [],
  };
}

function testTimeAndDistanceModesRouteDifferently(): void {
  const loaded = parseBundle(makeBundle());

  const timeDist = multiSourceDijkstra(loaded.graph, loaded.existingStationNodeIndices);
  assertTrue(Math.abs(timeDist[1] - 60) < 1e-6, `time mode should take the 60s detour, got ${timeDist[1]}`);

  const distanceGraph = asDistanceGraph(loaded.graph);
  const distDist = multiSourceDijkstra(distanceGraph, loaded.existingStationNodeIndices);
  assertTrue(Math.abs(distDist[1] - 100) < 1e-6, `distance mode should take the 100m direct road, got ${distDist[1]}`);

  // Sanity: the two graphs share topology but really do carry different
  // weights — this isn't just two calls returning the same array by accident.
  assertTrue(timeDist[1] !== distDist[1], "time and distance results should differ for this fixture");

  console.log("[testTimeAndDistanceModesRouteDifferently] time picked the fast detour, distance picked the short direct road");
}

testTimeAndDistanceModesRouteDifferently();

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll distance-graph tests passed.");
}
