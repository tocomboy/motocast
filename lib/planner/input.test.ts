import { describe, expect, it } from "vitest";

import { parseSelectedPlace, parseTripInput, PlannerInputError } from "./input";

const place = {
  kakaoPlaceId: "12345",
  verificationToken: "a".repeat(43),
  name: "팔당역",
  address: "경기도 남양주시 와부읍",
  roadAddress: "경기도 남양주시 경강로 111",
  latitude: 37.547,
  longitude: 127.243,
};

const stop = (name: string, dwellMinutes: number) => ({
  place: { ...place, kakaoPlaceId: name, name },
  kind: "stop",
  dwellMinutes,
  selected: true,
  winding: false,
});

function validTrip() {
  return {
    title: "북한강 당일 라이딩",
    serviceDate: "2026-08-31",
    departureAt: "2026-08-31T07:30:00+09:00",
    origin: place,
    destination: { ...place, kakaoPlaceId: "67890" },
    lunch: stop("lunch", 60),
    dinner: null,
    waypoints: [],
  };
}

describe("parseSelectedPlace", () => {
  it("requires a Kakao result identity rather than accepting free text", () => {
    expect(() => parseSelectedPlace({ ...place, kakaoPlaceId: "" })).toThrowError(
      new PlannerInputError("INVALID_KAKAO_PLACE_ID"),
    );
  });

  it("rejects coordinates outside the supported Korea boundary", () => {
    expect(() => parseSelectedPlace({ ...place, longitude: 139.6917, latitude: 35.6895 })).toThrowError(
      new PlannerInputError("PLACE_OUTSIDE_KOREA"),
    );
  });
});

describe("parseTripInput", () => {
  it("normalizes a valid under-24-hour trip", () => {
    const parsed = parseTripInput(validTrip());
    expect(parsed.departureAt).toBe("2026-08-30T22:30:00.000Z");
    expect(parsed.dinner).toBeNull();
    expect(parsed.lunch?.dwellMinutes).toBe(60);
  });

  it("allows a missing lunch and rejects a malformed selected lunch", () => {
    expect(parseTripInput({ ...validTrip(), lunch: null }).lunch).toBeNull();
    const input = validTrip();
    input.lunch.kind = "pass-through";
    expect(() => parseTripInput(input)).toThrowError(new PlannerInputError("INVALID_LUNCH_STOP"));
  });

  it("rejects an impossible calendar date", () => {
    const input = validTrip();
    input.serviceDate = "2026-02-31";
    expect(() => parseTripInput(input)).toThrowError(new PlannerInputError("INVALID_SERVICE_DATE"));
  });

  it("rejects an impossible RFC 3339 timestamp instead of allowing Date normalization", () => {
    const input = validTrip();
    input.departureAt = "2026-02-31T07:30:00+09:00";
    input.serviceDate = "2026-03-03";
    expect(() => parseTripInput(input)).toThrowError(new PlannerInputError("INVALID_DEPARTURE_AT"));
  });

  it("requires an explicit RFC 3339 timezone", () => {
    const input = validTrip();
    input.departureAt = "2026-08-31T07:30:00";
    expect(() => parseTripInput(input)).toThrowError(new PlannerInputError("INVALID_DEPARTURE_AT"));
  });

  it("requires the departure timestamp to match the selected Seoul service date", () => {
    const input = validTrip();
    input.serviceDate = "2026-09-01";
    expect(() => parseTripInput(input)).toThrowError(new PlannerInputError("DEPARTURE_DATE_MISMATCH"));
  });
});
