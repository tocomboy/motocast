import { KakaoMapCanvas, type MapMarkerRole } from "@/components/kakao-map-canvas";
import { formatElapsedAge, formatKoreanDateTime, formatKoreanTime, formatRideTime } from "@/lib/planner/schedule";
import type { SharedPlace, SharedRideSnapshot, SharedWaypoint } from "@/lib/sharing/contracts";
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

function sameSharedPlace(
  left: { id: string; label: string; longitude: number; latitude: number },
  right: { id: string; label: string; longitude: number; latitude: number } | null | undefined,
) {
  return Boolean(right) && (
    left.id === right!.id || (
      left.label === right!.label &&
      left.longitude === right!.longitude &&
      left.latitude === right!.latitude
    )
  );
}

export function buildSharedMapPoints(input: {
  routePoints: SharedPlace[];
  waypoints: SharedWaypoint[];
  lunchStop: SharedPlace;
  dinnerStop: SharedPlace | null;
}) {
  const traversedWaypoints = input.waypoints.filter((item) => item.selected);
  return input.routePoints.map((point, index, all) => {
    const expectedWaypoint = index > 0 && index < all.length - 1
      ? traversedWaypoints[index - 1]
      : undefined;
    const waypoint = sameSharedPlace(point, expectedWaypoint) ? expectedWaypoint : undefined;
    let role: MapMarkerRole = "waypoint";
    if (index === 0) role = "origin";
    else if (index === all.length - 1) role = "destination";
    else if (sameSharedPlace(point, input.lunchStop)) role = "lunch";
    else if (sameSharedPlace(point, input.dinnerStop)) role = "dinner";
    else if (waypoint?.kind === "optional") role = "rest";
    else if (waypoint?.winding) role = "winding";
    return { ...point, role };
  });
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
  const selected = snapshot.routes.find((route) => route.candidate.id === snapshot.trip.selectedProfile)!;
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
    ? new Date(snapshot.weather.validUntil).getTime() < new Date(referenceTime).getTime()
    : false;
  const weatherStale = snapshot.weather ? snapshot.weather.stale || weatherExpired : false;

  return (
    <div className={`shared-snapshot ${preview ? "is-preview" : ""}`}>
      <section className="shared-hero">
        <div>
          <p className="eyebrow">{preview ? "APPROVAL PREVIEW" : "SHARED RIDE SNAPSHOT"}</p>
          <h1>{snapshot.trip.title}</h1>
          <p>{preview ? "아래에 표시된 장소·시각·세 경로·날씨 전체가 그대로 발행됩니다." : "원본 계획을 수정해도 이 발행본은 바뀌지 않습니다."}</p>
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
          <div><dt>점심</dt><dd>{snapshot.trip.lunchStop.label}</dd></div>
          <div><dt>저녁</dt><dd>{snapshot.trip.dinnerStop?.label ?? "없음"}</dd></div>
          <div><dt>선택 경로</dt><dd>{selected.candidate.label}</dd></div>
        </dl>
      </section>

      <section className="shared-map" aria-label={`${preview ? "미리보기" : "공유된"} 라이딩 경로`}>
        <KakaoMapCanvas points={points} path={path} />
        <div className="shared-map-summary">
          <strong>{snapshot.trip.origin.label} → {snapshot.trip.destination.label}</strong>
          <span>{Math.round(selected.totalDistanceMeters / 100) / 10} km · 약 {minutes(selected.totalDurationSeconds)}</span>
        </div>
      </section>

      <div className="shared-grid">
        <section>
          <p className="eyebrow">STOPS</p><h2>경유와 정차 전체</h2>
          <ol className="shared-stops">
            {snapshot.waypoints.map((point) => (
              <li key={point.id}>
                <span>{String(point.position + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{point.label}</strong>
                  <small>
                    {point.kind} · {point.dwellMinutes ? `${point.dwellMinutes}분 정차` : "통과"}
                    {point.winding ? " · 커스텀 와인딩" : ""} · {point.selected ? "선택됨" : "선택 안 됨"}
                  </small>
                  <small>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <p className="eyebrow">ROUTE OPTIONS</p><h2>발행되는 후보 3개</h2>
          <div className="shared-routes">
            {snapshot.routes.map((route) => (
              <article key={route.candidate.id} className={route.candidate.id === snapshot.trip.selectedProfile ? "selected" : ""}>
                <strong>{route.candidate.label}{route.candidate.id === snapshot.trip.selectedProfile ? " · 선택 경로" : ""}</strong>
                <span>{Math.round(route.totalDistanceMeters / 100) / 10} km · {minutes(route.totalDurationSeconds)} · 복귀 {formatRideTime(snapshot.trip.departureAt, route.returnAt)}</span>
                <small>이륜차 · 자동차전용도로 제외 · 자동차 경로 대체 없음</small>
                <ol className="shared-legs">
                  {route.legs.map((leg, index) => (
                    <li key={`${route.candidate.id}-${index}`}>
                      <strong>{leg.from.label} → {leg.to.label}</strong>
                      <span>{formatRideTime(snapshot.trip.departureAt, leg.departureAt)} 출발 · {formatRideTime(snapshot.trip.departureAt, leg.arrivalAt)} 도착 · {Math.round(leg.distanceMeters / 100) / 10} km · {minutes(leg.durationSeconds)}{leg.dwellMinutes ? ` · ${leg.dwellMinutes}분 정차` : ""}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>
      </div>

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
                    <p>{conditionLabel(forecast.condition)} · {forecast.temperatureC ?? "–"}°C · 강수 {forecast.precipitationProbability ?? "–"}% · 바람 {forecast.windSpeedMps ?? "–"}m/s</p>
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
