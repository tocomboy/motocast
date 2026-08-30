"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { KakaoMapCanvas } from "@/components/kakao-map-canvas";
import { PlaceSearchField } from "@/components/place-search-field";
import type { PlaceSearchResult } from "@/lib/places/search";
import {
  demoCandidates,
  demoDepartureAt,
  demoDesiredReturnAt,
  demoHardReturnAt,
  demoMapPoints,
} from "@/lib/planner/demo";
import { parseSafeRouteCandidateSet, type SafeRouteResponse } from "@/lib/planner/provider-contract";
import { buildTimeline, formatKoreanTime, weatherRiskLabel } from "@/lib/planner/schedule";
import type { RouteCandidate } from "@/lib/planner/types";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type PlannerDraft = {
  origin: string;
  destination: string;
  rideDate: string;
  departureTime: string;
  desiredReturnTime: string;
  hardReturnTime: string;
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
  desiredReturnTime: "17:30",
  hardReturnTime: "18:30",
  lunch: "홍천 점심 정차",
  dinner: "",
  includeRest: false,
};

const candidateTone: Record<RouteCandidate["id"], string> = {
  balanced: "mint",
  winding: "orange",
  short: "blue",
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

function liveRouteCandidate(response: SafeRouteResponse, desiredReturnAt: string, hardReturnAt: string): RouteCandidate {
  const stopMinutes = response.legs.reduce((total, leg) => total + leg.dwellMinutes, 0);
  const rideMinutes = Math.ceil(response.legs.reduce((total, leg) => total + leg.durationSeconds, 0) / 60);
  const descriptions: Record<RouteCandidate["id"], string> = {
    balanced: "주행 시간과 경로의 균형",
    winding: response.candidate.estimatedWinding ? "대안 경로 곡률 기반 추정" : "커스텀 와인딩 경유지 필수 통과",
    short: "총 거리를 우선한 경로",
  };
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
    id: response.candidate.id,
    label: response.candidate.label,
    description: descriptions[response.candidate.id],
    distanceKm: Math.round(response.totalDistanceMeters / 100) / 10,
    rideMinutes,
    stopMinutes,
    returnAt: response.returnAt,
    fitsDesiredReturn: new Date(response.returnAt) <= new Date(desiredReturnAt),
    fitsHardReturn: new Date(response.returnAt) <= new Date(hardReturnAt),
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
  const [addingWinding, setAddingWinding] = useState(false);
  const [selectedId, setSelectedId] = useState<RouteCandidate["id"]>("balanced");
  const [liveCandidates, setLiveCandidates] = useState<RouteCandidate[] | null>(null);
  const [liveResultStale, setLiveResultStale] = useState(false);
  const [waypointStatus, setWaypointStatus] = useState("");
  const [isCompact, setIsCompact] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [notice, setNotice] = useState(
    connected
      ? "저장된 데모 계획입니다. 장소를 확인한 뒤 선택 경로를 다시 계산하세요."
      : "환경변수가 없어 데모 모드로 실행 중입니다. 실제 외부 API는 호출하지 않습니다.",
  );
  const [calculating, setCalculating] = useState(false);
  const plannerPanelRef = useRef<HTMLElement>(null);
  const mobilePlanButtonRef = useRef<HTMLButtonElement>(null);
  const addWindingButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("motocast-planner-draft-v1");
    if (!saved) return;
    let restored: PlannerDraft;
    try {
      restored = { ...defaultDraft, ...(JSON.parse(saved) as Partial<PlannerDraft>) };
    } catch {
      window.localStorage.removeItem("motocast-planner-draft-v1");
      return;
    }
    const task = window.setTimeout(() => setDraft(restored), 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("motocast-planner-draft-v1", JSON.stringify(draft));
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

  const displayedCandidates = liveCandidates ?? demoCandidates;
  const selected = displayedCandidates.find((candidate) => candidate.id === selectedId) ?? displayedCandidates[0];
  const liveTimes = {
    departureAt: `${draft.rideDate}T${draft.departureTime}:00+09:00`,
    desiredReturnAt: `${draft.rideDate}T${draft.desiredReturnTime}:00+09:00`,
    hardReturnAt: `${draft.rideDate}T${draft.hardReturnTime}:00+09:00`,
  };
  const timeline = useMemo(
    () =>
      buildTimeline({
        departureAt: liveCandidates ? liveTimes.departureAt : demoDepartureAt,
        desiredReturnAt: liveCandidates ? liveTimes.desiredReturnAt : demoDesiredReturnAt,
        hardReturnAt: liveCandidates ? liveTimes.hardReturnAt : demoHardReturnAt,
        segments: selected.segments.map((segment) =>
          segment.to.id === "rest"
            ? { ...segment, to: { ...segment.to, selected: draft.includeRest } }
            : segment,
        ),
      }),
    [draft.includeRest, liveCandidates, liveTimes.departureAt, liveTimes.desiredReturnAt, liveTimes.hardReturnAt, selected],
  );
  const selectedMapPoints = liveCandidates
    ? [selected.segments[0].from, ...selected.segments.map((segment) => segment.to)]
    : demoMapPoints;

  function update<K extends keyof PlannerDraft>(key: K, value: PlannerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (liveCandidates) setLiveResultStale(true);
  }

  function selectPlace(key: keyof PlannerPlaces, place: PlaceSearchResult | null) {
    setPlaces((current) => ({ ...current, [key]: place }));
    if (liveCandidates) setLiveResultStale(true);
  }

  function addWindingPoint(place: PlaceSearchResult | null) {
    if (!place) return;
    setWindingPoints((current) => (
      current.some((item) => item.kakaoPlaceId === place.kakaoPlaceId) || current.length >= 20
        ? current
        : [...current, place]
    ));
    setAddingWinding(false);
    setWaypointStatus(`${place.name}을(를) 와인딩 경유지 마지막에 추가했습니다.`);
    if (liveCandidates) setLiveResultStale(true);
    window.setTimeout(() => addWindingButtonRef.current?.focus(), 0);
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
    if (liveCandidates) setLiveResultStale(true);
  }

  function removeWindingPoint(place: PlaceSearchResult) {
    setWindingPoints((current) => current.filter((item) => item.kakaoPlaceId !== place.kakaoPlaceId));
    setWaypointStatus(`${place.name}을(를) 와인딩 경유지에서 제거했습니다.`);
    if (liveCandidates) setLiveResultStale(true);
    window.setTimeout(() => addWindingButtonRef.current?.focus(), 0);
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

  async function recalculate(event: FormEvent) {
    event.preventDefault();
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

    setCalculating(true);
    setNotice("오토바이·자동차전용도로 제외 조건으로 경로를 계산 중입니다.");
    const commonBody = {
      origin: routePoint(places.origin, "pass-through", 0),
      destination: routePoint(places.destination, "pass-through", 0),
      waypoints: [
        ...windingPoints.map((place) => routePoint(place, "pass-through", 0, true)),
        routePoint(places.lunch, "stop", 60, false, "lunch"),
        ...(draft.includeRest && places.rest ? [routePoint(places.rest, "optional", 30, false, "rest")] : []),
        ...(places.dinner ? [routePoint(places.dinner, "stop", 60, false, "dinner")] : []),
      ],
      serviceDate: draft.rideDate,
      ...liveTimes,
    };
    const results = await Promise.all(
      (["balanced", "winding", "short"] as const).map((candidate) => (
        supabase.functions.invoke("plan-route", { body: { ...commonBody, candidate } })
      )),
    );
    setCalculating(false);
    if (results.some(({ error }) => error)) {
      const labels = ["균형", "와인딩", "최단"];
      const failed = results.flatMap((result, index) => result.error ? [labels[index]] : []);
      if (liveCandidates) setLiveResultStale(true);
      setNotice(liveCandidates
        ? `${failed.join("·")} 경로 계산에 실패해 이전 실제 경로를 유지했습니다. 자동차 경로로 대체하지 않았습니다.`
        : `${failed.join("·")} 경로를 안전 조건 안에서 계산하지 못했습니다. 예시 결과를 실제 성공으로 바꾸지 않았습니다.`);
      return;
    }
    try {
      const responses = parseSafeRouteCandidateSet(results.map(({ data }) => data));
      const candidates = responses.map((response) => liveRouteCandidate(response, liveTimes.desiredReturnAt, liveTimes.hardReturnAt));
      setLiveCandidates(candidates);
      setLiveResultStale(false);
      setSelectedId("balanced");
      setNotice("오토바이 안전 조건을 적용한 실제 경로 3개를 계산했습니다. 날씨는 아직 조회 전입니다.");
    } catch {
      if (liveCandidates) setLiveResultStale(true);
      setNotice(liveCandidates
        ? "새 응답을 안전하게 확인하지 못해 직전 실제 경로를 유지했습니다."
        : "경로 공급자 응답을 안전하게 확인하지 못했습니다. 예시 결과를 실제 성공으로 바꾸지 않았습니다.");
      return;
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
              {connected && windingPoints.length ? (
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
                  <PlaceSearchField label="와인딩 경유지" placeholder="산길 입구, 고개, 전망대" selected={null} onSelect={addWindingPoint} />
                  <button className="text-button muted" type="button" onClick={() => setAddingWinding(false)}>추가 취소</button>
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
              <div className="field-grid three">
                <label><span>출발</span><input type="time" value={draft.departureTime} onChange={(event) => update("departureTime", event.target.value)} /></label>
                <label><span>희망 복귀</span><input type="time" value={draft.desiredReturnTime} onChange={(event) => update("desiredReturnTime", event.target.value)} /></label>
                <label><span>최종 복귀</span><input type="time" value={draft.hardReturnTime} onChange={(event) => update("hardReturnTime", event.target.value)} /></label>
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
              {calculating ? "안전 경로 계산 중…" : "선택 경로 다시 계산"}
            </button>
          </form>
        </aside>

        <section className="route-stage" aria-label="라이딩 계획 결과">
          <div className="map-area">
            <KakaoMapCanvas points={selectedMapPoints} path={selected.path} />
            <div className="map-topbar">
              <div className="map-badges">
                <div className="condition-banner"><span>안전 조건</span><strong>이륜차 · 자동차전용도로 제외</strong></div>
                {!liveCandidates ? <span className="example-data-badge">예시 데이터</span> : <span className="live-data-badge">{liveResultStale ? "이전 실제 경로" : "실제 경로"}</span>}
              </div>
              <button className="map-control" type="button" aria-label="현재 위치로 이동">⌖</button>
            </div>
            <div className="ride-summary">
              <p>선택 경로</p>
              <h2>{selected.label}</h2>
              <div className="summary-metrics">
                <span><strong>{selected.distanceKm}</strong> km</span>
                <span><strong>{minutesLabel(timeline.rideMinutes)}</strong> 주행</span>
                <span><strong>{formatKoreanTime(timeline.returnAt)}</strong> 복귀</span>
              </div>
              <div className={`return-status ${timeline.fitsHardReturn ? "safe" : "late"}`}>
                {timeline.fitsDesiredReturn ? "희망 복귀 안쪽" : timeline.fitsHardReturn ? "희망 복귀 초과 · 최종 시각 안쪽" : "최종 복귀 시각 초과"}
              </div>
            </div>
          </div>

          <div className="candidate-strip" aria-label="추천 경로 후보">
            <div className="strip-heading">
              <div><p className="eyebrow">ROUTE OPTIONS</p><h2>추천 경로 3개 {!liveCandidates ? <small>예시</small> : null}</h2></div>
              <p>날씨는 순위에 반영하지 않고 구간 정보로만 표시합니다.</p>
            </div>
            <div className="candidate-grid">
              {displayedCandidates.map((candidate) => (
                <button
                  type="button"
                  className={`candidate-card ${selectedId === candidate.id ? "is-selected" : ""}`}
                  key={candidate.id}
                  onClick={() => setSelectedId(candidate.id)}
                  aria-pressed={selectedId === candidate.id}
                >
                  <span className={`candidate-index ${candidateTone[candidate.id]}`}>0{displayedCandidates.indexOf(candidate) + 1}</span>
                  <span className="candidate-copy"><strong>{candidate.label}</strong><small>{candidate.description}</small></span>
                  <span className="candidate-stats"><b>{candidate.distanceKm} km</b><small>{minutesLabel(candidate.rideMinutes)}</small></span>
                  <span className="select-mark">{selectedId === candidate.id ? "✓" : "→"}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="forecast-panel">
            <div className="forecast-heading">
              <div><p className="eyebrow">WEATHER BY ARRIVAL</p><h2>시간에 따른 구간 날씨</h2></div>
              <span className="forecast-issued">{liveCandidates ? "날씨 미조회" : "예보 발행 09:00 · 예시"}</span>
            </div>
            <div className="timeline-list">
              {timeline.segments.map((segment, index) => {
                const risk = weatherRiskLabel(segment);
                return (
                  <article className="timeline-row" key={segment.id}>
                    <div className="timeline-time"><strong>{formatKoreanTime(segment.arrivalAt)}</strong><span>{index === timeline.segments.length - 1 ? "복귀" : "통과 예상"}</span></div>
                    <div className="timeline-rail"><i className={`risk-dot ${risk.level}`} />{index < timeline.segments.length - 1 ? <span /> : null}</div>
                    <div className="segment-copy"><strong>{segment.from.label} → {segment.to.label}</strong><span>{segment.distanceKm} km · 약 {Math.ceil(segment.rideMinutes)}분</span></div>
                    <div className={`weather-chip ${risk.level}`}>
                      <span className="weather-word">{weatherIcon(segment.weather.condition)}</span>
                      <strong>{segment.weather.temperatureC ?? "–"}°</strong>
                      <small>강수 {segment.weather.precipitationProbability ?? "–"}% · 바람 {segment.weather.windSpeedMps ?? "–"}m/s</small>
                    </div>
                    <span className={`risk-label ${risk.level}`}>{risk.label}</span>
                  </article>
                );
              })}
            </div>
            <div className="stale-notice" role="status"><span>i</span>{notice}</div>
          </div>
        </section>
      </div>

      <button ref={mobilePlanButtonRef} className="mobile-plan-button" type="button" onClick={() => setPlannerOpen(true)}>계획 수정</button>
      {plannerOpen ? <button className="panel-backdrop" type="button" aria-label="계획 패널 닫기" onClick={closePlannerPanel} /> : null}
    </main>
  );
}
