"""
Step 1d — Compile raw_graph.graphml + demand_points.geojson +
existing_stations.geojson + candidate_sites.geojson into ONE compact JSON
file the web app loads directly. This is the hand-off point between the
Python pipeline and the TypeScript engine (Step 2).

Run (after steps 1-3):
    python step4_export_web_data.py

Output:
    ../data/civicsim_graph.json

Format (see ../web/src/engine/types.ts for the matching TS types):
{
  "nodes": [[lon, lat], ...]                          // index = node id used everywhere below
  "edges": [[fromIdx, toIdx, seconds, meters], ...]  // directed, one entry per direction
  "demand": [{ "nodeIdx": int, "population": int, "blockId": str }, ...]
  "existingStations": [{ "nodeIdx": int, "name": str }, ...]
  "candidateSites": [int, ...]               // node indices
}

We re-index OSM's 64-bit node IDs to small contiguous integers (0..N-1)
because that lets the web engine use plain JS arrays (fast, cache-friendly)
instead of a Map keyed by giant OSM IDs (slow, memory-heavy) for the inner
loop of Dijkstra's algorithm.
"""
import json
import os
import geopandas as gpd
import networkx as nx
import osmnx as ox

from config import OUT_DIR


def main():
    graph_path = os.path.join(OUT_DIR, "raw_graph.graphml")
    demand_path = os.path.join(OUT_DIR, "demand_points.geojson")
    stations_path = os.path.join(OUT_DIR, "existing_stations.geojson")
    candidates_path = os.path.join(OUT_DIR, "candidate_sites.geojson")
    for p in [graph_path, demand_path, stations_path, candidates_path]:
        if not os.path.exists(p):
            raise SystemExit(f"Missing {p} — run steps 1-3 first.")

    G = ox.load_graphml(graph_path)

    # Keep only the largest weakly-connected component. Nodes outside it are
    # unreachable from anywhere else in the graph, which would otherwise
    # show up as fake "no coverage" gaps that are really just data
    # artifacts (e.g. a service road OSM failed to connect to the network).
    largest_cc = max(nx.weakly_connected_components(G), key=len)
    if len(largest_cc) < G.number_of_nodes():
        dropped = G.number_of_nodes() - len(largest_cc)
        print(f"Dropping {dropped} node(s) outside the largest connected component")
    G = G.subgraph(largest_cc).copy()

    # Re-index OSM node IDs -> contiguous integers.
    osm_ids = list(G.nodes())
    id_to_idx = {osm_id: i for i, osm_id in enumerate(osm_ids)}

    nodes_out = []
    for osm_id in osm_ids:
        data = G.nodes[osm_id]
        nodes_out.append([round(data["x"], 6), round(data["y"], 6)])  # [lon, lat]

    edges_out = []
    for u, v, data in G.edges(data=True):
        tt = data.get("travel_time")
        length_m = data.get("length")
        if tt is None or tt <= 0 or length_m is None or length_m <= 0:
            continue
        edges_out.append([id_to_idx[u], id_to_idx[v], round(float(tt), 2), round(float(length_m), 1)])

    def snap_osm_id(node_id_col_value):
        """OSMnx node ids may load back as str or int depending on graphml
        round-trip; try both so we don't silently drop every row."""
        for candidate in (node_id_col_value, int(node_id_col_value)):
            if candidate in id_to_idx:
                return id_to_idx[candidate]
        return None

    demand_gdf = gpd.read_file(demand_path)
    demand_out = []
    dropped_demand = 0
    for _, row in demand_gdf.iterrows():
        idx = snap_osm_id(row["node_id"])
        if idx is None:
            dropped_demand += 1
            continue
        demand_out.append({
            "nodeIdx": idx,
            "population": int(row["population"]),
            "blockId": str(row["block_id"]),
        })
    if dropped_demand:
        print(f"WARNING: dropped {dropped_demand} demand point(s) snapped to a node "
              "outside the largest connected component")

    stations_gdf = gpd.read_file(stations_path)
    stations_out = []
    for _, row in stations_gdf.iterrows():
        idx = snap_osm_id(row["node_id"])
        if idx is None:
            print(f"WARNING: an existing station snapped outside the largest "
                  "connected component and was DROPPED — check this by hand, "
                  "it will make coverage look worse than reality.")
            continue
        stations_out.append({
            "nodeIdx": idx,
            "name": str(row.get("name", "Unnamed station")),
        })

    candidates_gdf = gpd.read_file(candidates_path)
    candidates_out = []
    for _, row in candidates_gdf.iterrows():
        idx = snap_osm_id(row["node_id"])
        if idx is not None:
            candidates_out.append(idx)

    bundle = {
        "meta": {
            "nodeCount": len(nodes_out),
            "edgeCount": len(edges_out),
            "demandCount": len(demand_out),
            "totalPopulation": sum(d["population"] for d in demand_out),
            "existingStationCount": len(stations_out),
            "candidateCount": len(candidates_out),
        },
        "nodes": nodes_out,
        "edges": edges_out,
        "demand": demand_out,
        "existingStations": stations_out,
        "candidateSites": candidates_out,
    }

    out_path = os.path.join(OUT_DIR, "civicsim_graph.json")
    with open(out_path, "w") as f:
        json.dump(bundle, f)

    size_mb = os.path.getsize(out_path) / 1e6
    print(f"Saved {out_path} ({size_mb:.1f} MB)")
    print(json.dumps(bundle["meta"], indent=2))
    if size_mb > 15:
        print(
            "NOTE: file is fairly large for a browser to fetch instantly. "
            "Consider lowering MAX_CANDIDATES, or switching CANDIDATE_METHOD "
            "to 'grid', or gzip-serving this file (most static hosts do this "
            "automatically)."
        )


if __name__ == "__main__":
    main()
