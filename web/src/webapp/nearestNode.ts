import { CompactGraph } from "../engine/types.js";

/**
 * Finds the graph node closest to a clicked lat/lon. A candidate "new
 * station" has to snap to an actual road node — the engine only knows
 * about points on the graph, not arbitrary map coordinates.
 *
 * Plain linear scan over ~3,000-5,000 nodes (typical city-size graph) —
 * fast enough for a single click (sub-millisecond) without needing a
 * spatial index. Longitude degrees are narrower than latitude degrees
 * away from the equator, so we scale the longitude difference by
 * cos(latitude) before comparing — otherwise "nearest" would be subtly
 * wrong (stretched east-west) at any latitude away from 0.
 */
export function findNearestNode(graph: CompactGraph, clickLat: number, clickLon: number): number {
  const latRad = (clickLat * Math.PI) / 180;
  const lonScale = Math.cos(latRad);

  let bestIdx = -1;
  let bestDistSq = Infinity;

  for (let i = 0; i < graph.nodeCount; i++) {
    const dLat = graph.lat[i] - clickLat;
    const dLon = (graph.lon[i] - clickLon) * lonScale;
    const distSq = dLat * dLat + dLon * dLon;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = i;
    }
  }

  return bestIdx;
}
