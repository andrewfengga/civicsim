"""
Step 1b — Fetch Census block population for the study area (a congressional
district, which routinely spans several counties — unlike a single city),
convert each block to a centroid demand point, and snap it to the nearest
road-network node.

Run (after step1_fetch_roads.py):
    python step2_fetch_demand.py

Output:
    ../data/demand_points.geojson

Why block-level centroids: Census blocks are the smallest unit the Census
Bureau publishes population for, so they're the finest resolution available
without buying commercial data. A centroid is a simplification — real
people are spread across the block, not standing at one point — so this is
noted explicitly in the "assumptions" panel of the web app, not hidden.
"""
import os
import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from pygris import blocks

from config import OUT_DIR, CENSUS_API_KEY, STUDY_AREA_NAME
from district_boundary import get_district_boundary, get_counties_overlapping_district


def fetch_blocks_for_county(state_fips: str, county_fips: str, year: int = 2020) -> gpd.GeoDataFrame:
    print(f"  downloading {year} Census blocks for county {county_fips}...")
    return blocks(state=state_fips, county=county_fips, year=year, cache=True)


def fetch_block_population(state_fips: str, county_fips: str, year: int = 2020) -> "dict[str, int]":
    """
    2020 Decennial Census, table P1 (total population), block level,
    scoped to one county. Returns {GEOID20: population}.

    Built directly with `requests` instead of pygris.data.get_census: when
    the Census API returns something that isn't JSON (a rate-limit notice,
    an HTML error page, a malformed-query message), pygris's version hides
    the actual response behind a generic JSONDecodeError. Building the
    call ourselves lets us print exactly what the server said, which is
    the only way to tell "need an API key" apart from "wrong FIPS code"
    apart from "network/firewall is blocking this request" apart from
    "Census API is down".

    Uses CENSUS_API_KEY from config.py if set. Get one instantly at
    https://api.census.gov/data/key_signup.html
    """
    import requests

    url = f"https://api.census.gov/data/{year}/dec/pl"
    params = {
        "get": "NAME,P1_001N",
        "for": "block:*",
        "in": f"state:{state_fips} county:{county_fips}",
    }
    if CENSUS_API_KEY:
        params["key"] = CENSUS_API_KEY

    print(f"  downloading block population counts for county {county_fips}...")

    try:
        r = requests.get(url, params=params, timeout=60)
    except requests.exceptions.RequestException as e:
        raise SystemExit(
            f"\nNetwork request to api.census.gov failed outright: {e}\n"
            "This usually means a firewall, VPN, or antivirus on this machine is "
            "blocking the connection. Try a different network, or temporarily "
            "disable VPN/firewall software and retry."
        )

    if r.status_code != 200:
        raise SystemExit(
            f"\nCensus API returned HTTP {r.status_code}, not 200 (county {county_fips}).\n"
            f"Response body (first 500 chars):\n{r.text[:500]}\n\n"
            "If this mentions a rate limit or 'you have exceeded', either wait "
            "a while or set CENSUS_API_KEY in config.py — get a free key at "
            "https://api.census.gov/data/key_signup.html"
        )

    try:
        data = r.json()
    except requests.exceptions.JSONDecodeError:
        raise SystemExit(
            f"\nCensus API responded with HTTP 200 but the body isn't JSON (county {county_fips}).\n"
            f"Response body (first 500 chars):\n{r.text[:500]}\n\n"
            "This is usually a malformed query (wrong FIPS codes) or the API "
            "silently rejecting the request. Double check the state/county "
            "FIPS printed above are correct, or set CENSUS_API_KEY in "
            "config.py and retry — get a free key at "
            "https://api.census.gov/data/key_signup.html"
        )

    rows = data[1:]
    cols = data[0]
    df = pd.DataFrame(rows, columns=cols)
    df["population"] = df["P1_001N"].astype(int)
    df["GEOID"] = df["state"] + df["county"] + df["tract"] + df["block"]
    print(f"    got {len(df)} block rows, {df['population'].sum():,} people")
    return dict(zip(df["GEOID"], df["population"]))


