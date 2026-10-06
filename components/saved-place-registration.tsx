"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LineIcon, StarMark } from "@/components/line-icon";
import { KakaoMapCanvas, type MapCenterHandle } from "./kakao-map-canvas";
import { resolveMapPoint } from "./map-point-confirmation";
import { SavedDialog } from "./saved-dialog";
import {
  FREQUENT_PLACE_LIMIT,
  isRegionOnlyPlace,
  type SavedPlace,
  type SavedPlaceKind,
} from "@/lib/places/saved";
import { parsePlaceSearchResponse, type PlaceSearchResult } from "@/lib/places/search";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import styles from "./saved-places-manager.module.css";

type Point = { latitude: number; longitude: number };
type Search =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "results"; places: PlaceSearchResult[]; selectedId: string }
  | { status: "empty"; query: string }
  | { status: "error" };
type Lookup =
  | { status: "picking" }
  | { status: "loading"; point: Point }
  | { status: "ready"; point: Point; place: PlaceSearchResult }
  | { status: "empty"; point: Point }
  | { status: "error"; point: Point };
type Step = "search" | "map" | "form";

const ALIAS_LIMIT = 80;
const PICKER_LEVEL = 4;
const kindLabel = (kind: SavedPlaceKind) => (kind === "restaurant" ? "식당" : "라이딩 스팟");
const address = (place: PlaceSearchResult) => place.roadAddress ?? place.address;

/**
 * Saved-place registration (Figma 372:11029–11289, 373:11122–11512): search with a
 * result map, a centered map point picker, then alias/kind/star. The search step never
 * lists frequent places, and its map shows only coordinates already in the results.
 */
export function SavedPlaceRegistration({
  initialPlace,
  existing,
  stars,
  blocked,
  startView,
  onClose,
  onSave,
}: {
  initialPlace: PlaceSearchResult | null;
  existing?: SavedPlace;
  stars: number;
  blocked: boolean;
  startView: Point;
  onClose: () => void;
  onSave: (place: PlaceSearchResult, alias: string, kind: SavedPlaceKind, starred: boolean) => void;
}) {
  const [step, setStep] = useState<Step>(initialPlace ? "form" : "search");
  const [place, setPlace] = useState<PlaceSearchResult | null>(initialPlace);
  const [pickerView, setPickerView] = useState<Point>(startView);
  // Kept here so returning from the map picker shows the same query and results.
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>({ status: "idle" });
  const title = step === "search" ? "장소 등록" : step === "map" ? "지도에서 지점 고르기" : existing ? "별명·분류 수정" : "내 장소로 저장";
  const back = existing ? undefined : step === "search" ? undefined : () => setStep("search");
  return (
    <SavedDialog title={title} accessibleTitle={step === "search" ? "장소 등록" : title} onClose={onClose} onBack={back} fullScreen wide={step !== "form"}>
      {step === "search" ? (
        <SearchStep
          query={query}
          setQuery={setQuery}
          search={search}
          setSearch={setSearch}
          onClose={onClose}
          onPickOnMap={() => setStep("map")}
          onChoose={(chosen) => { setPlace(chosen); setStep("form"); }}
        />
      ) : step === "map" ? (
        <MapStep
          startView={pickerView}
          onRestart={setPickerView}
          onChoose={(chosen) => { setPlace(chosen); setPickerView({ latitude: chosen.latitude, longitude: chosen.longitude }); setStep("form"); }}
        />
      ) : place ? (
        <FormStep place={place} existing={existing} stars={stars} blocked={blocked} onSave={onSave} />
      ) : null}
    </SavedDialog>
  );
}

