"""
Generates a random directed graph, computes multi-source shortest-path
distances with NetworkX (a mature, independently-tested library), and
writes both the graph and the expected distances to JSON.

This fixture is what lets the TypeScript test prove the hand-rolled
Dijkstra engine (Step 2) is correct, rather than just "runs without
crashing". It's the same idea as the calibration step in the real
pipeline, just applied to correctness instead of accuracy.

Run:
    python3 generate_fixture.py
Output:
    fixture.json
"""
import json
import os
import random

import networkx as nx

random.seed(7)

N_NODES = 500
N_EDGES = 2500
N_SOURCES = 5
CUTOFF_SECONDS = 1_000_000  # effectively no cutoff, to test the plain path first

G = nx.gnm_random_graph(N_NODES, N_EDGES, seed=7, directed=True)

# Assign positive, non-uniform weights (seconds) — uniform weights would fail
# to exercise the heap's decrease-key path as thoroughly.
for u, v in G.edges():
    G[u][v]["weight"] = round(random.uniform(1.0, 120.0), 3)

edges = [[u, v, G[u][v]["weight"]] for u, v in G.edges()]
nodes = [[0.0, 0.0] for _ in range(N_NODES)]  # coordinates unused by the correctness test

sources = random.sample(range(N_NODES), N_SOURCES)

# NetworkX ground truth: shortest distance from ANY source to each node.
# Implemented as single-source Dijkstra from each source, then take the min
# — deliberately not reusing any of our own multi-source logic, since this
# fixture's entire point is to be an independent check.
best = [float("inf")] * N_NODES
for s in sources:
    lengths = nx.single_source_dijkstra_path_length(G, s, weight="weight")
    for node, d in lengths.items():
        if d < best[node]:
            best[node] = d

# JSON has no Infinity; use null and translate back to Infinity on the TS side.
expected = [None if v == float("inf") else round(v, 3) for v in best]

fixture = {
    "nodeCount": N_NODES,
    "edges": edges,
    "sources": sources,
    "expectedDistances": expected,
}

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixture.json")
with open(out_path, "w") as f:
    json.dump(fixture, f)

n_reachable = sum(1 for v in expected if v is not None)
print(f"Wrote {out_path}: {N_NODES} nodes, {len(edges)} edges, "
      f"{n_reachable}/{N_NODES} reachable from {N_SOURCES} sources")
