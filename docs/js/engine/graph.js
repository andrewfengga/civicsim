/**
 * Convert the JSON bundle's edge list into a CSR (compressed sparse row)
 * adjacency structure: three flat typed arrays instead of an array of
 * per-node arrays. This is the layout Dijkstra's inner loop walks, and it
 * matters for speed — one contiguous scan per node instead of chasing
 * pointers through nested JS arrays.
 */
export function buildCompactGraph(bundle) {
    const { nodeCount } = bundle.meta;
    const edges = bundle.edges;
    // Pass 1: count outgoing edges per node, to size edgeStart correctly.
    const outDegree = new Int32Array(nodeCount);
    for (const [from] of edges)
        outDegree[from]++;
    const edgeStart = new Int32Array(nodeCount + 1);
    for (let i = 0; i < nodeCount; i++)
        edgeStart[i + 1] = edgeStart[i] + outDegree[i];
    const edgeTarget = new Int32Array(edges.length);
    const edgeWeight = new Float64Array(edges.length);
    const edgeDistance = new Float64Array(edges.length);
    // Pass 2: fill in, using a cursor per node so each edge lands in its
    // node's contiguous slice.
    const cursor = edgeStart.slice(0, nodeCount);
    for (const [from, to, seconds, meters] of edges) {
        const pos = cursor[from]++;
        edgeTarget[pos] = to;
        edgeWeight[pos] = seconds;
        edgeDistance[pos] = meters;
    }
    const lon = new Float64Array(nodeCount);
    const lat = new Float64Array(nodeCount);
    bundle.nodes.forEach(([lo, la], i) => {
        lon[i] = lo;
        lat[i] = la;
    });
    return { nodeCount, lon, lat, edgeStart, edgeTarget, edgeWeight, edgeDistance };
}
/**
 * Same graph, but with `edgeWeight` swapped to point at the distance (meter)
 * values instead of travel-time (second) values. Dijkstra only ever reads
 * `graph.edgeWeight`, so this is enough to make multiSourceDijkstra /
 * incrementalAddSource compute shortest paths by ROAD DISTANCE instead of
 * travel time, with no changes to the (tested) pathfinding code itself.
 * Shares the same edgeStart/edgeTarget arrays — no copying of the graph
 * topology, just a different lens on the same edges.
 */
export function asDistanceGraph(graph) {
    return { ...graph, edgeWeight: graph.edgeDistance };
}
//# sourceMappingURL=graph.js.map