"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

import { CollectionManager } from "@/components/collection-manager";
import { KakaoMapHandoff } from "@/components/kakaomap-handoff";
import { ownerHandoff } from "@/lib/planner/kakaomap-sources";
import { KakaoMapCanvas, MapMarkerLegend } from "@/components/kakao-map-canvas";
import { OrderedWaypointEditor } from "@/components/ordered-waypoint-editor";
import { PlaceFavoritesProvider, usePlaceFavorites } from "@/components/place-favorites-provider";
import { PlaceSearchField } from "@/components/place-search-field";
import { PlannerHome } from "@/components/planner-home";
import { PlannerScheduleDialog } from "@/components/planner-schedule-dialog";
import { RidingSummaryLayout, RidingWeatherCard } from "@/components/riding-summary-layout";
import { ShareManager } from "@/components/share-manager";
import { prepareCollectionApplication } from "@/lib/collections/application";
import type { CollectionCourse, CollectionPoint } from "@/lib/collections/contracts";
import type { PlaceSearchResult } from "@/lib/places/search";
import { favoriteAsSearchResult } from "@/lib/places/favorites";
import {
  demoRoute,
  demoDepartureAt,
  demoMapPoints,
} from "@/lib/planner/demo";
import { PlannerActionGate } from "@/lib/planner/action-gate";
import { withClientTimeout } from "@/lib/planner/client-timeout";
import { isPastDeparture, minimumDeparture } from "@/lib/planner/departure";
import { formatRideDuration, formatSummaryDeparture } from "@/lib/planner/display";
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

type PlannerView = "home" | "editor" | "summary" | "collections";
type PlannerDashboardProps = {
  connected: boolean;
  initialCourse?: CollectionCourse | null;
  initialTitle?: string;
  navigationMode?: "browser" | "memory";
  onExit?: () => void;
};

