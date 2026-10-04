/**
 * Correctness tests for the greedy optimizer, run with plain `node` (same
 * convention as dijkstra.test.ts / loadGraph.test.ts).
 *
 * Graph: a "plus" shape — one station at the center, four arms of demand
 * getting progressively farther out. This makes the right greedy choice
 * predictable by hand, which is the point: we're checking the SELECTION
 * logic, not re-testing Dijkstra correctness (that's dijkstra.test.ts's job).
 *
 *         (7)
 *          |
 *   (5)-(1)-(0)-(2)-(6)
 *          |
 *         (8)
 *
 * Node 0 = existing station. Nodes 1,2 one hop out (60s); 5,6 two hops
 * (120s); 7,8 on a third arm, one hop out (60s) but with NO further
 * candidate beyond them.
 */
import { multiSourceDijkstra } from "../dijkstra.js";
import { greedyOptimizeStations } from "../optimizer.js";
import { CompactGraph, DemandPoint } from "../types.js";

let failures = 0;
function assertTrue(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

function buildGraph(edges: [number, number, number][], nodeCount: number): CompactGraph {
  const outDegree = new Int32Array(nodeCount);
  for (const [from] of edges) outDegree[from]++;
  const edgeStart = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) edgeStart[i + 1] = edgeStart[i] + outDegree[i];
  const edgeTarget = new Int32Array(edges.length);
  const edgeWeight = new Float64Array(edges.length);
  const cursor = edgeStart.slice(0, nodeCount);
  for (const [from, to, w] of edges) {
    const pos = cursor[from]++;
    edgeTarget[pos] = to;
    edgeWeight[pos] = w;
  }
  return {
    nodeCount,
    lon: new Float64Array(nodeCount),
    lat: new Float64Array(nodeCount),
    edgeStart,
    edgeTarget,
    edgeWeight,
    edgeDistance: new Float64Array(edges.length), // unused by these tests — time-only fixture
  };
}

// Nodes: 0=station, 1,2=near arms, 3,4=mid arms (beyond 1,2), 5,6=far arms (beyond 3,4)
// One long arm 7-8-9 with a big population cluster at the far end (node 9).
const NODE_COUNT = 10;
function buildFixtureGraph(): CompactGraph {
  const undirected: [number, number][] = [
    [0, 1], [1, 3], [3, 5], // west arm
    [0, 2], [2, 4], [4, 6], // east arm
    [0, 7], [7, 8], [8, 9], // long south arm
  ];
  const edges: [number, number, number][] = [];
  for (const [a, b] of undirected) {
    edges.push([a, b, 60], [b, a, 60]);
  }
  return buildGraph(edges, NODE_COUNT);
}

function buildDemand(): DemandPoint[] {
  return [
    { nodeIdx: 1, population: 50, blockId: "near-west" }, // 60s from station, already covered
    { nodeIdx: 2, population: 50, blockId: "near-east" }, // 60s from station, already covered
    { nodeIdx: 5, population: 400, blockId: "far-west" }, // 180s from station, uncovered, 1 hop from candidate@3
    { nodeIdx: 6, population: 100, blockId: "far-east" }, // 180s from station, uncovered, 1 hop from candidate@4
    { nodeIdx: 9, population: 30, blockId: "far-south" }, // 180s from station, uncovered, small population
  ];
}

const TARGET_SECONDS = 150; // 2.5 min: covers 1-hop (60s) and 2-hop (120s), not 3-hop (180s)
const CAP_SECONDS = TARGET_SECONDS * 4;

