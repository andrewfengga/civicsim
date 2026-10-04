"""
Step 1a — Fetch the drivable road network for the study area (config.py's
STUDY_AREA_NAME / CONGRESSIONAL_DISTRICT) and attach a travel time (in
seconds) to every edge.

Run:
    python step1_fetch_roads.py

Output:
    ../data/raw_graph.graphml   (full OSMnx graph, kept for debugging/QA)

Why travel time and not just distance: response-time coverage depends on
how fast a fire truck can move along a road, not how long the road is. A
0.5 km stretch of residential street and a 0.5 km stretch of a four-lane
arterial take very different amounts of time to drive, and the whole point
of the model is to capture that difference.
"""
import os
import networkx as nx
import osmnx as ox

from config import STUDY_AREA_NAME, NETWORK_TYPE, FALLBACK_SPEEDS_KPH, OUT_DIR
from district_boundary import get_district_boundary


def fetch_graph() -> nx.MultiDiGraph:
    """
    Congressional districts aren't a nameable OSM place, so unlike the old
    single-city version (which used graph_from_place), this downloads the
    road network clipped to the district's own polygon boundary.
    """
    boundary = get_district_boundary()
    polygon = boundary.geometry.iloc[0]
    print(f"Downloading road network for {STUDY_AREA_NAME}...")
    print("  (this covers ~3,000 km^2 across 6 counties — expect this to take a while)")
    G = ox.graph_from_polygon(polygon, network_type=NETWORK_TYPE)
    print(f"  raw graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    return G


def add_speeds_and_travel_times(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """
    OSMnx's add_edge_speeds() imputes missing maxspeed tags from OSM
    highway-type medians observed elsewhere in the graph. That still leaves
    some edges with no speed at all (rare tags, disconnected fragments), so
    we backfill those from FALLBACK_SPEEDS_KPH before computing travel time.
    """
    G = ox.add_edge_speeds(G)

    missing = 0
    for u, v, k, data in G.edges(keys=True, data=True):
        if data.get("speed_kph") is None:
            hwy = data.get("highway", "unclassified")
            if isinstance(hwy, list):
                hwy = hwy[0]
            data["speed_kph"] = FALLBACK_SPEEDS_KPH.get(hwy, FALLBACK_SPEEDS_KPH["unclassified"])
            missing += 1
    if missing:
        print(f"  backfilled speed on {missing} edges using fallback table")

    G = ox.add_edge_travel_times(G)  # adds 'travel_time' in seconds per edge
    return G


def sanity_check(G: nx.MultiDiGraph) -> None:
    """Fail loudly rather than silently exporting a broken graph."""
    n_components = nx.number_weakly_connected_components(G)
    largest = max(nx.weakly_connected_components(G), key=len)
    frac_largest = len(largest) / G.number_of_nodes()
    print(f"  weakly connected components: {n_components}")
    print(f"  largest component covers {frac_largest:.1%} of nodes")
    if frac_largest < 0.9:
        print(
            "  WARNING: less than 90% of the graph is in one connected "
            "component. This usually means the place boundary clipped the "
            "network oddly, or there are OSM data gaps. Inspect before "
            "continuing — Step 2 should build demand points against the "
            "LARGEST component only, or travel times to isolated nodes "
            "will show up as unreachable (infinite)."
        )

    speeds = [d["speed_kph"] for _, _, d in G.edges(data=True)]
    if min(speeds) <= 0:
        raise ValueError("Found an edge with non-positive speed — check FALLBACK_SPEEDS_KPH.")
    print(f"  speed range: {min(speeds):.0f}–{max(speeds):.0f} kph")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    G = fetch_graph()
    G = add_speeds_and_travel_times(G)
    sanity_check(G)

    out_path = os.path.join(OUT_DIR, "raw_graph.graphml")
    ox.save_graphml(G, out_path)
    print(f"Saved {out_path}")


if __name__ == "__main__":
    main()
