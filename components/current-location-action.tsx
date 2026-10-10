"use client";

import { useEffect, useRef, useState } from "react";

import { LineIcon } from "@/components/line-icon";
import { resolveMapPoint } from "@/components/map-point-confirmation";
import { CurrentLocationError, findCurrentPlace, type CurrentLocationFailure } from "@/lib/places/current-location";
import type { PlaceSearchResult } from "@/lib/places/search";

export type CurrentLocationRole = "출발지" | "도착지";
type Failure = Exclude<CurrentLocationFailure, "cancelled">;
type State = { kind: "idle" | "locating" | "resolving" } | { kind: "failed"; failure: Failure };

/** Issue #137 memo 487:13132 §3. `settings` cards are yellow (the rider must change a
 * browser setting); every other failure has a red border. */
const failureCopy: Record<Failure, { title: string; body: string; retry: boolean; settings?: true }> = {
  permission: { title: "위치 권한이 필요해요", body: "브라우저 주소창의 사이트 설정에서 위치를 허용한 뒤 다시 시도해 주세요.", retry: true, settings: true },
  position: { title: "현재 위치를 정확히 잡지 못했어요", body: "실내나 지하에서는 위치가 늦거나 부정확할 수 있어요. 트인 곳에서 다시 시도하거나 장소를 검색해 주세요.", retry: true },
  outside: { title: "한국 안에서만 쓸 수 있어요", body: "지금 위치는 서비스 지역 밖이에요. 장소를 검색해 주세요.", retry: false },
  lookup: { title: "현재 위치의 주소를 확인하지 못했어요", body: "연결이 불안정하거나 주소 서비스가 응답하지 않았어요.", retry: true },
  "no-address": { title: "이 위치의 주소를 찾지 못했어요", body: "강·호수 위처럼 주소가 없는 곳이에요. 장소를 검색해 주세요.", retry: true },
  limit: { title: "오늘 장소 조회 한도를 모두 썼어요", body: "현재 위치와 장소 검색은 내일 다시 쓸 수 있어요. 자주 찾는 장소는 지금도 고를 수 있어요.", retry: false },
};

/** "현재 위치로 설정" in the origin/destination picker. Reads the position once, looks the
 * point up like a map point (region fallback) and hands the place to `onPlace`; the
 * current selection is never touched on failure. Unmounting cancels: a late fix or
 * lookup is dropped, so the picker remounts this to cancel or reset it. */
export function CurrentLocationAction({ role, selectedName, onBusyChange, onPlace }: {
  role: CurrentLocationRole;
  selectedName: string | null;
  onBusyChange: (busy: boolean) => void;
  onPlace: (place: PlaceSearchResult) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const sequence = useRef(0);
  const moveFocus = useRef(false);
  const focusTarget = useRef<HTMLElement | null>(null);
  useEffect(() => () => { sequence.current += 1; }, []);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    focusTarget.current?.focus();
  }, [state.kind]);

  function transition(next: State) {
    moveFocus.current = true;
    setState(next);
    onBusyChange(next.kind === "locating" || next.kind === "resolving");
  }

  async function start(retry: boolean) {
    const attempt = ++sequence.current;
    const isCurrent = () => attempt === sequence.current;
    transition({ kind: "locating" });
    try {
      const place = await findCurrentPlace({
        geolocation: typeof navigator === "undefined" ? undefined : navigator.geolocation,
        retry,
        resolve: (point) => resolveMapPoint(point, true),
        isCurrent,
        onResolving: () => transition({ kind: "resolving" }),
      });
      if (!isCurrent()) return;
      onBusyChange(false);
      onPlace(place);
    } catch (error) {
      if (!isCurrent()) return;
      const failure = error instanceof CurrentLocationError ? error.kind : "lookup";
      if (failure !== "cancelled") transition({ kind: "failed", failure });
    }
  }

  function cancel() {
    sequence.current += 1;
    transition({ kind: "idle" });
  }

  const target = (element: HTMLElement | null) => { focusTarget.current = element; };
  if (state.kind === "idle") {
    return <div className="current-location" aria-live="polite">
      <button ref={target} type="button" className="current-location-entry" aria-label={`현재 위치를 ${role}로 설정`} onClick={() => void start(false)}>
        <LineIcon name="crosshair" />
        <span><strong>현재 위치로 설정</strong><span>지금 있는 곳을 {role}로 넣어요</span></span>
      </button>
    </div>;
  }
  if (state.kind !== "failed") {
    const title = state.kind === "locating" ? "현재 위치를 확인하고 있어요" : "주소를 확인하고 있어요";
    return <div className="current-location" aria-live="polite">
      <div className="current-location-card is-progress">
        <span className="current-location-eyebrow">현재 위치</span>
        <strong>{title}</strong>
        <span className="current-location-progress" role="progressbar" aria-label={title}><span /></span>
        <p>{role}는 아직 바뀌지 않았어요.</p>
        <button ref={target} type="button" className="current-location-cancel" onClick={cancel}>취소</button>
      </div>
    </div>;
  }
  const copy = failureCopy[state.failure];
  return <div className="current-location" aria-live="polite">
    <div ref={copy.retry ? undefined : target} tabIndex={copy.retry ? undefined : -1} className={`current-location-card ${copy.settings ? "is-settings" : "is-failed"}`}>
      <strong role="alert">{copy.title}</strong>
      <p>{copy.body}</p>
      <p className="current-location-keep"><LineIcon name="check" />{selectedName ? `${role}는 그대로예요 · ${selectedName}` : `${role}는 아직 비어 있어요`}</p>
      {copy.retry ? <div className="current-location-actions"><button ref={target} type="button" className="primary-button" onClick={() => void start(true)}>다시 시도</button></div> : null}
    </div>
  </div>;
}
