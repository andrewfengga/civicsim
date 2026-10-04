/// <reference path="./leaflet-shim.d.ts" />
import { loadCivicSimData, LoadedCivicSimData } from "../engine/loadGraph.js";
import { multiSourceDijkstra, incrementalAddSource } from "../engine/dijkstra.js";
import { asDistanceGraph } from "../engine/graph.js";
import { computeCoverage, formatMinutes } from "../engine/coverage.js";
import { greedyOptimizeStations, OptimizerStep } from "../engine/optimizer.js";
import { CompactGraph, TravelTimes } from "../engine/types.js";
import { findNearestNode } from "./nearestNode.js";

// --- Configuration ---------------------------------------------------------
// TODO once you have calibration data (README Step 4): replace these
// defaults with values backed by your department's actual targets, and cite
// them in your write-up rather than leaving them as assumptions.
const MILES_TO_METERS = 1609.34;

const MIN_TARGET_MINUTES = 1, MAX_TARGET_MINUTES = 15, STEP_TARGET_MINUTES = 0.5, DEFAULT_TARGET_MINUTES = 5;
const MIN_TARGET_MILES = 0.25, MAX_TARGET_MILES = 5, STEP_TARGET_MILES = 0.25, DEFAULT_TARGET_MILES = 1.5;

// How far the pruned incremental search explores past a new candidate
// station before giving up — fixed to a generous multiple of the SLIDER'S
// MAX (not its current value), so dragging the slider is a pure re-render
// with zero risk of an under-count from a cutoff that's suddenly too tight.
// See dijkstra.ts's correctness note.
const TIME_CUTOFF_SECONDS = MAX_TARGET_MINUTES * 60 * 4;
const DISTANCE_CUTOFF_METERS = MAX_TARGET_MILES * MILES_TO_METERS * 4;

// Relative on purpose: the same page works from web/public locally and from
// the GitHub Pages folder (docs/), since each one has its own data/ next to it.
const DATA_URL = "data/civicsim_graph.json";

// --- State -------------------------------------------------------------
type Metric = "time" | "distance";

let data: LoadedCivicSimData;
let distanceGraph: CompactGraph; // same topology as data.graph, edgeWeight = meters instead of seconds
let baselineTimes: TravelTimes; // travel TIME with ONLY the real existing stations
let baselineDistances: TravelTimes; // travel DISTANCE with ONLY the real existing stations
let currentTimes: TravelTimes; // travel time including any added candidate stations
let currentDistances: TravelTimes; // travel distance including any added candidate stations

let metric: Metric = "time";
let targetMinutes = DEFAULT_TARGET_MINUTES;
let targetMiles = DEFAULT_TARGET_MILES;

let map: any;
let demandMarkers: any[] = []; // parallel to data.demand
let addedStations: { nodeIdx: number; marker: any; source: "user" | "optimizer" }[] = [];

// --- Metric helpers --------------------------------------------------------
// Everything below reads through these instead of touching currentTimes /
// currentDistances / targetMinutes / targetMiles directly, so the rest of
// the file doesn't need to know which metric is active.

function activeTravelValues(): TravelTimes {
  return metric === "time" ? currentTimes : currentDistances;
}
function activeGraph(): CompactGraph {
  return metric === "time" ? data.graph : distanceGraph;
}
function activeCutoffSeconds(): number {
  return metric === "time" ? TIME_CUTOFF_SECONDS : DISTANCE_CUTOFF_METERS;
}
function activeTargetValue(): number {
  return metric === "time" ? targetMinutes * 60 : targetMiles * MILES_TO_METERS;
}
function activeCapValue(): number {
  return activeTargetValue() * 4; // see coverage.ts docstring for why a cap
}
function activeUnitLabel(): string {
  return metric === "time" ? "min" : "mi";
}
function formatActiveValue(value: number): string {
  return metric === "time" ? formatMinutes(value) : formatMiles(value);
}
function formatMiles(meters: number): string {
  return (meters / MILES_TO_METERS).toFixed(2);
}

