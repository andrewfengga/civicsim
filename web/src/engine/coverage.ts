import { CoverageStats, DemandPoint, TravelTimes } from "./types.js";

/**
 * Turn a per-node travel-time array into the numbers the metrics panel
 * displays: % within target, population-weighted mean time, and the
 * uncovered population count.
 *
 * `capSecondsForMean` bounds how much a single very-far demand point can
 * drag the mean — without it, one demand point that's technically
 * "unreachable" (Infinity) would make the population-weighted mean
 * infinite too, which is not a useful number to show a planner. We cap at
 * a generous multiple of the target instead of silently dropping the
 * point, and say so in the UI.
 */
export function computeCoverage(
  demand: DemandPoint[],
  travelTimes: TravelTimes,
  targetSeconds: number,
  capSecondsForMean: number
): CoverageStats {
  let totalPopulation = 0;
  let coveredPopulation = 0;
  let weightedTimeSum = 0;
  let weightedTimeSumCovered = 0;
  let coveredPopForMean = 0;

  for (const d of demand) {
    const t = travelTimes[d.nodeIdx];
    totalPopulation += d.population;

    if (t <= targetSeconds) {
      coveredPopulation += d.population;
      weightedTimeSumCovered += t * d.population;
      coveredPopForMean += d.population;
    }

    const cappedT = Math.min(t, capSecondsForMean);
    weightedTimeSum += cappedT * d.population;
  }

  const coveredFraction = totalPopulation > 0 ? coveredPopulation / totalPopulation : 0;
  const meanAll = totalPopulation > 0 ? weightedTimeSum / totalPopulation : 0;
  const meanCovered = coveredPopForMean > 0 ? weightedTimeSumCovered / coveredPopForMean : 0;

  return {
    totalPopulation,
    coveredPopulation,
    coveredFraction,
    meanTravelTimeSeconds: meanCovered,
    meanTravelTimeSecondsAll: meanAll,
    uncoveredPopulation: totalPopulation - coveredPopulation,
  };
}

export function formatMinutes(seconds: number): string {
  return (seconds / 60).toFixed(2);
}
