/**
 * Rough performance sanity check on a CITY-SCALE graph, so "feels instant"
 * in the plan is a measured claim, not a guess. Not a rigorous benchmark
 * (single run, one machine) — re-run this once real city data is loaded in
 * Step 1 and update the numbers in README.md with the real figures.
 *
 * Builds a synthetic grid graph (like a simplified street grid) since we
 * don't have real OSM data in this environment. A grid is a reasonable
 * stand-in for a road network's sparsity (each node connects to a handful
 * of neighbors, not all nodes to all nodes).
 */
import { CompactGraph } from "../types.js";
import { multiSourceDijkstra, incrementalAddSource } from "../dijkstra.js";

function buildGridGraph(sideLength: number): CompactGraph {
  const nodeCount = sideLength * sideLength;
  const idx = (r: number, c: number) => r * sideLength + c;

  const edgesFrom: number[] = [];
  const edgesTo: number[] = [];
  const edgesW: number[] = [];

  const rand = mulberry32(42);
  for (let r = 0; r < sideLength; r++) {
    for (let c = 0; c < sideLength; c++) {
      const u = idx(r, c);
      if (c + 1 < sideLength) {
        const v = idx(r, c + 1);
        const w = 8 + rand() * 40; // seconds, stand-in for a city block travel time
        edgesFrom.push(u, v);
        edgesTo.push(v, u);
        edgesW.push(w, w);
      }
      if (r + 1 < sideLength) {
        const v = idx(r + 1, c);
        const w = 8 + rand() * 40;
        edgesFrom.push(u, v);
        edgesTo.push(v, u);
        edgesW.push(w, w);
      }
    }
  }

  const outDegree = new Int32Array(nodeCount);
  for (const f of edgesFrom) outDegree[f]++;
  const edgeStart = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) edgeStart[i + 1] = edgeStart[i] + outDegree[i];
  const edgeTarget = new Int32Array(edgesFrom.length);
  const edgeWeight = new Float64Array(edgesFrom.length);
  const cursor = edgeStart.slice(0, nodeCount);
  for (let i = 0; i < edgesFrom.length; i++) {
    const pos = cursor[edgesFrom[i]]++;
    edgeTarget[pos] = edgesTo[i];
    edgeWeight[pos] = edgesW[i];
  }

  return {
    nodeCount,
    lon: new Float64Array(nodeCount),
    lat: new Float64Array(nodeCount),
    edgeStart,
    edgeTarget,
    edgeWeight,
    edgeDistance: new Float64Array(edgesFrom.length), // unused — benchmark is time-only
  };
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bench(label: string, fn: () => void, runs = 5): void {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    fn();
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`${label}: median ${median}ms over ${runs} runs (all: ${times.join(", ")}ms)`);
}

const SIDE = 160; // 160x160 = 25,600 nodes — comparable to a mid-size city's routable intersections
const graph = buildGridGraph(SIDE);
console.log(`Graph: ${graph.nodeCount} nodes, ${graph.edgeTarget.length} directed edges\n`);

const stationNodes = [
  0,
  SIDE - 1,
  graph.nodeCount - SIDE,
  graph.nodeCount - 1,
  Math.floor(graph.nodeCount / 2),
];

bench("Full multi-source Dijkstra (5 existing stations, cold)", () => {
  multiSourceDijkstra(graph, stationNodes);
});

const before = multiSourceDijkstra(graph, stationNodes);
bench("Full re-run after adding 1 station (what the map does on drag)", () => {
  multiSourceDijkstra(graph, [...stationNodes, Math.floor(graph.nodeCount * 0.3)]);
});

bench("Pruned incrementalAddSource, cutoff=1200s (what the optimizer calls per candidate)", () => {
  incrementalAddSource(graph, before, Math.floor(graph.nodeCount * 0.3), 1200);
});

// Realistic optimizer inner loop: score 300 candidate sites.
bench(
  "Optimizer sweep: score 300 candidates (pruned incremental each)",
  () => {
    for (let i = 0; i < 300; i++) {
      const candidate = Math.floor((i * 83) % graph.nodeCount);
      incrementalAddSource(graph, before, candidate, 1200);
    }
  },
  3
);
