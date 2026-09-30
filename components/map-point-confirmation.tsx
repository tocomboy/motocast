"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { parsePlaceSearchResponse, type PlaceSearchResult } from "@/lib/places/search";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type Point = { latitude: number; longitude: number };
export type MapPlacePickerHandle = { open: (point: Point) => void };
type Selection = { status: "loading" | "empty" | "error" } | { status: "ready"; place: PlaceSearchResult };

export function MapPointConfirmation({ pickerRef, onSelect }: {
  pickerRef: Ref<MapPlacePickerHandle>;
  onSelect: (place: PlaceSearchResult) => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const focus = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);
  const pending = useRef<Point | null>(null);
  const [selection, setSelection] = useState<Selection>({ status: "loading" });
  useEffect(() => () => { sequence.current += 1; pending.current = null; }, []);

  async function resolve(point: Point) {
    const attempt = ++sequence.current;
    setSelection({ status: "loading" });
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("UNAVAILABLE");
      const { data, error } = await supabase.functions.invoke("search-places", { body: { mode: "coordinate", ...point } });
      if (attempt !== sequence.current) return;
      if (error) throw new Error("UNAVAILABLE");
      const response = parsePlaceSearchResponse(data);
      const latitude = Number(point.latitude.toFixed(7));
      const longitude = Number(point.longitude.toFixed(7));
      const place = response.places[0];
      if (!response.isEnd || response.places.length > 1 || (place && (
        place.latitude !== latitude || place.longitude !== longitude ||
        place.kakaoPlaceId !== `map:${latitude.toFixed(7)}:${longitude.toFixed(7)}`
      ))) throw new Error("WRONG_SELECTED_POINT");
      setSelection(place ? { status: "ready", place } : { status: "empty" });
    } catch {
      if (attempt === sequence.current) setSelection({ status: "error" });
    }
  }

  useImperativeHandle(pickerRef, () => ({ open(point) {
    focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pending.current = point;
    dialog.current?.showModal();
    void resolve(point);
  } }));

  function close() {
    sequence.current += 1;
    pending.current = null;
    setSelection({ status: "loading" });
    dialog.current?.close();
    focus.current?.focus();
  }

  function confirm() {
    if (!pending.current || selection.status !== "ready") return;
    const place = selection.place;
    close();
    onSelect(place);
  }

  const status = selection.status;
  return <dialog ref={dialog} className="map-confirmation-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClose={() => { sequence.current += 1; pending.current = null; }}>
    <h2 id={titleId}>{status === "ready" ? "이 지점을 경유지로 추가할까요?" : status === "loading" ? "선택한 위치를 확인하고 있어요" : status === "empty" ? "이 지점의 주소를 찾지 못했어요" : "선택한 위치를 확인하지 못했어요"}</h2>
    <div className="map-confirmation-body" aria-live="polite">
      {selection.status === "ready" ? <><p>{selection.place.roadAddress ?? selection.place.address}</p><p>지도에서 길게 누른 위치입니다. 추가하면 마지막 경유지에 통과 지점으로 들어갑니다.</p></>
        : <p>{status === "loading" ? "주소를 확인한 뒤 경유지로 추가할 수 있어요. 아직 코스에는 반영되지 않았습니다."
          : status === "empty" ? "지도의 다른 지점을 선택하거나 장소 이름으로 검색해 주세요. 코스는 변경되지 않았습니다."
            : "주소 조회에 실패했습니다. 다시 시도하거나 지도의 다른 지점을 선택해 주세요. 코스는 변경되지 않았습니다."}</p>}
    </div>
    <div className="map-confirmation-actions">
      {status === "empty" ? <button type="button" className="primary-button" onClick={close}>지도에서 다시 선택</button>
        : status === "error" ? <button type="button" className="primary-button" onClick={() => pending.current && void resolve(pending.current)}>다시 시도</button>
          : <button type="button" className="primary-button" disabled={status !== "ready"} onClick={confirm}>{status === "loading" ? "주소 확인 중" : "경유지로 추가"}</button>}
      <button type="button" onClick={close}>{status === "empty" || status === "error" ? "닫기" : "취소"}</button>
    </div>
  </dialog>;
}
