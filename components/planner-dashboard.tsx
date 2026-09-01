"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { CollectionManager } from "@/components/collection-manager";
import { KakaoMapCanvas, type MapMarkerRole } from "@/components/kakao-map-canvas";
import { PlaceSearchField } from "@/components/place-search-field";
import { ShareManager } from "@/components/share-manager";
import {
  insertCollectionWinding,
  moveCollectionWinding,
  prepareCollectionApplication,
  removeCollectionWinding,
  replaceCollectionStop,
  setCollectionRestSelected,
} from "@/lib/collections/application";
import type { CollectionPoint } from "@/lib/collections/contracts";
import type { PlaceSearchResult } from "@/lib/places/search";
import {
  demoRoute,
  demoDepartureAt,
  demoMapPoints,
} from "@/lib/planner/demo";
import { PlannerActionGate } from "@/lib/planner/action-gate";
import { withClientTimeout } from "@/lib/planner/client-timeout";
import { parseSafeRecommendedRoute, ProviderContractError, type SafeRouteResponse } from "@/lib/planner/provider-contract";
import { buildTimeline, formatRideTime, weatherRiskLabel } from "@/lib/planner/schedule";
import type { PlannedSegment, RouteCandidate } from "@/lib/planner/types";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { parseWeatherTimelineResponse, type WeatherTimelineResponse } from "@/lib/weather/provider-contract";
import { formatPlannerWeatherStatus, weatherFailureLabel } from "@/lib/weather/status";

type PlannerDraft = {
  origin: string;
  destination: string;
  rideDate: string;
  departureTime: string;
  lunch: string;
  dinner: string;
  includeRest: boolean;
};

type PlannerPlaces = {
  origin: PlaceSearchResult | null;
  destination: PlaceSearchResult | null;
  lunch: PlaceSearchResult | null;
  dinner: PlaceSearchResult | null;
  rest: PlaceSearchResult | null;
};

type AppliedCollectionPoint = CollectionPoint & { uiKey: string };

function seoulToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const defaultDraft: PlannerDraft = {
  origin: "팔당 출발점",
  destination: "팔당 복귀점",
  rideDate: seoulToday(),
  departureTime: "07:30",
  lunch: "홍천 점심 정차",
  dinner: "",
  includeRest: false,
};

function minutesLabel(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours ? `${hours}시간 ${minutes ? `${minutes}분` : ""}` : `${minutes}분`;
}

function weatherIcon(condition: string) {
  if (condition === "rain") return "비";
  if (condition === "snow") return "눈";
  if (condition === "cloudy") return "흐림";
  if (condition === "clear") return "맑음";
  return "미정";
}

