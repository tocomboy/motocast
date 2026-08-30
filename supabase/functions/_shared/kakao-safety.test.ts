import { describe, expect, it } from "vitest";

import { applyMotorcycleRoutePolicy } from "./kakao-safety";

describe("applyMotorcycleRoutePolicy", () => {
  it.each([
    ["balanced", "RECOMMEND", false],
    ["short", "DISTANCE", false],
    ["estimated winding", "RECOMMEND", true],
  ] as const)("forces motorcycle safety for %s", (_name, priority, alternatives) => {
    const url = applyMotorcycleRoutePolicy(
      new URL("https://apis-navi.kakaomobility.com/v1/directions"),
      priority,
      alternatives,
    );
    expect(url.searchParams.get("car_type")).toBe("7");
    expect(url.searchParams.get("avoid")).toBe("motorway");
    expect(url.searchParams.get("roadevent")).toBe("0");
    expect(url.searchParams.get("summary")).toBe("false");
    expect(url.searchParams.get("priority")).toBe(priority);
    expect(url.searchParams.get("alternatives")).toBe(alternatives ? "true" : null);
  });
});