/**
 * Extends BOTH currentTimes and currentDistances by the same set of new
 * station nodes, regardless of which metric is currently displayed — this
 * is what keeps switching the Time/Distance toggle instant (no recompute
 * needed) no matter when stations were added.
 */
function addStationsToBothMetrics(nodeIndices: number[]): void {
  for (const idx of nodeIndices) {
    currentTimes = incrementalAddSource(data.graph, currentTimes, idx, TIME_CUTOFF_SECONDS);
    currentDistances = incrementalAddSource(distanceGraph, currentDistances, idx, DISTANCE_CUTOFF_METERS);
  }
}

// --- Entry point ---------------------------------------------------------

async function main(): Promise<void> {
  try {
    data = await loadCivicSimData(DATA_URL);
  } catch (e) {
    // Loading failed before the map/panel had anything real to show, so the
    // error goes on the full-screen loading overlay (which is still up)
    // instead of the panel's #status line, which would be sitting behind it.
    showLoadingError(
      `Failed to load ${DATA_URL}: ${e instanceof Error ? e.message : e}. ` +
      `Check that you're running a local server from the PROJECT ROOT ` +
      `(see README) and that data/civicsim_graph.json exists.`
    );
    return;
  }

  distanceGraph = asDistanceGraph(data.graph);
  baselineTimes = multiSourceDijkstra(data.graph, data.existingStationNodeIndices);
  baselineDistances = multiSourceDijkstra(distanceGraph, data.existingStationNodeIndices);
  currentTimes = baselineTimes.slice();
  currentDistances = baselineDistances.slice();

  initMap();
  drawExistingStations();
  drawDemandPoints();
  updateTargetSliderLabel();
  renderMetrics();
  setStatus(`Loaded ${data.meta.totalPopulation.toLocaleString()} residents, ${data.meta.existingStationCount} stations. Click the map to test a new station location.`);
  hideLoadingOverlay();
  maybeShowOnboardingHint();

  map.on("click", onMapClick);
  document.getElementById("reset-btn")!.addEventListener("click", onReset);
  document.getElementById("undo-btn")!.addEventListener("click", onUndoLast);
  document.getElementById("optimize-btn")!.addEventListener("click", onOptimizeClick);
  document.querySelectorAll<HTMLButtonElement>(".metric-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => onMetricToggle(btn.dataset.metric as Metric));
  });
  document.getElementById("target-slider")!.addEventListener("input", onTargetSliderInput);
}

// --- Map setup -----------------------------------------------------------

