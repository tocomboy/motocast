import { describe, expect, it } from "vitest";

import { applyMotorcycleRoutePolicy } from "./kakao-safety";

describe("applyMotorcycleRoutePolicy", () => {
  it("forces the single recommended motorcycle policy", () => {
    const url = applyMotorcycleRoutePolicy(new URL("https://apis-navi.kakaomobility.com/v1/directions"));
    expect(url.searchParams.get("car_type")).toBe("7");
    expect(url.searchParams.get("avoid")).toBe("motorway");
    expect(url.searchParams.get("roadevent")).toBe("0");
    expect(url.searchParams.get("summary")).toBe("false");
    expect(url.searchParams.get("priority")).toBe("RECOMMEND");
    expect(url.searchParams.has("alternatives")).toBe(false);
  });
});
