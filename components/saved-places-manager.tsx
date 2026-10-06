"use client";

import { LineIcon, StarMark } from "@/components/line-icon";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { KakaoMapCanvas, type MapPoint } from "./kakao-map-canvas";
import {
  MapPointConfirmation,
  type MapPlacePickerHandle,
} from "./map-point-confirmation";
import { SavedDialog } from "./saved-dialog";
import { SavedPlaceRegistration } from "./saved-place-registration";
import { useSavedPlaces } from "./saved-places-provider";
import {
  FREQUENT_PLACE_LIMIT,
  isRegionOnlyPlace,
  PROVINCES,
  savedPlaceName,
  type SavedPlace,
  type SavedPlaceEntry,
  type SavedPlaceKind,
} from "@/lib/places/saved";
import type { PlaceSearchResult } from "@/lib/places/search";
import {
  defaultDwellMinutes,
  dwellError,
  dwellForRole,
  isMealRole,
  MEAL_DWELL_NOTE,
  waypointRoleOptions,
  type WaypointRole,
} from "@/lib/planner/ordered-waypoints";
import styles from "./saved-places-manager.module.css";

type Pending = {
  title: string;
  name: string;
  description: string;
  action: string;
  valid: () => boolean;
  run: () => Promise<boolean>;
  destructive?: boolean;
  fullScreen?: boolean;
  placeSummary?: { kind: string; originalName: string; address: string; starred: boolean };
};

const kindLabel = (kind: SavedPlaceKind) => (kind === "restaurant" ? "식당" : "라이딩 스팟");
/** Address line; a region-only map point says it has no detail address. */
const placeLine = (p: SavedPlace) =>
  isRegionOnlyPlace(p.place)
    ? `${p.place.name} · 상세 주소 없음`
    : p.alias
      ? `${p.place.name} · ${p.place.roadAddress ?? p.place.address}`
      : p.place.roadAddress ?? p.place.address;
const starLabel = (starred: boolean) => (starred ? "자주 찾는 장소에서 빼기" : "자주 찾는 장소에 추가");

export function SavedPlacesManager(props: SavedPlacesManagerProps) {
  const { accountEpoch } = useSavedPlaces();
  return <SavedPlacesManagerContent key={accountEpoch} {...props} />;
}

type SavedPlacesManagerProps = {
  onBack: () => void;
  onAddWaypoint: (
    place: PlaceSearchResult,
    role: WaypointRole,
    dwellMinutes: number,
  ) => string | null;
  routePoints: MapPoint[];
  routePath?: { latitude: number; longitude: number }[];
  disabled?: boolean;
  initialWaypoint?: { role: WaypointRole; dwellMinutes: number };
};

