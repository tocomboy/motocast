import type { ReactNode } from "react";

import { KakaoMapCanvas, MapMarkerLegend, MapOmissionList, type MapMarkerRole } from "@/components/kakao-map-canvas";
import { RidingSummaryLayout, RidingWeatherCard } from "@/components/riding-summary-layout";
import { formatRideDuration, formatSummaryDeparture } from "@/lib/planner/display";
import { formatElapsedAge, formatKoreanDateTime, formatKoreanTime, formatRideTime } from "@/lib/planner/schedule";
import { sharedSnapshotRoute, type SharedPlace, type SharedRideSnapshot, type SharedWaypoint } from "@/lib/sharing/contracts";
import { weatherFailureLabel } from "@/lib/weather/status";

function minutes(value: number) {
  return formatRideDuration(value / 60);
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
  actions,
  backAction,
}: {
  snapshot: SharedRideSnapshot;
  referenceTime: string;
  preview?: boolean;
  actions?: ReactNode;
  backAction?: ReactNode;
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
  const rideSeconds = selected.legs.reduce((total, leg) => total + leg.durationSeconds, 0);
  const restMinutes = selected.legs.reduce((total, leg) => total + leg.dwellMinutes, 0);

  return (
    <div className={`shared-snapshot ${preview ? "is-preview" : ""}`}>
      <RidingSummaryLayout
        preview={preview}
        backAction={backAction}
        title={preview ? "공유 미리보기" : "공유받은 라이딩 요약"}
        subtitle={<>{formatSummaryDeparture(snapshot.trip.departureAt)}{snapshot.schemaVersion === 1 ? <><br /><span>희망 복귀 · 이전 발행본</span> {formatKoreanTime(snapshot.trip.desiredReturnAt)} · <span>최종 복귀 · 이전 발행본</span> {formatKoreanTime(snapshot.trip.hardReturnAt)}</> : null}</>}
        actions={actions}
        metrics={[
          { label: "총 소요", value: `총 ${minutes(rideSeconds + restMinutes * 60)}` },
          { label: "주행", value: minutes(rideSeconds) },
          { label: "휴식", value: `${restMinutes}분` },
          { label: "예상 도착", value: formatRideTime(snapshot.trip.departureAt, selected.returnAt) },
        ]}
        distance={`${Math.round(selected.totalDistanceMeters / 100) / 10} km`}
        map={<><h2 className="summary-course-title">{snapshot.trip.title}</h2><section className="shared-map" aria-label={`${preview ? "미리보기" : "공유된"} 라이딩 경로`}><KakaoMapCanvas points={points} path={path} showLegend={false} /></section></>}
        mapDetails={<div className="shared-map-details"><p className="summary-route-order">{[selected.legs[0].from.label, ...selected.legs.map((leg) => leg.to.label)].join(" → ")}</p>{!preview ? <p className="shared-handoff-history">공유 당시 시간·날씨이며 현재 주행 기준이 아니에요. 경로 실행은 장소와 방문 순서만 전달해요.</p> : null}<p className="route-safety-copy">이륜차 · 자동차전용도로 제외 · 자동차 경로 대체 없음</p><MapMarkerLegend points={points} inline /></div>}
        weather={<section className="shared-weather" aria-labelledby={`shared-weather-${preview ? "preview" : "public"}`}><h2 id={`shared-weather-${preview ? "preview" : "public"}`}>구간별 날씨</h2>{snapshot.weather ? <><p className={`shared-weather-state ${weatherStale ? "stale" : "fresh"}`}>{formatKoreanDateTime(snapshot.weather.issuedAt)} 발행 · {formatElapsedAge(snapshot.weather.retrievedAt, referenceTime)}{snapshot.weather.stale ? ` · ${weatherFailureLabel(snapshot.weather.failureKind ?? undefined)} 후 저장본` : ""}{weatherExpired ? " · 현재 기준 예보 유효기간 지남" : " · 현재 기준 예보 유효기간 안쪽"}</p>{snapshot.weather.stale && snapshot.weather.staleReason ? <p className="shared-weather-reason">{snapshot.weather.staleReason}</p> : null}<ol className="shared-weather-list">{snapshot.weather.segments.map((forecast) => <li key={forecast.id}><RidingWeatherCard time={formatRideTime(snapshot.trip.departureAt, forecast.eta)} place={forecast.label} condition={forecast.condition} conditionLabel={forecast.status === "outside-window" ? "상세 예보 기간 밖" : conditionLabel(forecast.condition)} temperature={`${forecast.temperatureC ?? "–"}°`} probability={`${forecast.precipitationProbability ?? "–"}%`} statusNote={forecast.status === "outside-window" ? "상세 예보 기간 밖" : undefined} /></li>)}</ol><details className="weather-detail"><summary>날씨 상세정보</summary><ul>{snapshot.weather.segments.map((forecast) => <li key={forecast.id}><strong>{forecast.label}</strong><span>바람 {forecast.windSpeedMps ?? "–"}m/s · {modelLabel(forecast.model)}</span></li>)}</ul></details></> : <p>이 발행본에는 저장된 동일 경로 날씨가 없습니다.</p>}</section>}
        notices={<MapOmissionList points={points} />}
        management={<><details className="route-arrival-details"><summary>구간별 도착 시간</summary><ol>{selected.legs.map((leg, index) => <li key={`${selected.candidate.id}-arrival-${index}`}><strong>{leg.to.label}</strong><span>{formatRideTime(snapshot.trip.departureAt, leg.arrivalAt)} 도착{leg.dwellMinutes ? ` · ${leg.dwellMinutes}분 정차` : " · 통과"}</span></li>)}</ol></details><p className="route-estimate-note">도착 시각은 교통 상황에 따라 달라질 수 있는 추정값입니다.</p></>}
      />
    </div>
  );
}
