export class RouteDurationAllocationError extends RangeError {
  constructor() {
    super("ROUTE_DURATION_ALLOCATION");
  }
}

function safeDuration(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RouteDurationAllocationError();
  return value;
}

function safeSum(values: readonly number[]) {
  let sum = 0;
  for (const value of values) {
    safeDuration(value);
    sum += value;
    if (!Number.isSafeInteger(sum)) throw new RouteDurationAllocationError();
  }
  return sum;
}

export function allocateDurationByWeight(total: number, weights: readonly number[]) {
  safeDuration(total);
  if (weights.length === 0) throw new RouteDurationAllocationError();
  const weightSum = safeSum(weights);
  if (weightSum <= 0) throw new RouteDurationAllocationError();

  const totalBigInt = BigInt(total);
  const weightSumBigInt = BigInt(weightSum);
  const allocations = weights.map((weight) => Number(totalBigInt * BigInt(weight) / weightSumBigInt));
  const remainders = weights.map((weight, index) => ({
    index,
    remainder: totalBigInt * BigInt(weight) % weightSumBigInt,
  }));
  const allocated = safeSum(allocations);
  const remaining = total - allocated;
  const ranked = remainders
    .filter(({ index }) => weights[index] > 0)
    .sort((left, right) => (
      left.remainder === right.remainder
        ? left.index - right.index
        : left.remainder > right.remainder ? -1 : 1
    ));
  if (remaining < 0 || remaining > ranked.length) throw new RouteDurationAllocationError();
  for (let index = 0; index < remaining; index += 1) allocations[ranked[index].index] += 1;
  if (safeSum(allocations) !== total) throw new RouteDurationAllocationError();
  return allocations;
}

export function allocateRouteDurations<
  TRoad extends { duration: number },
  TSection extends { duration: number; roads: TRoad[] },
>(summaryDuration: number, sections: TSection[]): TSection[] {
  safeDuration(summaryDuration);
  if (summaryDuration <= 0 || sections.length === 0) throw new RouteDurationAllocationError();
  const sectionDurations = allocateDurationByWeight(summaryDuration, sections.map((section) => section.duration));
  if (sectionDurations.some((duration) => duration <= 0)) throw new RouteDurationAllocationError();

  return sections.map((section, sectionIndex) => {
    const duration = sectionDurations[sectionIndex];
    const roadDurations = allocateDurationByWeight(duration, section.roads.map((road) => road.duration));
    return {
      ...section,
      duration,
      roads: section.roads.map((road, roadIndex) => ({
        ...road,
        duration: roadDurations[roadIndex],
      })),
    };
  });
}