function testPicksHighestPopulationCandidateFirst(): void {
  const graph = buildFixtureGraph();
  const demand = buildDemand();
  const baseline = multiSourceDijkstra(graph, [0]);
  // Candidates at 3 (unlocks far-west, pop 400), 4 (unlocks far-east, pop 100),
  // 8 (unlocks far-south, pop 30). Candidate at 3 should win round 1.
  const candidates = [3, 4, 8];

  const result = greedyOptimizeStations(graph, demand, candidates, baseline, TARGET_SECONDS, CAP_SECONDS, 3, 10_000);

  assertTrue(result.steps.length === 3, `expected 3 steps, got ${result.steps.length}`);
  assertTrue(result.steps[0].nodeIdx === 3, `round 1 should pick node 3 (biggest population unlock), got ${result.steps[0]?.nodeIdx}`);
  assertTrue(result.steps[0].newlyCoveredPopulation === 400, `round 1 newly covered should be 400, got ${result.steps[0]?.newlyCoveredPopulation}`);
  assertTrue(result.steps[1].nodeIdx === 4, `round 2 should pick node 4, got ${result.steps[1]?.nodeIdx}`);
  assertTrue(result.steps[1].newlyCoveredPopulation === 100, `round 2 newly covered should be 100, got ${result.steps[1]?.newlyCoveredPopulation}`);
  assertTrue(result.steps[2].nodeIdx === 8, `round 3 should pick node 8, got ${result.steps[2]?.nodeIdx}`);
  assertTrue(result.steps[2].newlyCoveredPopulation === 30, `round 3 newly covered should be 30, got ${result.steps[2]?.newlyCoveredPopulation}`);

  // Coverage should be monotonically non-decreasing round over round.
  let prevFraction = -1;
  for (const step of result.steps) {
    assertTrue(step.coverageAfter.coveredFraction >= prevFraction, "coverage fraction regressed between rounds");
    prevFraction = step.coverageAfter.coveredFraction;
  }
  assertTrue(Math.abs(result.steps[2].coverageAfter.coveredFraction - 1) < 1e-9, "all demand should be covered after all 3 stations placed");

  console.log("[testPicksHighestPopulationCandidateFirst] greedy order and newly-covered counts verified");
}

function testBudgetZeroReturnsNoSteps(): void {
  const graph = buildFixtureGraph();
  const demand = buildDemand();
  const baseline = multiSourceDijkstra(graph, [0]);
  const result = greedyOptimizeStations(graph, demand, [3, 4, 8], baseline, TARGET_SECONDS, CAP_SECONDS, 0, 10_000);
  assertTrue(result.steps.length === 0, "budget 0 should produce 0 steps");
  assertTrue(result.finalTimes === baseline || Array.from(result.finalTimes).every((v, i) => v === baseline[i]), "finalTimes should equal baseline when nothing was picked");
  console.log("[testBudgetZeroReturnsNoSteps] verified");
}

function testStopsEarlyWhenNoCandidateHelps(): void {
  const graph = buildFixtureGraph();
  const demand = buildDemand();
  const baseline = multiSourceDijkstra(graph, [0]);
  // Node 0 IS the existing station: a "candidate" there is a pure no-op —
  // distances are already optimal through it, so it can neither newly cover
  // anyone nor reduce anyone's time (unlike e.g. node 1, which is already
  // covered but would still drop from 60s to 0s and thus register a
  // positive time-reduction score).
  const result = greedyOptimizeStations(graph, demand, [0], baseline, TARGET_SECONDS, CAP_SECONDS, 5, 10_000);
  assertTrue(result.steps.length === 0, `expected 0 steps when the only candidate helps nobody, got ${result.steps.length}`);
  console.log("[testStopsEarlyWhenNoCandidateHelps] verified");
}

function testNeverPicksSameCandidateTwice(): void {
  const graph = buildFixtureGraph();
  const demand = buildDemand();
  const baseline = multiSourceDijkstra(graph, [0]);
  const result = greedyOptimizeStations(graph, demand, [3, 4, 8], baseline, TARGET_SECONDS, CAP_SECONDS, 10, 10_000);
  const picked = result.steps.map((s) => s.nodeIdx);
  const unique = new Set(picked);
  assertTrue(unique.size === picked.length, `duplicate candidate picked across rounds: ${picked.join(",")}`);
  assertTrue(picked.length <= 3, `only 3 candidates were offered, cannot pick more than 3, got ${picked.length}`);
  console.log("[testNeverPicksSameCandidateTwice] verified");
}

testPicksHighestPopulationCandidateFirst();
testBudgetZeroReturnsNoSteps();
testStopsEarlyWhenNoCandidateHelps();
testNeverPicksSameCandidateTwice();

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll optimizer tests passed.");
}
