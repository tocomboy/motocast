import { expect, test } from "@playwright/test";

import { parseSharedRideSnapshot } from "../../lib/sharing/contracts";

const origin = { id: "origin", label: "공개 출발지", longitude: 127, latitude: 37, kind: "pass-through", dwellMinutes: 0, selected: true };
const lunch = { id: "lunch", label: "공개 점심지", longitude: 127.1, latitude: 37.1, kind: "stop", dwellMinutes: 60, selected: true };
const pass = { id: "pass", label: "공개 경유지", longitude: 127.2, latitude: 37.2, kind: "pass-through", dwellMinutes: 0, selected: true };
const destination = { id: "destination", label: "공개 복귀지", longitude: 127.3, latitude: 37.3, kind: "pass-through", dwellMinutes: 0, selected: true };

function route(candidate: "balanced" | "winding" | "short", offset: number) {
  const points = [origin, lunch, pass, destination];
  const times = [
    ["2030-01-01T00:00:00.000Z", "2030-01-01T01:00:00.000Z", 60],
    ["2030-01-01T02:00:00.000Z", "2030-01-01T03:00:00.000Z", 0],
    ["2030-01-01T03:00:00.000Z", "2030-01-01T04:00:00.000Z", 0],
  ] as const;
  return {
    candidate: { id: candidate, label: candidate === "balanced" ? "균형" : candidate === "winding" ? "와인딩 추정" : "최단", estimatedWinding: candidate === "winding" },
    safety: { vehicle: "motorcycle", motorwayExcluded: true, fallbackUsed: false },
    totalDistanceMeters: 30_000,
    totalDurationSeconds: 14_400,
    returnAt: "2030-01-01T04:00:00.000Z",
    legs: times.map(([departureAt, arrivalAt, dwellMinutes], index) => ({
      from: points[index],
      to: points[index + 1],
      via: [],
      departureAt,
      arrivalAt,
      dwellMinutes,
      distanceMeters: 10_000,
      durationSeconds: 3_600,
      forecastTraffic: false,
      sections: [{
        distance: 10_000,
        duration: 3_600,
        roads: [{
          name: `공개 도로 ${index + 1}`,
          distance: 10_000,
          duration: 3_600,
          vertexes: [
            points[index].longitude,
            points[index].latitude,
            points[index].longitude + 0.04 + offset / 1_000_000,
            points[index].latitude + 0.06,
            points[index + 1].longitude,
            points[index + 1].latitude,
          ],
        }],
      }],
    })),
  };
}

function snapshot() {
  const routes = [
    { profile: "balanced", route: route("balanced", 0) },
    { profile: "winding", route: route("winding", 1_000) },
    { profile: "short", route: route("short", -1_000) },
  ];
  return {
    schemaVersion: 2,
    trip: {
      title: "공개 날씨 표시 검증",
      serviceDate: "2030-01-01",
      departureAt: "2030-01-01T00:00:00.000Z",
      origin,
      destination,
      lunchStop: lunch,
      dinnerStop: null,
      selectedProfile: "balanced",
    },
    waypoints: [
      { ...lunch, position: 0, winding: false },
      { ...pass, position: 1, winding: true },
    ],
    routes,
    weather: {
      source: "kma",
      issuedAt: "2029-12-31T23:30:00.000Z",
      retrievedAt: "2029-12-31T23:35:00.000Z",
      validUntil: "2030-01-06T00:00:00.000Z",
      stale: true,
      staleObservedAt: "2029-12-31T23:40:00.000Z",
      staleReason: "기상청 요청에 실패했습니다.",
      failureKind: "provider",
      candidateProfile: "balanced",
      segments: [
        {
          id: "balanced-0", label: lunch.label, longitude: lunch.longitude, latitude: lunch.latitude,
          eta: "2030-01-01T01:00:00.000Z", status: "forecast", model: "ultra",
          issuedAt: "2029-12-31T23:30:00.000Z", condition: "clear", temperatureC: 12,
          precipitationProbability: 10, windSpeedMps: 2.1,
        },
        {
          id: "balanced-1", label: pass.label, longitude: pass.longitude, latitude: pass.latitude,
          eta: "2030-01-01T03:00:00.000Z", status: "forecast", model: "short",
          issuedAt: "2029-12-31T23:00:00.000Z", condition: "rain", temperatureC: 9,
          precipitationProbability: 70, windSpeedMps: 7.2,
        },
        {
          id: "balanced-2", label: destination.label, longitude: destination.longitude, latitude: destination.latitude,
          eta: "2030-01-01T04:00:00.000Z", status: "outside-window", reason: "FORECAST_WINDOW_EXCEEDED",
        },
      ],
    },
  };
}

test("renders model, outside-window, and stale states without changing route order", async ({ page }) => {
  expect(() => parseSharedRideSnapshot(snapshot())).not.toThrow();
  await page.route("**/api/shares/resolve", async (request) => {
    await request.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ snapshot: snapshot() }) });
  });

  const resolution = page.waitForResponse((response) => response.url().endsWith("/api/shares/resolve"));
  await page.goto(`/share#${"a".repeat(43)}`);
  await expect((await resolution).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "구간 통과 시각별 날씨" })).toBeVisible();
  await expect(page.locator(".shared-weather-state")).toContainText("기상청 공급자 오류 후 저장본");
  await expect(page.locator(".shared-weather-reason")).toHaveText("기상청 요청에 실패했습니다.");
  await expect(page.locator(".shared-weather-list")).toContainText("초단기예보");
  await expect(page.locator(".shared-weather-list")).toContainText("단기예보");
  await expect(page.locator(".shared-weather-list")).toContainText("상세 예보 기간 밖 · 기상청 상세 호출 없음");
  await expect(page.locator(".shared-routes article").nth(0)).toContainText("균형");
  await expect(page.locator(".shared-routes article").nth(1)).toContainText("와인딩 추정");
  await expect(page.locator(".shared-routes article").nth(2)).toContainText("최단");
  await expect.poll(() => page.url()).not.toContain("#");
});