function weatherModelLabel(status: string | undefined, model: string | undefined) {
  if (status === "outside-window") return "상세 예보 기간 밖 · API 미호출";
  if (model === "ultra") return "초단기예보";
  if (model === "short") return "단기예보";
  return "날씨 미조회";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function liveRouteCandidate(response: SafeRouteResponse): RouteCandidate {
  const stopMinutes = response.legs.reduce((total, leg) => total + leg.dwellMinutes, 0);
  const rideMinutes = Math.ceil(response.legs.reduce((total, leg) => total + leg.durationSeconds, 0) / 60);
  const path = response.legs.flatMap((leg) => (
    leg.sections.flatMap((section) => section.roads.flatMap((road) => {
      const points = [];
      for (let index = 0; index < road.vertexes.length; index += 2) {
        points.push({ longitude: road.vertexes[index], latitude: road.vertexes[index + 1] });
      }
      return points;
    }))
  )).filter((point, index, points) => (
    index === 0 || point.longitude !== points[index - 1].longitude || point.latitude !== points[index - 1].latitude
  ));
  return {
    id: "recommended",
    label: response.candidate.label,
    description: "입력한 모든 필수 지점을 지나는 오토바이 안전 추천 경로",
    distanceKm: Math.round(response.totalDistanceMeters / 100) / 10,
    rideMinutes,
    stopMinutes,
    returnAt: response.returnAt,
    path,
    segments: response.legs.map((leg, index) => ({
      id: `${response.candidate.id}-${index}`,
      from: leg.from,
      to: leg.to,
      distanceKm: Math.round(leg.distanceMeters / 100) / 10,
      rideMinutes: leg.durationSeconds / 60,
      departureAt: leg.departureAt,
      arrivalAt: leg.arrivalAt,
      weather: {
        condition: "unknown",
        temperatureC: null,
        precipitationProbability: null,
        windSpeedMps: null,
        issuedAt: leg.arrivalAt,
      },
    })),
  };
}

export function buildPlannerDisplayTimeline(input: {
  live: boolean;
  draftDepartureAt: string;
  fallbackDepartureAt: string;
  includeRest: boolean;
  segments: PlannedSegment[];
}) {
  const departureAt = input.live
    ? input.segments[0]?.departureAt ?? input.draftDepartureAt
    : input.fallbackDepartureAt;
  return {
    departureAt,
    timeline: buildTimeline({
      departureAt,
      segments: input.segments.map((segment) => (
        !input.live && segment.to.id === "rest"
          ? { ...segment, to: { ...segment.to, selected: input.includeRest } }
          : segment
      )),
    }),
  };
}

export function PlannerDashboard({ connected }: { connected: boolean }) {
  const [draft, setDraft] = useState(defaultDraft);
  const [places, setPlaces] = useState<PlannerPlaces>({
    origin: null,
    destination: null,
    lunch: null,
    dinner: null,
    rest: null,
  });
  const [windingPoints, setWindingPoints] = useState<PlaceSearchResult[]>([]);
  const [appliedCollectionPoints, setAppliedCollectionPoints] = useState<AppliedCollectionPoint[] | null>(null);
  const [addingWinding, setAddingWinding] = useState(false);
  const [liveRoute, setLiveRoute] = useState<RouteCandidate | null>(null);
  const [liveTripId, setLiveTripId] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherTimelineResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState<RouteCandidate["id"] | null>(null);
  const [weatherClock, setWeatherClock] = useState<string | null>(null);
  const [liveResultStale, setLiveResultStale] = useState(false);
  const [waypointStatus, setWaypointStatus] = useState("");
  const [isCompact, setIsCompact] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [notice, setNotice] = useState(
    connected
      ? "저장된 데모 계획입니다. 장소를 확인한 뒤 추천 경로를 다시 계산하세요."
      : "환경변수가 없어 데모 모드로 실행 중입니다. 실제 외부 API는 호출하지 않습니다.",
  );
  const [calculating, setCalculating] = useState(false);
  const plannerPanelRef = useRef<HTMLElement>(null);
  const mobilePlanButtonRef = useRef<HTMLButtonElement>(null);
  const addWindingButtonRef = useRef<HTMLButtonElement>(null);
  const appliedPointKeySequenceRef = useRef(0);
  const routeGenerationRef = useRef(0);
  const liveTripIdRef = useRef<string | null>(null);
  const weatherRequestRef = useRef(0);
  const actionGateRef = useRef(new PlannerActionGate());

  function asAppliedPoint(point: CollectionPoint): AppliedCollectionPoint {
    appliedPointKeySequenceRef.current += 1;
    return { ...point, uiKey: `applied-point-${appliedPointKeySequenceRef.current}` };
  }

  useEffect(() => {
    const currentKey = "motocast-planner-draft-v2";
    const legacyKey = "motocast-planner-draft-v1";
    const saved = window.localStorage.getItem(currentKey) ?? window.localStorage.getItem(legacyKey);
    if (!saved) return;
    let restored: PlannerDraft;
    try {
      const parsed = JSON.parse(saved) as Partial<PlannerDraft>;
      restored = {
        origin: typeof parsed.origin === "string" ? parsed.origin : defaultDraft.origin,
        destination: typeof parsed.destination === "string" ? parsed.destination : defaultDraft.destination,
        rideDate: typeof parsed.rideDate === "string" ? parsed.rideDate : defaultDraft.rideDate,
        departureTime: typeof parsed.departureTime === "string" ? parsed.departureTime : defaultDraft.departureTime,
        lunch: typeof parsed.lunch === "string" ? parsed.lunch : defaultDraft.lunch,
        dinner: typeof parsed.dinner === "string" ? parsed.dinner : defaultDraft.dinner,
        includeRest: typeof parsed.includeRest === "boolean" ? parsed.includeRest : defaultDraft.includeRest,
      };
      window.localStorage.removeItem(legacyKey);
    } catch {
      window.localStorage.removeItem(currentKey);
      window.localStorage.removeItem(legacyKey);
      return;
    }
    const task = window.setTimeout(() => setDraft(restored), 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("motocast-planner-draft-v2", JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const updateCompact = () => setIsCompact(media.matches);
    updateCompact();
    media.addEventListener("change", updateCompact);
    return () => media.removeEventListener("change", updateCompact);
  }, []);

  useEffect(() => {
    if (!isCompact || !plannerOpen) return;
    const firstControl = plannerPanelRef.current?.querySelector<HTMLElement>("input, button, [href], [tabindex]:not([tabindex='-1'])");
    firstControl?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlannerOpen(false);
        window.setTimeout(() => mobilePlanButtonRef.current?.focus(), 0);
        return;
      }
      if (event.key === "Tab") {
        const controls = [...(plannerPanelRef.current?.querySelectorAll<HTMLElement>(
          "input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
        ) ?? [])].filter((control) => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isCompact, plannerOpen]);

  const selected = liveRoute ?? demoRoute;
  const selectedWeather = weather;
  const selectedWeatherStatus = selectedWeather
    ? formatPlannerWeatherStatus(selectedWeather, weatherClock ?? selectedWeather.staleObservedAt ?? selectedWeather.generatedAt)
    : null;
  const selectedWeatherAnnouncement = weatherLoading === selected.id
    ? `${selected.label} 날씨 조회 중`
    : selectedWeather && selectedWeatherStatus
      ? selectedWeather.stale
        ? `${selected.label} 날씨: ${weatherFailureLabel(selectedWeather.failureKind)}로 저장본 표시${selectedWeatherStatus.expired ? ", 유효기간 만료" : ""}`
        : `${selected.label} 날씨: ${selectedWeather.source === "cache" ? "최근 저장 예보" : "실시간 조회 예보"}${selectedWeatherStatus.expired ? ", 유효기간 만료" : ""}`
      : `${selected.label} 날씨 미조회`;

  useEffect(() => {
    if (!selectedWeather) return;
    const refresh = () => setWeatherClock(new Date().toISOString());
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [selectedWeather]);
  const departureAt = `${draft.rideDate}T${draft.departureTime}:00+09:00`;
  const { departureAt: displayedDepartureAt, timeline } = useMemo(() => buildPlannerDisplayTimeline({
    live: Boolean(liveRoute),
    draftDepartureAt: departureAt,
    fallbackDepartureAt: demoDepartureAt,
    includeRest: draft.includeRest,
    segments: selected.segments,
  }), [departureAt, draft.includeRest, liveRoute, selected]);
  const selectedMapPoints = liveRoute
    ? [selected.segments[0].from, ...selected.segments.map((segment) => segment.to)].map((point, index, all) => {
        let role: MapMarkerRole = "waypoint";
        if (index === 0) role = "origin";
        else if (index === all.length - 1) role = "destination";
        else if (point.id === places.lunch?.kakaoPlaceId) role = "lunch";
        else if (point.id === places.dinner?.kakaoPlaceId) role = "dinner";
        else if (point.id === places.rest?.kakaoPlaceId) role = "rest";
        else if (point.winding) role = "winding";
        return { ...point, role };
      })
    : demoMapPoints;

  const collectionPoints = useMemo<CollectionPoint[]>(() => {
    if (appliedCollectionPoints) return appliedCollectionPoints;
    if (!connected || !places.lunch) return [];
    return [
      ...windingPoints.map((place) => routePoint(place, "pass-through", 0, true)),
      routePoint(places.lunch, "stop", 60, false, "lunch"),
      ...(draft.includeRest && places.rest ? [routePoint(places.rest, "optional", 30, false, "rest")] : []),
      ...(places.dinner ? [routePoint(places.dinner, "stop", 60, false, "dinner")] : []),
    ];
  }, [appliedCollectionPoints, connected, draft.includeRest, places.dinner, places.lunch, places.rest, windingPoints]);

  function markRouteInputChanged() {
    routeGenerationRef.current += 1;
    weatherRequestRef.current += 1;
    setWeatherLoading(null);
    if (liveRoute) setLiveResultStale(true);
  }

  function update<K extends keyof PlannerDraft>(key: K, value: PlannerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === "includeRest") {
      setAppliedCollectionPoints((current) => current ? setCollectionRestSelected(current, value === true) : null);
    }
    markRouteInputChanged();
  }

  function selectPlace(key: keyof PlannerPlaces, place: PlaceSearchResult | null) {
    setPlaces((current) => ({ ...current, [key]: place }));
    const stop = {
      lunch: { kind: "stop" as const, dwellMinutes: 60, stopRole: "lunch" as const },
      dinner: { kind: "stop" as const, dwellMinutes: 60, stopRole: "dinner" as const },
      rest: { kind: "optional" as const, dwellMinutes: 30, stopRole: "rest" as const },
    }[key as "lunch" | "dinner" | "rest"];
    if (stop) {
      setAppliedCollectionPoints((current) => {
        if (!current) return null;
        const replacement = place
          ? asAppliedPoint(routePoint(place, stop.kind, stop.dwellMinutes, false, stop.stopRole))
          : null;
        return replaceCollectionStop(current, stop.stopRole, replacement);
      });
    }
    markRouteInputChanged();
  }

  function addWindingPoint(place: PlaceSearchResult | null) {
    if (!place) return;
    if (
      windingPoints.some((item) => item.kakaoPlaceId === place.kakaoPlaceId) ||
      appliedCollectionPoints?.some((item) => item.kakaoPlaceId === place.kakaoPlaceId)
    ) {
      setWaypointStatus(`${place.name}은(는) 이미 와인딩 경유지에 있습니다.`);
      setAddingWinding(false);
      focusAfterWindingEdit();
      return;
    }
    if (windingPoints.length >= 20) {
      setWaypointStatus("와인딩 경유지는 최대 20개까지 추가할 수 있습니다.");
      setAddingWinding(false);
      focusAfterWindingEdit();
      return;
    }
    setWindingPoints((current) => [...current, place]);
    setAppliedCollectionPoints((current) => {
      if (!current) return null;
      const point = asAppliedPoint(routePoint(place, "pass-through", 0, true));
      return insertCollectionWinding(current, point);
    });
    setAddingWinding(false);
    setWaypointStatus(`${place.name}을(를) 와인딩 경유지 마지막에 추가했습니다.`);
    markRouteInputChanged();
    focusAfterWindingEdit(windingPoints.length + 1 >= 20);
  }

  function moveWindingPoint(index: number, direction: -1 | 1) {
    const place = windingPoints[index];
    setWindingPoints((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    if (place) setWaypointStatus(`${place.name}을(를) ${index + direction + 1}번째로 이동했습니다.`);
    markRouteInputChanged();
  }

  function moveAppliedWindingPoint(index: number, direction: -1 | 1) {
    const point = appliedCollectionPoints?.[index];
    if (!point?.winding) return;
    setAppliedCollectionPoints((current) => current ? moveCollectionWinding(current, index, direction) : null);
    setWaypointStatus(`${point.name}을(를) 전체 경유지 순서의 ${index + direction + 1}번째로 이동했습니다.`);
    markRouteInputChanged();
  }

  function removeWindingPoint(place: PlaceSearchResult) {
    setWindingPoints((current) => current.filter((item) => item.kakaoPlaceId !== place.kakaoPlaceId));
    setWaypointStatus(`${place.name}을(를) 와인딩 경유지에서 제거했습니다.`);
    markRouteInputChanged();
    focusAfterWindingEdit();
  }

  function removeAppliedWindingPoint(point: CollectionPoint) {
    setAppliedCollectionPoints((current) => current
      ? removeCollectionWinding(current, point.kakaoPlaceId)
      : null);
    setWindingPoints((current) => current.filter((item) => item.kakaoPlaceId !== point.kakaoPlaceId));
    setWaypointStatus(`${point.name}을(를) 적용된 경로에서 제거했습니다.`);
    markRouteInputChanged();
    focusAfterWindingEdit();
  }

  function focusAfterWindingEdit(forceWaypoint = false) {
    window.setTimeout(() => {
      if (!forceWaypoint && addWindingButtonRef.current && !addWindingButtonRef.current.disabled) {
        addWindingButtonRef.current.focus();
        return;
      }
      plannerPanelRef.current?.querySelector<HTMLElement>(".waypoint-actions button:not(:disabled)")?.focus();
    }, 0);
  }

  function cancelWindingEdit() {
    setAddingWinding(false);
    setWaypointStatus("와인딩 경유지 추가를 취소했습니다.");
    focusAfterWindingEdit();
  }

  function closePlannerPanel() {
    setPlannerOpen(false);
    if (isCompact) window.setTimeout(() => mobilePlanButtonRef.current?.focus(), 0);
  }

  function routePoint(
    place: PlaceSearchResult,
    kind: "pass-through" | "stop" | "optional",
    dwellMinutes: number,
    winding = false,
    stopRole?: "lunch" | "dinner" | "rest",
  ) {
    return {
      ...place,
      id: place.kakaoPlaceId,
      label: place.name,
      kind,
      dwellMinutes,
      selected: true,
      winding,
      stopRole,
    };
  }

  function applyCollection(points: CollectionPoint[], title: string) {
    if (!actionGateRef.current.canApplyCollection()) {
      setNotice("현재 계획 상태 저장이 끝난 뒤 컬렉션을 적용해 주세요.");
      return;
    }
    const application = prepareCollectionApplication(points);
    routeGenerationRef.current += 1;
    const orderedPoints = application.lunch || !places.lunch
      ? application.orderedPoints
      : replaceCollectionStop(
          application.orderedPoints,
          "lunch",
          routePoint(places.lunch, "stop", 60, false, "lunch"),
        );
    setAppliedCollectionPoints(orderedPoints.map(asAppliedPoint));
    setWindingPoints(application.selectedWindingPoints);
    setPlaces((current) => ({
      ...current,
      lunch: application.lunch ?? current.lunch,
      dinner: application.dinner,
      rest: application.rest,
    }));
    setDraft((current) => ({ ...current, includeRest: application.includeRest }));
    if (liveRoute) setLiveResultStale(true);
    setWaypointStatus(`${title} 컬렉션의 최신 불변 버전을 계획에 적용했습니다.`);
    setNotice("컬렉션을 적용했습니다. 변경된 장소로 안전 경로를 다시 계산해 주세요.");
  }

  async function loadWeather(candidate: RouteCandidate, tripId: string, generation = routeGenerationRef.current) {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    if (candidate.segments.some((segment) => !segment.arrivalAt)) {
      setNotice("경로 통과 시각이 없어 날씨를 조회하지 않았습니다.");
      return;
    }
    const weatherRequest = ++weatherRequestRef.current;
    setWeatherLoading(candidate.id);
    const points = candidate.segments.map((segment) => ({
      id: segment.id,
      label: segment.to.label,
      longitude: segment.to.longitude,
      latitude: segment.to.latitude,
      eta: segment.arrivalAt!,
    }));
    try {
      const weatherOperation: PromiseLike<{ data: unknown; error: unknown }> = supabase.functions.invoke(
        "weather-timeline",
        { body: { tripId, candidateProfile: candidate.id, points } },
      );
      const { data, error } = await withClientTimeout(
        weatherOperation,
        12_000,
      );
      if (
        weatherRequest !== weatherRequestRef.current ||
        generation !== routeGenerationRef.current ||
        liveTripIdRef.current !== tripId
      ) return;
      if (error) {
        setNotice("날씨를 조회하지 못했습니다. 저장된 동일 경로 예보가 있으면 서버가 stale 표시와 함께 반환합니다.");
        return;
      }
      const response = parseWeatherTimelineResponse(data);
      if (
        response.forecasts.length !== points.length ||
        response.forecasts.some((forecast, index) => (
          forecast.id !== points[index].id || forecast.eta !== new Date(points[index].eta).toISOString() ||
          forecast.longitude !== points[index].longitude || forecast.latitude !== points[index].latitude
        ))
      ) throw new Error("WEATHER_POINT_MISMATCH");
      setWeather(response);
      setLiveRoute((current) => current ? ({
        ...current,
        segments: current.segments.map((segment, index) => {
          const forecast = response.forecasts[index];
          return {
            ...segment,
            weather: forecast.status === "forecast" ? {
              condition: forecast.condition ?? "unknown",
              temperatureC: forecast.temperatureC ?? null,
              precipitationProbability: forecast.precipitationProbability ?? null,
              windSpeedMps: forecast.windSpeedMps ?? null,
              issuedAt: forecast.issuedAt ?? response.issuedAt,
              retrievedAt: response.generatedAt,
              model: forecast.model,
              status: "forecast",
              stale: response.stale,
              staleReason: response.staleReason,
            } : {
              condition: "unknown",
              temperatureC: null,
              precipitationProbability: null,
              windSpeedMps: null,
              issuedAt: response.issuedAt,
              retrievedAt: response.generatedAt,
              status: "outside-window",
              stale: response.stale,
              staleReason: response.staleReason,
            },
          };
        }),
      }) : null);
    } catch {
      setNotice("날씨 공급자 응답을 안전하게 확인하지 못해 날씨를 표시하지 않았습니다.");
    } finally {
      if (weatherRequest === weatherRequestRef.current) setWeatherLoading(null);
    }
  }

  async function recalculate(event: FormEvent) {
    event.preventDefault();
    if (actionGateRef.current.planning) {
      setNotice("현재 계획의 계산과 저장이 끝날 때까지 기다려 주세요.");
      return;
    }
    if (!connected && (!draft.origin.trim() || !draft.destination.trim() || !draft.lunch.trim())) {
      setNotice("출발지, 복귀지, 점심 정차는 반드시 입력해야 합니다.");
      return;
    }
    if (!connected) {
      setNotice("데모 계획을 갱신했습니다. 실제 계산에는 Supabase와 카카오 API 설정이 필요합니다.");
      setPlannerOpen(false);
      return;
    }
    if (!places.origin || !places.destination || !places.lunch) {
      setNotice("출발지, 복귀지, 점심은 검색 결과에서 장소를 선택해야 합니다.");
      return;
    }
    if (draft.includeRest && !places.rest) {
      setNotice("휴식을 일정에 넣으려면 휴식 장소를 검색해서 선택해 주세요.");
      return;
    }

    const supabase = getBrowserSupabase();
    if (!supabase) {
      setNotice("Supabase 연결 설정을 확인해 주세요.");
      return;
    }

    const planningLease = actionGateRef.current.beginPlanning();
    if (!planningLease) {
      setNotice("현재 계획 상태 저장이 끝난 뒤 다시 계산해 주세요.");
      return;
    }
    setCalculating(true);
    weatherRequestRef.current += 1;
    setWeatherLoading(null);
    const calculationGeneration = ++routeGenerationRef.current;
    const targetTripId = liveTripIdRef.current;
    const planningId = crypto.randomUUID();
    setNotice("오토바이·자동차전용도로 제외 조건으로 경로를 계산 중입니다.");
    const generatedWaypoints = [
      ...windingPoints.map((place) => routePoint(place, "pass-through", 0, true)),
      routePoint(places.lunch, "stop", 60, false, "lunch"),
      ...(draft.includeRest && places.rest ? [routePoint(places.rest, "optional", 30, false, "rest")] : []),
      ...(places.dinner ? [routePoint(places.dinner, "stop", 60, false, "dinner")] : []),
    ];
    const commonBody = {
      planningId,
      origin: routePoint(places.origin, "pass-through", 0),
      destination: routePoint(places.destination, "pass-through", 0),
      waypoints: appliedCollectionPoints?.filter((point) => point.selected) ?? generatedWaypoints,
      serviceDate: draft.rideDate,
      departureAt,
    };
    try {
      const result = await supabase.functions.invoke("plan-route", { body: commonBody });
      if (
        calculationGeneration !== routeGenerationRef.current ||
        liveTripIdRef.current !== targetTripId
      ) {
        setNotice("계산 중 계획이 바뀌어 도착한 이전 경로를 적용하지 않았습니다. 다시 계산해 주세요.");
        return;
      }
      if (result.error) {
        if (liveRoute) setLiveResultStale(true);
        setNotice(liveRoute
          ? "추천 경로 계산에 실패해 이전 실제 경로를 유지했습니다. 자동차 경로로 대체하지 않았습니다."
          : "추천 경로를 안전 조건 안에서 계산하지 못했습니다. 예시 결과를 실제 성공으로 바꾸지 않았습니다.");
        return;
      }
      const candidate = liveRouteCandidate(parseSafeRecommendedRoute(result.data));
      setNotice("실제 추천 경로를 계산했습니다. 계획을 안전하게 저장하는 중입니다.");

      const { data: savedTripId, error: saveError } = await supabase.rpc("finalize_trip_plan", {
        target_planning_id: planningId,
        target_trip_id: targetTripId,
      });
      if (saveError || !isUuid(savedTripId)) {
        setNotice("계획 저장에 실패해 이전 실제 경로를 유지했습니다. 날씨와 공유에는 실패한 계산을 사용하지 않습니다.");
        closePlannerPanel();
        return;
      }
      if (
        calculationGeneration !== routeGenerationRef.current ||
        liveTripIdRef.current !== targetTripId
      ) {
        setNotice("저장 중 계획 상태가 바뀌어 도착한 결과를 화면에 적용하지 않았습니다. 다시 계산해 주세요.");
        return;
      }
      setLiveRoute(candidate);
      setWeather(null);
      setLiveResultStale(false);
      setLiveTripId(savedTripId);
      liveTripIdRef.current = savedTripId;
      setNotice("실제 추천 경로와 계획을 저장했습니다.");
      void loadWeather(candidate, savedTripId, calculationGeneration);
    } catch (error) {
      if (liveRoute) setLiveResultStale(true);
      const providerFailure = error instanceof ProviderContractError;
      setNotice(liveRoute
        ? `${providerFailure ? "추천 경로 " : ""}응답을 안전하게 확인하지 못해 이전 실제 경로를 유지했습니다.`
        : `${providerFailure ? "추천 경로 " : ""}공급자 응답을 안전하게 확인하지 못했습니다. 예시 결과를 실제 성공으로 바꾸지 않았습니다.`);
      return;
    } finally {
      planningLease.release();
      setCalculating(false);
    }
    closePlannerPanel();
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top" aria-label="MOTOCAST 홈">
          <span className="brand-mark">M</span>
          <span>MOTOCAST</span>
        </a>
        <div className="trip-heading">
          <span className="trip-kicker">{draft.rideDate}</span>
          <strong>당일 라이딩 계획</strong>
          <span className="private-pill">지인 전용</span>
        </div>
        <div className="header-actions">
          <span className={`connection-pill ${connected ? "connected" : "demo"}`}>
            {connected ? "서비스 연결됨" : "데모 모드"}
          </span>
          {connected ? <Link className="ghost-button" href="/admin/invites">초대 관리</Link> : null}
        </div>
      </header>

      <div className="workspace" id="top">
        <aside
          ref={plannerPanelRef}
          className={`planner-panel ${plannerOpen ? "is-open" : ""}`}
          inert={isCompact && !plannerOpen}
          role={isCompact ? "dialog" : undefined}
          aria-modal={isCompact && plannerOpen ? true : undefined}
          aria-label={isCompact ? "라이딩 계획 편집" : undefined}
        >
          <div className="panel-handle" aria-hidden="true" />
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">PLAN THE DAY</p>
              <h1>라이딩 계획</h1>
            </div>
            <button className="close-panel" type="button" onClick={closePlannerPanel} aria-label="계획 패널 닫기">×</button>
          </div>

          <form onSubmit={recalculate} className="planner-form">
            <fieldset className="planner-fields" disabled={calculating} aria-busy={calculating}>
            <section className="form-section">
              <div className="section-label"><span>01</span>경로</div>
              {connected ? (
                <>
                  <PlaceSearchField label="출발지" placeholder="예: 팔당역" required selected={places.origin} onSelect={(place) => selectPlace("origin", place)} />
                  <PlaceSearchField label="복귀지" placeholder="예: 팔당역" required selected={places.destination} onSelect={(place) => selectPlace("destination", place)} />
                </>
              ) : (
                <>
                  <label><span>출발지</span><input value={draft.origin} onChange={(event) => update("origin", event.target.value)} /></label>
                  <label><span>복귀지</span><input value={draft.destination} onChange={(event) => update("destination", event.target.value)} /></label>
                </>
              )}
              {connected && appliedCollectionPoints ? (
                <ol className="ordered-waypoints" aria-label="적용된 컬렉션 경유지 순서">
                  {appliedCollectionPoints.map((point, index) => (
                    <li className="ordered-waypoint" key={point.uiKey}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{point.name}</strong>
                        <small>{point.kind} · {point.dwellMinutes}분 · {point.selected ? "선택됨" : "선택 안 됨"}{point.winding ? " · 와인딩" : ""}</small>
                      </div>
                      {point.winding ? (
                        <div className="waypoint-actions">
                          <button type="button" disabled={index === 0} onClick={() => moveAppliedWindingPoint(index, -1)} aria-label={`${point.name} 위로 이동`}>↑</button>
                          <button type="button" disabled={index === appliedCollectionPoints.length - 1} onClick={() => moveAppliedWindingPoint(index, 1)} aria-label={`${point.name} 아래로 이동`}>↓</button>
                          <button type="button" onClick={() => removeAppliedWindingPoint(point)} aria-label={`${point.name} 제거`}>×</button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : connected && windingPoints.length ? (
                <ol className="ordered-waypoints" aria-label="커스텀 와인딩 경유지 순서">
                  {windingPoints.map((place, index) => (
                    <li className="ordered-waypoint" key={place.kakaoPlaceId}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div><strong>{place.name}</strong><small>{place.roadAddress ?? place.address}</small></div>
                      <div className="waypoint-actions">
                        <button type="button" disabled={index === 0} onClick={() => moveWindingPoint(index, -1)} aria-label={`${place.name} 위로 이동`}>↑</button>
                        <button type="button" disabled={index === windingPoints.length - 1} onClick={() => moveWindingPoint(index, 1)} aria-label={`${place.name} 아래로 이동`}>↓</button>
                        <button type="button" onClick={() => removeWindingPoint(place)} aria-label={`${place.name} 제거`}>×</button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : !connected ? (
                <div className="waypoint-list">
                  <span className="waypoint-tag winding"><i />유명산 굽이길 <button type="button" aria-label="유명산 굽이길 제거">×</button></span>
                  <span className="waypoint-tag"><i />홍천 점심 <button type="button" aria-label="홍천 점심 제거">×</button></span>
                </div>
              ) : null}
              {connected && addingWinding ? (
                <div className="winding-editor">
                  <PlaceSearchField label="와인딩 경유지" placeholder="산길 입구, 고개, 전망대" autoFocus selected={null} onSelect={addWindingPoint} />
                  <button className="text-button muted" type="button" onClick={cancelWindingEdit}>추가 취소</button>
                </div>
              ) : null}
              <button
                ref={addWindingButtonRef}
                className="text-button"
                type="button"
                disabled={connected && (addingWinding || windingPoints.length >= 20)}
                onClick={() => connected ? setAddingWinding(true) : setNotice("커스텀 경유지는 실제 연결 모드에서 장소 검색으로 추가합니다.")}
              >
                + 커스텀 와인딩 경유지 추가{windingPoints.length ? ` · ${windingPoints.length}개` : ""}
              </button>
              <p className="sr-only" role="status" aria-live="polite">{waypointStatus}</p>
            </section>

            <section className="form-section">
              <div className="section-label"><span>02</span>시간</div>
              <label>
                <span>라이딩 날짜</span>
                <input type="date" value={draft.rideDate} onChange={(event) => update("rideDate", event.target.value)} />
              </label>
              <label><span>출발</span><input type="time" value={draft.departureTime} onChange={(event) => update("departureTime", event.target.value)} /></label>
              <div className="time-estimate-note">
                <span aria-hidden="true">↗</span>
                <p><strong>복귀는 자동 계산</strong><small>추천 경로·식사·선택 휴식을 합산해 예상 시각을 보여줍니다.</small></p>
              </div>
            </section>

            <section className="form-section">
              <div className="section-label"><span>03</span>정차</div>
              {connected ? (
                <>
                  <PlaceSearchField label="점심" placeholder="식당 이름 또는 지역" required selected={places.lunch} onSelect={(place) => selectPlace("lunch", place)} />
                  <PlaceSearchField label="저녁 · 선택" placeholder="입력하지 않아도 됩니다" selected={places.dinner} onSelect={(place) => selectPlace("dinner", place)} />
                </>
              ) : (
                <>
                  <label><span>점심 · 필수</span><input value={draft.lunch} onChange={(event) => update("lunch", event.target.value)} /></label>
                  <label><span>저녁 · 선택</span><input placeholder="입력하지 않아도 됩니다" value={draft.dinner} onChange={(event) => update("dinner", event.target.value)} /></label>
                </>
              )}
              <label className="toggle-row">
                <span><strong>휴식 일정에 포함</strong><small>장소 선택 시 기본 30분 계산</small></span>
                <input type="checkbox" checked={draft.includeRest} onChange={(event) => update("includeRest", event.target.checked)} />
                <i aria-hidden="true" />
              </label>
              {connected && draft.includeRest ? (
                <PlaceSearchField label="휴식 장소" placeholder="카페, 휴게소, 전망대" required selected={places.rest} onSelect={(place) => selectPlace("rest", place)} />
              ) : null}
            </section>

            <div className="safety-note">
              <span className="shield-mark">✓</span>
              <p><strong>오토바이 안전 조건 고정</strong><br />자동차전용도로 제외 조건을 완화하지 않습니다.</p>
            </div>
            <button className="primary-button calculate" type="submit" disabled={calculating}>
              {calculating ? "안전 추천 경로 계산 중…" : "추천 경로 다시 계산"}
            </button>
            </fieldset>
          </form>
        </aside>

        <section className="route-stage" aria-label="라이딩 계획 결과">
          <div className="map-area">
            <KakaoMapCanvas points={selectedMapPoints} path={selected.path} />
            <div className="map-topbar">
              <div className="map-badges">
                <div className="condition-banner"><span>안전 조건</span><strong>이륜차 · 자동차전용도로 제외</strong></div>
                {!liveRoute ? <span className="example-data-badge">예시 데이터</span> : <span className="live-data-badge">{liveResultStale ? "이전 실제 경로" : "실제 경로"}</span>}
              </div>
              <button className="map-control" type="button" aria-label="현재 위치로 이동">⌖</button>
            </div>
            <div className="ride-summary">
              <p>추천 경로</p>
              <h2>{selected.label}</h2>
              <div className="summary-metrics">
                <span><strong>{selected.distanceKm}</strong> km</span>
                <span><strong>{minutesLabel(timeline.rideMinutes)}</strong> 주행</span>
                <span><strong>{minutesLabel(timeline.stopMinutes)}</strong> 정차</span>
                <span><strong>{formatRideTime(displayedDepartureAt, timeline.returnAt)}</strong> 예상 복귀</span>
              </div>
              <div className="return-status safe">정차 포함 예상 복귀</div>
            </div>
          </div>

          <div className="forecast-panel">
            <div className="forecast-heading">
              <div><p className="eyebrow">WEATHER BY ARRIVAL</p><h2>시간에 따른 구간 날씨</h2></div>
              <span className="forecast-issued">
                {!liveRoute
                  ? "예보 발행 09:00 · 예시"
                  : weatherLoading === selected.id
                    ? "기상청 예보 조회 중"
                    : selectedWeatherStatus
                      ? selectedWeatherStatus.header
                      : "날씨 미조회"}
              </span>
            </div>
            <div className="timeline-list">
              {timeline.segments.map((segment, index) => {
                const risk = weatherRiskLabel(segment);
                return (
                  <article className="timeline-row" key={segment.id}>
                    <div className="timeline-time"><strong>{formatRideTime(displayedDepartureAt, segment.arrivalAt)}</strong><span>{index === timeline.segments.length - 1 ? "예상 복귀" : "통과 예상"}</span></div>
                    <div className="timeline-rail"><i className={`risk-dot ${risk.level}`} />{index < timeline.segments.length - 1 ? <span /> : null}</div>
                    <div className="segment-copy"><strong>{segment.from.label} → {segment.to.label}</strong><span>{segment.distanceKm} km · 약 {Math.ceil(segment.rideMinutes)}분</span></div>
                    <div className={`weather-chip ${risk.level}`}>
                      <span className="weather-word">{weatherIcon(segment.weather.condition)}</span>
                      <strong>{segment.weather.temperatureC ?? "–"}°</strong>
                      <small>강수 {segment.weather.precipitationProbability ?? "–"}% · 바람 {segment.weather.windSpeedMps ?? "–"}m/s</small>
                      <small>{weatherModelLabel(segment.weather.status, segment.weather.model)}</small>
                    </div>
                    <span className={`risk-label ${risk.level}`}>{risk.label}</span>
                  </article>
                );
              })}
            </div>
            {selectedWeatherStatus ? (
              <div className="stale-notice"><span>i</span>{selectedWeatherStatus.notice}</div>
            ) : null}
            <p className="sr-only" role="status" aria-live="polite">{selectedWeatherAnnouncement}</p>
            <div className="stale-notice" role="status"><span>i</span>{notice}</div>
          </div>

          {connected ? (
            <div className="management-grid">
              <CollectionManager currentPoints={collectionPoints} onApply={applyCollection} disabled={calculating} />
              <ShareManager tripId={liveTripId} disabled={calculating} />
            </div>
          ) : null}
        </section>
      </div>

      <button ref={mobilePlanButtonRef} className="mobile-plan-button" type="button" onClick={() => setPlannerOpen(true)}>계획 수정</button>
      {plannerOpen ? <button className="panel-backdrop" type="button" aria-label="계획 패널 닫기" onClick={closePlannerPanel} /> : null}
    </main>
  );
}
