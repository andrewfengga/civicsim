"""
Step 1c — Set existing fire/EMS station locations (from a hand-verified
address list, geocoded here) and generate candidate sites for new stations.

Run (after step1_fetch_roads.py):
    python step3_fetch_stations.py

Output:
    ../data/existing_stations.geojson
    ../data/candidate_sites.geojson

Station source: MANUAL_STATIONS in config.py if it's non-empty (recommended
— fill it in with verified addresses from your department's own site).
Falls back to scraping OSM's amenity=fire_station tags if that list is
empty, which is noticeably less reliable in practice: incomplete, often
unnamed, and sometimes double-tagged (one station showing up as two nearby
points). Either way, READ what this script prints before trusting it —
a coverage model missing a real station will show a fake gap.
"""
import os
import geopandas as gpd
import networkx as nx
import osmnx as ox
import numpy as np
from shapely.geometry.base import BaseGeometry

from config import (
    OUT_DIR,
    CANDIDATE_METHOD,
    CANDIDATE_GRID_SPACING_METERS,
    MAX_CANDIDATES,
    MANUAL_STATIONS,
)
from district_boundary import get_district_boundary


def fetch_manual_stations(manual_stations: list) -> gpd.GeoDataFrame:
    """
    Geocode a hand-verified list of {"name", "address"} dicts from
    config.py, instead of trusting OSM's amenity=fire_station tagging
    (which is often incomplete, duplicated, or missing names — see the
    fallback function below for what that looks like in practice).
    """
    print(f"Geocoding {len(manual_stations)} manually-specified station(s)...")
    rows = []
    for entry in manual_stations:
        name = entry["name"]
        address = entry["address"]
        try:
            lat, lon = ox.geocode(address)
        except Exception as e:
            print(f"  FAILED to geocode '{name}' at '{address}': {e}")
            print("    Skipping this one — fix the address in config.py and re-run.")
            continue
        print(f"  {name}: {address}  ->  {lat:.5f}, {lon:.5f}")
        rows.append({"name": name, "geometry": gpd.points_from_xy([lon], [lat])[0]})
    if not rows:
        raise RuntimeError("No manual stations geocoded successfully — check addresses in config.py.")
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def fetch_existing_stations_from_osm(district_polygon: BaseGeometry) -> gpd.GeoDataFrame:
    """
    Fallback when MANUAL_STATIONS is empty in config.py. OSM's
    amenity=fire_station tagging is community-contributed and often
    incomplete, missing names, or duplicated (the same station tagged as
    both a node and an outline) — this is the less reliable path. Prefer
    filling in MANUAL_STATIONS instead once you've verified real addresses.
    """
    tags = {"amenity": "fire_station"}
    print("Querying OSM for tagged fire stations across the district (fallback — MANUAL_STATIONS is empty in config.py)...")
    gdf = ox.features_from_polygon(district_polygon, tags)
    gdf = gdf[gdf.geometry.type.isin(["Point", "Polygon", "MultiPolygon"])].copy()

    # Compute centroids in a projected CRS, not lat/lon (same reasoning as
    # step2_fetch_demand.py — geometry math on raw lat/lon is inaccurate).
    utm_crs = gdf.estimate_utm_crs()
    gdf = gdf.to_crs(utm_crs)
    gdf["geometry"] = gdf.geometry.centroid
    gdf = gdf.to_crs("EPSG:4326")

    gdf = gdf.reset_index()[["osmid", "name", "geometry"]] if "osmid" in gdf.reset_index().columns \
        else gdf.reset_index()[["geometry"]]

    # De-duplicate points that are essentially the same physical station
    # (OSM sometimes has both a node and an outline/way for one building).
    # 60m is generous enough to catch "same building, different tag" while
    # not merging two genuinely separate nearby stations.
    gdf_utm = gdf.to_crs(gdf.estimate_utm_crs())
    keep = []
    used = set()
    for i, geom_i in enumerate(gdf_utm.geometry):
        if i in used:
            continue
        keep.append(i)
        for j in range(i + 1, len(gdf_utm)):
            if j in used:
                continue
            if geom_i.distance(gdf_utm.geometry.iloc[j]) < 60:
                used.add(j)
    if len(keep) < len(gdf):
        print(f"  merged {len(gdf) - len(keep)} likely-duplicate point(s) within 60m of another")
    gdf = gdf.iloc[keep].reset_index(drop=True)

    print(f"  found {len(gdf)} station(s) tagged in OSM after de-duplication — VERIFY THIS LIST MANUALLY:")
    for _, row in gdf.iterrows():
        name = row.get("name", "unnamed")
        print(f"    - {name} at {row.geometry.y:.5f}, {row.geometry.x:.5f}")
    print(
        "  Strongly recommended: fill in MANUAL_STATIONS in config.py with "
        "verified addresses instead of trusting this list — see the comment "
        "there for why."
    )
    return gdf