function resetViewScroll() {
  if (typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
}

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
  return formatRideDuration(value);
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

export function PlannerDashboard(props: PlannerDashboardProps) {
  return <PlaceFavoritesProvider enabled={props.connected}><PlannerDashboardContent {...props} /></PlaceFavoritesProvider>;
}

function PlannerDashboardContent({ connected, initialCourse = null, initialTitle = "공유받은 경로", navigationMode = "browser", onExit }: PlannerDashboardProps) {
  const favoriteControls = usePlaceFavorites();
  const [view, setView] = useState<PlannerView>(initialCourse ? "editor" : connected ? "home" : "summary");
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
  const [summaryActionMode, setSummaryActionMode] = useState<"choice" | "share" | "save">("choice");
  const [summaryActionsOpen, setSummaryActionsOpen] = useState(false);
  const [routeTitle, setRouteTitle] = useState(initialCourse ? initialTitle : "라이딩 경로");
  const [homeStatus, setHomeStatus] = useState("");
  const [summarySaveBusy, setSummarySaveBusy] = useState(false);
  const [placeSelectionRevision, setPlaceSelectionRevision] = useState(0);
  const [favoriteTarget, setFavoriteTarget] = useState<"origin" | "destination" | string | null>("origin");
  const plannerPanelRef = useRef<HTMLElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const rideDateRef = useRef<HTMLButtonElement>(null);
  const noticeSequenceRef = useRef(0);
  const routeGenerationRef = useRef(0);
  const calculatedGenerationRef = useRef<number | null>(null);
  const liveTripIdRef = useRef<string | null>(null);
  const weatherRequestRef = useRef(0);
  const sharePreviewSerialRef = useRef(0);
  const actionGateRef = useRef(new PlannerActionGate());
  const viewRef = useRef(view);
  const navigationGenerationRef = useRef(0);
  const initialCourseAppliedRef = useRef(false);
  const mountedRef = useRef(true);
  const summaryActionsDialogRef = useRef<HTMLDialogElement>(null);
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
    for (const key of ["motocast-planner-draft-v1", "motocast-planner-draft-v2", "motocast-planner-draft-v3"]) window.localStorage.removeItem(key);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      routeGenerationRef.current += 1;
      weatherRequestRef.current += 1;
    };
  }, []);

  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    if (!connected) return;
    const supabase = getBrowserSupabase();
    let userId: string | null | undefined;
    const subscription = supabase?.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      const next = session?.user.id ?? null;
      if (userId !== undefined && userId !== next) {
        routeGenerationRef.current += 1;
        setLiveResultStale(true);
      }
      userId = next;
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, [connected]);

  useEffect(() => {
    if (!summaryActionsOpen || view !== "summary") return;
    const dialog = summaryActionsDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [summaryActionsOpen, view]);

  useEffect(() => {
    if (navigationMode !== "browser") return;
    const sync = () => {
      const hash = window.location.hash;
      const next: PlannerView = hash === "#collections" ? "collections" : hash === "#editor" ? "editor" : hash === "#summary" ? "summary" : "home";
      navigationGenerationRef.current += 1;
      setView(next);
      resetViewScroll();
      window.setTimeout(() => { if (mountedRef.current && typeof document !== "undefined") document.querySelector<HTMLElement>(`[data-view-title="${next}"]`)?.focus({ preventScroll: true }); }, 0);
    };
    if (window.location?.hash) sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); };
  }, [navigationMode]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (notice.severity !== "error") return;
    noticeRef.current?.focus({ preventScroll: false });
  }, [notice.eventId, notice.severity, isCompact]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const updateCompact = () => setIsCompact(media.matches);
    updateCompact();
    media.addEventListener("change", updateCompact);
    return () => media.removeEventListener("change", updateCompact);
  }, []);

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
  const inputMapPoints = [
    ...(places.origin ? [{ label: places.origin.name, latitude: places.origin.latitude, longitude: places.origin.longitude, role: "origin" as const }] : []),
    ...waypoints.flatMap((waypoint) => waypoint.place ? [{ label: waypoint.place.name, latitude: waypoint.place.latitude, longitude: waypoint.place.longitude, role: waypoint.role === "lunch" || waypoint.role === "dinner" || waypoint.role === "rest" ? waypoint.role : "waypoint" as const }] : []),
    ...(places.destination ? [{ label: places.destination.name, latitude: places.destination.latitude, longitude: places.destination.longitude, role: "destination" as const }] : []),
  ];
  const selectedMapPoints = liveRoute ? buildPlannerMapPoints(selected.segments) : connected ? inputMapPoints : demoMapPoints;
  const selectedMapPath = liveRoute ? selected.path : connected ? undefined : selected.path;

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

  function markRouteInputChanged(preserveShareIntent = false) {
    routeGenerationRef.current += 1;
    setShareIntentGeneration((current) => preserveShareIntent && current !== null ? routeGenerationRef.current : null);
    invalidateShareSession();
    weatherRequestRef.current += 1;
    setWeatherLoading(null);
    if (liveRoute) setLiveResultStale(true);
  }

  function navigate(next: PlannerView, replace = false) {
    if (next !== "summary") {
      setSummaryActionsOpen(false);
      if (summaryActionsDialogRef.current?.open) summaryActionsDialogRef.current.close();
    }
    navigationGenerationRef.current += 1;
    viewRef.current = next;
    setView(next);
    resetViewScroll();
    window.setTimeout(() => { if (mountedRef.current && typeof document !== "undefined") document.querySelector<HTMLElement>(`[data-view-title="${next}"]`)?.focus({ preventScroll: true }); }, 0);
    if (navigationMode === "browser") {
      const target = next === "home" ? `${window.location.pathname}${window.location.search}` : `#${next}`;
      window.history[replace ? "replaceState" : "pushState"](null, "", target);
    }
  }

  function openSummaryActions(mode: "choice" | "share" | "save") {
    setSummaryActionMode(mode);
    setSummaryActionsOpen(true);
  }

  function startNewRoute() {
    if (actionGateRef.current.planning) {
      setNotice("현재 경로 저장이 끝난 뒤 새 경로를 시작해 주세요.", "warning");
      return;
    }
    routeGenerationRef.current += 1;
    weatherRequestRef.current += 1;
    invalidateShareSession();
    liveTripIdRef.current = null;
    setLiveTripId(null);
    setLiveRoute(null);
    setWeather(null);
    setWeatherLoading(null);
    setLiveResultStale(false);
    setShareIntentGeneration(null);
    setPlaces({ origin: null, destination: null });
    setWaypoints([]);
    setFavoriteTarget(null);
    setDraft({ origin: "", destination: "", rideDate: "", departureTime: "" });
    setRouteTitle("라이딩 경로");
    setPlaceSelectionRevision((current) => current + 1);
    setNotice("출발지와 도착지, 새 일정을 선택해 주세요.");
    navigate("editor");
  }

  function update<K extends keyof PlannerDraft>(key: K, value: PlannerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    markRouteInputChanged(key === "rideDate" || key === "departureTime");
  }

  function selectEndpoint(key: keyof PlannerPlaces, place: PlaceSearchResult | null) {
    setPlaces((current) => ({ ...current, [key]: place }));
    markRouteInputChanged();
  }

  function updateWaypoints(next: EditableWaypoint[]) {
    setWaypoints(next);
    if (favoriteTarget && favoriteTarget !== "origin" && favoriteTarget !== "destination" && !next.some((waypoint) => waypoint.id === favoriteTarget)) {
      setFavoriteTarget(null);
      setNotice("즐겨찾기를 적용할 장소를 다시 선택해 주세요.", "warning");
    }
    markRouteInputChanged();
  }

  function applyFavorite(place: PlaceSearchResult) {
    if (!favoriteTarget) {
      setNotice("즐겨찾기를 적용할 출발지, 경유지 또는 도착지를 먼저 선택해 주세요.", "warning");
      return;
    }
    if (favoriteTarget === "origin" || favoriteTarget === "destination") {
      selectEndpoint(favoriteTarget, place);
      return;
    }
    if (!waypoints.some((waypoint) => waypoint.id === favoriteTarget)) {
      setFavoriteTarget(null);
      setNotice("즐겨찾기를 적용할 장소를 다시 선택해 주세요.", "warning");
      return;
    }
    updateWaypoints(waypoints.map((waypoint) => waypoint.id === favoriteTarget ? { ...waypoint, place } : waypoint));
  }

  const favoriteTargetLabel = favoriteTarget === "origin"
    ? "출발지"
    : favoriteTarget === "destination"
      ? "도착지"
      : favoriteTarget
        ? `경유 ${waypoints.findIndex((waypoint) => waypoint.id === favoriteTarget) + 1}`
        : "장소를 다시 선택해 주세요";

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
    setFavoriteTarget(null);
    setPlaces({
      origin: application.origin,
      destination: application.destination,
    });
    setDraft((current) => ({ ...current, rideDate: "", departureTime: "" }));
    setRouteTitle(title);
    setPlaceSelectionRevision((current) => current + 1);
    setShareIntentGeneration(sharing ? collectionGeneration : null);
    if (liveRoute) setLiveResultStale(true);
    setWaypointStatus(`${title} 컬렉션의 최신 불변 버전을 계획에 적용했습니다.`);
    setNotice(sharing
      ? "컬렉션 전체 코스를 적용했습니다. 새 날짜와 출발 시각을 선택해 계산하면 공유 요약 미리보기가 열립니다."
      : "컬렉션 전체 코스를 적용했습니다. 새 날짜와 출발 시각을 선택한 뒤 안전 경로를 계산해 주세요.", "warning");
    navigate("editor");
    window.setTimeout(() => rideDateRef.current?.click(), 0);
  }

  function prepareCollectionShare(course: CollectionCourse, title: string) {
    applyCollection(course, title, true);
  }

  useEffect(() => {
    if (!initialCourse || initialCourseAppliedRef.current) return;
    initialCourseAppliedRef.current = true;
    applyCollection(initialCourse, initialTitle, false);
    // This bootstrap is intentionally one-shot for the mounted private share context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCourse, initialTitle]);

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
        !mountedRef.current ||
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
      if (
        !mountedRef.current ||
        weatherRequest !== weatherRequestRef.current ||
        generation !== routeGenerationRef.current ||
        liveTripIdRef.current !== tripId
      ) return false;
      setNotice("날씨 공급자 응답을 안전하게 확인하지 못해 날씨를 표시하지 않았습니다.", "error");
      return false;
    } finally {
      if (mountedRef.current && weatherRequest === weatherRequestRef.current) setWeatherLoading(null);
    }
  }

  async function recalculate(event: FormEvent) {
    event.preventDefault();
    if (actionGateRef.current.planning) {
      setNotice("현재 계획의 계산과 저장이 끝날 때까지 기다려 주세요.", "warning");
      return;
    }
    if (!draft.rideDate || !draft.departureTime) {
      setNotice("새 라이딩 날짜와 출발 시각을 모두 선택해 주세요.", "error");
      window.setTimeout(() => rideDateRef.current?.focus(), 0);
      return;
    }
    if (isPastDeparture(draft.rideDate, draft.departureTime, new Date())) {
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

    const expectedNavigation = navigationGenerationRef.current;
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
      if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
      if (saveError || !isUuid(savedTripId)) {
        if (sharingForCalculation) setShareIntentGeneration(null);
        setNotice("계획 저장에 실패해 이전 실제 경로를 유지했습니다. 날씨와 공유에는 실패한 계산을 사용하지 않습니다.", "error");
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
      calculatedGenerationRef.current = calculationGeneration;
      setWeather(null);
      setLiveResultStale(false);
      setLiveTripId(savedTripId);
      liveTripIdRef.current = savedTripId;
      setNotice("실제 추천 경로와 계획을 저장했습니다.");
      if (navigationGenerationRef.current === expectedNavigation && viewRef.current === "editor") navigate("summary");
      const previewNavigation = navigationGenerationRef.current;
      if (sharingForCalculation) {
        const weatherReady = await loadWeather(candidate, savedTripId, calculationGeneration, true);
        setShareIntentGeneration(null);
        if (weatherReady) {
          sharePreviewSerialRef.current += 1;
          setSharePreviewRequest({ serial: sharePreviewSerialRef.current, tripId: savedTripId });
          if (
            mountedRef.current &&
            viewRef.current === "summary" &&
            navigationGenerationRef.current === previewNavigation
          ) openSummaryActions("share");
        }
      } else {
        void loadWeather(candidate, savedTripId, calculationGeneration);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      if (sharingForCalculation) setShareIntentGeneration(null);
      if (liveRoute) setLiveResultStale(true);
      const providerFailure = error instanceof ProviderContractError;
      setNotice(liveRoute
        ? `${providerFailure ? "추천 경로 " : ""}응답을 안전하게 확인하지 못해 이전 실제 경로를 유지했습니다.`
        : `${providerFailure ? "추천 경로 " : ""}공급자 응답을 안전하게 확인하지 못했습니다. 예시 결과를 실제 성공으로 바꾸지 않았습니다.`, "error");
      return;
    } finally {
      planningLease.release();
      if (mountedRef.current) setCalculating(false);
    }
  }

  return (
    <main className={`app-shell app-view-${view}`} data-view={view}>
      <header className="app-header">
        <button className="brand" type="button" aria-label="MOTOCAST 홈" onClick={() => navigationMode === "memory" && onExit ? onExit() : navigate("home")}>
          <span>MOTOCAST</span>
        </button>
        <nav className="app-navigation" aria-label="주요 화면">
          <button type="button" aria-current={view === "home" ? "page" : undefined} onClick={() => navigate("home")}>홈</button>
          <button type="button" aria-current={view === "editor" ? "page" : undefined} disabled={calculating} onClick={startNewRoute}>새 경로 만들기</button>
          {connected ? <button type="button" aria-current={view === "collections" ? "page" : undefined} onClick={() => navigate("collections")}>저장한 경로</button> : null}
        </nav>
        <div className="header-actions">
          {connected ? <Link className="ghost-button" href="/admin/invites">초대 관리</Link> : null}
        </div>
      </header>

      {view === "home" ? (
        <PlannerHome connected={connected} busy={calculating} status={homeStatus} onNewRoute={startNewRoute} onCollections={() => navigate("collections")} collections={connected ? <CollectionManager mode="home" currentCourse={currentCourse} onApply={applyCollection} onShare={prepareCollectionShare} disabled={calculating} /> : undefined} />
      ) : view === "collections" ? (
        <section className="collections-view" id="collections" aria-labelledby="collections-view-title">
          <div className="view-heading"><button className="collections-back" type="button" onClick={() => navigate("home")} aria-label="홈으로">←</button><div><h1 id="collections-view-title" data-view-title="collections" tabIndex={-1}><span className="desktop-collections-title">저장한 경로 모음</span><span className="mobile-collections-title">저장한 경로</span></h1><p className="collections-desktop-intro">경로를 고르면 새로운 출발 날짜와 시간을 설정해요.</p></div></div>
          <CollectionManager currentCourse={currentCourse} onApply={applyCollection} onShare={prepareCollectionShare} disabled={calculating} />
          <details className="collection-share-management"><summary>공유 링크 관리</summary><ShareManager mode="history" tripId={null} sessionEpoch={shareManagerEpoch} disabled={calculating} /></details>
        </section>
      ) : connected && view === "summary" && !liveRoute ? (
        <section className="empty-summary"><h1 data-view-title="summary" tabIndex={-1}>계산된 경로가 없습니다.</h1><p>장소와 새 일정을 선택하고 실제 경로를 계산해 주세요.</p><button className="primary-button" type="button" onClick={() => navigate("editor")}>경로 편집으로</button></section>
      ) : <div className={`workspace ${view === "summary" ? "is-summary-view" : "is-editor-view"}`} id="top">
        {view === "editor" ? <div className="editor-view-heading"><h1 data-view-title="editor" tabIndex={-1}><span className="desktop-editor-title">경로 편집</span><span className="mobile-editor-title">어디로 떠날까요?</span></h1><button className="close-panel" type="button" onClick={() => navigate(liveRoute ? "summary" : "home")} aria-label={liveRoute ? "경로 요약으로" : "홈으로"}>{liveRoute ? "요약" : "홈"}</button></div> : null}
        <aside
          ref={plannerPanelRef}
          className={`planner-panel ${view === "summary" ? "is-hidden" : ""}`}
        >
          <div className="panel-handle" aria-hidden="true" />
          <form onSubmit={recalculate} className="planner-form">
            <section className="form-section schedule-section">
              <PlannerScheduleDialog
                date={draft.rideDate}
                time={draft.departureTime}
                minimumDate={departureMinimum.date}
                minimumTime={departureMinimum.time}
                disabled={calculating}
                triggerRef={rideDateRef}
                onConfirm={(date, time) => {
                  setDraft((current) => ({ ...current, rideDate: date, departureTime: time }));
                  markRouteInputChanged(true);
                }}
              />
            </section>
            <fieldset className="planner-fields" disabled={calculating} aria-busy={calculating}>
            <section className="form-section">
              {connected ? (
                <>
                  <PlaceSearchField key={`origin-${placeSelectionRevision}`} label="출발" accessibleLabel="출발지" placeholder="예: 팔당역" required selected={places.origin} favorites={favoriteControls} onActivate={() => setFavoriteTarget("origin")} onSelect={(place) => selectEndpoint("origin", place)} />
                </>
              ) : (
                <>
                  <label><span>출발지</span><input value={draft.origin} onChange={(event) => update("origin", event.target.value)} /></label>
                  <label><span>복귀지</span><input value={draft.destination} onChange={(event) => update("destination", event.target.value)} /></label>
                </>
              )}
            </section>

            <section className="form-section">
              <OrderedWaypointEditor
                connected={connected}
                disabled={calculating}
                selectionRevision={placeSelectionRevision}
                favorites={favoriteControls}
                waypoints={waypoints}
                onPlaceTarget={setFavoriteTarget}
                onChange={updateWaypoints}
                onStatus={reportWaypointSuccess}
                onError={(message) => setNotice(message, "error", "waypoint")}
              />
              <p className="sr-only" role="status" aria-live="polite">{waypointStatus}</p>
              {connected ? <PlaceSearchField key={`destination-${placeSelectionRevision}`} label="도착" accessibleLabel="도착지" placeholder="예: 양평역" required selected={places.destination} favorites={favoriteControls} onActivate={() => setFavoriteTarget("destination")} onSelect={(place) => selectEndpoint("destination", place)} /> : null}
              <button className="route-reset-button" type="button" disabled={calculating} onClick={startNewRoute}>경로 초기화</button>
            </section>

            </fieldset>
            {connected ? <section className="editor-favorites" aria-label={`공용 즐겨찾기, 적용 위치 ${favoriteTargetLabel}`}>
              <div className="editor-favorites-heading"><strong>공용 즐겨찾기 {favoriteControls.favorites.length}/3</strong><span>적용 위치: {favoriteTargetLabel}</span></div>
              <div className="editor-favorite-slots">
                {[0, 1, 2].map((index) => {
                  const favorite = favoriteControls.favorites[index];
                  return <button key={favorite?.slot ?? `empty-${index}`} type="button" disabled={!favorite || !favoriteTarget || calculating} onClick={() => favorite && applyFavorite(favoriteAsSearchResult(favorite))}>{favorite ? favorite.place.name : "비어 있음"}</button>;
                })}
              </div>
              {favoriteControls.status === "error" ? <div className="editor-favorites-error" role="alert"><span>{favoriteControls.message}</span><button type="button" onClick={favoriteControls.retry}>다시 시도</button></div> : <p className="sr-only" role="status">{favoriteControls.message}</p>}
            </section> : null}
            <button className="primary-button calculate" type="submit" disabled={calculating}>
              {calculating ? "경로와 날씨 확인 중…" : <><span className="desktop-calculate-label">라이딩 날씨 확인</span><span className="mobile-calculate-label">이 경로로 날씨 확인</span></>}
            </button>
            {connected && view === "editor" ? (
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
          </form>
        </aside>

        {view === "summary" ? <section className="route-stage" aria-label="라이딩 계획 결과">
          <RidingSummaryLayout
            title={<><span className="desktop-summary-title">라이딩 결과</span><span className="mobile-summary-title">라이딩 요약</span></>}
            subtitle={formatSummaryDeparture(displayedDepartureAt)}
            backAction={<button type="button" onClick={() => navigate("editor")} aria-label="경로 편집으로">←</button>}
            metrics={[
              { label: "총 소요", value: `총 ${minutesLabel(timeline.rideMinutes + timeline.stopMinutes)}` },
              { label: "주행", value: minutesLabel(timeline.rideMinutes) },
              { label: "휴식", value: minutesLabel(timeline.stopMinutes) },
              { label: "예상 도착", value: formatRideTime(displayedDepartureAt, timeline.returnAt) },
            ]}
            distance={`${selected.distanceKm} km`}
            actions={<>
              <KakaoMapHandoff context="owner" readSource={() => ({
                identity: `${routeGenerationRef.current}:${navigationGenerationRef.current}`,
                result: ownerHandoff({ course: currentCourse, route: liveRoute, departureAt, stale: liveResultStale || calculatedGenerationRef.current !== routeGenerationRef.current, busy: calculating }),
              })} onPrepare={() => navigate("editor")} />
              {connected ? <>
                <button className="secondary-button" type="button" onClick={() => openSummaryActions("choice")}>공유 · 저장</button>
                <dialog
                  ref={summaryActionsDialogRef}
                  className="summary-actions-dialog"
                  aria-label="공유 · 저장"
                  onCancel={(event) => { if (summarySaveBusy) event.preventDefault(); }}
                  onClose={() => { setSummaryActionsOpen(false); setSummaryActionMode("choice"); }}
                >
                  <header>
                    <div><h2>{summaryActionMode === "choice" ? <><span className="desktop-choice-title">이 경로를 어떻게 남길까요?</span><span className="mobile-choice-title">이 경로, 함께 달릴까요?</span></> : summaryActionMode === "share" ? "링크로 공유" : "내 경로에 저장"}</h2></div>
                    <button type="button" disabled={summarySaveBusy} onClick={() => summaryActionsDialogRef.current?.close()} aria-label="공유 저장 창 닫기">×</button>
                  </header>
                  {summaryActionMode === "choice" ? <div className="summary-action-choice">
                    <p className="summary-action-course"><strong>{routeTitle}</strong><span>{[selected.segments[0]?.from.label, ...selected.segments.map((segment) => segment.to.label)].filter(Boolean).join(" → ")}</span></p>
                    <p className="summary-action-description">경로를 공유하거나 다음 라이딩을 위해 저장할 수 있어요.</p>
                    <button type="button" onClick={() => setSummaryActionMode("share")}><strong><span className="desktop-choice-label">링크로 공유하기</span><span className="mobile-choice-label">다른 라이더에게 공유</span></strong><span>요약을 확인한 뒤 공유 링크를 발행해요.</span></button>
                    <button type="button" onClick={() => setSummaryActionMode("save")}><strong><span className="desktop-choice-label">내 경로에 저장하기</span><span className="mobile-choice-label">이 경로 저장</span></strong><span>날짜와 시간을 제외한 방문 순서를 저장해요.</span></button>
                    <p className="summary-action-scope">출발 날짜·시간과 날씨는 저장 경로에 포함되지 않습니다.</p>
                  </div> : null}
                  <div className="summary-action-panel" hidden={summaryActionMode !== "share"}>
                    <button className="text-button" type="button" onClick={() => setSummaryActionMode("choice")}>← 선택으로 돌아가기</button>
                    <ShareManager tripId={shareTripId} sessionEpoch={shareManagerEpoch} previewRequest={sharePreviewRequest?.tripId === shareTripId ? sharePreviewRequest.serial : 0} disabled={calculating} />
                  </div>
                  <div className="summary-action-panel" hidden={summaryActionMode !== "save"}>
                    <CollectionManager mode="save-panel" currentCourse={currentCourse} onApply={applyCollection} onShare={prepareCollectionShare} disabled={calculating} onBusyChange={setSummarySaveBusy} onCancel={() => setSummaryActionMode("choice")} onSaved={(title) => { setHomeStatus(`${title}을(를) 내 경로에 저장했습니다.`); summaryActionsDialogRef.current?.close(); navigate("home"); }} />
                  </div>
                </dialog>
              </> : null}
            </>}
            map={<><h2 className="summary-course-title">{routeTitle}</h2><div className="route-map-meta"><div className="condition-banner"><span>안전 조건</span><strong>이륜차 · 자동차전용도로 제외</strong></div>{liveRoute ? <span className="live-data-badge">{liveResultStale ? "이전 실제 경로" : "실제 경로"}</span> : <span className="example-data-badge">예시 데이터</span>}</div><div className="map-area"><KakaoMapCanvas points={selectedMapPoints} path={selectedMapPath} showLegend={false} /></div></>}
            mapDetails={<div className="route-map-details"><p className="summary-route-order">{[selected.segments[0]?.from.label, ...selected.segments.map((segment) => segment.to.label)].filter(Boolean).join(" → ")}</p><p className="route-safety-copy">이륜차 · 자동차전용도로 제외 · 자동차 경로 대체 없음</p><MapMarkerLegend points={selectedMapPoints} inline /></div>}
            weather={<><div className="forecast-heading"><div><h2>구간별 날씨</h2></div><span className="forecast-issued">{weatherLoading === selected.id ? "기상청 예보 조회 중" : selectedWeatherStatus?.header ?? "날씨 미조회"}</span></div><p className="sr-only" role="status" aria-live="polite">{selectedWeatherAnnouncement}</p><div className="timeline-list">{timeline.segments.map((segment) => { const effectiveDwell = segment.to.selected ? segment.to.dwellMinutes : 0; return <RidingWeatherCard key={segment.id} time={formatRideTime(displayedDepartureAt, segment.arrivalAt)} place={segment.to.label} stopDetail={effectiveDwell ? `${effectiveDwell}분 정차` : "통과"} condition={segment.weather.condition} conditionLabel={weatherIcon(segment.weather.condition)} temperature={`${segment.weather.temperatureC ?? "–"}°`} probability={`${segment.weather.precipitationProbability ?? "–"}%`} statusNote={segment.weather.status === "outside-window" ? weatherModelLabel(segment.weather.status, segment.weather.model) : undefined} />; })}</div><details className="weather-detail"><summary>날씨 상세정보</summary><ul>{timeline.segments.map((segment) => <li key={segment.id}><strong>{segment.to.label}</strong><span>바람 {segment.weather.windSpeedMps ?? "–"}m/s · {weatherModelLabel(segment.weather.status, segment.weather.model)}</span></li>)}</ul></details></>}
            notices={<>{selectedWeatherStatus ? <div className="stale-notice"><span>i</span>{selectedWeatherStatus.notice}</div> : null}<div ref={noticeRef} className={`action-notice ${notice.severity}`} role={notice.severity === "error" ? "alert" : "status"} aria-live={notice.severity === "error" ? "assertive" : "polite"} tabIndex={-1}><span className="notice-symbol" aria-hidden="true">{notice.severity === "error" ? "!" : notice.severity === "warning" ? "△" : "i"}</span><p><strong>{notice.severity === "error" ? "계획을 완료하지 못했습니다" : notice.severity === "warning" ? "확인이 필요합니다" : "진행 상태"}</strong><span>{notice.message}</span></p></div></>}
          />
        </section> : <section className="route-stage" aria-label="라이딩 계획 결과">
          <h1 className="sr-only" hidden={!isCompact}>라이딩 계획 결과</h1>
          <div className="route-map-frame">
            {connected ? <h2 className="editor-map-title">선택한 경로</h2> : null}
            <div className="route-map-meta">
              <div className="condition-banner"><span>안전 조건</span><strong>이륜차 · 자동차전용도로 제외</strong></div>
              {!liveRoute ? <span className="example-data-badge">{connected ? "선택한 장소" : "예시 데이터"}</span> : <span className="live-data-badge">{liveResultStale ? "이전 실제 경로" : "실제 경로"}</span>}
            </div>
            <div className="map-area">
              <KakaoMapCanvas points={selectedMapPoints} path={selectedMapPath} showLegend={false} />
            </div>
            {!connected ? <div className="route-map-details">
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
                {liveRoute ? (
                  <p className="route-estimate-note">도착 시각은 추정값입니다. 전체 시간과 구간 합계가 다르면 전체 시간을 기준으로 구간별 시간을 비례 배분합니다.</p>
                ) : null}
              </section>
            </div> : <div className="editor-map-details">
              <p className="editor-route-order">{[
                places.origin?.name,
                ...waypoints.map((waypoint) => waypoint.place?.name ?? "장소 미선택"),
                places.destination?.name,
              ].filter(Boolean).join(" → ") || "출발지와 도착지를 선택해 주세요."}</p>
            </div>}
          </div>

          {!connected ? <div className="forecast-panel">
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
          </div> : null}

        </section>}
      </div>}

    </main>
  );
}
