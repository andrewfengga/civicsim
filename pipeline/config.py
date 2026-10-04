"""
CivicSim pipeline configuration.

Edit the values below for your community, then run the step1-step4 scripts
in order. Everything downstream reads from this file, so you should not
need to touch the other scripts to point CivicSim at a new place.
"""

# --- Required: your study area -------------------------------------------

# Georgia's 7th Congressional District (119th Congress / current map,
# redrawn December 2023). Congressional districts aren't a place name OSM's
# Nominatim can reliably geocode, so the boundary is fetched directly from
# the Census Bureau's own TIGER/Line data via pygris (see
# district_boundary.py) — the same authoritative source the population data
# itself comes from, so the two are guaranteed to agree on where the line is.
STATE_FIPS = "13"  # Georgia
CONGRESSIONAL_DISTRICT = "07"
STUDY_AREA_NAME = "Georgia's 7th Congressional District"  # for logging/display only
DISTRICT_YEAR = 2024  # TIGER vintage year; 2024 = current post-redistricting map

# --- Response-time target --------------------------------------------------

# Minutes. This should match what your local department actually targets,
# not an invented number. NFPA 1710 (career departments) suggests a total of
# 6 min 20 sec turnout+travel for the first-arriving unit on a fire call;
# many departments cite ~5 min travel as a working benchmark. Confirm with
# your department if you can, and say in your write-up where this number
# came from.
TARGET_MINUTES = 5.0

# --- Census API (optional) --------------------------------------------

# Don't put your real key directly in this file — config.py is meant to be
# committed to git (e.g. for your Congressional App Challenge GitHub repo),
# and an API key in a public repo can get scraped and abused even if it's
# low-stakes. Instead:
#   1. Copy pipeline/local_secrets.example.py to pipeline/local_secrets.py
#   2. Paste your key in there
#   3. local_secrets.py is already in .gitignore, so it never gets committed
try:
    from local_secrets import CENSUS_API_KEY
except ImportError:
    CENSUS_API_KEY = ""

# Assumed turnout time (crew getting dressed/onto the truck) in minutes,
# subtracted from any dispatch-to-arrival figures during calibration since
# our model only predicts *travel* time, not turnout.
ASSUMED_TURNOUT_MINUTES = 1.5

# --- Network ----------------------------------------------------------------

# Road network type passed to OSMnx. "drive" is correct for emergency
# vehicles on public roads.
NETWORK_TYPE = "drive"

# Fallback free-flow speeds (km/h) by OSM highway tag, used only for edges
# missing a speed after OSMnx's own imputation. Keep these conservative;
# they get corrected during calibration in Step 4.
FALLBACK_SPEEDS_KPH = {
    "motorway": 105,
    "trunk": 90,
    "primary": 72,
    "secondary": 56,
    "tertiary": 48,
    "residential": 40,
    "living_street": 24,
    "unclassified": 40,
    "service": 24,
}

# --- Candidate sites for new stations ---------------------------------------

# How to generate candidate locations for "where should the next station go".
# "intersections": every arterial/collector road intersection (simple, works
#   everywhere, includes some unrealistic sites like private driveways).
# "grid": a regular grid over the city snapped to the nearest road node
#   (fewer, more evenly spread candidates — faster optimizer, coarser answer).
CANDIDATE_METHOD = "intersections"
CANDIDATE_GRID_SPACING_METERS = 800  # only used if CANDIDATE_METHOD == "grid"
MAX_CANDIDATES = 400  # cap for runtime; sample down if more are generated

# --- Existing stations: manual override (recommended) --------------------

# Automated OSM tag scraping (amenity=fire_station) is unreliable in
# practice — duplicate entries, missing names, sometimes missing or extra
# stations. For a project where "how many people are covered" is the
# headline number, get this list right by hand from each department's own
# published station list, then geocode addresses here instead of trusting
# the scrape. Leave this list EMPTY to fall back to automatic OSM scraping
# (step3_fetch_stations.py will warn you loudly if it does).
#
# Left EMPTY for the district-wide build: GA-07 spans 6 counties (Fulton,
# Forsyth, Cherokee, Hall, Dawson, Lumpkin — see district_boundary.py),
# each with its own fire department (plus city departments like Alpharetta
# within Fulton/Forsyth) — manually verifying every address across all of
# them is a real follow-up task, not a same-session one. This is a
# documented known limitation (like the Avalon road-network gap): OSM's
# amenity=fire_station tagging can have duplicates or miss stations, so
# treat the station count/coverage numbers as a first pass, not verified
# ground truth, until this list is filled in by hand.
MANUAL_STATIONS = []

# --- Output -------------------------------------------------------------

OUT_DIR = "../data"
