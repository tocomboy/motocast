import { KakaoMapCanvas, MapMarkerLegend, MapOmissionList, type MapMarkerRole } from "@/components/kakao-map-canvas";
import { formatElapsedAge, formatKoreanDateTime, formatKoreanTime, formatRideTime } from "@/lib/planner/schedule";
import { sharedSnapshotRoute, type SharedPlace, type SharedRideSnapshot, type SharedWaypoint } from "@/lib/sharing/contracts";
import { weatherFailureLabel } from "@/lib/weather/status";

function minutes(value: number) {
  return `${Math.ceil(value / 60)}분`;
}

function modelLabel(model: "ultra" | "short" | undefined) {
  return model === "ultra" ? "초단기예보" : model === "short" ? "단기예보" : "예보 범위 밖";
}

function conditionLabel(condition: string | undefined) {
  return ({ clear: "맑음", cloudy: "흐림", rain: "비", snow: "눈", unknown: "미정" } as Record<string, string>)[condition ?? "unknown"] ?? "미정";
}

const SHARED_PLACE_COORDINATE_TOLERANCE = 0.000001;

function sameSharedPlace(
  left: { id: string; label: string; longitude: number; latitude: number },
  right: { id: string; label: string; longitude: number; latitude: number } | null | undefined,
) {
  return Boolean(right) && (
    left.id === right!.id || (
      left.label === right!.label &&
      Math.abs(left.longitude - right!.longitude) <= SHARED_PLACE_COORDINATE_TOLERANCE &&
      Math.abs(left.latitude - right!.latitude) <= SHARED_PLACE_COORDINATE_TOLERANCE
    )
  );
}

export function buildSharedMapPoints(input: {
  routePoints: Array<SharedPlace & {
    kind?: "pass-through" | "stop" | "optional";
    winding?: boolean;
    stopRole?: "lunch" | "dinner" | "rest";
  }>;
  waypoints: SharedWaypoint[];
  lunchStop: SharedPlace | null;
  dinnerStop: SharedPlace | null;
}) {
  const traversedWaypoints = input.waypoints.filter((item) => item.selected);
  const matchedWaypoints = new Set<SharedWaypoint>();
  const assignedStops = { lunch: false, dinner: false };
  const occurrenceRole = (
    point: SharedPlace & {
      kind?: "pass-through" | "stop" | "optional";
      winding?: boolean;
      stopRole?: "lunch" | "dinner" | "rest";
    },
    waypoint?: SharedWaypoint,
  ): MapMarkerRole => {
    if (point.stopRole) {
      if (point.stopRole !== "rest") assignedStops[point.stopRole] = true;
      return point.stopRole;
    }
    if (point.winding || waypoint?.winding) return "waypoint";
    if (point.kind === "optional" || waypoint?.kind === "optional") return "rest";
    if (point.kind === "pass-through" || waypoint?.kind === "pass-through") return "waypoint";
    const isLunch = sameSharedPlace(point, input.lunchStop);
    const isDinner = sameSharedPlace(point, input.dinnerStop);
    if (isLunch && !assignedStops.lunch) {
      assignedStops.lunch = true;
      return "lunch";
    }
    if (isDinner && !assignedStops.dinner) {
      assignedStops.dinner = true;
      return "dinner";
    }
    return "waypoint";
  };
  // Current schemaVersion 3 routes are validated to traverse every selected
  // occurrence in this exact order. Immutable legacy snapshots can contain a
  // route that omits occurrences, so only those need the place-matching path.
  const completeOrderedTraversal = input.routePoints.length === traversedWaypoints.length + 2;
  const routePoints = input.routePoints.map((point, index, all) => {
    const samePlaceWaypoints = index > 0 && index < all.length - 1
      ? traversedWaypoints.filter((waypoint) => !matchedWaypoints.has(waypoint) && sameSharedPlace(point, waypoint))
      : [];
    const remainingRouteOccurrences = all.slice(index, -1)
      .filter((routePoint) => sameSharedPlace(routePoint, point)).length;
    const matchingWaypoint = completeOrderedTraversal && index > 0 && index < all.length - 1
      ? traversedWaypoints[index - 1]
      : remainingRouteOccurrences < samePlaceWaypoints.length
        ? samePlaceWaypoints.find((waypoint) => !waypoint.winding) ?? samePlaceWaypoints[0]
        : samePlaceWaypoints[0];
    if (matchingWaypoint) matchedWaypoints.add(matchingWaypoint);
    let role: MapMarkerRole = "waypoint";
    if (index === 0) role = "origin";
    else if (index === all.length - 1) role = "destination";
    else role = occurrenceRole(point, matchingWaypoint);
    return { ...point, role };
  });
  const omittedWaypoints = traversedWaypoints
    .filter((waypoint) => !matchedWaypoints.has(waypoint))
    .map((waypoint) => {
      const role = occurrenceRole(waypoint, waypoint);
      return { ...waypoint, label: `${waypoint.label} · 선택 경로 미통과`, role, nonTraversed: true };
    });
  return [...routePoints, ...omittedWaypoints];
}