function initMap(): void {
  // Fit to the actual bounding box of every node, rather than a fixed zoom
  // level — a fixed zoom tuned for a small city would leave a
  // county-spanning study area mostly off-screen (and vice versa).
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (let i = 0; i < data.graph.nodeCount; i++) {
    const lat = data.graph.lat[i];
    const lon = data.graph.lon[i];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  // preferCanvas: with thousands of demand-point circles (a full district
  // has 5,000+), rendering each as its own SVG DOM element gets sluggish,
  // especially on mobile. Canvas draws them all on one surface instead.
  map = L.map("map", { preferCanvas: true });
  map.fitBounds([[minLat, minLon], [maxLat, maxLon]]);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

function drawExistingStations(): void {
  data.existingStationNodeIndices.forEach((nodeIdx, i) => {
    const lat = data.graph.lat[nodeIdx];
    const lon = data.graph.lon[nodeIdx];
    L.marker([lat, lon], { title: data.existingStationNames[i] })
      .addTo(map)
      .bindPopup(`<b>${escapeHtml(data.existingStationNames[i])}</b><br>Existing station`);
  });
}

function drawDemandPoints(): void {
  demandMarkers = data.demand.map((d) => {
    const lat = data.graph.lat[d.nodeIdx];
    const lon = data.graph.lon[d.nodeIdx];
    const radius = Math.max(3, Math.sqrt(d.population) * 0.6);
    const marker = L.circleMarker([lat, lon], {
      radius,
      weight: 1,
      fillOpacity: 0.6,
    }).addTo(map);
    marker.bindTooltip(""); // content set by updateDemandMarkerStyles()
    return marker;
  });
  updateDemandMarkerStyles();
}

function updateDemandMarkerStyles(): void {
  const values = activeTravelValues();
  const target = activeTargetValue();
  const unit = activeUnitLabel();

  data.demand.forEach((d, i) => {
    const v = values[d.nodeIdx];
    const marker = demandMarkers[i];
    let color: string;
    let borderWeight: number;
    let statusText: string;
    // Border weight carries the same signal as color, not just as a
    // decoration — readers who have trouble distinguishing green/orange/red
    // (red-green color blindness affects a real fraction of any audience,
    // judges included) can still tell "unreachable" apart by its thick
    // light ring, matching the legend's swatches.
    if (v === Infinity) {
      color = "#7f1d1d"; // dark red — unreachable, a data/connectivity issue, not just "far"
      borderWeight = 2;
      statusText = "unreachable (see README on road-network gaps)";
    } else if (v <= target) {
      color = "#16a34a"; // green — covered
      borderWeight = 1;
      statusText = `${formatActiveValue(v)} ${unit} — within target`;
    } else {
      color = "#f97316"; // orange — reachable but outside target
      borderWeight = 1;
      statusText = `${formatActiveValue(v)} ${unit} — outside target`;
    }
    marker.setStyle({
      color: v === Infinity ? "#f3f4f6" : color,
      fillColor: color,
      weight: borderWeight,
    });
    marker.setTooltipContent(
      `Block ${escapeHtml(d.blockId)}<br>Population: ${d.population.toLocaleString()}<br>${statusText}`
    );
  });
}

// --- Metric / target controls ----------------------------------------------

function onMetricToggle(newMetric: Metric): void {
  if (newMetric === metric) return;
  metric = newMetric;

  document.querySelectorAll<HTMLButtonElement>(".metric-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.metric as Metric) === metric);
  });

  const slider = document.getElementById("target-slider") as HTMLInputElement;
  if (metric === "time") {
    slider.min = String(MIN_TARGET_MINUTES);
    slider.max = String(MAX_TARGET_MINUTES);
    slider.step = String(STEP_TARGET_MINUTES);
    slider.value = String(targetMinutes);
  } else {
    slider.min = String(MIN_TARGET_MILES);
    slider.max = String(MAX_TARGET_MILES);
    slider.step = String(STEP_TARGET_MILES);
    slider.value = String(targetMiles);
  }

  updateTargetSliderLabel();
  updateDemandMarkerStyles();
  renderMetrics();
}

/**
 * Dragging the slider never re-runs Dijkstra — currentTimes/currentDistances
 * already hold real travel values for every node; the target is just the
 * threshold updateDemandMarkerStyles() and computeCoverage() compare against.
 * That's what makes this live-draggable instead of debounced.
 */
function onTargetSliderInput(): void {
  const slider = document.getElementById("target-slider") as HTMLInputElement;
  const value = Number(slider.value);
  if (metric === "time") {
    targetMinutes = value;
  } else {
    targetMiles = value;
  }
  updateTargetSliderLabel();
  updateDemandMarkerStyles();
  renderMetrics();
}

function updateTargetSliderLabel(): void {
  const label = document.getElementById("target-slider-label")!;
  label.textContent =
    metric === "time" ? `Target: ${targetMinutes.toFixed(1)} min` : `Target: ${targetMiles.toFixed(2)} mi`;
}

// --- Interaction -----------------------------------------------------------

function onMapClick(e: any): void {
  const nodeIdx = findNearestNode(data.graph, e.latlng.lat, e.latlng.lng);
  if (nodeIdx < 0) return;

  addStationsToBothMetrics([nodeIdx]);

  const lat = data.graph.lat[nodeIdx];
  const lon = data.graph.lon[nodeIdx];
  const marker = L.marker([lat, lon], {
    title: "Candidate station",
    icon: L.divIcon({
      className: "candidate-station-icon",
      html: "🚒",
      iconSize: [24, 24],
    }),
  })
    .addTo(map)
    .bindPopup("Candidate station (click Undo or Reset to remove)");

  addedStations.push({ nodeIdx, marker, source: "user" });
  updateDemandMarkerStyles();
  renderMetrics();
}

function onUndoLast(): void {
  const last = addedStations.pop();
  if (!last) return;
  map.removeLayer(last.marker);
  recomputeFromScratch();
  renderOptimizerResults(null);
}

function onReset(): void {
  if (addedStations.length === 0) return;
  addedStations.forEach((s) => map.removeLayer(s.marker));
  addedStations = [];
  currentTimes = baselineTimes.slice();
  currentDistances = baselineDistances.slice();
  updateDemandMarkerStyles();
  renderMetrics();
  renderOptimizerResults(null);
}

// --- Optimizer -----------------------------------------------------------

/**
 * Runs the greedy optimizer over every candidate site NOT already occupied
 * by a real station or a previously-added candidate (user-clicked or
 * optimizer-picked) — otherwise a second "Optimize" click could just
 * re-recommend the same spot someone already placed. Optimizes for whichever
 * metric (time or distance) is currently selected.
 */
function onOptimizeClick(): void {
  const btn = document.getElementById("optimize-btn") as HTMLButtonElement;
  const budgetInput = document.getElementById("optimizer-budget") as HTMLInputElement;
  const budget = Math.max(1, Math.min(10, Math.round(Number(budgetInput.value)) || 1));
  budgetInput.value = String(budget);

  const occupied = new Set<number>([
    ...data.existingStationNodeIndices,
    ...addedStations.map((s) => s.nodeIdx),
  ]);
  const availableCandidates = data.candidateSiteNodeIndices.filter((n) => !occupied.has(n));

  if (availableCandidates.length === 0) {
    renderOptimizerResults([]);
    return;
  }

  btn.disabled = true;
  btn.textContent = "Optimizing…";

  // Defer the (synchronous, CPU-bound) search one tick so the browser can
  // actually paint the "Optimizing…" button state first.
  setTimeout(() => {
    const result = greedyOptimizeStations(
      activeGraph(),
      data.demand,
      availableCandidates,
      activeTravelValues(),
      activeTargetValue(),
      activeCapValue(),
      budget,
      activeCutoffSeconds()
    );

    // Apply the same picks to BOTH metrics, not just the one just optimized
    // for, so toggling Time/Distance afterward doesn't leave the other
    // metric's arrays stale.
    addStationsToBothMetrics(result.steps.map((s) => s.nodeIdx));

    for (const step of result.steps) {
      const lat = data.graph.lat[step.nodeIdx];
      const lon = data.graph.lon[step.nodeIdx];
      const marker = L.marker([lat, lon], {
        title: "Recommended station",
        icon: L.divIcon({
          className: "recommended-station-icon",
          html: "🎯",
          iconSize: [24, 24],
        }),
      })
        .addTo(map)
        .bindPopup(
          `<b>Recommended station</b><br>Newly covers ${step.newlyCoveredPopulation.toLocaleString()} residents`
        );
      addedStations.push({ nodeIdx: step.nodeIdx, marker, source: "optimizer" });
    }

    updateDemandMarkerStyles();
    renderMetrics();
    renderOptimizerResults(result.steps);

    btn.disabled = false;
    btn.textContent = "Optimize";
  }, 0);
}

function renderOptimizerResults(steps: OptimizerStep[] | null): void {
  const el = document.getElementById("optimizer-results")!;
  if (steps === null) {
    el.innerHTML = "";
    return;
  }
  if (steps.length === 0) {
    el.innerHTML = "No more improvement available from the remaining candidate sites.";
    return;
  }
  const items = steps
    .map(
      (s) =>
        `<li>+${s.newlyCoveredPopulation.toLocaleString()} residents covered — now ${(s.coverageAfter.coveredFraction * 100).toFixed(1)}% total</li>`
    )
    .join("");
  el.innerHTML = `<ol>${items}</ol>`;
}

/** Re-derives currentTimes/currentDistances from scratch after an undo — see comment below. */
function recomputeFromScratch(): void {
  // Undo can't just "subtract" a source from a min-based array (removing
  // one station might un-improve some nodes that ALSO would have been
  // covered by a still-present station — min() isn't invertible). Full
  // multi-source Dijkstra over existing + remaining added stations is the
  // correct fix, and on a city-size graph this is a few milliseconds — see
  // the benchmark numbers in README, so there's no need for anything
  // cleverer here.
  const allSources = [...data.existingStationNodeIndices, ...addedStations.map((s) => s.nodeIdx)];
  currentTimes = multiSourceDijkstra(data.graph, allSources);
  currentDistances = multiSourceDijkstra(distanceGraph, allSources);
  updateDemandMarkerStyles();
  renderMetrics();
}

// --- Metrics panel -----------------------------------------------------

function renderMetrics(): void {
  const stats = computeCoverage(data.demand, activeTravelValues(), activeTargetValue(), activeCapValue());
  const el = document.getElementById("metrics")!;
  const targetLabel = metric === "time" ? `${targetMinutes.toFixed(1)} min` : `${targetMiles.toFixed(2)} mi`;
  const meanLabel = metric === "time" ? "mean travel time (min)" : "mean travel distance (mi)";
  el.innerHTML = `
    <div class="metric"><span class="metric-value">${(stats.coveredFraction * 100).toFixed(1)}%</span><span class="metric-label">within ${targetLabel}</span></div>
    <div class="metric"><span class="metric-value">${formatActiveValue(stats.meanTravelTimeSecondsAll)}</span><span class="metric-label">${meanLabel}</span></div>
    <div class="metric"><span class="metric-value">${stats.uncoveredPopulation.toLocaleString()}</span><span class="metric-label">residents outside target</span></div>
    <div class="metric"><span class="metric-value">${addedStations.length}</span><span class="metric-label">candidate station(s) added</span></div>
  `;
}

function setStatus(text: string, isError: boolean = false): void {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function hideLoadingOverlay(): void {
  document.getElementById("loading-overlay")?.classList.add("hidden");
}

function showLoadingError(message: string): void {
  const spinner = document.querySelector("#loading-overlay .spinner") as HTMLElement | null;
  if (spinner) spinner.hidden = true;
  const text = document.getElementById("loading-text");
  if (text) {
    text.textContent = message;
    text.style.color = "#fca5a5";
  }
}

const ONBOARDING_DISMISSED_KEY = "civicsim-onboarding-dismissed";

/**
 * Shown once per browser, not once per page load — dismissal is remembered
 * in localStorage. Wrapped in try/catch: some browsers (private windows,
 * locked-down settings) throw on localStorage access rather than just
 * returning null, and a first-run hint isn't worth crashing the app over.
 */
function maybeShowOnboardingHint(): void {
  let alreadyDismissed = false;
  try {
    alreadyDismissed = localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    // localStorage unavailable — just show the hint every time, harmless.
  }
  if (alreadyDismissed) return;

  const hint = document.getElementById("onboarding-hint");
  if (!hint) return;
  hint.hidden = false;
  document.getElementById("onboarding-dismiss")?.addEventListener("click", () => {
    hint.hidden = true;
    try {
      localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    } catch {
      // best-effort only — worst case it reappears next visit
    }
  });
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

main();
