// Mirrors the JSON shape written by pipeline/step4_export_web_data.py.
// Keep these two in sync by hand — there are only five fields, and a
// shared schema file would be overkill for a project this size.

export interface CivicSimBundle {
  meta: {
    nodeCount: number;
    edgeCount: number;
    demandCount: number;
    totalPopulation: number;
    existingStationCount: number;
    candidateCount: number;
  };
  nodes: [number, number][]; // [lon, lat], index = node id
  edges: [number, number, number, number][]; // [fromIdx, toIdx, seconds, meters]
  demand: { nodeIdx: number; population: number; blockId: string }[];
  existingStations: { nodeIdx: number; name: string }[];
  candidateSites: number[]; // node indices
}

// Compact adjacency-list form built once from the bundle, then reused by
// every Dijkstra call. Two parallel typed arrays (CSR-style) instead of an
// array of arrays: better cache locality, and it's what makes recomputing
// coverage on every drag-move fast enough to feel instant.
export interface CompactGraph {
  nodeCount: number;
  lon: Float64Array;
  lat: Float64Array;
  // For node i, its outgoing edges are edgeTarget[edgeStart[i] .. edgeStart[i+1])
  edgeStart: Int32Array; // length nodeCount + 1
  edgeTarget: Int32Array; // length = number of directed edges
  edgeWeight: Float64Array; // seconds, parallel to edgeTarget — the ACTIVE weight Dijkstra reads
  edgeDistance: Float64Array; // meters, parallel to edgeTarget — see graph.ts's asDistanceGraph()
}

export interface DemandPoint {
  nodeIdx: number;
  population: number;
  blockId: string;
}

/** Travel time in seconds from the nearest station to each demand point's node. */
export type TravelTimes = Float64Array; // length = graph.nodeCount, Infinity if unreachable

export interface CoverageStats {
  totalPopulation: number;
  coveredPopulation: number;
  coveredFraction: number; // 0..1
  meanTravelTimeSeconds: number; // population-weighted, covered points only contribute if you choose to
  meanTravelTimeSecondsAll: number; // population-weighted, including unreached demand as their actual (possibly large) time
  uncoveredPopulation: number;
}
