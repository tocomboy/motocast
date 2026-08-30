"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { KakaoMapCanvas } from "@/components/kakao-map-canvas";
import {
  demoCandidates,
  demoDepartureAt,
  demoDesiredReturnAt,
  demoHardReturnAt,
  demoMapPoints,
} from "@/lib/planner/demo";
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

const defaultDraft: PlannerDraft = {
  origin: "팔당 출발점",
  destination: "팔당 복귀점",
  rideDate: "2026-08-31",
  departureTime: "07:30",
  desiredReturnTime: "17:30",
  hardReturnTime: "18:30",
  lunch: "홍천 점심 정차",
  dinner: "",
  includeRest: true,
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

export function PlannerDashboard({ connected }: { connected: boolean }) {
  const [draft, setDraft] = useState(defaultDraft);
  const [selectedId, setSelectedId] = useState<RouteCandidate["id"]>("balanced");
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [notice, setNotice] = useState(
    connected
      ? "저장된 데모 계획입니다. 장소를 확인한 뒤 선택 경로를 다시 계산하세요."
      : "환경변수가 없어 데모 모드로 실행 중입니다. 실제 외부 API는 호출하지 않습니다.",
  );
  const [calculating, setCalculating] = useState(false);

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

  const selected = demoCandidates.find((candidate) => candidate.id === selectedId) ?? demoCandidates[0];
  const timeline = useMemo(
    () =>
      buildTimeline({
        departureAt: demoDepartureAt,
        desiredReturnAt: demoDesiredReturnAt,
        hardReturnAt: demoHardReturnAt,
        segments: selected.segments.map((segment) =>
          segment.to.id === "rest"
            ? { ...segment, to: { ...segment.to, selected: draft.includeRest } }
            : segment,
        ),
      }),
    [draft.includeRest, selected],
  );

  function update<K extends keyof PlannerDraft>(key: K, value: PlannerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function recalculate(event: FormEvent) {
    event.preventDefault();
    if (!draft.origin.trim() || !draft.destination.trim() || !draft.lunch.trim()) {
      setNotice("출발지, 복귀지, 점심 정차는 반드시 입력해야 합니다.");
      return;
    }
    if (!connected) {
      setNotice("데모 계획을 갱신했습니다. 실제 계산에는 Supabase와 카카오 API 설정이 필요합니다.");
      setPlannerOpen(false);
      return;
    }

    const supabase = getBrowserSupabase();
    if (!supabase) {
      setNotice("Supabase 연결 설정을 확인해 주세요.");
      return;
    }

    setCalculating(true);
    setNotice("오토바이·자동차전용도로 제외 조건으로 경로를 계산 중입니다.");
    const { error } = await supabase.functions.invoke("plan-route", {
      body: {
        origin: { ...demoMapPoints[0], name: draft.origin },
        destination: { ...demoMapPoints.at(-1), name: draft.destination },
        waypoints: demoMapPoints.slice(1, -1).map((point, index) => ({
          ...point,
          name: index === 1 ? draft.lunch : point.label,
          dwellMinutes: index === 1 ? 60 : index === 2 && draft.includeRest ? 30 : 0,
        })),
        departureAt: `${draft.rideDate}T${draft.departureTime}:00+09:00`,
        priority: selected.id === "short" ? "DISTANCE" : selected.id === "balanced" ? "TIME" : "RECOMMEND",
      },
    });
    setCalculating(false);
    setNotice(
      error
        ? "경로 갱신에 실패했습니다. 기존 계획을 유지하며, 실패를 자동차 경로로 대체하지 않았습니다."
        : "안전 조건을 적용한 경로가 갱신되었습니다. 화면 데이터 연결은 다음 수직 슬라이스에서 완료합니다.",
    );
    setPlannerOpen(false);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top" aria-label="MOTOCAST 홈">
          <span className="brand-mark">M</span>
          <span>MOTOCAST</span>
        </a>
        <div className="trip-heading">
          <span className="trip-kicker">MON · AUG 31</span>
          <strong>북한강 루프</strong>
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
        <aside className={`planner-panel ${plannerOpen ? "is-open" : ""}`}>
          <div className="panel-handle" aria-hidden="true" />
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">PLAN THE DAY</p>
              <h1>라이딩 계획</h1>
            </div>
            <button className="close-panel" type="button" onClick={() => setPlannerOpen(false)} aria-label="계획 패널 닫기">×</button>
          </div>

          <form onSubmit={recalculate} className="planner-form">
            <section className="form-section">
              <div className="section-label"><span>01</span>경로</div>
              <label>
                <span>출발지</span>
                <input value={draft.origin} onChange={(event) => update("origin", event.target.value)} />
              </label>
              <label>
                <span>복귀지</span>
                <input value={draft.destination} onChange={(event) => update("destination", event.target.value)} />
              </label>
              <div className="waypoint-list">
                <span className="waypoint-tag winding"><i />유명산 굽이길 <button type="button" aria-label="유명산 굽이길 제거">×</button></span>
                <span className="waypoint-tag"><i />홍천 점심 <button type="button" aria-label="홍천 점심 제거">×</button></span>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => setNotice("커스텀 경유지는 컬렉션 저장 화면과 함께 다음 구현 단위에서 연결됩니다.")}
              >
                + 커스텀 경유지 추가
              </button>
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
              <label><span>점심 · 필수</span><input value={draft.lunch} onChange={(event) => update("lunch", event.target.value)} /></label>
              <label><span>저녁 · 선택</span><input placeholder="입력하지 않아도 됩니다" value={draft.dinner} onChange={(event) => update("dinner", event.target.value)} /></label>
              <label className="toggle-row">
                <span><strong>북한강 휴식</strong><small>선택 시 30분 계산</small></span>
                <input type="checkbox" checked={draft.includeRest} onChange={(event) => update("includeRest", event.target.checked)} />
                <i aria-hidden="true" />
              </label>
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
            <KakaoMapCanvas points={demoMapPoints} />
            <div className="map-topbar">
              <div className="condition-banner"><span>안전 조건</span><strong>이륜차 · 자동차전용도로 제외</strong></div>
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
              <div><p className="eyebrow">ROUTE OPTIONS</p><h2>추천 경로 3개</h2></div>
              <p>날씨는 순위에 반영하지 않고 구간 정보로만 표시합니다.</p>
            </div>
            <div className="candidate-grid">
              {demoCandidates.map((candidate) => (
                <button
                  type="button"
                  className={`candidate-card ${selectedId === candidate.id ? "is-selected" : ""}`}
                  key={candidate.id}
                  onClick={() => setSelectedId(candidate.id)}
                  aria-pressed={selectedId === candidate.id}
                >
                  <span className={`candidate-index ${candidateTone[candidate.id]}`}>0{demoCandidates.indexOf(candidate) + 1}</span>
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
              <span className="forecast-issued">예보 발행 09:00 · 저장됨</span>
            </div>
            <div className="timeline-list">
              {timeline.segments.map((segment, index) => {
                const risk = weatherRiskLabel(segment);
                return (
                  <article className="timeline-row" key={segment.id}>
                    <div className="timeline-time"><strong>{formatKoreanTime(segment.arrivalAt)}</strong><span>{index === timeline.segments.length - 1 ? "복귀" : "통과 예상"}</span></div>
                    <div className="timeline-rail"><i className={`risk-dot ${risk.level}`} />{index < timeline.segments.length - 1 ? <span /> : null}</div>
                    <div className="segment-copy"><strong>{segment.from.label} → {segment.to.label}</strong><span>{segment.distanceKm} km · 약 {segment.rideMinutes}분</span></div>
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

      <button className="mobile-plan-button" type="button" onClick={() => setPlannerOpen(true)}>계획 수정</button>
      {plannerOpen ? <button className="panel-backdrop" type="button" aria-label="계획 패널 닫기" onClick={() => setPlannerOpen(false)} /> : null}
    </main>
  );
}
