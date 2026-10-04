import { findNearestNode } from "../nearestNode.js";
import { CompactGraph } from "../../engine/types.js";

let failures = 0;
function assertTrue(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// 3x3 grid of nodes, no edges needed (findNearestNode only looks at
// lat/lon arrays), spaced 0.01 degrees apart (~1.1km at this latitude).
function makeGridGraph(): CompactGraph {
  const lat: number[] = [];
  const lon: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      lat.push(34.00 + r * 0.01);
      lon.push(-84.30 + c * 0.01);
    }
  }
  return {
    nodeCount: 9,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    edgeStart: new Int32Array(10),
    edgeTarget: new Int32Array(0),
    edgeWeight: new Float64Array(0),
    edgeDistance: new Float64Array(0),
  };
}

function testExactHitsReturnThatNode(): void {
  const g = makeGridGraph();
  for (let i = 0; i < 9; i++) {
    const idx = findNearestNode(g, g.lat[i], g.lon[i]);
    assertTrue(idx === i, `clicking exactly on node ${i} should return ${i}, got ${idx}`);
  }
  console.log("[testExactHitsReturnThatNode] 9/9 exact clicks matched");
}

function testNearMissReturnsClosest(): void {
  const g = makeGridGraph();
  // node 4 is the center (lat 34.01, lon -84.29); click slightly off it.
  const idx = findNearestNode(g, 34.011, -84.289);
  assertTrue(idx === 4, `should snap to center node 4, got ${idx}`);
  console.log("[testNearMissReturnsClosest] near-miss correctly snapped to nearest node");
}

function testLongitudeScalingMatters(): void {
  // A constant lon-scaling factor alone can't change nearest-neighbor
  // order between two points at the SAME latitude (it just multiplies
  // both differences by the same constant). To prove the cos(lat)
  // correction actually matters, pit a pure-latitude offset against a
  // pure-longitude offset, at a high latitude where the correction is large.
  //
  // Click at (70.0, 0.0). Node A is 0.05° due north (pure lat diff).
  // Node B is 0.10° due east (pure lon diff). At 70°N, cos(70°) ≈ 0.342.
  //   Unscaled: distA = 0.05, distB = 0.10           -> A is "closer"
  //   Scaled:   distA = 0.05, distB = 0.10*0.342=0.034 -> B is actually closer
  // A real click 0.10° of longitude away at 70°N is physically much
  // closer than 0.10° suggests, because longitude lines are squeezed
  // together near the poles — so B should win once correctly scaled.
  const lat = Float64Array.from([69.95, 70.0]); // node 0 = A (north), node 1 = B (east)
  const lon = Float64Array.from([0.0, 0.10]);
  const g: CompactGraph = {
    nodeCount: 2,
    lat,
    lon,
    edgeStart: new Int32Array(3),
    edgeTarget: new Int32Array(0),
    edgeWeight: new Float64Array(0),
    edgeDistance: new Float64Array(0),
  };
  const idx = findNearestNode(g, 70.0, 0.0);
  assertTrue(idx === 1, `expected node 1 (B, longitude-scaling-aware nearest), got node ${idx}`);
  console.log("[testLongitudeScalingMatters] cos(lat) correction correctly changed the nearest-node result");
}

testExactHitsReturnThatNode();
testNearMissReturnsClosest();
testLongitudeScalingMatters();

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll nearestNode tests passed.");
}
