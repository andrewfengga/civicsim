import { incrementalAddSource } from "./dijkstra.js";
import { computeCoverage } from "./coverage.js";
/**
 * Greedy maximal-covering-location selection: repeatedly pick the single
 * candidate site that helps the most, given everything picked so far, until
 * `budget` stations are placed or no remaining candidate helps at all.
 *
 * This is the standard greedy heuristic for the maximal covering location
 * problem (MCLP). It isn't guaranteed globally optimal — a different pair of
 * stations could in principle beat the two this picks one-at-a-time — but
 * it's a provably-good approximation (within a constant factor for the
 * submodular coverage objective) and, unlike exact selection, it's cheap
 * enough to run interactively: budget * candidates single-source Dijkstra
 * calls, each pruned by `cutoffSeconds` the same way the click-to-add path
 * already is.
 *
 * Ranking uses two numbers, most important first:
 *   1. Newly-covered population — the primary goal, matching the metrics
 *      panel's headline "% within target" number.
 *   2. Weighted travel-time reduction across ALL demand — a tie-breaker,
 *      and also what keeps the optimizer useful once coverage is already
 *      near 100%: a candidate that shaves minutes off already-covered
 *      points but crosses no one over the line still has a real score
 *      instead of losing to an arbitrary first-candidate default.
 *
 * Stops early once a round finds a candidate that helps NOT AT ALL (zero
 * newly covered, zero time reduction) — every remaining candidate would
 * only place a station where it does literally nothing, so there is
 * nothing left worth recommending even if the budget isn't spent.
 */
export function greedyOptimizeStations(graph, demand, candidateNodeIndices, baselineTimes, targetSeconds, capSecondsForMean, budget, cutoffSeconds) {
    let currentTimes = baselineTimes.slice();
    const remaining = new Set(candidateNodeIndices);
    const steps = [];
    for (let round = 0; round < budget && remaining.size > 0; round++) {
        let bestNode = -1;
        let bestTimes = null;
        let bestNewlyCovered = -1;
        let bestTimeReduction = -Infinity;
        for (const candidate of remaining) {
            const trialTimes = incrementalAddSource(graph, currentTimes, candidate, cutoffSeconds);
            let newlyCovered = 0;
            let timeReduction = 0;
            for (const d of demand) {
                const before = currentTimes[d.nodeIdx];
                const after = trialTimes[d.nodeIdx];
                if (before > targetSeconds && after <= targetSeconds) {
                    newlyCovered += d.population;
                }
                const cappedBefore = Math.min(before, capSecondsForMean);
                const cappedAfter = Math.min(after, capSecondsForMean);
                timeReduction += (cappedBefore - cappedAfter) * d.population;
            }
            const better = newlyCovered > bestNewlyCovered ||
                (newlyCovered === bestNewlyCovered && timeReduction > bestTimeReduction);
            if (better) {
                bestNode = candidate;
                bestTimes = trialTimes;
                bestNewlyCovered = newlyCovered;
                bestTimeReduction = timeReduction;
            }
        }
        if (bestNode === -1 || (bestNewlyCovered <= 0 && bestTimeReduction <= 0))
            break;
        currentTimes = bestTimes;
        remaining.delete(bestNode);
        steps.push({
            nodeIdx: bestNode,
            newlyCoveredPopulation: bestNewlyCovered,
            weightedTimeReductionSeconds: bestTimeReduction,
            coverageAfter: computeCoverage(demand, currentTimes, targetSeconds, capSecondsForMean),
        });
    }
    return { steps, finalTimes: currentTimes };
}
//# sourceMappingURL=optimizer.js.map