export function SharedRideSnapshotView({
  snapshot,
  referenceTime,
  preview = false,
}: {
  snapshot: SharedRideSnapshot;
  referenceTime: string;
  preview?: boolean;
}) {
  const selected = sharedSnapshotRoute(snapshot);
  const path = selected.legs.flatMap((leg) => leg.sections.flatMap((section) => section.roads.flatMap((road) => {
    const points = [];
    for (let index = 0; index < road.vertexes.length; index += 2) {
      points.push({ longitude: road.vertexes[index], latitude: road.vertexes[index + 1] });
    }
    return points;
  })));
  const points = buildSharedMapPoints({
    routePoints: [selected.legs[0].from, ...selected.legs.map((leg) => leg.to)],
    waypoints: snapshot.waypoints,
    lunchStop: snapshot.trip.lunchStop,
    dinnerStop: snapshot.trip.dinnerStop,
  });
  const weatherExpired = snapshot.weather
    ? new Date(snapshot.weather.validUntil).getTime() <= new Date(referenceTime).getTime()
    : false;
  const weatherStale = snapshot.weather ? snapshot.weather.stale || weatherExpired : false;

  return (
    <div className={`shared-snapshot ${preview ? "is-preview" : ""}`}>
      <section className="shared-hero">
        <div>
          <p className="eyebrow">{preview ? "ROUTE & WEATHER PREVIEW" : "SHARED RIDE"}</p>
          <h1>{snapshot.trip.title}</h1>
          <p>{preview ? "공유될 여행 루트와 날씨 요약입니다." : "발행 당시의 여행 루트와 날씨 요약입니다."}</p>
        </div>
        <dl>
          <div><dt>라이딩 날짜</dt><dd>{snapshot.trip.serviceDate}</dd></div>
          <div><dt>출발</dt><dd>{snapshot.trip.origin.label} · {formatKoreanTime(snapshot.trip.departureAt)}</dd></div>
          {snapshot.schemaVersion === 1 ? (
            <>
              <div><dt>희망 복귀 · 이전 발행본</dt><dd>{formatKoreanTime(snapshot.trip.desiredReturnAt)}</dd></div>
              <div><dt>최종 복귀 · 이전 발행본</dt><dd>{snapshot.trip.destination.label} · {formatKoreanTime(snapshot.trip.hardReturnAt)}</dd></div>
            </>
          ) : (
            <div><dt>예상 복귀</dt><dd>{snapshot.trip.destination.label} · {formatRideTime(snapshot.trip.departureAt, selected.returnAt)}</dd></div>
          )}
        </dl>
      </section>

      <section className="shared-map" aria-label={`${preview ? "미리보기" : "공유된"} 라이딩 경로`}>
        <KakaoMapCanvas points={points} path={path} showLegend={false} />
      </section>
      <div className="shared-map-details">
        <MapMarkerLegend points={points} inline />
        <div className="shared-map-summary">
          <strong>{snapshot.trip.origin.label} → {snapshot.trip.destination.label}</strong>
          <span>{Math.round(selected.totalDistanceMeters / 100) / 10} km · 약 {minutes(selected.totalDurationSeconds)}</span>
        </div>
      </div>
      <MapOmissionList points={points} />

      <section className="shared-route-summary" aria-labelledby={`shared-route-${preview ? "preview" : "public"}`}>
        <p className="eyebrow">ROUTE</p>
        <h2 id={`shared-route-${preview ? "preview" : "public"}`}>여행 루트</h2>
        <div className="shared-routes">
          <article className="selected">
            <strong>{snapshot.schemaVersion === 3 ? "추천 경로" : selected.candidate.label}</strong>
            <span>{Math.round(selected.totalDistanceMeters / 100) / 10} km · {minutes(selected.totalDurationSeconds)} · 복귀 {formatRideTime(snapshot.trip.departureAt, selected.returnAt)}</span>
            <small>이륜차 · 자동차전용도로 제외 · 자동차 경로 대체 없음</small>
            <ol className="shared-legs">
              {selected.legs.map((leg, index) => (
                <li key={`${selected.candidate.id}-${index}`}>
                  <strong>{String(index + 1).padStart(2, "0")} · {leg.to.label}</strong>
                  <span>{formatRideTime(snapshot.trip.departureAt, leg.arrivalAt)} 도착{leg.dwellMinutes ? ` · ${leg.dwellMinutes}분 정차` : " · 통과"}</span>
                </li>
              ))}
            </ol>
          </article>
        </div>
      </section>

      <section className="shared-weather" aria-labelledby={`shared-weather-${preview ? "preview" : "public"}`}>
        <p className="eyebrow">WEATHER BY ARRIVAL</p>
        <h2 id={`shared-weather-${preview ? "preview" : "public"}`}>구간 통과 시각별 날씨</h2>
        {snapshot.weather ? (
          <>
            <p className={`shared-weather-state ${weatherStale ? "stale" : "fresh"}`}>
              {formatKoreanDateTime(snapshot.weather.issuedAt)} 발행 · {formatKoreanDateTime(snapshot.weather.retrievedAt)} 저장 ({formatElapsedAge(snapshot.weather.retrievedAt, referenceTime)})
              {snapshot.weather.stale ? ` · ${weatherFailureLabel(snapshot.weather.failureKind ?? undefined)} 후 저장본${snapshot.weather.staleObservedAt ? ` · ${formatKoreanDateTime(snapshot.weather.staleObservedAt)} 실패 확인` : ""}` : ""}
              {weatherExpired ? " · 현재 기준 예보 유효기간 지남" : " · 현재 기준 예보 유효기간 안쪽"}
            </p>
            {snapshot.weather.stale && snapshot.weather.staleReason ? <p className="shared-weather-reason">{snapshot.weather.staleReason}</p> : null}
            <ol className="shared-weather-list">
              {snapshot.weather.segments.map((forecast) => (
                <li key={forecast.id}>
                  <div><strong>{formatRideTime(snapshot.trip.departureAt, forecast.eta)} · {forecast.label}</strong><span>{modelLabel(forecast.model)}</span></div>
                  {forecast.status === "outside-window" ? (
                    <p>상세 예보 기간 밖 · 기상청 상세 호출 없음</p>
                  ) : (
                    <p><span className="shared-weather-condition" data-condition={forecast.condition ?? "unknown"}>{conditionLabel(forecast.condition)}</span> · {forecast.temperatureC ?? "–"}°C · 강수 {forecast.precipitationProbability ?? "–"}% · 바람 {forecast.windSpeedMps ?? "–"}m/s</p>
                  )}
                </li>
              ))}
            </ol>
          </>
        ) : <p>이 발행본에는 저장된 동일 경로 날씨가 없습니다.</p>}
      </section>
    </div>
  );
}
