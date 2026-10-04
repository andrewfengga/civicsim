/**
 * Standalone CLI check — not a test, a one-off report. Loads a real
 * civicsim_graph.json (produced by the Python pipeline) and prints the
 * SAME kind of numbers the original pitch promised:
 *   "71% of residents within 5 minutes, mean travel time 6.24 min"
 * except computed for real, from your actual road network, actual
 * population, and actual verified station locations.
 *
 * Run from the web/ folder:
 *   npx ts-node src/scripts/checkCoverage.ts
 * or, since this project has no ts-node dependency (kept zero-dependency
 * on purpose — see binaryHeap.ts), compile then run:
 *   npm run build
 *   node dist/scripts/checkCoverage.js
 *
 * Optional args:
 *   node dist/scripts/checkCoverage.js [path-to-json] [target-minutes]
 * Defaults to ../data/civicsim_graph.json and 5 minutes.
 */
import * as fs from "fs";
import * as path from "path";
import { parseBundle } from "../engine/loadGraph.js";
import { multiSourceDijkstra } from "../engine/dijkstra.js";
import { computeCoverage, formatMinutes } from "../engine/coverage.js";
import { CivicSimBundle } from "../engine/types.js";

function main(): void {
  const jsonPathArg = process.argv[2] || path.join(__dirname, "..", "..", "..", "data", "civicsim_graph.json");
  const targetMinutesArg = process.argv[3] ? parseFloat(process.argv[3]) : 5.0;
  const targetSeconds = targetMinutesArg * 60;
  const capSecondsForMean = targetSeconds * 4; // generous cap, see coverage.ts docstring

  if (!fs.existsSync(jsonPathArg)) {
    console.error(`File not found: ${jsonPathArg}`);
    console.error("Pass the path explicitly: node dist/scripts/checkCoverage.js path/to/civicsim_graph.json");
    process.exit(1);
  }

  console.log(`Loading ${jsonPathArg} ...`);
  const raw = fs.readFileSync(jsonPathArg, "utf-8");
  const bundle: CivicSimBundle = JSON.parse(raw);
  const data = parseBundle(bundle);

  console.log(`\n${data.meta.nodeCount} road nodes, ${data.meta.edgeCount} directed edges`);
  console.log(`${data.meta.existingStationCount} existing station(s):`);
  data.existingStationNames.forEach((name, i) => {
    console.log(`  - ${name} (node ${data.existingStationNodeIndices[i]})`);
  });

  const t0 = Date.now();
  const travelTimes = multiSourceDijkstra(data.graph, data.existingStationNodeIndices);
  const elapsedMs = Date.now() - t0;

  const stats = computeCoverage(data.demand, travelTimes, targetSeconds, capSecondsForMean);

  console.log(`\n--- Current coverage (target: ${targetMinutesArg} min), computed in ${elapsedMs}ms ---`);
  console.log(`  ${(stats.coveredFraction * 100).toFixed(1)}% of residents within ${targetMinutesArg} min`);
  console.log(`  Mean travel time (covered residents): ${formatMinutes(stats.meanTravelTimeSeconds)} min`);
  console.log(`  Mean travel time (all residents, capped): ${formatMinutes(stats.meanTravelTimeSecondsAll)} min`);
  console.log(`  ${stats.uncoveredPopulation.toLocaleString()} residents outside target coverage`);
  console.log(`  (${stats.coveredPopulation.toLocaleString()} / ${stats.totalPopulation.toLocaleString()} total)`);

  const unreachable = data.demand.filter((d) => travelTimes[d.nodeIdx] === Infinity);
  if (unreachable.length > 0) {
    const pop = unreachable.reduce((s, d) => s + d.population, 0);
    console.log(
      `\n  WARNING: ${unreachable.length} demand point(s) (${pop.toLocaleString()} people) are ` +
      `UNREACHABLE from any station — likely a road-network connectivity gap. ` +
      `Investigate before trusting the coverage number above.`
    );
    console.log(
      `  This graph is DIRECTED (one-way streets respected), so "unreachable" means ` +
      `no directed path from any station — possibly a real one-way configuration, ` +
      `possibly an OSM tagging quirk. Look these up on Google Maps:`
    );
    for (const d of unreachable) {
      const lon = data.graph.lon[d.nodeIdx];
      const lat = data.graph.lat[d.nodeIdx];
      console.log(
        `    - block ${d.blockId}, population ${d.population}: ` +
        `https://www.google.com/maps?q=${lat},${lon}`
      );
    }
  }
}

main();