def snap_to_graph(points: gpd.GeoDataFrame, G: nx.MultiDiGraph) -> gpd.GeoDataFrame:
    xs = points.geometry.x.values
    ys = points.geometry.y.values
    nearest_nodes = ox.nearest_nodes(G, xs, ys)
    points = points.copy()
    points["node_id"] = nearest_nodes
    return points


def main():
    graph_path = os.path.join(OUT_DIR, "raw_graph.graphml")
    if not os.path.exists(graph_path):
        raise SystemExit("Run step1_fetch_roads.py first.")

    boundary = get_district_boundary()
    district_counties = get_counties_overlapping_district(boundary)

    # Fetch blocks + population for EVERY county the district overlaps, then
    # concatenate — a congressional district routinely spans several
    # counties, unlike the single-city version this replaced.
    all_blocks = []
    for _, county_row in district_counties.iterrows():
        state_fips = county_row["STATEFP"]
        county_fips = county_row["COUNTYFP"]
        print(f"County: {county_row['NAME']} (FIPS {county_fips})")
        blk = fetch_blocks_for_county(state_fips, county_fips)
        pop = fetch_block_population(state_fips, county_fips)
        blk["population"] = blk["GEOID20"].map(pop).fillna(0).astype(int)
        all_blocks.append(blk)

    blk = pd.concat(all_blocks, ignore_index=True)
    blk = gpd.GeoDataFrame(blk, geometry="geometry", crs=all_blocks[0].crs)
    print(f"Combined: {len(blk)} blocks across {len(district_counties)} counties, "
          f"{blk['population'].sum():,} total people before district clipping")

    # Membership test: is each block's CENTROID inside the district
    # boundary? Deliberately NOT gpd.clip() here. clip() trims a block's
    # shape to the boundary but leaves its population attribute untouched —
    # so a block that's only 20% inside the district would still contribute
    # 100% of its population, inflating the total for every block that
    # straddles the edge. Testing the centroid instead means each block
    # counts as either fully in or fully out, which is the standard,
    # defensible way to assign population to a boundary using whole-block
    # Census data (the alternative — splitting population by intersection
    # area — assumes uniform density within a block, which is its own,
    # messier approximation). Compute the centroid in a projected CRS
    # first; geometry math on raw lat/lon coordinates is measurably
    # inaccurate.
    utm_crs = blk.estimate_utm_crs()
    blk_utm = blk.to_crs(utm_crs)
    centroids = blk_utm.copy()
    centroids["geometry"] = blk_utm.geometry.centroid

    boundary_utm = boundary.to_crs(utm_crs)
    in_district = gpd.sjoin(centroids, boundary_utm[["geometry"]], predicate="within", how="inner")
    print(f"  {len(in_district)} blocks have their centroid inside the district boundary")

    in_district = in_district[in_district["population"] > 0].copy()
    print(f"  {len(in_district)} of those have nonzero population")

    in_district = in_district.to_crs("EPSG:4326")

    G = ox.load_graphml(graph_path)
    demand = snap_to_graph(in_district, G)

    out = demand[["GEOID20", "population", "node_id", "geometry"]].rename(
        columns={"GEOID20": "block_id"}
    )
    total_pop = int(out["population"].sum())
    print(f"  total demand population: {total_pop:,}")
    print(
        f"  SANITY CHECK: {STUDY_AREA_NAME} should have roughly 760,000-770,000 "
        "people (the target size Congress draws districts to after each "
        "reapportionment). A large gap likely means a county's blocks got "
        "clipped oddly at the district line, or a populated block sits just "
        "outside — worth a one-line mention in your write-up, not a bug to "
        "keep chasing."
    )

    out_path = os.path.join(OUT_DIR, "demand_points.geojson")
    out.to_file(out_path, driver="GeoJSON")
    print(f"Saved {out_path}")


if __name__ == "__main__":
    main()
