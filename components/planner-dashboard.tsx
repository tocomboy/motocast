"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { CollectionManager } from "@/components/collection-manager";
import { KakaoMapCanvas, MapMarkerLegend } from "@/components/kakao-map-canvas";
import { OrderedWaypointEditor } from "@/components/ordered-waypoint-editor";
import { PlaceSearchField } from "@/components/place-search-field";
import { ShareManager } from "@/components/share-manager";
import { prepareCollectionApplication } from "@/lib/collections/application";
import type { CollectionCourse, CollectionPoint } from "@/lib/collections/contracts";
import type { PlaceSearchResult } from "@/lib/places/search";
import {
  demoRoute,
  demoDepartureAt,
  demoMapPoints,
} from "@/lib/planner/demo";
import { PlannerActionGate } from "@/lib/planner/action-gate";
import { withClientTimeout } from "@/lib/planner/client-timeout";
import { isPastDeparture, minimumDeparture } from "@/lib/planner/departure";
import { buildPlannerMapPoints } from "@/lib/planner/map-points";
import {
  collectionPointFromEditableWaypoint,
  editableWaypointFromCollectionPoint,
  type EditableWaypoint,
} from "@/lib/planner/ordered-waypoints";
import { parseSafeRecommendedRoute, ProviderContractError, type SafeRouteResponse } from "@/lib/planner/provider-contract";
import { readRouteFailureCode, routeFailureNotice } from "@/lib/planner/route-failure";
import { buildTimeline, formatRideTime, weatherRiskLabel } from "@/lib/planner/schedule";
import type { PlannedSegment, RouteCandidate } from "@/lib/planner/types";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { parseWeatherTimelineResponse, type WeatherTimelineResponse } from "@/lib/weather/provider-contract";
import { formatPlannerWeatherStatus, isFreshWeatherForSharing, weatherFailureLabel } from "@/lib/weather/status";

type PlannerDraft = {
  origin: string;
  destination: string;
  rideDate: string;
  departureTime: string;
};

type PlannerPlaces = {
  origin: PlaceSearchResult | null;
  destination: PlaceSearchResult | null;
};

type PlannerNotice = {
  message: string;
  severity: "info" | "warning" | "error";
  source: "planner" | "waypoint";
  eventId: number;
};

function seoulToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function currentReferenceTime() {
  return new Date().toISOString();
}