function SavedPlacesManagerContent({
  onBack,
  onAddWaypoint,
  routePoints,
  routePath,
  disabled = false,
  initialWaypoint,
}: SavedPlacesManagerProps) {
  const saved = useSavedPlaces();
  const [tab, setTab] = useState<"starred" | SavedPlaceKind>("riding_spot");
  const [province, setProvince] = useState("");
  const [spots, setSpots] = useState(true);
  const [restaurants, setRestaurants] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedSelection, setSavedSelection] = useState<string | null>(null);
  const [form, setForm] = useState<{
    place: PlaceSearchResult | null;
    existing?: SavedPlaceEntry;
  } | null>(null);
  const [clusterIds, setClusterIds] = useState<string[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [adding, setAdding] = useState<SavedPlaceEntry | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const picker = useRef<MapPlacePickerHandle>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const selected = saved.places.find((p) => savedSelection ? p.place.kakaoPlaceId === savedSelection : p.id === selectedId);
  function selectPlace(id: string | null) { setSavedSelection(null); setSelectedId(id); }
  const blocked = saved.busy || saved.status !== "ready";
  const filtered = useMemo(
    () =>
      saved.places.filter(
        (p) =>
          (!province ||
            (province === "unknown"
              ? p.province === null
              : p.province === province)) &&
          (!query.trim() ||
            `${savedPlaceName(p)} ${p.place.name} ${p.place.address}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())),
      ),
    [saved.places, province, query],
  );
  const starredCount = saved.favorites.length;
  const full = starredCount >= FREQUENT_PLACE_LIMIT;
  const list = filtered
    .filter((p) => (tab === "starred" ? p.starPosition !== null : p.kind === tab))
    .sort((a, b) => (tab === "starred" ? a.starPosition! - b.starPosition! : 0));
  // Only the visible layers reach the map, so cluster counts match what is shown.
  const pins = filtered
    .filter(
      (p) =>
        (tab !== "starred" || p.starPosition !== null) &&
        (p.kind === "restaurant" ? restaurants : spots),
    )
    .map((p) => ({
      id: p.id,
      label: savedPlaceName(p),
      kind: p.kind,
      starred: p.starPosition !== null,
      latitude: p.place.latitude,
      longitude: p.place.longitude,
    }));
  const clusterPlaces = clusterIds ? saved.places.filter((p) => clusterIds.includes(p.id)) : [];
  const failure = saved.failureTitle && saved.status === "ready" ? (
    <div className={styles.errorCard} role="alert"><strong>{saved.failureTitle}</strong><p>{saved.message}</p></div>
  ) : null;
  const startView = selected?.place ?? routePoints[0] ?? saved.places[0]?.place ?? { latitude: 37.5665, longitude: 126.978 };
  function manageStars() { selectPlace(null); setTab("starred"); setProvince(""); setQuery(""); }

  function confirm(p: SavedPlaceEntry, action: "star" | "delete") {
    const starred = p.starPosition === null;
    setPending({
      title:
        action === "delete"
          ? "이 장소를 삭제할까요?"
          : starred
            ? "자주 찾는 장소에 추가할까요?"
            : "자주 찾는 장소에서 뺄까요?",
      name: savedPlaceName(p),
      description:
        action === "delete"
          ? "내 저장 장소와 자주 찾는 장소에서 삭제해요. 이미 저장한 일정·코스·공유 결과는 유지됩니다."
          : starred
            ? `라이딩 스팟과 식당을 합쳐 최대 ${FREQUENT_PLACE_LIMIT}곳까지 별표할 수 있어요.`
            : "별표만 빼요. 라이딩 스팟이나 식당 목록에는 그대로 남아 있어요.",
      action:
        action === "delete" ? "장소 삭제" : starred ? "별표 지정" : "별표 빼기",
      destructive: action === "delete",
      valid: saved.captureSnapshot(),
      run: () =>
        action === "delete" ? saved.deletePlace(p) : saved.star(p, starred),
    });
  }

  return (
    <section className={styles.page} aria-labelledby="saved-places-title">
      <header className={styles.heading}>
        <div>
          <h1 id="saved-places-title" data-view-title="favorites" tabIndex={-1}>
            즐겨찾기
          </h1>
        </div>
        <button type="button" onClick={onBack}>
          뒤로
        </button>
      </header>
      <div className={styles.filters}>
        <label>
          <span className={styles.srOnly}>시·도</span>
          <select
            value={province}
            onChange={(e) => setProvince(e.target.value)}
          >
            <option value="">전국</option>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
            <option value="unknown">지역 미확인</option>
          </select>
        </label>
        <details className={styles.search}><summary>저장 장소 찾기</summary><label>
          <span className={styles.srOnly}>저장 장소 찾기</span>
          <input
            value={query}
            maxLength={100}
            placeholder="별명, 장소명, 주소"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label></details>
      </div>
      <div className={styles.layers} aria-label="지도 핀 표시">
        <label>
          <input
            type="checkbox"
            checked={spots}
            onChange={(e) => setSpots(e.target.checked)}
          />
          라이딩 스팟
        </label>
        <label>
          <input
            type="checkbox"
            checked={restaurants}
            onChange={(e) => setRestaurants(e.target.checked)}
          />
          식당
        </label>
      </div>
      <div className={styles.columns}>
        <div className={styles.mapColumn}>
          <div className={styles.map}>
            <KakaoMapCanvas
              key={mapAttempt}
              points={routePoints}
              path={routePath}
              allowEmptyMap
              savedPins={pins}
              savedViewportKey={province}
              onSelectSavedPin={selectPlace}
              selectedSavedPinId={selected?.id ?? null}
              onSelectSavedCluster={setClusterIds}
              showLegend={false}
              onSelectCoordinate={
                !blocked && saved.places.length < 1000
                  ? (point) => picker.current?.open(point)
                  : undefined
              }
              coordinateActionLabel="지도 중심에서 등록 위치 선택"
              coordinateActionInFullscreenOnly
            />
          </div>
          <details className={styles.mapHelp}><summary>지도 도움말·다시 불러오기</summary><p className={styles.helper}>
            S 원형은 라이딩 스팟, 식 사각형은 식당이고 노란 별 배지는 자주 찾는 장소예요. 숫자 원은 그 자리에 묶인 장소 수예요. 누르면 확대돼요. 핀을 누르면 상세가 열려요. 지도를 길게 눌러 장소를 등록하거나, 전체화면에서 중심 지점을 선택하세요.
          </p>
          <button
            type="button"
            onClick={() => {
              // Retry only an explicitly failed loader. Keep the draft and healthy SDK.
              const script = document.querySelector<HTMLScriptElement>(
                "script[data-motocast-kakao-map]",
              );
              if (
                script?.dataset.motocastKakaoMapStatus === "error" &&
                !window.kakao?.maps
              )
                script.remove();
              setMapAttempt((n) => n + 1);
            }}
          >
            지도 다시 불러오기
          </button>
          </details>
          {!spots && !restaurants ? <p role="status">저장 장소 핀을 모두 숨겼어요. 현재 일정의 지점과 지도는 유지됩니다.</p> : null}
          {selected && wide ? <section className={styles.desktopDetail} aria-label="장소 상세">
            <span className={styles.placeKind}>{kindLabel(selected.kind)} · {selected.province ?? "지역 미확인"}{selected.starPosition !== null ? " · 자주 찾는 장소" : ""}</span>
            <h2>{savedPlaceName(selected)}</h2>
            <p>{placeLine(selected)}</p>
            {failure}
            <div className={styles.desktopActions}>
              <StarButton place={selected} full={full} count={starredCount} disabled={blocked} onClick={() => confirm(selected, "star")} />
              <button type="button" disabled={blocked} onClick={() => setForm({place:selected.place, existing:selected})}>별명·분류 수정</button>
              <button type="button" className="danger-text" disabled={blocked} onClick={() => confirm(selected, "delete")}>장소 삭제</button>
              <button type="button" className="primary-button" disabled={blocked || disabled} onClick={() => setAdding(selected)}>경유지에 추가</button>
            </div>
            {selected.starPosition === null && full ? <p>자주 찾는 장소 {FREQUENT_PLACE_LIMIT}곳이 모두 찼어요. 다른 장소의 별표를 빼면 추가할 수 있어요. <button type="button" onClick={manageStars}>자주 찾는 장소 관리</button></p> : null}
          </section> : null}
        </div>
        <section
          className={styles.listColumn}
          aria-label={`${tab === "starred" ? "자주 찾는 장소" : kindLabel(tab)} 목록`}
        >
          <nav className={styles.tabs} aria-label="저장 장소 목록">
            {([["starred", "자주 찾는 장소"], ["riding_spot", "라이딩 스팟"], ["restaurant", "식당"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
          </nav>
          <p className={styles.listCount}>{tab === "starred" ? <strong>자주 찾는 장소 <b className={styles.countNumber}>{starredCount} / {FREQUENT_PLACE_LIMIT}</b></strong> : `${kindLabel(tab)} ${list.length}곳`}<span>전체 {saved.places.length.toLocaleString()}/1,000</span></p>
          {tab === "starred" ? <p className={styles.helper}>라이딩 스팟과 식당을 합쳐 최대 {FREQUENT_PLACE_LIMIT}곳까지 별표할 수 있어요.</p> : null}
          {saved.status === "loading" ? (
            <div className={styles.stateCard} role="status"><strong>장소를 불러오고 있어요</strong><p>저장한 장소를 불러오는 중이에요. 잠시만 기다려 주세요.</p></div>
          ) : saved.status === "error" ? (
            <div className={styles.stateCard} role="alert">
              <strong>목록을 확인하지 못했어요</strong>
              <p>{saved.message}</p>
              <button type="button" disabled={saved.busy} onClick={saved.retry}>
                목록 다시 확인
              </button>
            </div>
          ) : !list.length ? (
            <div className={styles.stateCard}><strong>{query || province ? "조건에 맞는 장소가 없어요" : "아직 저장한 장소가 없어요"}</strong><p>{query || province ? "검색어 또는 지역 필터를 바꿔 보세요." : "좋아하는 장소를 저장하고 다음 라이딩에 추가해 보세요."}</p>{query || province ? <button type="button" onClick={() => { setQuery(""); setProvince(""); }}>검색·지역 필터 해제</button> : <button type="button" disabled={blocked} onClick={() => setForm({place:null})}>장소 등록하기</button>}</div>
          ) : (
            <ul className={styles.list}>
              {list.map((p) => (
                <li key={p.id} className={styles.placeCard}>
                  <button
                    type="button"
                    onClick={() => selectPlace(p.id)}
                    aria-label={`${savedPlaceName(p)} 상세 보기`}
                  >
                    <span className={styles.placeKind}>{kindLabel(p.kind)} · {p.province ?? "지역 미확인"}</span>
                    <strong>{savedPlaceName(p)}</strong>
                    <span>{placeLine(p)}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.starIconButton}
                    aria-label={starLabel(p.starPosition !== null)}
                    aria-pressed={p.starPosition !== null}
                    disabled={blocked || (p.starPosition === null && full)}
                    onClick={() => confirm(p, "star")}
                  >
                    <StarMark filled={p.starPosition !== null} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tab === "starred" && list.length ? <p className={styles.notice}>별표를 빼도 라이딩 스팟·식당 목록에는 그대로 남아 있어요.</p> : null}
          {saved.places.length >= 1000 ? (
            <p role="status">
              저장 한도에 도달했어요. 기존 장소를 정리한 뒤 등록해 주세요.
            </p>
          ) : null}
        </section>
      </div>
      <footer className={styles.registerFooter}>
        <button ref={addButton} aria-label="＋ 장소 등록" className="primary-button" type="button" disabled={blocked || saved.places.length >= 1000} onClick={() => setForm({ place: null })}><LineIcon name="plus" /> 장소 등록</button>
      </footer>
      {saved.message && saved.status === "ready" && !saved.failureTitle ? (
        <p role="status" aria-live="polite">
          {saved.message}
        </p>
      ) : !selected ? failure : null}
      {clusterIds ? (
        <SavedDialog title={`이 위치의 장소 ${clusterPlaces.length}곳`} onClose={() => setClusterIds(null)}>
          <ul className={styles.list}>
            {clusterPlaces.map((p) => (
              <li key={p.id} className={styles.placeCard}>
                <button type="button" aria-label={`${savedPlaceName(p)} 상세 보기`} onClick={() => { setClusterIds(null); selectPlace(p.id); }}>
                  <span className={styles.placeKind}>{kindLabel(p.kind)} · {p.province ?? "지역 미확인"}{p.starPosition !== null ? " · 자주 찾는 장소" : ""}</span>
                  <strong>{savedPlaceName(p)}</strong>
                  <span>{placeLine(p)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.helper}>최대로 확대해도 겹치는 장소예요. 하나를 고르면 상세를 열어요.</p>
        </SavedDialog>
      ) : null}
      {selected && !wide ? (
        <SavedDialog title="장소 상세" onBack={() => selectPlace(null)} onClose={() => selectPlace(null)} fullScreen>
          <div className={styles.waypointBody}>
          <div className={`${styles.placeSummary} ${styles.detailSummary}`}>
            <span className={styles.placeKind}>{kindLabel(selected.kind)} · {selected.province ?? "지역 미확인"}</span>
            <strong>{savedPlaceName(selected)}</strong>
            <span>{placeLine(selected)}</span>
            <span className={styles.summaryStar} role="img" aria-label={selected.starPosition !== null ? "자주 찾는 장소" : "별표 없음"}><StarMark filled={selected.starPosition !== null} /></span>
          </div>
          <div className={styles.detailMap}><KakaoMapCanvas points={[]} allowEmptyMap savedPins={[{ id: selected.id, label: savedPlaceName(selected), kind: selected.kind, starred: selected.starPosition !== null, latitude: selected.place.latitude, longitude: selected.place.longitude }]} selectedSavedPinId={selected.id} showLegend={false} /></div>
          {failure}
          <StarButton place={selected} full={full} count={starredCount} disabled={blocked} onClick={() => confirm(selected, "star")} />
          {selected.starPosition === null && full ? (
            <>
              <p className={styles.helper}>자주 찾는 장소 {FREQUENT_PLACE_LIMIT}곳이 모두 찼어요. 다른 장소의 별표를 빼면 추가할 수 있어요.</p>
              <button type="button" className={styles.textButton} onClick={manageStars}>자주 찾는 장소 관리</button>
            </>
          ) : null}
          <div className={styles.actions}><button
            type="button"
            disabled={blocked}
            onClick={() =>
              setForm({ place: selected.place, existing: selected })
            }
          >
            별명·분류 수정
          </button>
          <button
            type="button"
            className="danger-text"
            disabled={blocked}
            onClick={() => confirm(selected, "delete")}
          >
            장소 삭제
          </button>
          </div>
          <p className={styles.notice}>장소를 추가하면 방문 순서에 바로 반영돼요. 경로와 날씨는 직접 다시 계산해 주세요.</p>
          </div>
          <div className={styles.waypointFooter}><button className="primary-button" type="button" disabled={blocked || disabled} onClick={() => setAdding(selected)}>경유지에 추가</button></div>
        </SavedDialog>
      ) : null}
      {adding ? (
        <SavedWaypointForm
          place={adding}
          initial={initialWaypoint}
          disabled={blocked || disabled}
          onClose={() => setAdding(null)}
          onAdd={(role, dwell) => {
            if (blocked || disabled || !saved.places.some((p) => p.id === adding.id && p.revision === adding.revision)) return "장소가 변경되었습니다. 목록에서 다시 선택해 주세요.";
            const failure = onAddWaypoint(adding.place, role, dwell);
            if (!failure) {
              setAdding(null);
              selectPlace(null);
            }
            return failure;
          }}
        />
      ) : null}
      <MapPointConfirmation
        pickerRef={picker}
        purpose="saved-place"
        onSelect={(place) => setForm({ place })}
      />
      {form ? (
        <SavedPlaceRegistration
          initialPlace={form.place}
          existing={form.existing}
          stars={starredCount}
          blocked={blocked}
          startView={startView}
          onClose={() => {
            setForm(null);
            addButton.current?.focus();
          }}
          onSave={(place, alias, kind, starred) => {
            const existing = form.existing;
            setPending({
              title: existing
                ? "장소 정보를 수정할까요?"
                : "이 장소를 저장할까요?",
              name: alias.trim() || place.name,
              description: `${kindLabel(kind)}으로 ${existing ? "수정" : "저장"}해요. ${existing ? "기존 별표 설정은 유지돼요." : starred ? "자주 찾는 장소에 별표를 표시해요." : "별표 없이 저장해요."}`,
              placeSummary: { kind: kindLabel(kind), originalName: place.name, address: isRegionOnlyPlace(place) ? `${place.address} · 상세 주소 없음` : place.roadAddress ?? place.address, starred: existing ? existing.starPosition !== null : starred },
              action: existing ? "확인하고 수정" : "확인하고 저장",
              fullScreen: true,
              valid: saved.captureSnapshot(),
              run: async () => {
                const ok = await (existing
                  ? saved.edit(existing, alias, kind)
                  : saved.save(place, alias, kind, starred));
                if (ok) {
                  setForm(null);
                  if (!existing) setSavedSelection(place.kakaoPlaceId);
                }
                return ok;
              },
            });
          }}
        />
      ) : null}
      {pending ? (
        <SavedConfirmation
          pending={pending}
          busy={saved.busy}
          onClose={() => setPending(null)}
        />
      ) : null}
    </section>
  );
}

function StarButton({ place, full, count, disabled, onClick }: {
  place: SavedPlaceEntry;
  full: boolean;
  count: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const starred = place.starPosition !== null;
  return (
    <button
      type="button"
      className={styles.starToggle}
      aria-label={starLabel(starred)}
      aria-pressed={starred}
      disabled={disabled || (!starred && full)}
      onClick={onClick}
    >
      <StarMark filled={starred} />
      {starred ? "자주 찾는 장소에서 빼기" : `자주 찾는 장소에 추가 · ${count} / ${FREQUENT_PLACE_LIMIT}${full ? " 가득 참" : ""}`}
    </button>
  );
}

function SavedWaypointForm({
  place,
  initial,
  disabled,
  onClose,
  onAdd,
}: {
  place: SavedPlaceEntry;
  initial?: { role: WaypointRole; dwellMinutes: number };
  disabled: boolean;
  onClose: () => void;
  onAdd: (role: WaypointRole, dwell: number) => string | null;
}) {
  const [role, setRole] = useState<WaypointRole>(initial?.role ?? "waypoint");
  const [dwell, setDwell] = useState(initial ? dwellForRole(initial.role, initial.dwellMinutes) : 0);
  const [error, setError] = useState("");
  return (
    <SavedDialog title="즐겨찾기" accessibleTitle="경유지 추가 확인" onClose={onClose} fullScreen>
      <div className={styles.waypointBody}>
      <h3>어떻게 들를까요?</h3>
      <div className={styles.placeSummary}>
        <span className={styles.placeKind}>{kindLabel(place.kind)}{place.starPosition !== null ? <span aria-label="자주 찾는 장소"><StarMark filled /></span> : null}</span>
        <strong>{savedPlaceName(place)}</strong>
        <span>{place.place.name} · {place.province ?? "지역 미확인"}</span>
      </div>
      <fieldset className={styles.roleField}>
        <legend>방문 종류</legend>
        <div className={styles.roleButtons}>
          {waypointRoleOptions.map((option) => <button type="button" key={option.value} aria-pressed={role === option.value} onClick={() => { if (role !== option.value) setDwell(defaultDwellMinutes(option.value)); setRole(option.value); setError(""); }}>{option.value === "waypoint" ? "통과" : option.label}</button>)}
        </div>
      </fieldset>
      {isMealRole(role) ? (
        <p className={styles.helper}>{MEAL_DWELL_NOTE}</p>
      ) : role === "rest" ? (
        <div className={styles.dwellControl}>
          <label htmlFor="saved-waypoint-dwell">머무는 시간</label>
          <button type="button" aria-label="머무는 시간 10분 줄이기" disabled={dwell <= 1} onClick={() => setDwell(value => Math.max(1, value - 10))}><LineIcon name="minus" /></button>
          <span><input
            id="saved-waypoint-dwell"
            aria-label="정차 시간 (분)"
            type="number"
            min={1}
            max={1440}
            value={dwell}
            onChange={(e) => setDwell(Number(e.target.value))}
          />분</span>
          <button type="button" aria-label="머무는 시간 10분 늘리기" disabled={dwell >= 1440} onClick={() => setDwell(value => Math.min(1440, value + 10))}><LineIcon name="plus" /></button>
        </div>
      ) : (
        <p>정차 없이 통과해요.</p>
      )}
      <p className={styles.notice}>도착 직전에 추가해요. 추가한 뒤 방문 순서를 바꿀 수 있어요.</p>
      <p className={styles.helper}>경로와 날씨는 경로 다시 계산을 눌러 갱신해요.</p>
      {error ? <p role="alert">{error}</p> : null}
      </div>
      <div className={styles.waypointFooter}>
        <button
          className="primary-button"
          type="button"
          disabled={disabled}
          onClick={() => {
            const value = dwellForRole(role, dwell);
            const invalid = dwellError(role, value);
            if (invalid) {
              setError(invalid);
              return;
            }
            setError(onAdd(role, value) ?? "");
          }}
        >
          경유지 추가하기
        </button>
      </div>
    </SavedDialog>
  );
}

function SavedConfirmation({
  pending,
  busy,
  onClose,
}: {
  pending: Pending;
  busy: boolean;
  onClose: () => void;
}) {
  const started = useRef(false);
  const mounted = useRef(false);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const valid = pending.valid();
  async function confirm() {
    if (started.current || busy || !pending.valid()) return;
    started.current = true;
    setRunning(true);
    try {
      const ok = await pending.run();
      if (mounted.current) {
        if (ok) onClose();
        else setFailed(true);
      }
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setRunning(false);
    }
  }
  return (
    <SavedDialog title={pending.fullScreen ? "즐겨찾기" : pending.title} accessibleTitle={pending.title} locked={running} onClose={onClose} fullScreen={pending.fullScreen}>
      <div className={pending.fullScreen ? styles.waypointBody : undefined}>
      {pending.fullScreen ? <h3>{pending.title}</h3> : null}
      <div className={styles.placeSummary}>
        {pending.placeSummary ? <span className={styles.placeKind}>{pending.placeSummary.kind}<span aria-label={pending.placeSummary.starred ? "별표 있음" : "별표 없음"}><StarMark filled={pending.placeSummary.starred} /></span></span> : null}
        <strong>{pending.name}</strong>
        {pending.placeSummary ? <span>원래 장소명 {pending.placeSummary.originalName} · {pending.placeSummary.address}</span> : <p>{pending.description}</p>}
      </div>
      {pending.placeSummary ? <><p>{pending.description}</p><p>원래 장소명과 위치는 유지됩니다.</p></> : null}
      {!valid && !running ? (
        <p role="alert">
          목록이나 계정이 바뀌었어요. 닫고 최신 장소를 다시 선택해 주세요.
        </p>
      ) : null}
      {failed ? (
        <p role="alert">
          변경을 확인하지 못했어요. 창을 닫고 목록 상태를 확인해 주세요.
        </p>
      ) : null}
      </div>
      <div className={pending.fullScreen ? `${styles.waypointFooter} ${styles.confirmFooter}` : styles.actions}>
        <button
          type="button"
          className={pending.destructive ? styles.danger : "primary-button"}
          disabled={busy || running || !valid || failed}
          onClick={() => void confirm()}
        >
          {running ? "처리 중" : pending.action}
        </button>
        <button type="button" disabled={running} onClick={onClose}>
          취소
        </button>
      </div>
    </SavedDialog>
  );
}
