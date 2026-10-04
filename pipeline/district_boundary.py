"""
Shared helper: fetch (and cache) Georgia's 7th Congressional District
boundary from the Census Bureau's own TIGER/Line data via pygris, so
step1/step2/step3 all use the EXACT same polygon instead of three separate
derivations that could quietly drift apart.

Also resolves which counties the district actually overlaps — needed
because, unlike a single city, a congressional district routinely spans
several counties, and step2's block-population fetch is scoped per county.
"""
import os
import geopandas as gpd
from pygris import congressional_districts, counties

from config import STATE_FIPS, CONGRESSIONAL_DISTRICT, DISTRICT_YEAR, OUT_DIR

_BOUNDARY_CACHE_PATH = os.path.join(OUT_DIR, "district_boundary.geojson")

# Below this, a county "intersecting" the district is almost always just a
# floating-point boundary touch (two polygons sharing an edge/corner with
# ~zero real overlap area), not a real sliver that could contain a populated
# Census block. Real slivers in practice run from tens to hundreds of km^2;
# 1 km^2 comfortably separates the two without risking dropping a genuine
# (if small) piece of the district.
_MIN_REAL_OVERLAP_KM2 = 1.0


def get_district_boundary() -> gpd.GeoDataFrame:
    """Returns a 1-row GeoDataFrame with the district's official boundary polygon in EPSG:4326."""
    if os.path.exists(_BOUNDARY_CACHE_PATH):
        return gpd.read_file(_BOUNDARY_CACHE_PATH)

    print(f"Fetching congressional district boundaries for state {STATE_FIPS} ({DISTRICT_YEAR})...")
    all_districts = congressional_districts(state=STATE_FIPS, cb=True, year=DISTRICT_YEAR, cache=True)

    district_col = next(
        (c for c in all_districts.columns if c.upper().startswith("CD") and c.upper().endswith("FP")), None
    )
    if district_col is None:
        raise RuntimeError(
            f"Couldn't find a congressional-district-number column in pygris's output. "
            f"Columns were: {list(all_districts.columns)}. Look for one holding two-digit "
            "district numbers (e.g. CD119FP) and adjust district_boundary.py."
        )

    match = all_districts[all_districts[district_col] == CONGRESSIONAL_DISTRICT]
    if len(match) == 0:
        raise RuntimeError(
            f"No district '{CONGRESSIONAL_DISTRICT}' found in state {STATE_FIPS} for year {DISTRICT_YEAR}. "
            f"Available: {sorted(all_districts[district_col].unique())}"
        )
    if len(match) > 1:
        raise RuntimeError(f"Matched {len(match)} rows for district '{CONGRESSIONAL_DISTRICT}' — expected 1.")

    boundary = match.iloc[[0]].to_crs("EPSG:4326")

    os.makedirs(OUT_DIR, exist_ok=True)
    boundary.to_file(_BOUNDARY_CACHE_PATH, driver="GeoJSON")
    print(f"  matched district, saved boundary to {_BOUNDARY_CACHE_PATH}")
    return boundary


def get_counties_overlapping_district(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Returns the county rows (STATEFP/COUNTYFP/NAME/geometry) with REAL area
    overlap with the district boundary — i.e. what step2 needs to know to
    fetch Census blocks from the right counties. Filters out boundary-touch
    artifacts (see _MIN_REAL_OVERLAP_KM2 above).
    """
    print(f"Finding counties overlapping the district...")
    all_counties = counties(state=STATE_FIPS, cb=True, year=DISTRICT_YEAR, cache=True)

    utm_crs = boundary.estimate_utm_crs()
    boundary_utm = boundary.to_crs(utm_crs)
    counties_utm = all_counties.to_crs(utm_crs)
    district_geom = boundary_utm.geometry.iloc[0]

    candidates = counties_utm[counties_utm.intersects(district_geom)].copy()
    candidates["overlap_km2"] = candidates.geometry.intersection(district_geom).area / 1e6
    real = candidates[candidates["overlap_km2"] >= _MIN_REAL_OVERLAP_KM2]

    print(f"  {len(real)} counties with real overlap:")
    for _, row in real.sort_values("overlap_km2", ascending=False).iterrows():
        print(f"    {row['NAME']:12s} FIPS {row['COUNTYFP']}  ({row['overlap_km2']:.0f} km^2 overlap)")

    return real.to_crs("EPSG:4326")[["STATEFP", "COUNTYFP", "NAME", "geometry"]]
