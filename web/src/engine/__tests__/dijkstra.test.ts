/**
 * Correctness tests for the Dijkstra engine, run with plain `node` (no test
 * framework dependency — see README for why). Two checks:
 *
 *   1. multiSourceDijkstra matches NetworkX's shortest-path distances
 *      exactly (within floating-point tolerance) on a random 500-node
 *      graph — this is the "test against NetworkX on 100+ random pairs"
 *      step from the project plan, covering all 500 nodes rather than a
 *      sample of pairs.
 *   2. incrementalAddSource (the pruned, single-candidate version the
 *      optimizer will call hundreds of times) produces the SAME result as
 *      calling multiSourceDijkstra with the candidate added to the source
 *      list — i.e. the speed optimization doesn't change the answer.
 */
import * as fs from "fs";
import * as path from "path";
import { multiSourceDijkstra, incrementalAddSource } from "../dijkstra.js";
import { CompactGraph } from "../types.js";

interface Fixture {
  nodeCount: number;
  edges: [number, number, number][];
  sources: number[];
  expectedDistances: (number | null)[];
}

function loadFixture(): Fixture {
  const p = path.join(__dirname, "fixture.json");
  if (!fs.existsSync(p)) {
    throw new Error("fixture.json not found — run `python3 generate_fixture.py` in this directory first.");
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function buildGraphFromFixture(fx: Fixture): CompactGraph {
  const outDegree = new Int32Array(fx.nodeCount);
  for (const [from] of fx.edges) outDegree[from]++;

  const edgeStart = new Int32Array(fx.nodeCount + 1);
  for (let i = 0; i < fx.nodeCount; i++) edgeStart[i + 1] = edgeStart[i] + outDegree[i];

  const edgeTarget = new Int32Array(fx.edges.length);
  const edgeWeight = new Float64Array(fx.edges.length);
  const cursor = edgeStart.slice(0, fx.nodeCount);
  for (const [from, to, w] of fx.edges) {
    const pos = cursor[from]++;
    edgeTarget[pos] = to;
    edgeWeight[pos] = w;
  }

  return {
    nodeCount: fx.nodeCount,
    lon: new Float64Array(fx.nodeCount),
    lat: new Float64Array(fx.nodeCount),
    edgeStart,
    edgeTarget,
    edgeWeight,
    edgeDistance: new Float64Array(fx.edges.length), // unused by these tests — time-only fixture
  };
}

let failures = 0;
function assertClose(actual: number, expected: number, msg: string, tol = 1e-6): void {
  if (Math.abs(actual - expected) > tol) {
    failures++;
    console.error(`FAIL: ${msg} — expected ${expected}, got ${actual}`);
  }
}
function assertTrue(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

function testAgainstNetworkX(): void {
  const fx = loadFixture();
  const graph = buildGraphFromFixture(fx);
  const dist = multiSourceDijkstra(graph, fx.sources);

  let checked = 0;
  let mismatches = 0;
  for (let i = 0; i < fx.nodeCount; i++) {
    const expected = fx.expectedDistances[i];
    checked++;
    if (expected === null) {
      assertTrue(dist[i] === Infinity, `node ${i} should be unreachable`);
    } else {
      if (Math.abs(dist[i] - expected) > 1e-3) mismatches++;
      assertClose(dist[i], expected, `node ${i} distance`, 1e-3);
    }
  }
  console.log(`[testAgainstNetworkX] checked ${checked} nodes, ${mismatches} mismatches`);
}

function testIncrementalMatchesFullRerun(): void {
  const fx = loadFixture();
  const graph = buildGraphFromFixture(fx);

  // Start from all sources but one, held out as the "new" station being added.
  const heldOut = fx.sources[fx.sources.length - 1];
  const baseSources = fx.sources.slice(0, -1);

  const before = multiSourceDijkstra(graph, baseSources);
  const incremental = incrementalAddSource(graph, before, heldOut, 1_000_000);
  const fullRerun = multiSourceDijkstra(graph, [...baseSources, heldOut]);

  let mismatches = 0;
  for (let i = 0; i < fx.nodeCount; i++) {
    const a = incremental[i];
    const b = fullRerun[i];
    const bothInfinite = a === Infinity && b === Infinity;
    if (!bothInfinite && Math.abs(a - b) > 1e-6) mismatches++;
    assertTrue(bothInfinite || Math.abs(a - b) <= 1e-6, `node ${i}: incremental=${a} fullRerun=${b}`);
  }
  console.log(`[testIncrementalMatchesFullRerun] ${fx.nodeCount} nodes, ${mismatches} mismatches`);

  // Sanity: adding a source should never make any distance worse.
  let regressions = 0;
  for (let i = 0; i < fx.nodeCount; i++) {
    if (incremental[i] > before[i] + 1e-9) regressions++;
  }
  assertTrue(regressions === 0, `${regressions} node(s) got WORSE after adding a station`);
}

function testCutoffIsConservative(): void {
  // Two guarantees a small cutoff must uphold (see the correctness note in
  // dijkstra.ts — this is NOT "unchanged beyond cutoff", it's "exact
  // within cutoff, never an under-count beyond it"):
  //   1. Exact match to the true value for every node within the cutoff.
  //   2. Never reports a distance SMALLER than the true value, anywhere —
  //      this is the safety-critical property: coverage must never be
  //      overstated because of the speed optimization.
  const fx = loadFixture();
  const graph = buildGraphFromFixture(fx);
  const heldOut = fx.sources[fx.sources.length - 1];
  const baseSources = fx.sources.slice(0, -1);

  const before = multiSourceDijkstra(graph, baseSources);
  const fullRerun = multiSourceDijkstra(graph, [...baseSources, heldOut]); // ground truth, no cutoff
  const cutoffSeconds = 50; // deliberately small, well below typical trueDist values in this random graph
  const pruned = incrementalAddSource(graph, before, heldOut, cutoffSeconds);

  let exactWithinCutoffViolations = 0;
  let underCountViolations = 0;
  let exercisedTheApproximateCase = 0; // sanity: make sure this test actually exercises cutoff > exact-value cases

  for (let i = 0; i < fx.nodeCount; i++) {
    const trueDist = fullRerun[i];

    if (trueDist <= cutoffSeconds) {
      if (Math.abs(pruned[i] - trueDist) > 1e-6) exactWithinCutoffViolations++;
    } else {
      exercisedTheApproximateCase++;
    }

    if (pruned[i] < trueDist - 1e-6) underCountViolations++;
  }

  assertTrue(exactWithinCutoffViolations === 0, `${exactWithinCutoffViolations} node(s) inexact within cutoff`);
  assertTrue(underCountViolations === 0, `${underCountViolations} node(s) UNDER-COUNTED (unsafe: coverage would be overstated)`);
  assertTrue(exercisedTheApproximateCase > 0, "test fixture didn't exercise any beyond-cutoff node — cutoff too generous to be a meaningful test");

  console.log(
    `[testCutoffIsConservative] cutoff=${cutoffSeconds}s, ` +
    `${exactWithinCutoffViolations} exactness violations, ${underCountViolations} under-count violations, ` +
    `${exercisedTheApproximateCase} nodes exercised the beyond-cutoff path`
  );
}

testAgainstNetworkX();
testIncrementalMatchesFullRerun();
testCutoffIsConservative();

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
