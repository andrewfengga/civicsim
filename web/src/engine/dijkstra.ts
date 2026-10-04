import { BinaryHeap } from "./binaryHeap.js";
import { CompactGraph } from "./types.js";

/**
 * Multi-source Dijkstra: the shortest travel time from the NEAREST of
 * `sourceNodes` to every node in the graph.
 *
 * This one function covers three uses in the app:
 *   - "current coverage"      -> sources = existing station nodes
 *   - "what-if: add station"  -> sources = existing stations + the dragged node
 *   - re-run after any edit   -> same call, just a different source list
 *
 * All sources start in the heap at distance 0 (standard trick: add a
 * virtual super-source connected to each real source with weight 0 — we
 * skip materializing that node and just seed the heap directly instead).
 *
 * Complexity: O((V + E) log V). For a typical mid-size city graph (tens of
 * thousands of nodes), this runs in low tens of milliseconds in a modern
 * browser, which is why we can just re-run it from scratch on every drag
 * instead of maintaining incremental state.
 */
export function multiSourceDijkstra(
  graph: CompactGraph,
  sourceNodes: number[],
  cutoffSeconds: number = Infinity
): Float64Array {
  const dist = new Float64Array(graph.nodeCount).fill(Infinity);
  const heap = new BinaryHeap(graph.nodeCount);

  for (const s of sourceNodes) {
    if (s < 0 || s >= graph.nodeCount) continue;
    dist[s] = 0;
    heap.push(s, 0);
  }

  runDijkstraFromHeap(graph, heap, dist, cutoffSeconds);
  return dist;
}

/**
 * Add ONE new source to an already-computed distance array, without
 * recomputing from scratch. Returns a NEW Float64Array (does not mutate
 * `currentBest`) equal to elementwise min(currentBest, distanceFromSource).
 *
 * This is the function the optimizer calls hundreds of times per run (once
 * per candidate site being scored), so its speed is what makes "Optimize
 * Placement" feel responsive instead of freezing the tab.
 *
 * Correctness of the early stop, precisely stated: Dijkstra pops nodes in
 * non-decreasing order of distance from the source. Once we pop a node at
 * distance d > `cutoffSeconds`, every node with TRUE shortest distance
 * <= cutoffSeconds has already been popped and finalized — so this
 * function's result is EXACT for every node within the cutoff.
 *
 * For nodes beyond the cutoff, the result is a safe upper bound, not
 * necessarily the exact distance: a node one hop from an already-processed
 * node picks up that tentative distance even if never popped itself, and
 * that value can be an overestimate if a cheaper path existed through a
 * node we stopped short of exploring. This never causes an UNDER-count
 * (a demand point is never reported as reachable sooner than it truly is,
 * so coverage numbers are never overstated) — it can occasionally cost a
 * little precision on the *exact* travel time for a far-away, uncovered
 * point, which doesn't matter for coverage/optimization metrics as long as
 * cutoffSeconds is set comfortably above the response-time target.
 */
export function incrementalAddSource(
  graph: CompactGraph,
  currentBest: Float64Array,
  newSourceNode: number,
  cutoffSeconds: number
): Float64Array {
  const dist = new Float64Array(graph.nodeCount).fill(Infinity);
  const heap = new BinaryHeap(graph.nodeCount);
  dist[newSourceNode] = 0;
  heap.push(newSourceNode, 0);

  runDijkstraFromHeap(graph, heap, dist, cutoffSeconds);

  const result = new Float64Array(graph.nodeCount);
  for (let i = 0; i < graph.nodeCount; i++) {
    result[i] = Math.min(currentBest[i], dist[i]);
  }
  return result;
}

function runDijkstraFromHeap(
  graph: CompactGraph,
  heap: BinaryHeap,
  dist: Float64Array,
  cutoffSeconds: number
): void {
  const { edgeStart, edgeTarget, edgeWeight } = graph;

  for (;;) {
    const popped = heap.popMin();
    if (popped === null) break;
    const { node: u, dist: du } = popped;

    if (du > cutoffSeconds) break; // see correctness note above
    if (du > dist[u]) continue; // stale heap entry (shouldn't happen with decreaseKey, kept defensively)

    const start = edgeStart[u];
    const end = edgeStart[u + 1];
    for (let e = start; e < end; e++) {
      const v = edgeTarget[e];
      const alt = du + edgeWeight[e];
      if (alt < dist[v]) {
        dist[v] = alt;
        heap.push(v, alt);
      }
    }
  }
}
