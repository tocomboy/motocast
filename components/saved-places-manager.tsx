"use client";

import { LineIcon, StarMark } from "@/components/line-icon";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { KakaoMapCanvas, type MapDisplayState, type MapPoint } from "./kakao-map-canvas";
import {
  MapPointConfirmation,
  type MapPlacePickerHandle,
} from "./map-point-confirmation";
import { SavedDialog } from "./saved-dialog";
import { SavedPlaceRegistration } from "./saved-place-registration";
import { useSavedPlaces, type SavedPlaceWrite } from "./saved-places-provider";
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

/** Centered confirmation popup content (Figma FP29, FP29b, FP34–FP37, memo 392:10916). */
type Pending = {
  key: number;
  title: string;
  card: { eyebrow?: string; region?: boolean; name?: string; line: string; line2?: string };
  rows?: Array<{ label: string; value: string; count?: string }>;
  /** FP38: only the changed values, as before → after. */
  changes?: Array<{ label: string; before: string; after: string }>;
  count?: { label: string; value: string };
  note?: string;
  /** Confirm action that sends one request; absent for information-only popups. */
  confirm?: {
    label: string;
    busyLabel: string;
    danger?: boolean;
    /** FP39a title while an unknown result is checked, e.g. "저장됐는지 확인하고 있어요". */
    checking: string;
    /** FP39b text when the re-read list does not show the change. */
    notApplied: { title: string; message: string };
    run: () => Promise<SavedPlaceWrite>;
  };
  /** Information-only popups (FP36, duplicate save) replace confirm/cancel with these buttons. */
  buttons?: Array<{ label: string; primary?: boolean; onClick: () => void }>;
  error?: { title: string; message: string };
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
  // FP31: a tapped pin first shows a preview card under the map; the card opens the detail.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pressedPoint, setPressedPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [clustersVisible, setClustersVisible] = useState(false);
  const [mapStatus, setMapStatus] = useState<MapDisplayState>("loading");
  const [mapHelpOpen, setMapHelpOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const popupKey = useRef(0);
  // Retries use the newest revision from the re-read list, never the one captured at open.
  const placesRef = useRef(saved.places);
  useEffect(() => { placesRef.current = saved.places; }, [saved.places]);
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
  const preview = selected ? undefined : saved.places.find((p) => p.id === previewId);
  function selectPlace(id: string | null) { setSavedSelection(null); setSelectedId(id); }
  const blocked = saved.busy || saved.status !== "ready";
  const inRegion = useMemo(
    () =>
      saved.places.filter(
        (p) =>
          !province ||
          (province === "unknown" ? p.province === null : p.province === province),
      ),
    [saved.places, province],
  );
  // The saved-place search narrows only the list and its count; map pins follow region and layers.
  const filtered = useMemo(
    () =>
      inRegion.filter(
        (p) =>
          !query.trim() ||
          `${savedPlaceName(p)} ${p.place.name} ${p.place.address}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
      ),
    [inRegion, query],
  );
  const starredCount = saved.favorites.length;
  const full = starredCount >= FREQUENT_PLACE_LIMIT;
  const list = filtered
    .filter((p) => (tab === "starred" ? p.starPosition !== null : p.kind === tab))
    .sort((a, b) => (tab === "starred" ? a.starPosition! - b.starPosition! : 0));
  // Map pins = region + layer toggles (FP01); list tabs and search never change them.
  // Only the visible layers reach the map, so cluster counts match what is shown.
  const pins = inRegion
    .filter((p) => (p.kind === "restaurant" ? restaurants : spots))
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

  const latest = (id: string) => placesRef.current.find((row) => row.id === id);
  const placeCard = (p: SavedPlaceEntry, withProvince = true) => ({
    eyebrow: withProvince ? `${kindLabel(p.kind)} · ${p.province ?? "지역 미확인"}` : kindLabel(p.kind),
    region: false,
    name: savedPlaceName(p),
    line: p.alias ? `원래 이름 · ${p.place.name}` : placeLine(p),
  });
  const notFound: SavedPlaceWrite = { ok: false, reason: "rejected", title: "장소를 찾지 못했어요", message: "다른 곳에서 삭제됐을 수 있어요. 최신 목록을 확인해 주세요." };
  function open(next: Omit<Pending, "key">) { setPending({ ...next, key: ++popupKey.current }); }

  function confirm(p: SavedPlaceEntry, action: "star" | "delete") {
    const starred = p.starPosition === null;
    if (action === "star" && starred && full) {
      // FP36: a full list explains itself without sending anything.
      open({
        title: `자주 찾는 장소 ${FREQUENT_PLACE_LIMIT}곳이 모두 찼어요`,
        card: { ...placeCard(p), line: placeLine(p) },
        note: "다른 장소의 별표를 빼면 이 장소를 추가할 수 있어요. 아무것도 바뀌지 않았어요.",
        buttons: [
          { label: "닫기", primary: true, onClick: () => setPending(null) },
          { label: "자주 찾는 장소 관리", onClick: () => { setPending(null); manageStars(); } },
        ],
      });
      return;
    }
    if (action === "delete") {
      open({
        title: "이 장소를 삭제할까요?",
        card: placeCard(p),
        count: p.starPosition !== null ? { label: "자주 찾는 장소에서도 빠져요", value: `${starredCount} → ${starredCount - 1} / ${FREQUENT_PLACE_LIMIT}` } : undefined,
        note: `내 ${kindLabel(p.kind)}에서 삭제해요. 이미 만든 일정·코스·공유 결과는 그대로예요. 되돌릴 수 없어요.`,
        confirm: {
          label: "장소 삭제",
          busyLabel: "삭제하는 중…",
          danger: true,
          checking: "삭제됐는지 확인하고 있어요",
          notApplied: { title: "삭제되지 않았어요", message: "목록을 다시 확인했지만 장소가 그대로 있어요. 다시 삭제하려면 \"장소 삭제\"를 눌러 주세요." },
          run: async () => {
            const current = latest(p.id);
            if (!current) return { ok: true };
            const write = await saved.deletePlace(current);
            if (write.ok) selectPlace(null);
            return write;
          },
        },
      });
      return;
    }
    open({
      title: starred ? "자주 찾는 장소에 추가할까요?" : "자주 찾는 장소에서 뺄까요?",
      card: { ...placeCard(p), line: placeLine(p) },
      count: { label: "자주 찾는 장소", value: `${starredCount} → ${starredCount + (starred ? 1 : -1)} / ${FREQUENT_PLACE_LIMIT}` },
      note: starred ? undefined : `별표만 빼요. ${kindLabel(p.kind)} 목록에는 그대로 남아 있어요.`,
      confirm: {
        label: starred ? "추가" : "별표 빼기",
        busyLabel: starred ? "추가하는 중…" : "빼는 중…",
        checking: starred ? "추가됐는지 확인하고 있어요" : "별표를 뺐는지 확인하고 있어요",
        notApplied: starred
          ? { title: "추가되지 않았어요", message: "목록을 다시 확인했지만 별표가 없어요. 다시 추가하려면 \"추가\"를 눌러 주세요." }
          : { title: "별표가 그대로예요", message: "목록을 다시 확인했지만 별표가 남아 있어요. 다시 빼려면 \"별표 빼기\"를 눌러 주세요." },
        run: async () => {
          const current = latest(p.id);
          if (!current) return notFound;
          if ((current.starPosition !== null) === starred) return { ok: true };
          const write = await saved.star(current, starred);
          // FP03: an 11th star closes the popup and the detail shows the refusal.
          if (!write.ok && write.reason === "star_limit") setPending(null);
          return write;
        },
      },
    });
  }

  function confirmSave(place: PlaceSearchResult, alias: string, kind: SavedPlaceKind, starred: boolean, existing?: SavedPlaceEntry, retryNote?: string) {
    const region = isRegionOnlyPlace(place);
    const name = alias.trim();
    const rows = [
      { label: "별명", value: name || "없음 · 원래 이름으로 표시" },
      { label: "분류", value: kindLabel(kind) },
      ...(region ? [{ label: "주소", value: `상세 주소 없음 · ${place.address}` }] : []),
      ...(existing ? [] : [starred
        ? { label: "자주 찾는 장소", value: "추가", count: `${starredCount} → ${starredCount + 1} / ${FREQUENT_PLACE_LIMIT}` }
        : { label: "자주 찾는 장소", value: full ? `추가 안 함 · ${starredCount} / ${FREQUENT_PLACE_LIMIT} 가득 참` : "추가 안 함" }]),
    ];
    const changes = existing ? [
      ...((existing.alias ?? "") !== name ? [{ label: "별명", before: existing.alias ?? `${place.name} (없음)`, after: name || `${place.name} (없음)` }] : []),
      ...(existing.kind !== kind ? [{ label: "분류", before: kindLabel(existing.kind), after: kindLabel(kind) }] : []),
    ] : undefined;
    open({
      title: existing ? "별명과 분류를 수정할까요?" : "이 장소를 저장할까요?",
      card: existing
        ? { line: `원래 이름 · ${place.name}`, line2: region ? `상세 주소 없음 · ${place.address}` : place.roadAddress ?? place.address }
        : { eyebrow: kindLabel(kind), region, name: name || place.name, line: name ? `원래 이름 · ${place.name}` : place.roadAddress ?? place.address },
      rows: existing ? undefined : rows,
      changes,
      note: retryNote ?? (existing ? "바뀐 값만 보여요. 원래 이름·위치와 자주 찾는 장소 별표는 그대로예요." : !starred && full ? "자주 찾는 장소가 가득 차 별표 없이 저장해요." : "원래 위치는 그대로 저장돼요."),
      confirm: {
        label: existing ? "확인하고 수정" : "확인하고 저장",
        busyLabel: existing ? "수정하는 중…" : "저장하는 중…",
        checking: existing ? "수정됐는지 확인하고 있어요" : "저장됐는지 확인하고 있어요",
        notApplied: existing
          ? { title: "수정되지 않았어요", message: "목록을 다시 확인했지만 바뀐 내용이 없어요. 입력 내용은 그대로예요. 다시 수정하려면 \"확인하고 수정\"을 눌러 주세요." }
          : { title: "저장되지 않았어요", message: "목록을 다시 확인했지만 이 장소가 없어요. 입력 내용은 그대로예요. 다시 저장하려면 \"확인하고 저장\"을 눌러 주세요." },
        run: async () => {
          if (existing) {
            const current = latest(existing.id);
            if (!current) return notFound;
            const write = await saved.edit(current, alias, kind);
            if (write.ok) setForm(null);
            return write;
          }
          const write = await saved.save(place, alias, kind, starred);
          if (write.ok && write.duplicate) {
            // The server returns the place saved before without changing it.
            open({
              title: "이미 저장한 장소예요",
              card: { eyebrow: kindLabel(kind), region, name: place.name, line: place.roadAddress ?? place.address },
              note: "같은 장소가 이미 내 장소에 있어요. 기존 정보는 바뀌지 않았어요.",
              buttons: [
                { label: "기존 장소 열기", primary: true, onClick: () => { setPending(null); setForm(null); selectPlace(write.id ?? null); } },
                { label: "닫기", onClick: () => setPending(null) },
              ],
            });
            return { ok: false, reason: "blocked", title: "", message: "" };
          }
          if (write.ok) {
            setForm(null);
            setSavedSelection(place.kakaoPlaceId);
          } else if (write.reason === "star_limit") {
            // Another device filled the stars first: confirm saving without a star (FP29b).
            confirmSave(place, alias, kind, false, undefined, "자주 찾는 장소가 가득 차 별표 없이 저장할지 다시 확인해 주세요. 목록을 새로 불러왔어요.");
            return { ok: false, reason: "blocked", title: "", message: "" };
          }
          return write;
        },
      },
    });
  }

  const provinceLabel = !province ? "전국" : province === "unknown" ? "지역 미확인" : province;
  const regionSelect = (variant: "large" | "compact") => (
    <label className={variant === "large" ? styles.regionLarge : styles.regionCompact}>
      <span aria-hidden="true">
        <b>{provinceLabel}</b>
        {variant === "large" ? <small>· 저장한 장소</small> : null}
        <LineIcon name="chevron-down" />
      </span>
      <select aria-label="시·도" value={province} onChange={(e) => setProvince(e.target.value)}>
        <option value="">전국</option>
        {PROVINCES.map((p) => (
          <option key={p}>{p}</option>
        ))}
        <option value="unknown">지역 미확인</option>
      </select>
    </label>
  );
  const layerToggle = (label: string, checked: boolean, onChange: (value: boolean) => void) => (
    <label className={styles.layerToggle}>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {checked ? <LineIcon name="check" /> : null}
      <span aria-hidden="true">{checked ? label : `${label} 숨김`}</span>
    </label>
  );

  return (
    <section className={styles.page} aria-labelledby="saved-places-title">
      <header className={styles.heading}>
        <button type="button" className={`${styles.iconButton} ${styles.desktopOnly}`} aria-label="뒤로" onClick={onBack}>
          <LineIcon name="chevron-left" />
        </button>
        <h1 id="saved-places-title" data-view-title="favorites" tabIndex={-1}>
          즐겨찾기
        </h1>
        <button type="button" className={`${styles.iconButton} ${styles.mobileOnly}`} aria-label="즐겨찾기 닫기" onClick={onBack}>
          <LineIcon name="close" />
        </button>
        <button type="button" className={`primary-button ${styles.desktopOnly}`} disabled={blocked || saved.places.length >= 1000} onClick={() => setForm({ place: null })}>장소 등록하기</button>
      </header>
      <div className={`${styles.mobileRegion} ${styles.mobileOnly}`}>{regionSelect("large")}</div>
      <div className={styles.columns}>
        <div className={styles.mapColumn}>
          <div className={styles.layers} role="group" aria-label="지도 핀 표시">
            {layerToggle("라이딩 스팟", spots, setSpots)}
            {layerToggle("식당", restaurants, setRestaurants)}
          </div>
          {/* FP41: a failed map keeps its place with an error card; lists and search stay usable. */}
          {mapStatus === "error" ? (
            <div className={styles.mapFailure} role="alert">
              <strong>지도를 불러오지 못했어요</strong>
              <p>목록과 검색은 그대로 쓸 수 있어요.</p>
              <button type="button" className={styles.secondaryButton} aria-expanded={mapHelpOpen} onClick={() => setMapHelpOpen((open) => !open)}>지도 도움말·다시 불러오기</button>
              {mapHelpOpen ? (
                <div className={styles.mapHelpPanel}>
                  <p className={styles.helper}>S 원형은 라이딩 스팟, 식 사각형은 식당이고 노란 별 배지는 자주 찾는 장소예요. 숫자 원은 그 자리에 묶인 장소 수예요. 지도를 길게 누르거나 전체화면에서 가운데 표시로 장소를 등록할 수 있어요.</p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      // Retry only an explicitly failed loader. Keep the draft and healthy SDK.
                      const script = document.querySelector<HTMLScriptElement>("script[data-motocast-kakao-map]");
                      if (script?.dataset.motocastKakaoMapStatus === "error" && !window.kakao?.maps) script.remove();
                      setMapHelpOpen(false);
                      setMapStatus("loading");
                      setMapAttempt((n) => n + 1);
                    }}
                  >
                    지도 다시 불러오기
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className={styles.map} hidden={mapStatus === "error"}>
            <KakaoMapCanvas
              key={mapAttempt}
              points={routePoints}
              path={routePath}
              allowEmptyMap
              savedPins={pins}
              savedViewportKey={province}
              onSelectSavedPin={(id) => (wide ? selectPlace(id) : setPreviewId(id))}
              selectedSavedPinId={selected?.id ?? preview?.id ?? null}
              onSelectSavedCluster={setClusterIds}
              showLegend={false}
              onSelectCoordinate={
                !blocked && saved.places.length < 1000
                  ? (point) => picker.current?.open(point)
                  : undefined
              }
              coordinateActionLabel="이 지점 등록"
              coordinateActionInFullscreenOnly
              markerPoint={pressedPoint}
              onClustersChange={setClustersVisible}
              fullscreenTitle="저장 장소 지도"
              fullscreenControls={<div className={styles.layers} role="group" aria-label="전체화면 지도 핀 표시">{layerToggle("라이딩 스팟", spots, setSpots)}{layerToggle("식당", restaurants, setRestaurants)}</div>}
              onStatusChange={setMapStatus}
            />
          </div>
          {clustersVisible && (spots || restaurants) && !(preview && !wide) ? <p className={styles.helper}>숫자는 그 자리에 묶인 장소 수예요. 누르면 확대돼요. 별 배지는 자주 찾는 장소가 포함된 묶음이에요.</p> : null}
          {!spots && !restaurants ? <p className={styles.notice} role="status">저장 장소 핀을 모두 숨겼어요. 현재 일정의 지점과 지도는 유지돼요.</p> : null}
          {preview && !wide ? (
            <div className={styles.previewCard}>
              <button type="button" aria-label={`${savedPlaceName(preview)} 상세 보기`} onClick={() => { setPreviewId(null); selectPlace(preview.id); }}>
                <span className={styles.placeKind}>{kindLabel(preview.kind)} · {preview.province ?? "지역 미확인"}{preview.starPosition !== null ? " · 자주 찾는 장소" : ""}</span>
                <strong>{savedPlaceName(preview)}</strong>
                <span>{placeLine(preview)}</span>
              </button>
              <StarIconButton place={preview} disabled={blocked} onClick={() => confirm(preview, "star")} />
            </div>
          ) : null}
        </div>
        <section
          className={styles.listColumn}
          aria-label={selected && wide ? "장소 상세" : `${tab === "starred" ? "자주 찾는 장소" : kindLabel(tab)} 목록`}
        >
          {selected && wide ? (
            <div className={styles.pcDetail}>
              <div className={styles.pcDetailHeading}>
                <button type="button" className={styles.iconButton} aria-label="장소 상세 뒤로" onClick={() => selectPlace(null)}><LineIcon name="chevron-left" /></button>
                <h2>장소 상세</h2>
              </div>
              <div className={`${styles.placeSummary} ${styles.detailSummary}`}>
                <span className={styles.placeKind}>{kindLabel(selected.kind)} · {selected.province ?? "지역 미확인"}{selected.starPosition !== null ? " · 자주 찾는 장소" : ""}</span>
                <strong>{savedPlaceName(selected)}</strong>
                <span>{placeLine(selected)}</span>
                <StarIconButton place={selected} disabled={blocked} onClick={() => confirm(selected, "star")} />
              </div>
              {failure}
              <StarButton place={selected} full={full} count={starredCount} disabled={blocked} onClick={() => confirm(selected, "star")} />
              {selected.starPosition === null && full ? <p className={styles.helper}>자주 찾는 장소 {FREQUENT_PLACE_LIMIT}곳이 모두 찼어요. 다른 장소의 별표를 빼면 추가할 수 있어요.</p> : null}
              <button type="button" className={styles.secondaryButton} disabled={blocked || disabled} onClick={() => setAdding(selected)}>경유지에 추가</button>
              <button type="button" className={styles.secondaryButton} disabled={blocked} onClick={() => setForm({ place: selected.place, existing: selected })}>별명·분류 수정</button>
              <button type="button" className={styles.dangerButton} disabled={blocked} onClick={() => confirm(selected, "delete")}>장소 삭제</button>
            </div>
          ) : <>
          <nav className={styles.tabs} aria-label="저장 장소 목록">
            {([["starred", "자주 찾는 장소"], ["riding_spot", "라이딩 스팟"], ["restaurant", "식당"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
          </nav>
          <div className={styles.filters}>
            <label className={styles.searchField}>
              <LineIcon name="search" />
              <span className={styles.srOnly}>저장 장소 찾기</span>
              <input
                value={query}
                maxLength={100}
                placeholder="별명, 장소명, 주소"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className={styles.desktopOnly}>{regionSelect("compact")}</div>
          </div>
          {/* FP01/FP04: starred "7 / 10"; kind tabs "34곳 · 저장 장소 전체 46 / 1,000" (counts follow the filters). */}
          <p className={styles.listCount}>
            <strong>{tab === "starred" ? "자주 찾는 장소" : kindLabel(tab)}</strong>
            {tab === "starred" ? <b className={styles.countNumber}>{starredCount} / {FREQUENT_PLACE_LIMIT}</b> : <>
              <b className={styles.countNumber}>{list.length.toLocaleString()}</b>
              <span>곳 · 저장 장소 전체</span>
              <b className={styles.countNumber}>{saved.places.length.toLocaleString()} / 1,000</b>
            </>}
          </p>
          {tab === "starred" ? <p className={`${styles.helper} ${styles.mobileOnly}`}>라이딩 스팟과 식당을 합쳐 최대 {FREQUENT_PLACE_LIMIT}곳까지 별표할 수 있어요.</p> : null}
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
                  <StarIconButton place={p} disabled={blocked} onClick={() => confirm(p, "star")} />
                </li>
              ))}
            </ul>
          )}
          {tab === "starred" && list.length ? <p className={`${styles.notice} ${styles.mobileOnly}`}>별표를 빼도 라이딩 스팟·식당 목록에는 그대로 남아 있어요.</p> : null}
          {saved.places.length >= 1000 ? (
            <p role="status">
              저장 한도에 도달했어요. 기존 장소를 정리한 뒤 등록해 주세요.
            </p>
          ) : null}
          </>}
        </section>
      </div>
      <footer className={styles.registerFooter}>
        <button ref={addButton} aria-label="＋ 장소 등록" className="primary-button" type="button" disabled={blocked || saved.places.length >= 1000} onClick={() => setForm({ place: null })}>＋ 장소 등록</button>
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
                  <span className={styles.placeKind}>{kindLabel(p.kind)} · {p.province ?? "지역 미확인"}</span>
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
          <div className={`${styles.waypointBody} ${styles.detailBody}`}>
          <div className={`${styles.placeSummary} ${styles.detailSummary}`}>
            <span className={styles.placeKind}>{kindLabel(selected.kind)} · {selected.province ?? "지역 미확인"}{selected.starPosition !== null ? " · 자주 찾는 장소" : ""}</span>
            <strong>{savedPlaceName(selected)}</strong>
            <span>{placeLine(selected)}</span>
            <StarIconButton place={selected} disabled={blocked} onClick={() => confirm(selected, "star")} />
          </div>
          <div className={styles.detailMap}><KakaoMapCanvas points={[]} allowEmptyMap savedPins={[{ id: selected.id, label: savedPlaceName(selected), kind: selected.kind, starred: selected.starPosition !== null, latitude: selected.place.latitude, longitude: selected.place.longitude }]} selectedSavedPinId={selected.id} showLegend={false} allowFullscreen={false} /></div>
          {failure}
          <StarButton place={selected} full={full} count={starredCount} disabled={blocked} onClick={() => confirm(selected, "star")} />
          {selected.starPosition === null && full ? (
            <>
              <p className={styles.helper}>자주 찾는 장소 {FREQUENT_PLACE_LIMIT}곳이 모두 찼어요. 다른 장소의 별표를 빼면 추가할 수 있어요.</p>
              <button type="button" className={styles.textButton} onClick={manageStars}>자주 찾는 장소 관리</button>
            </>
          ) : null}
          <button type="button" className={styles.secondaryButton} disabled={blocked || disabled} onClick={() => setAdding(selected)}>경유지에 추가</button>
          <button type="button" className={styles.secondaryButton} disabled={blocked} onClick={() => setForm({ place: selected.place, existing: selected })}>별명·분류 수정</button>
          <button type="button" className={styles.dangerButton} disabled={blocked} onClick={() => confirm(selected, "delete")}>장소 삭제</button>
          </div>
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
        onPreview={setPressedPoint}
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
          onSave={(place, alias, kind, starred) => confirmSave(place, alias, kind, starred, form.existing)}
        />
      ) : null}
      {pending ? (
        <ConfirmPopup
          key={pending.key}
          pending={pending}
          busy={saved.busy}
          verifying={saved.verifying}
          capture={saved.captureSnapshot}
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
  if (starred)
    // FP02b: an active status button; pressing it asks before removing the star (FP35).
    return (
      <>
        <button type="button" className={styles.starSaved} aria-label="자주 찾는 장소에 저장됨, 눌러서 빼기" disabled={disabled} onClick={onClick}>
          <StarMark filled />
          <span>자주 찾는 장소에 저장됨</span>
          <b className={styles.countNumber}>· {count} / {FREQUENT_PLACE_LIMIT}</b>
        </button>
        <p className={styles.helper}>누르면 자주 찾는 장소에서 뺄지 다시 확인해요.</p>
      </>
    );
  return (
    <button
      type="button"
      className={styles.starToggle}
      aria-label={starLabel(false)}
      aria-pressed={false}
      disabled={disabled || full}
      onClick={onClick}
    >
      {`☆ 자주 찾는 장소에 추가 · ${count} / ${FREQUENT_PLACE_LIMIT}${full ? " 가득 참" : ""}`}
    </button>
  );
}

/** In a full list an empty star opens the FP36 explanation instead of being disabled. */
function StarIconButton({ place, disabled, onClick }: {
  place: SavedPlaceEntry;
  disabled: boolean;
  onClick: () => void;
}) {
  const starred = place.starPosition !== null;
  return (
    <button
      type="button"
      className={styles.starIconButton}
      aria-label={starLabel(starred)}
      aria-pressed={starred}
      disabled={disabled}
      onClick={onClick}
    >
      <StarMark filled={starred} />
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

function ConfirmPopup({
  pending,
  busy,
  verifying,
  capture,
  onClose,
}: {
  pending: Pending;
  busy: boolean;
  verifying: boolean;
  capture: () => () => boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const started = useRef(false);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(() => capture());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; retry?: boolean } | null>(pending.error ?? null);
  useEffect(() => {
    mounted.current = true;
    const focus = document.activeElement;
    ref.current?.showModal();
    return () => {
      mounted.current = false;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);
  const valid = snapshot();
  function close() { if (!running) onClose(); }
  async function confirm() {
    const action = pending.confirm;
    if (!action || started.current || busy || !snapshot()) return;
    started.current = true;
    setRunning(true);
    setError(null);
    try {
      const write = await action.run();
      if (!mounted.current) return;
      if (write.ok) onClose();
      else if (write.reason !== "blocked" || write.message) {
        // FP39b: the list was re-read without the change, so the same confirm sends one new
        // request with the newest revision. FP39c: a clear refusal can be retried right away.
        setError(write.reason === "unknown" && write.checked ? action.notApplied : { title: write.title, message: write.message, retry: write.reason !== "unknown" });
        setSnapshot(() => capture());
      }
    } catch {
      if (mounted.current) setError({ title: "변경을 확인하지 못했어요", message: "목록을 확인한 뒤 다시 시도해 주세요." });
    } finally {
      started.current = false;
      if (mounted.current) setRunning(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className={styles.popup}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); close(); }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 id={titleId}>{pending.title}</h2>
      <div className={styles.popupCard}>
        {pending.card.eyebrow ? <span className={styles.placeKind}>{pending.card.eyebrow}{pending.card.region ? <span className={styles.chip}>상세 주소 없음</span> : null}</span> : null}
        {pending.card.name ? <strong>{pending.card.name}</strong> : null}
        <span>{pending.card.line}</span>
        {pending.card.line2 ? <span>{pending.card.line2}</span> : null}
      </div>
      {pending.changes?.map((change) => (
        <div key={change.label} className={styles.popupChange}>
          <span>{change.label}</span>
          <p><del>{change.before}</del><span aria-hidden="true"> → </span><span className={styles.srOnly}>에서 </span><b>{change.after}</b></p>
        </div>
      ))}
      {pending.rows ? (
        <dl className={styles.popupRows}>
          {pending.rows.map((row) => (
            <div key={row.label}><dt>{row.label}</dt><dd>{row.value}{row.count ? <b className={styles.countNumber}>{row.count}</b> : null}</dd></div>
          ))}
        </dl>
      ) : null}
      {pending.count ? <p className={styles.popupCount}><span>{pending.count.label}</span><b className={styles.countNumber}>{pending.count.value}</b></p> : null}
      {/* FP39a–c replace the note with the checking or failure card. */}
      {pending.note && !error && !(running && verifying) ? <p className={styles.helper}>{pending.note}</p> : null}
      {!valid && !running && pending.confirm ? <p role="alert" className={styles.fieldError}>목록이나 계정이 바뀌었어요. 닫고 최신 장소를 다시 선택해 주세요.</p> : null}
      {running && verifying && pending.confirm ? (
        <div className={styles.popupChecking} role="status">
          <strong>{pending.confirm.checking}</strong>
          <p>응답을 받지 못해 목록을 다시 읽는 중이에요. 같은 요청을 다시 보내지 않아요.</p>
          <span className={styles.progress} aria-hidden="true"><span /></span>
        </div>
      ) : error ? <div className={styles.errorCard} role="alert"><strong>{error.title}</strong><p>{error.message}</p></div> : null}
      <div className={styles.popupActions}>
        {pending.confirm ? (
          <>
            <button
              type="button"
              className={pending.confirm.danger ? styles.destructiveButton : "primary-button"}
              disabled={busy || running || !valid}
              onClick={() => void confirm()}
            >
              {running ? (verifying ? "확인 중…" : pending.confirm.busyLabel) : error?.retry ? "다시 시도" : pending.confirm.label}
            </button>
            <button type="button" className={styles.secondaryButton} disabled={running} onClick={close}>취소</button>
          </>
        ) : (pending.buttons ?? []).map((button) => (
          <button key={button.label} type="button" className={button.primary ? "primary-button" : styles.secondaryButton} onClick={button.onClick}>{button.label}</button>
        ))}
      </div>
    </dialog>
  );
}