function SearchStep({ query, setQuery, search, setSearch, onClose, onPickOnMap, onChoose }: {
  query: string;
  setQuery: (query: string) => void;
  search: Search;
  setSearch: (update: Search | ((current: Search) => Search)) => void;
  onClose: () => void;
  onPickOnMap: () => void;
  onChoose: (place: PlaceSearchResult) => void;
}) {
  const inputId = useId();
  const sequence = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      // A search abandoned by leaving this step is discarded, not left loading.
      setSearch((current) => (current.status === "loading" ? { status: "idle" } : current));
    };
  }, [setSearch]);
  const normalized = query.trim().replace(/\s+/g, " ");
  const searchable = normalized.length >= 2 && normalized.length <= 100;

  async function run() {
    if (!searchable) return;
    const attempt = ++sequence.current;
    setSearch({ status: "loading" });
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("UNAVAILABLE");
      const { data, error } = await supabase.functions.invoke("search-places", { body: { query: normalized, page: 1, size: 10 } });
      if (!mounted.current || attempt !== sequence.current) return;
      if (error) throw new Error("UNAVAILABLE");
      const { places } = parsePlaceSearchResponse(data);
      // The first result is selected so the bottom action always names what it picks.
      setSearch(places.length ? { status: "results", places, selectedId: places[0].kakaoPlaceId } : { status: "empty", query: normalized });
    } catch {
      if (mounted.current && attempt === sequence.current) setSearch({ status: "error" });
    }
  }

  const selectedIndex = search.status === "results" ? search.places.findIndex((p) => p.kakaoPlaceId === search.selectedId) : -1;
  const selected = search.status === "results" ? search.places[selectedIndex] : undefined;
  const mapButton = <button type="button" className={styles.outlineButton} onClick={() => { sequence.current += 1; onPickOnMap(); }}>지도에서 지점 고르기</button>;
  return (
    <>
      <div className={`${styles.waypointBody} ${styles.registerBody}`}>
        <div className={styles.registerSearch}>
          <label className={styles.fieldLabel} htmlFor={inputId}>장소명 또는 주소 검색</label>
          <input
            id={inputId}
            value={query}
            maxLength={100}
            placeholder="예: 서종 막국수, 양평군 서종면"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }}
          />
          {search.status === "error" ? null : (
            <button type="button" className="primary-button" disabled={!searchable || search.status === "loading"} onClick={() => void run()}>
              {search.status === "loading" ? "검색 중…" : "검색"}
            </button>
          )}
        </div>
        {search.status === "idle" ? (
          <>
            <p className={styles.helper}>검색어를 2자 이상 입력하면 검색할 수 있어요.</p>
            <div className={styles.infoCard}><strong>검색으로 안 나오는 곳</strong><p>도로 위나 이름 없는 쉼터는 지도를 움직여 지점을 직접 고를 수 있어요.</p></div>
            {mapButton}
            <p className={styles.helper}>즐겨찾기 지도를 길게 눌러도 그 지점을 등록할 수 있어요.</p>
          </>
        ) : search.status === "loading" ? (
          <div className={styles.searchLoading} role="status">
            <div className={styles.resultMap} aria-hidden="true" />
            <p className={styles.helper}>카카오 장소를 검색하고 있어요.</p>
            {[0, 1, 2].map((n) => <div key={n} className={styles.skeletonCard} aria-hidden="true"><span /><span /></div>)}
          </div>
        ) : search.status === "empty" ? (
          <>
            <div className={styles.noticeCard} role="status"><strong>‘{search.query}’ 검색 결과가 없어요</strong><p>다른 이름이나 주소로 검색해 보세요. 검색되지 않는 지점은 지도에서 직접 고를 수 있어요.</p></div>
            {mapButton}
          </>
        ) : search.status === "error" ? (
          <>
            <div className={styles.errorCard} role="alert"><strong>장소를 검색하지 못했어요</strong><p>연결이 불안정하거나 검색 서비스가 응답하지 않았어요. 입력한 검색어는 그대로 있어요.</p></div>
            <button type="button" className="primary-button" disabled={!searchable} onClick={() => void run()}>다시 검색</button>
            {mapButton}
          </>
        ) : (
          <div className={styles.resultLayout}>
            <h3 className={styles.resultHeading}>검색 결과 <b>{search.places.length}</b>곳<span> · 지도는 받은 결과만 표시</span></h3>
            <div className={styles.resultMap}>
              <KakaoMapCanvas
                points={[]}
                allowEmptyMap
                showLegend={false}
                numberedPins={search.places.map((p, index) => ({ id: p.kakaoPlaceId, number: index + 1, label: p.name, latitude: p.latitude, longitude: p.longitude }))}
                selectedNumberedPinId={search.selectedId}
                onSelectNumberedPin={(id) => setSearch({ ...search, selectedId: id })}
              />
            </div>
            <ul className={styles.resultList} aria-label="검색 결과">
              {search.places.map((p, index) => {
                const active = p.kakaoPlaceId === search.selectedId;
                return (
                  <li key={p.kakaoPlaceId}>
                    <button type="button" aria-pressed={active} onClick={() => setSearch({ ...search, selectedId: p.kakaoPlaceId })}>
                      <span className={styles.resultNumber} aria-hidden="true">{index + 1}</span>
                      <span className={styles.resultText}>
                        <strong><span className={styles.srOnly}>{index + 1}번 </span>{p.name}</strong>
                        <span>{[p.category, address(p)].filter(Boolean).join(" · ")}</span>
                        {active ? <span className={styles.chip}>지도에 표시 중</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {mapButton}
          </div>
        )}
      </div>
      <div className={styles.waypointFooter}>
        {selected ? (
          <>
            <button type="button" className="primary-button" onClick={() => onChoose(selected)}>
              <span className={styles.wideLabel}>{selectedIndex + 1}번 {selected.name} 선택</span>
              <span className={styles.narrowLabel}>선택한 장소로 진행</span>
            </button>
            <p className={styles.footerHint}>다음 화면에서 별명과 분류를 정해요.</p>
          </>
        ) : (
          <button type="button" onClick={onClose}>취소</button>
        )}
      </div>
    </>
  );
}

function MapStep({ startView, onRestart, onChoose }: {
  startView: Point;
  onRestart: (view: Point) => void;
  onChoose: (place: PlaceSearchResult) => void;
}) {
  const handle = useRef<MapCenterHandle>(null);
  const sequence = useRef(0);
  const [lookup, setLookup] = useState<Lookup>({ status: "picking" });
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => () => { sequence.current += 1; }, []);

  async function resolve(point: Point) {
    const attempt = ++sequence.current;
    setLookup({ status: "loading", point });
    try {
      const place = await resolveMapPoint(point, true);
      if (attempt !== sequence.current) return;
      setLookup(place ? { status: "ready", point, place } : { status: "empty", point });
    } catch {
      if (attempt === sequence.current) setLookup({ status: "error", point });
    }
  }
  function pick() {
    const center = handle.current?.getCenter() ?? null;
    setUnavailable(!center);
    if (center) void resolve(center);
  }
  function restart() {
    sequence.current += 1;
    if (lookup.status !== "picking") onRestart(lookup.point);
    setLookup({ status: "picking" });
  }

  const region = lookup.status === "ready" && isRegionOnlyPlace(lookup.place);
  return (
    <>
      <div className={`${styles.waypointBody} ${styles.pickerBody}`}>
        {lookup.status === "picking" ? (
          <>
            <p className={styles.helper}>지도를 움직여 가운데 표시를 등록할 지점에 맞추세요.</p>
            <div className={styles.pickerMap}>
              <KakaoMapCanvas points={[]} allowEmptyMap showLegend={false} centerPicker centerHandle={handle} initialView={{ ...startView, level: PICKER_LEVEL }} />
            </div>
            <p className={styles.helper}>두 손가락이나 오른쪽 위 +/− 버튼으로 확대·축소할 수 있어요. 지도를 움직이는 동안에는 주소를 조회하지 않아요.</p>
            {unavailable ? <p role="alert" className={styles.fieldError}>지도를 아직 불러오지 못했어요. 지도가 보이면 다시 선택하거나 장소를 검색해 주세요.</p> : null}
          </>
        ) : (
          <div className={styles.pickerResult}>
            <div className={styles.pickerPreview}>
              <KakaoMapCanvas points={[{ ...lookup.point, label: "선택한 위치" }]} showLegend={false} selectionPreview />
            </div>
            <div className={styles.pickerPanel} aria-live="polite">
              {lookup.status === "loading" ? (
                <>
                  <div className={styles.placeSummary} role="status">
                    <span className={styles.placeKind}>선택한 위치</span>
                    <strong>주소를 확인하고 있어요</strong>
                    <span className={styles.progress} aria-hidden="true"><span /></span>
                    <span>확인하는 동안 지도는 움직이지 않아요.</span>
                  </div>
                  <button type="button" className={styles.textButton} onClick={restart}>조회 취소</button>
                </>
              ) : lookup.status === "ready" ? (
                <>
                  <div className={styles.placeSummary}>
                    <span className={styles.placeKind}>{region ? <>선택한 위치<span className={styles.chip}>상세 주소 없음</span></> : "선택한 위치 · 주소 확인됨"}</span>
                    <strong>{lookup.place.name}</strong>
                    <span>{region ? `${lookup.place.address} (지역만 확인)` : address(lookup.place)}</span>
                    {region ? <span>좌표 <b className={styles.coordinate}>{lookup.place.latitude.toFixed(4)}, {lookup.place.longitude.toFixed(4)}</b></span> : null}
                  </div>
                  {region
                    ? <p className={styles.notice}>도로 위처럼 상세 주소가 없는 지점이에요. 고른 위치 그대로 저장되고, 다음 화면에서 별명을 꼭 정해야 해요.</p>
                    : <p className={styles.helper}>다음 화면에서 별명과 분류를 정하고 저장해요. 아직 저장되지 않았어요.</p>}
                </>
              ) : lookup.status === "empty" ? (
                <div className={styles.noticeCard} role="status"><strong>이 지점은 주소와 지역을 찾지 못했어요</strong><p>강·호수 한가운데처럼 주소 정보가 없는 곳은 등록할 수 없어요. 지도를 조금 움직여 가까운 땅 위 지점을 골라 주세요.</p></div>
              ) : (
                <div className={styles.errorCard} role="alert"><strong>선택한 위치를 확인하지 못했어요</strong><p>연결이 불안정하거나 주소 서비스가 응답하지 않았어요. 아직 아무것도 저장되지 않았어요.</p></div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className={`${styles.waypointFooter} ${styles.confirmFooter}`}>
        {lookup.status === "picking" ? (
          <button type="button" className="primary-button" onClick={pick}>이 지점 선택</button>
        ) : lookup.status === "loading" ? (
          <>
            <button type="button" className="primary-button" disabled>이 장소 선택</button>
            <p className={styles.footerHint}>주소를 확인한 뒤 선택할 수 있어요.</p>
          </>
        ) : lookup.status === "ready" ? (
          <>
            <button type="button" className="primary-button" onClick={() => onChoose(lookup.place)}>{region ? "별명 정하고 저장" : "이 장소 선택"}</button>
            <button type="button" className={styles.outlineButton} onClick={restart}>다시 고르기</button>
          </>
        ) : lookup.status === "empty" ? (
          <button type="button" className="primary-button" onClick={restart}>다른 지점 고르기</button>
        ) : (
          <>
            <button type="button" className="primary-button" onClick={() => void resolve(lookup.point)}>다시 시도</button>
            <button type="button" className={styles.outlineButton} onClick={restart}>다른 지점 고르기</button>
          </>
        )}
      </div>
    </>
  );
}

function FormStep({ place, existing, stars, blocked, onSave }: {
  place: PlaceSearchResult;
  existing?: SavedPlace;
  stars: number;
  blocked: boolean;
  onSave: (place: PlaceSearchResult, alias: string, kind: SavedPlaceKind, starred: boolean) => void;
}) {
  const aliasId = useId();
  const aliasInput = useRef<HTMLInputElement>(null);
  const [alias, setAlias] = useState(existing?.alias ?? "");
  const [kind, setKind] = useState<SavedPlaceKind>(existing?.kind ?? "riding_spot");
  const [starred, setStarred] = useState(false);
  const [aliasMissing, setAliasMissing] = useState(false);
  const region = isRegionOnlyPlace(place);
  const full = stars >= FREQUENT_PLACE_LIMIT;
  const length = [...alias].length;
  function submit() {
    if (region && !alias.trim()) {
      // The server rejects a region-only place without an alias; say so before sending.
      setAliasMissing(true);
      aliasInput.current?.focus();
      return;
    }
    onSave(place, alias, kind, starred && !full);
  }
  return (
    <>
      <div className={styles.waypointBody}>
        <div className={styles.placeSummary}>
          <span className={styles.placeKind}>
            {existing ? `${kindLabel(existing.kind)} · ${existing.province ?? "지역 미확인"}` : "선택한 위치"}
            {region ? <span className={styles.chip}>상세 주소 없음</span> : null}
          </span>
          <strong>{place.name}</strong>
          <span>{address(place)}</span>
        </div>
        <fieldset className={styles.roleField}><legend>분류</legend><div className={`${styles.roleButtons} ${styles.twoChoices}`}>
          <button type="button" aria-pressed={kind === "riding_spot"} onClick={() => setKind("riding_spot")}>{kind === "riding_spot" ? <LineIcon name="check" /> : null}라이딩 스팟</button>
          <button type="button" aria-pressed={kind === "restaurant"} onClick={() => setKind("restaurant")}>{kind === "restaurant" ? <LineIcon name="check" /> : null}식당</button>
        </div></fieldset>
        <label className={styles.fieldLabel} htmlFor={aliasId}>{region ? "별명 (필수)" : "별명 (선택)"}</label>
        <input
          ref={aliasInput}
          id={aliasId}
          className={aliasMissing ? styles.invalidInput : undefined}
          value={alias}
          maxLength={160}
          placeholder={region ? "예: 서종 강변 쉼터" : "비워 두면 원래 장소명으로 표시해요"}
          aria-invalid={aliasMissing || undefined}
          aria-describedby={`${aliasId}-hint`}
          onChange={(e) => { setAlias([...e.target.value].slice(0, ALIAS_LIMIT).join("")); setAliasMissing(false); }}
        />
        <p id={`${aliasId}-hint`} className={aliasMissing ? styles.fieldError : styles.helper} role={aliasMissing ? "alert" : undefined}>
          {aliasMissing
            ? "별명을 입력해 주세요. 상세 주소가 없는 지점은 별명이 있어야 저장할 수 있어요."
            : `${length} / ${ALIAS_LIMIT} · 목록과 지도에 이 이름으로 보여요.`}
        </p>
        {!existing ? (
          <>
            <button
              type="button"
              className={styles.starToggle}
              aria-pressed={starred && !full}
              disabled={full}
              onClick={() => setStarred((value) => !value)}
            >
              <StarMark filled={starred && !full} />
              {full ? `자주 찾는 장소에 추가 · ${stars} / ${FREQUENT_PLACE_LIMIT} 가득 참` : `자주 찾는 장소에 추가 · ${stars} / ${FREQUENT_PLACE_LIMIT}`}
            </button>
            {full ? <p className={styles.helper}>자주 찾는 장소 {FREQUENT_PLACE_LIMIT}곳이 모두 찼어요. 이 장소는 별표 없이 저장되고, 나중에 다른 별표를 빼고 추가할 수 있어요.</p> : null}
          </>
        ) : null}
      </div>
      <div className={styles.waypointFooter}>
        <button type="button" className="primary-button" disabled={blocked} onClick={submit}>
          {existing ? "수정 내용 확인" : "저장 내용 확인"}
        </button>
        <p className={styles.footerHint}>닫기·취소 시 입력 내용은 저장되지 않아요.</p>
      </div>
    </>
  );
}
