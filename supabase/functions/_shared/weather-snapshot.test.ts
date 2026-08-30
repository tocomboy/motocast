import { describe, expect, it } from "vitest";

import { publicWeatherSnapshot } from "./weather-snapshot";

const stored = {
  snapshotId: "snapshot-id",
  issuedAt: "2026-08-31T00:00:00.000Z",
  validUntil: "2026-08-31T02:00:00.000Z",
  generatedAt: "2026-08-31T00:05:00.000Z",
  forecasts: [{}],
  staleObservedAt: null,
  staleReason: null,
  failureKind: null,
};

describe("publicWeatherSnapshot", () => {
  it("omits stale-only null fields from a fresh cache response", () => {
    expect(publicWeatherSnapshot(stored)).toEqual({
      issuedAt: stored.issuedAt,
      validUntil: stored.validUntil,
      generatedAt: stored.generatedAt,
      forecasts: stored.forecasts,
    });
  });

  it("preserves complete structured stale metadata", () => {
    expect(publicWeatherSnapshot({
      ...stored,
      staleObservedAt: "2026-08-31T01:00:00.000Z",
      staleReason: "기상청 요청에 실패했습니다.",
      failureKind: "provider",
    })).toMatchObject({ failureKind: "provider", staleReason: "기상청 요청에 실패했습니다." });
  });
});
