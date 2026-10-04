/**
 * Tests parseBundle() (the synchronous half of loadGraph.ts — the network
 * fetch itself isn't testable without a browser/server, but everything
 * after "we have the parsed JSON" is) against a small, hand-built bundle
 * matching EXACTLY the schema step4_export_web_data.py produces. This
 * catches a schema drift between the Python export and the TS loader
 * before it shows up as a confusing runtime error against your real data.
 */
import { parseBundle } from "../loadGraph.js";
import { CivicSimBundle } from "../types.js";
import { multiSourceDijkstra } from "../dijkstra.js";
import { computeCoverage } from "../coverage.js";

let failures = 0;
function assertTrue(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}
function assertThrows(fn: () => void, msgContains: string, testName: string): void {
  try {
    fn();
    failures++;
    console.error(`FAIL: ${testName} — expected an error but none was thrown`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes(msgContains)) {
      failures++;
      console.error(`FAIL: ${testName} — error message didn't mention "${msgContains}": ${msg}`);
    }
  }
}

// A tiny 5-node bundle: a line graph 0-1-2-3-4, one station at node 0,
// two demand points, one candidate site at node 4.
function makeValidBundle(): CivicSimBundle {
  return {
    meta: {
      nodeCount: 5,
      edgeCount: 8, // 4 undirected road segments x2 directions
      demandCount: 2,
      totalPopulation: 300,
      existingStationCount: 1,
      candidateCount: 1,
    },
    nodes: [
      [-84.30, 34.07],
      [-84.29, 34.07],
      [-84.28, 34.07],
      [-84.27, 34.07],
      [-84.26, 34.07],
    ],
    edges: [
      [0, 1, 60, 800], [1, 0, 60, 800],
      [1, 2, 60, 800], [2, 1, 60, 800],
      [2, 3, 60, 800], [3, 2, 60, 800],
      [3, 4, 60, 800], [4, 3, 60, 800],
    ],
    demand: [
      { nodeIdx: 2, population: 100, blockId: "block-A" },
      { nodeIdx: 4, population: 200, blockId: "block-B" },
    ],
    existingStations: [{ nodeIdx: 0, name: "Test Station 1" }],
    candidateSites: [4],
  };
}

function testValidBundleParsesAndWorksEndToEnd(): void {
  const bundle = makeValidBundle();
  const loaded = parseBundle(bundle);

  assertTrue(loaded.graph.nodeCount === 5, "graph.nodeCount should be 5");
  assertTrue(loaded.demand.length === 2, "demand should have 2 points");
  assertTrue(
    loaded.existingStationNodeIndices.length === 1 && loaded.existingStationNodeIndices[0] === 0,
    "existing station should be at node 0"
  );
  assertTrue(loaded.existingStationNames[0] === "Test Station 1", "station name should round-trip");
  assertTrue(
    loaded.candidateSiteNodeIndices.length === 1 && loaded.candidateSiteNodeIndices[0] === 4,
    "candidate site should be at node 4"
  );

  // End-to-end: run the ACTUAL engine (Step 2) against this loaded data,
  // proving the loader's output shape is really what dijkstra.ts expects.
  const travelTimes = multiSourceDijkstra(loaded.graph, loaded.existingStationNodeIndices);
  // node 2 is 2 hops (120s) from the station at node 0; node 4 is 4 hops (240s)
  assertTrue(Math.abs(travelTimes[2] - 120) < 1e-6, `node 2 should be 120s away, got ${travelTimes[2]}`);
  assertTrue(Math.abs(travelTimes[4] - 240) < 1e-6, `node 4 should be 240s away, got ${travelTimes[4]}`);

  const stats = computeCoverage(loaded.demand, travelTimes, /*target*/ 150, /*cap*/ 600);
  // Only block-A (node 2, 120s, pop 100) is within the 150s target.
  assertTrue(stats.coveredPopulation === 100, `covered population should be 100, got ${stats.coveredPopulation}`);
  assertTrue(stats.totalPopulation === 300, `total population should be 300, got ${stats.totalPopulation}`);

  console.log("[testValidBundleParsesAndWorksEndToEnd] loader -> engine -> coverage pipeline verified");
}

function testValidationCatchesRealMistakes(): void {
  const missingArrays = { meta: { nodeCount: 5 } } as unknown as CivicSimBundle;
  assertThrows(() => parseBundle(missingArrays), "nodes", "missing nodes/edges arrays");

  const mismatchedCount = { ...makeValidBundle() };
  mismatchedCount.meta = { ...mismatchedCount.meta, nodeCount: 999 };
  assertThrows(() => parseBundle(mismatchedCount), "nodeCount", "nodeCount mismatch");

  const noStations = { ...makeValidBundle(), existingStations: [] };
  assertThrows(() => parseBundle(noStations), "no existing stations", "empty existingStations");

  const badStationIdx = {
    ...makeValidBundle(),
    existingStations: [{ nodeIdx: 999, name: "Out of range" }],
  };
  assertThrows(() => parseBundle(badStationIdx), "out-of-range", "out-of-range station nodeIdx");

  console.log("[testValidationCatchesRealMistakes] all 4 invalid-bundle cases correctly rejected");
}

testValidBundleParsesAndWorksEndToEnd();
testValidationCatchesRealMistakes();

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll loader tests passed.");
}
