import { describe, expect, it } from "vitest";

import { parseSelectedPlace, parseTripInput, PlannerInputError } from "./input";

const place = {
  kakaoPlaceId: "12345",
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
    desiredReturnAt: "2026-08-31T17:30:00+09:00",
    hardReturnAt: "2026-08-31T18:30:00+09:00",
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
    expect(parsed.lunch.dwellMinutes).toBe(60);
  });

  it("rejects a missing or non-stopping lunch", () => {
    const input = validTrip();
    input.lunch.kind = "pass-through";
    expect(() => parseTripInput(input)).toThrowError(new PlannerInputError("INVALID_LUNCH_STOP"));
  });

  it("rejects a trip whose hard boundary reaches 24 hours", () => {
    const input = validTrip();
    input.hardReturnAt = "2026-09-01T07:30:00+09:00";
    expect(() => parseTripInput(input)).toThrowError(
      new PlannerInputError("TRIP_MUST_BE_UNDER_24_HOURS"),
    );
  });

  it("rejects desired return after the hard return", () => {
    const input = validTrip();
    input.desiredReturnAt = "2026-08-31T19:00:00+09:00";
    expect(() => parseTripInput(input)).toThrowError(new PlannerInputError("INVALID_RETURN_ORDER"));
  });
});