def snap_points_to_graph(gdf: gpd.GeoDataFrame, G: nx.MultiDiGraph) -> gpd.GeoDataFrame:
    xs = gdf.geometry.x.values
    ys = gdf.geometry.y.values
    gdf = gdf.copy()
    gdf["node_id"] = ox.nearest_nodes(G, xs, ys)
    return gdf


def candidates_from_intersections(G: nx.MultiDiGraph) -> gpd.GeoDataFrame:
    """
    Every node with degree >= 3 in the undirected sense is a real
    intersection (not just a bend in the road), and is a plausible site for
    a station in the sense that it's on the road network and well-connected.
    This will include unrealistic sites (private property, etc.) — that's
    fine for a first pass; a filter against public-land parcels is a good
    later refinement if your county publishes parcel data.
    """
    Gu = G.to_undirected()
    deg = dict(Gu.degree())
    nodes = [n for n, d in deg.items() if d >= 3]
    print(f"  {len(nodes)} intersection nodes (degree >= 3) found")

    if len(nodes) > MAX_CANDIDATES:
        rng = np.random.default_rng(42)
        nodes = list(rng.choice(nodes, size=MAX_CANDIDATES, replace=False))
        print(f"  sampled down to {MAX_CANDIDATES} for runtime")

    rows = []
    for n in nodes:
        data = G.nodes[n]
        rows.append({"node_id": n, "geometry": gpd.points_from_xy([data["x"]], [data["y"]])[0]})
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def candidates_from_grid(G: nx.MultiDiGraph, spacing_m: float) -> gpd.GeoDataFrame:
    nodes_gdf, _ = ox.graph_to_gdfs(G)
    bounds = nodes_gdf.to_crs(nodes_gdf.estimate_utm_crs()).total_bounds
    utm_crs = nodes_gdf.estimate_utm_crs()

    xs = np.arange(bounds[0], bounds[2], spacing_m)
    ys = np.arange(bounds[1], bounds[3], spacing_m)
    grid_pts = gpd.GeoDataFrame(
        geometry=gpd.points_from_xy(np.repeat(xs, len(ys)), np.tile(ys, len(xs))),
        crs=utm_crs,
    ).to_crs("EPSG:4326")

    grid_pts = snap_points_to_graph(grid_pts, G)
    grid_pts = grid_pts.drop_duplicates(subset="node_id")
    print(f"  {len(grid_pts)} grid candidates at {spacing_m}m spacing")

    if len(grid_pts) > MAX_CANDIDATES:
        grid_pts = grid_pts.sample(n=MAX_CANDIDATES, random_state=42)
        print(f"  sampled down to {MAX_CANDIDATES}")
    return grid_pts


def main():
    graph_path = os.path.join(OUT_DIR, "raw_graph.graphml")
    if not os.path.exists(graph_path):
        raise SystemExit("Run step1_fetch_roads.py first.")
    G = ox.load_graphml(graph_path)

    try:
        if MANUAL_STATIONS:
            stations = fetch_manual_stations(MANUAL_STATIONS)
        else:
            boundary = get_district_boundary()
            stations = fetch_existing_stations_from_osm(boundary.geometry.iloc[0])
        stations = snap_points_to_graph(stations, G) if len(stations) else stations
    except Exception as e:
        print(f"  WARNING: station fetch failed ({e}). Producing an empty file — "
              "you MUST fill in MANUAL_STATIONS in config.py before Step 4.")
        stations = gpd.GeoDataFrame(columns=["name", "node_id", "geometry"], geometry="geometry", crs="EPSG:4326")

    stations_path = os.path.join(OUT_DIR, "existing_stations.geojson")
    stations.to_file(stations_path, driver="GeoJSON")
    print(f"Saved {stations_path}")

    if CANDIDATE_METHOD == "grid":
        candidates = candidates_from_grid(G, CANDIDATE_GRID_SPACING_METERS)
    else:
        candidates = candidates_from_intersections(G)

    candidates_path = os.path.join(OUT_DIR, "candidate_sites.geojson")
    candidates.to_file(candidates_path, driver="GeoJSON")
    print(f"Saved {candidates_path}")


if __name__ == "__main__":
    main()