const defaultDraft: PlannerDraft = {
  origin: "팔당 출발점",
  destination: "팔당 복귀점",
  rideDate: seoulToday(),
  departureTime: "07:30",
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

function endpointPoint(place: PlaceSearchResult) {
  return {
    ...place,
    id: place.kakaoPlaceId,
    label: place.name,
    kind: "pass-through" as const,
    dwellMinutes: 0,
    selected: true,
    winding: false,
  };
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
  });
  const [waypoints, setWaypoints] = useState<EditableWaypoint[]>([]);
  const [liveRoute, setLiveRoute] = useState<RouteCandidate | null>(null);
  const [liveTripId, setLiveTripId] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherTimelineResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState<RouteCandidate["id"] | null>(null);
  const [weatherClock, setWeatherClock] = useState<string | null>(null);
  const [liveResultStale, setLiveResultStale] = useState(false);
  const [waypointStatus, setWaypointStatus] = useState("");
  const [isCompact, setIsCompact] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [notice, setNoticeState] = useState<PlannerNotice>({
    message: connected
      ? "저장된 데모 계획입니다. 장소를 확인한 뒤 추천 경로를 다시 계산하세요."
      : "환경변수가 없어 데모 모드로 실행 중입니다. 실제 외부 API는 호출하지 않습니다.",
    severity: "info",
    source: "planner",
    eventId: 0,
  });
  const [calculating, setCalculating] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [shareIntentGeneration, setShareIntentGeneration] = useState<number | null>(null);
  const [sharePreviewRequest, setSharePreviewRequest] = useState<{ serial: number; tripId: string } | null>(null);
  const [shareManagerEpoch, setShareManagerEpoch] = useState(0);
  const [placeSelectionRevision, setPlaceSelectionRevision] = useState(0);
  const plannerPanelRef = useRef<HTMLElement>(null);
  const mobilePlanButtonRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const noticeSequenceRef = useRef(0);
  const routeGenerationRef = useRef(0);
  const liveTripIdRef = useRef<string | null>(null);
  const weatherRequestRef = useRef(0);
  const sharePreviewSerialRef = useRef(0);
  const actionGateRef = useRef(new PlannerActionGate());
  function setNotice(
    message: string,
    severity: PlannerNotice["severity"] = "info",
    source: PlannerNotice["source"] = "planner",
  ) {
    noticeSequenceRef.current += 1;
    setNoticeState({ message, severity, source, eventId: noticeSequenceRef.current });
  }

  function reportWaypointSuccess(message: string) {
    setWaypointStatus(message);
    if (notice.source === "waypoint" && notice.severity === "error") {
      setNotice(message, "info", "waypoint");
    }
  }

  useEffect(() => {
    const currentKey = "motocast-planner-draft-v3";
    const legacyKeys = ["motocast-planner-draft-v2", "motocast-planner-draft-v1"];
    const saved = window.localStorage.getItem(currentKey) ?? legacyKeys
      .map((key) => window.localStorage.getItem(key))
      .find((value) => value !== null);
    if (!saved) return;
    let restored: PlannerDraft;
    try {
      const parsed = JSON.parse(saved) as Partial<PlannerDraft>;
      restored = {
        origin: typeof parsed.origin === "string" ? parsed.origin : defaultDraft.origin,
        destination: typeof parsed.destination === "string" ? parsed.destination : defaultDraft.destination,
        rideDate: typeof parsed.rideDate === "string" ? parsed.rideDate : defaultDraft.rideDate,
        departureTime: typeof parsed.departureTime === "string" ? parsed.departureTime : defaultDraft.departureTime,
      };
      legacyKeys.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      window.localStorage.removeItem(currentKey);
      legacyKeys.forEach((key) => window.localStorage.removeItem(key));
      return;
    }
    const task = window.setTimeout(() => setDraft(restored), 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("motocast-planner-draft-v3", JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (notice.severity !== "error") return;
    noticeRef.current?.focus({ preventScroll: false });
  }, [notice.eventId, notice.severity, isCompact, plannerOpen]);

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
  const shareWeatherReady = selectedWeather
    ? isFreshWeatherForSharing(selectedWeather, weatherClock ?? currentReferenceTime())
    : false;
  const shareTripId = !liveResultStale && shareIntentGeneration === null && shareWeatherReady ? liveTripId : null;
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
  const departureMinimum = minimumDeparture(clock);
  const departureAt = `${draft.rideDate}T${draft.departureTime}:00+09:00`;
  const { departureAt: displayedDepartureAt, timeline } = useMemo(() => buildPlannerDisplayTimeline({
    live: Boolean(liveRoute),
    draftDepartureAt: departureAt,
    fallbackDepartureAt: demoDepartureAt,
    includeRest: waypoints.some((waypoint) => waypoint.role === "rest"),
    segments: selected.segments,
  }), [departureAt, liveRoute, selected, waypoints]);
  const selectedMapPoints = liveRoute
    ? buildPlannerMapPoints(selected.segments)
    : demoMapPoints;

  const collectionPoints = useMemo<CollectionPoint[]>(() => {
    if (!connected) return [];
    return waypoints.flatMap((waypoint) => {
      const point = collectionPointFromEditableWaypoint(waypoint);
      return point ? [point] : [];
    });
  }, [connected, waypoints]);

  const allWaypointPlacesSelected = collectionPoints.length === waypoints.length;

  const currentCourse = useMemo<CollectionCourse | null>(() => (
    places.origin && places.destination && allWaypointPlacesSelected
      ? { origin: places.origin, destination: places.destination, points: collectionPoints }
      : null
  ), [allWaypointPlacesSelected, collectionPoints, places.destination, places.origin]);

  function invalidateShareSession() {
    setSharePreviewRequest(null);
    setShareManagerEpoch((current) => current + 1);
  }

  function markRouteInputChanged() {
    routeGenerationRef.current += 1;
    setShareIntentGeneration(null);
    invalidateShareSession();
    weatherRequestRef.current += 1;
    setWeatherLoading(null);
    if (liveRoute) setLiveResultStale(true);
  }

  function update<K extends keyof PlannerDraft>(key: K, value: PlannerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    markRouteInputChanged();
  }

  function selectEndpoint(key: keyof PlannerPlaces, place: PlaceSearchResult | null) {
    setPlaces((current) => ({ ...current, [key]: place }));
    markRouteInputChanged();
  }

  function updateWaypoints(next: EditableWaypoint[]) {
    setWaypoints(next);
    markRouteInputChanged();
  }

  function closePlannerPanel() {
    setPlannerOpen(false);
    if (isCompact) window.setTimeout(() => mobilePlanButtonRef.current?.focus(), 0);
  }

  function applyCollection(course: CollectionCourse, title: string, sharing = false) {
    if (!actionGateRef.current.canApplyCollection()) {
      setNotice("현재 계획 상태 저장이 끝난 뒤 컬렉션을 적용해 주세요.", "warning");
      return;
    }
    const application = prepareCollectionApplication(course);
    const collectionGeneration = ++routeGenerationRef.current;
    weatherRequestRef.current += 1;
    setWeatherLoading(null);
    invalidateShareSession();
    setWaypoints(application.orderedPoints.map(editableWaypointFromCollectionPoint));
    setPlaces({
      origin: application.origin,
      destination: application.destination,
    });
    setPlaceSelectionRevision((current) => current + 1);
    setShareIntentGeneration(sharing ? collectionGeneration : null);
    if (liveRoute) setLiveResultStale(true);
    setWaypointStatus(`${title} 컬렉션의 최신 불변 버전을 계획에 적용했습니다.`);
    setNotice(sharing
      ? "컬렉션 전체 코스를 적용했습니다. 안전 경로와 날씨를 계산하면 공유 요약 미리보기가 열립니다."
      : "컬렉션 전체 코스를 적용했습니다. 변경된 장소로 안전 경로를 다시 계산해 주세요.", "warning");
    if (sharing) {
      setPlannerOpen(true);
      window.setTimeout(() => plannerPanelRef.current?.querySelector<HTMLButtonElement>(".calculate")?.focus(), 0);
    }
  }

  function prepareCollectionShare(course: CollectionCourse, title: string) {
    applyCollection(course, title, true);
  }

  async function loadWeather(
    candidate: RouteCandidate,
    tripId: string,
    generation = routeGenerationRef.current,
    requireFresh = false,
  ): Promise<boolean> {
    const supabase = getBrowserSupabase();
    if (!supabase) return false;
    if (candidate.segments.some((segment) => !segment.arrivalAt)) {
      setNotice("경로 통과 시각이 없어 날씨를 조회하지 않았습니다.", "error");
      return false;
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
      ) return false;
      if (error) {
        setNotice("날씨를 조회하지 못했습니다. 저장된 동일 경로 예보가 있으면 서버가 stale 표시와 함께 반환합니다.", "error");
        return false;
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
      if (requireFresh && !isFreshWeatherForSharing(response, currentReferenceTime())) {
        setNotice("새 날씨가 준비되지 않아 공유 미리보기를 열지 않았습니다. 저장된 오래된 날씨는 참고용으로만 표시합니다.", "warning");
        return false;
      }
      return true;
    } catch {
      setNotice("날씨 공급자 응답을 안전하게 확인하지 못해 날씨를 표시하지 않았습니다.", "error");
      return false;
    } finally {
      if (weatherRequest === weatherRequestRef.current) setWeatherLoading(null);
    }
  }

  async function recalculate(event: FormEvent) {
    event.preventDefault();
    if (actionGateRef.current.planning) {
      setNotice("현재 계획의 계산과 저장이 끝날 때까지 기다려 주세요.", "warning");
      return;
    }
    if (isPastDeparture(draft.rideDate, draft.departureTime, new Date())) {
      setShareIntentGeneration(null);
      setNotice("지난 출발 시각은 계산할 수 없습니다. 현재 이후의 날짜와 시각을 선택해 주세요.", "error");
      return;
    }
    if (!connected && (!draft.origin.trim() || !draft.destination.trim())) {
      setShareIntentGeneration(null);
      setNotice("출발지와 복귀지는 반드시 입력해야 합니다.", "error");
      return;
    }
    if (!connected) {
      setNotice("데모 계획을 갱신했습니다. 실제 계산에는 Supabase와 카카오 API 설정이 필요합니다.");
      setPlannerOpen(false);
      return;
    }
    if (!places.origin || !places.destination) {
      setShareIntentGeneration(null);
      setNotice("출발지와 복귀지는 검색 결과에서 장소를 선택해야 합니다.", "error");
      return;
    }
    if (!allWaypointPlacesSelected) {
      setShareIntentGeneration(null);
      setNotice("추가한 모든 경유지에서 검색 결과 장소를 선택해 주세요.", "error");
      return;
    }

    const supabase = getBrowserSupabase();
    if (!supabase) {
      setShareIntentGeneration(null);
      setNotice("Supabase 연결 설정을 확인해 주세요.", "error");
      return;
    }

    const inputGeneration = routeGenerationRef.current;
    const sharingForCalculation = shareIntentGeneration === inputGeneration;
    if (shareIntentGeneration !== null && !sharingForCalculation) setShareIntentGeneration(null);

    const planningLease = actionGateRef.current.beginPlanning();
    if (!planningLease) {
      setShareIntentGeneration(null);
      setNotice("현재 계획 상태 저장이 끝난 뒤 다시 계산해 주세요.", "warning");
      return;
    }
    invalidateShareSession();
    setCalculating(true);
    weatherRequestRef.current += 1;
    setWeatherLoading(null);
    const calculationGeneration = ++routeGenerationRef.current;
    if (sharingForCalculation) setShareIntentGeneration(calculationGeneration);
    const targetTripId = liveTripIdRef.current;
    const planningId = crypto.randomUUID();
    setNotice("오토바이·자동차전용도로 제외 조건으로 경로를 계산 중입니다.");
    const commonBody = {
      planningId,
      tripId: targetTripId,
      origin: endpointPoint(places.origin),
      destination: endpointPoint(places.destination),
      waypoints: collectionPoints,
      serviceDate: draft.rideDate,
      departureAt,
    };
    try {
      const result = await supabase.functions.invoke("plan-route", { body: commonBody });
      if (
        calculationGeneration !== routeGenerationRef.current ||
        liveTripIdRef.current !== targetTripId
      ) {
        if (sharingForCalculation) setShareIntentGeneration(null);
        setNotice("계산 중 계획이 바뀌어 도착한 이전 경로를 적용하지 않았습니다. 다시 계산해 주세요.", "warning");
        return;
      }
      if (result.error) {
        if (sharingForCalculation) setShareIntentGeneration(null);
        if (liveRoute) setLiveResultStale(true);
        setNotice(routeFailureNotice(await readRouteFailureCode(result.error), Boolean(liveRoute)), "error");
        return;
      }
      const candidate = liveRouteCandidate(parseSafeRecommendedRoute(result.data));
      setNotice("실제 추천 경로를 계산했습니다. 계획을 안전하게 저장하는 중입니다.");

      const { data: savedTripId, error: saveError } = await supabase.rpc("finalize_trip_plan", {
        target_planning_id: planningId,
        target_trip_id: targetTripId,
      });
      if (saveError || !isUuid(savedTripId)) {
        if (sharingForCalculation) setShareIntentGeneration(null);
        setNotice("계획 저장에 실패해 이전 실제 경로를 유지했습니다. 날씨와 공유에는 실패한 계산을 사용하지 않습니다.", "error");
        closePlannerPanel();
        return;
      }
      if (
        calculationGeneration !== routeGenerationRef.current ||
        liveTripIdRef.current !== targetTripId
      ) {
        if (sharingForCalculation) setShareIntentGeneration(null);
        setNotice("저장 중 계획 상태가 바뀌어 도착한 결과를 화면에 적용하지 않았습니다. 다시 계산해 주세요.", "warning");
        return;
      }
      setLiveRoute(candidate);
      setWeather(null);
      setLiveResultStale(false);
      setLiveTripId(savedTripId);
      liveTripIdRef.current = savedTripId;
      setNotice("실제 추천 경로와 계획을 저장했습니다.");
      if (sharingForCalculation) {
        const weatherReady = await loadWeather(candidate, savedTripId, calculationGeneration, true);
        setShareIntentGeneration(null);
        if (weatherReady) {
          sharePreviewSerialRef.current += 1;
          setSharePreviewRequest({ serial: sharePreviewSerialRef.current, tripId: savedTripId });
        }
      } else {
        void loadWeather(candidate, savedTripId, calculationGeneration);
      }
    } catch (error) {
      if (sharingForCalculation) setShareIntentGeneration(null);
      if (liveRoute) setLiveResultStale(true);
      const providerFailure = error instanceof ProviderContractError;
      setNotice(liveRoute
        ? `${providerFailure ? "추천 경로 " : ""}응답을 안전하게 확인하지 못해 이전 실제 경로를 유지했습니다.`
        : `${providerFailure ? "추천 경로 " : ""}공급자 응답을 안전하게 확인하지 못했습니다. 예시 결과를 실제 성공으로 바꾸지 않았습니다.`, "error");
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
                  <PlaceSearchField key={`origin-${placeSelectionRevision}`} label="출발지" placeholder="예: 팔당역" required selected={places.origin} onSelect={(place) => selectEndpoint("origin", place)} />
                  <PlaceSearchField key={`destination-${placeSelectionRevision}`} label="복귀지" placeholder="예: 팔당역" required selected={places.destination} onSelect={(place) => selectEndpoint("destination", place)} />
                </>
              ) : (
                <>
                  <label><span>출발지</span><input value={draft.origin} onChange={(event) => update("origin", event.target.value)} /></label>
                  <label><span>복귀지</span><input value={draft.destination} onChange={(event) => update("destination", event.target.value)} /></label>
                </>
              )}
            </section>

            <section className="form-section">
              <div className="section-label"><span>02</span>경유지</div>
              <OrderedWaypointEditor
                connected={connected}
                disabled={calculating}
                selectionRevision={placeSelectionRevision}
                waypoints={waypoints}
                onChange={updateWaypoints}
                onStatus={reportWaypointSuccess}
                onError={(message) => setNotice(message, "error", "waypoint")}
              />
              <p className="sr-only" role="status" aria-live="polite">{waypointStatus}</p>
            </section>

            <section className="form-section">
              <div className="section-label"><span>03</span>시간</div>
              <label>
                <span>라이딩 날짜</span>
                <input type="date" min={departureMinimum.date} value={draft.rideDate} onChange={(event) => update("rideDate", event.target.value)} />
              </label>
              <label><span>출발</span><input type="time" min={draft.rideDate === departureMinimum.date ? departureMinimum.time : undefined} value={draft.departureTime} onChange={(event) => update("departureTime", event.target.value)} /></label>
              <div className="time-estimate-note">
                <span aria-hidden="true">↗</span>
                <p><strong>복귀는 자동 계산</strong><small>추천 경로·선택한 식사와 휴식을 합산해 예상 시각을 보여줍니다.</small></p>
              </div>
            </section>

            <div className="safety-note">
              <span className="shield-mark">✓</span>
              <p><strong>오토바이 안전 조건 고정</strong><br />자동차전용도로 제외 조건을 완화하지 않습니다.</p>
            </div>
            {isCompact && plannerOpen ? (
              <div
                ref={noticeRef}
                className={`action-notice ${notice.severity}`}
                role={notice.severity === "error" ? "alert" : "status"}
                aria-live={notice.severity === "error" ? "assertive" : "polite"}
                tabIndex={-1}
              >
                <span className="notice-symbol" aria-hidden="true">{notice.severity === "error" ? "!" : notice.severity === "warning" ? "△" : "i"}</span>
                <p><strong>{notice.severity === "error" ? "계획을 완료하지 못했습니다" : notice.severity === "warning" ? "확인이 필요합니다" : "진행 상태"}</strong><span>{notice.message}</span></p>
              </div>
            ) : null}
            <button className="primary-button calculate" type="submit" disabled={calculating}>
              {calculating ? "안전 추천 경로 계산 중…" : "추천 경로 다시 계산"}
            </button>
            </fieldset>
          </form>
        </aside>

        <section className="route-stage" aria-label="라이딩 계획 결과">
          <div className="route-map-frame">
            <div className="route-map-meta">
              <div className="condition-banner"><span>안전 조건</span><strong>이륜차 · 자동차전용도로 제외</strong></div>
              {!liveRoute ? <span className="example-data-badge">예시 데이터</span> : <span className="live-data-badge">{liveResultStale ? "이전 실제 경로" : "실제 경로"}</span>}
            </div>
            <div className="map-area">
              <KakaoMapCanvas points={selectedMapPoints} path={selected.path} showLegend={false} />
              <button className="map-control" type="button" aria-label="현재 위치로 이동">⌖</button>
            </div>
            <div className="route-map-details">
              <MapMarkerLegend points={selectedMapPoints} inline />
              <section className="ride-summary" aria-labelledby="route-summary-heading">
                <h2 id="route-summary-heading">경로 요약</h2>
                <div className="summary-metrics">
                  <span><strong>{selected.distanceKm}</strong> km</span>
                  <span><strong>{minutesLabel(timeline.rideMinutes)}</strong> 주행</span>
                  <span><strong>{minutesLabel(timeline.stopMinutes)}</strong> 정차</span>
                  <span><strong>{formatRideTime(displayedDepartureAt, timeline.returnAt)}</strong> 예상 복귀</span>
                </div>
                <div className="return-status safe">정차 포함 예상 복귀</div>
              </section>
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
                    <div className={`weather-chip ${risk.level}`} data-condition={segment.weather.condition} aria-label={`${formatRideTime(displayedDepartureAt, segment.arrivalAt)} ${segment.to.label} 도착, 날씨 ${weatherIcon(segment.weather.condition)}, 기온 ${segment.weather.temperatureC ?? "확인 불가"}도, 강수 확률 ${segment.weather.precipitationProbability ?? "확인 불가"}퍼센트, 바람 ${segment.weather.windSpeedMps ?? "확인 불가"}미터 매초, ${weatherModelLabel(segment.weather.status, segment.weather.model)}`}>
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
            {!(isCompact && plannerOpen) ? (
              <div
                ref={noticeRef}
                className={`action-notice ${notice.severity}`}
                role={notice.severity === "error" ? "alert" : "status"}
                aria-live={notice.severity === "error" ? "assertive" : "polite"}
                tabIndex={-1}
              >
                <span className="notice-symbol" aria-hidden="true">{notice.severity === "error" ? "!" : notice.severity === "warning" ? "△" : "i"}</span>
                <p><strong>{notice.severity === "error" ? "계획을 완료하지 못했습니다" : notice.severity === "warning" ? "확인이 필요합니다" : "진행 상태"}</strong><span>{notice.message}</span></p>
              </div>
            ) : null}
          </div>

          {connected ? (
            <div className="management-grid">
              <CollectionManager currentCourse={currentCourse} onApply={applyCollection} onShare={prepareCollectionShare} disabled={calculating} />
              <ShareManager
                tripId={shareTripId}
                sessionEpoch={shareManagerEpoch}
                previewRequest={sharePreviewRequest?.tripId === shareTripId ? sharePreviewRequest.serial : 0}
                disabled={calculating}
              />
            </div>
          ) : null}
        </section>
      </div>

      <button ref={mobilePlanButtonRef} className="mobile-plan-button" type="button" onClick={() => setPlannerOpen(true)}>계획 수정</button>
      {plannerOpen ? <button className="panel-backdrop" type="button" aria-label="계획 패널 닫기" onClick={closePlannerPanel} /> : null}
    </main>
  );
}
