"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { parsePlaceSearchResponse, selectedMapPointPlace, type PlaceSearchResult } from "@/lib/places/search";
import { isRegionOnlyPlace } from "@/lib/places/saved";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { KakaoMapCanvas } from "@/components/kakao-map-canvas";

type Point = { latitude: number; longitude: number };

/** Resolves one selected map point. `regionFallback` opts in to a region-only place
 * (`:region`, no detail address) when the point has no address; only saved-place
 * registration asks for it. Errors are thrown, never reported as an empty result. */
export async function resolveMapPoint(point: Point, regionFallback: boolean): Promise<PlaceSearchResult | null> {
  const supabase = getBrowserSupabase();
  if (!supabase) throw new Error("UNAVAILABLE");
  const body = { mode: "coordinate", ...point, ...(regionFallback ? { fallback: "region" } : {}) };
  const { data, error } = await supabase.functions.invoke("search-places", { body });
  if (error) throw new Error("UNAVAILABLE");
  return selectedMapPointPlace(parsePlaceSearchResponse(data), point, regionFallback);
}
export type MapPlacePickerHandle = { open: (point: Point) => void };
type Selection = { status: "loading" | "empty" | "error" } | { status: "ready"; place: PlaceSearchResult };

export function MapPointConfirmation({ pickerRef, onSelect, purpose = "waypoint" }: {
  pickerRef: Ref<MapPlacePickerHandle>;
  onSelect: (place: PlaceSearchResult) => void;
  purpose?: "waypoint" | "saved-place";
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const focus = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);
  const pending = useRef<Point | null>(null);
  const [preview, setPreview] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Selection>({ status: "loading" });
  useEffect(() => () => { sequence.current += 1; pending.current = null; }, []);

  async function resolve(point: Point) {
    const attempt = ++sequence.current;
    setSelection({ status: "loading" });
    try {
      const place = await resolveMapPoint(point, purpose === "saved-place");
      if (attempt !== sequence.current) return;
      setSelection(place ? { status: "ready", place } : { status: "empty" });
    } catch {
      if (attempt === sequence.current) setSelection({ status: "error" });
    }
  }

  useImperativeHandle(pickerRef, () => ({ open(point) {
    focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pending.current = point;
    setPreview(point);
    dialog.current?.showModal();
    void resolve(point);
  } }));

  function close() {
    sequence.current += 1;
    pending.current = null;
    setPreview(null);
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
  const region = selection.status === "ready" && isRegionOnlyPlace(selection.place);
  return <dialog ref={dialog} className="map-confirmation-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClose={() => { sequence.current += 1; pending.current = null; setPreview(null); }}>
    <h2 id={titleId}>{status === "ready" ? purpose === "saved-place" ? "이 위치를 내 장소로 선택할까요?" : "이 지점을 경유지로 추가할까요?" : status === "loading" ? "선택한 위치를 확인하고 있어요" : status === "empty" ? purpose === "saved-place" ? "이 지점은 주소와 지역을 찾지 못했어요" : "이 지점의 주소를 찾지 못했어요" : "선택한 위치를 확인하지 못했어요"}</h2>
    {preview ? <KakaoMapCanvas points={[{ ...preview, label: "선택한 위치" }]} showLegend={false} selectionPreview /> : null}
    <div className="map-confirmation-body" aria-live="polite">
      {selection.status === "ready" ? <>{purpose === "saved-place" ? <div className="map-confirmation-place"><span className="map-confirmation-eyebrow">길게 누른 위치{region ? <span className="detail-address-chip">상세 주소 없음</span> : null}</span><strong>{selection.place.name}</strong><span>{selection.place.roadAddress ?? selection.place.address}</span></div> : <p>{selection.place.roadAddress ?? selection.place.address}</p>}<p>{purpose === "saved-place" ? region ? "다음 화면에서 별명을 꼭 정해야 저장할 수 있어요. 아직 저장되지 않았어요." : "다음 화면에서 별명과 분류를 정하고 저장해요. 아직 장소나 일정에 반영되지 않았습니다." : "이 위치를 마지막 경유지로 추가합니다."}</p></>
        : <p>{status === "loading" ? purpose === "saved-place" ? "주소를 확인한 뒤 내 장소로 저장할 수 있어요. 아직 장소나 일정에 반영되지 않았습니다." : "주소를 확인한 뒤 경유지로 추가할 수 있어요. 아직 코스에는 반영되지 않았습니다."
          : status === "empty" ? purpose === "saved-place" ? "강·호수 한가운데처럼 주소 정보가 없는 곳은 등록할 수 없어요. 가까운 땅 위 지점을 골라 주세요." : "지도의 다른 지점을 선택하거나 장소 이름으로 검색해 주세요. 코스는 변경되지 않았습니다."
            : "주소 조회에 실패했습니다. 다시 시도하거나 지도의 다른 지점을 선택해 주세요. 코스는 변경되지 않았습니다."}</p>}
    </div>
    <div className="map-confirmation-actions">
      {status === "empty" ? <button type="button" className="primary-button" onClick={close}>지도에서 다시 선택</button>
        : status === "error" ? <button type="button" className="primary-button" onClick={() => pending.current && void resolve(pending.current)}>다시 시도</button>
          : <button type="button" className="primary-button" disabled={status !== "ready"} onClick={confirm}>{status === "loading" ? "주소 확인 중" : purpose === "saved-place" ? region ? "별명 정하고 저장" : "이 장소 선택" : "경유지로 추가"}</button>}
      <button type="button" onClick={close}>{status === "empty" || status === "error" ? "닫기" : "취소"}</button>
    </div>
  </dialog>;
}
