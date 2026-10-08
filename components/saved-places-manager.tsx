"use client";

import { LineIcon, StarMark } from "@/components/line-icon";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { KakaoMapCanvas, type MapDisplayState, type MapPoint, type SavedMapPin } from "./kakao-map-canvas";
import {
  MapPointConfirmation,
  type MapPlacePickerHandle,
} from "./map-point-confirmation";
import { ConfirmPopup, type Pending as PopupContent } from "./confirm-popup";
import { SavedDialog } from "./saved-dialog";
import { SavedPlaceRegistration } from "./saved-place-registration";
import { useSavedPlaces, type SavedPlaceWrite } from "./saved-places-provider";
import { useSharedFolders } from "./shared-folders-provider";
import { avoidedFor, avoidPopup, folderNameOf, folderPickerPopup, unavoidPopup, sharedStarPopup, useSharedPopup } from "./shared-place-actions";
import { SharedPlaceDetail } from "./shared-place-detail";
import { FolderCreate, SharedFolderList } from "./shared-folder-list";
import { SharedFolderDetail } from "./shared-folder-detail";
import { AvoidedPlacesView } from "./avoided-places";
import {
  FREQUENT_PLACE_LIMIT,
  isRegionOnlyPlace,
  PROVINCES,
  savedPlaceName,
  type SavedPlaceEntry,
  type SavedPlaceKind,
} from "@/lib/places/saved";
import type { PlaceSearchResult } from "@/lib/places/search";
import { mergePlaces, sourceLabel } from "@/lib/places/place-merge";
import type { SharedPlace } from "@/lib/places/shared-folders";
import { OPEN_FOLDER_STORAGE_KEY } from "@/lib/places/folder-invite-token";
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

type Pending = PopupContent<SavedPlaceEntry[]>;
/** One row of the merged "장소" view: my place, or a shared place standing for every enabled folder that holds it. */
type Item =
  | { key: string; source: "saved"; row: SavedPlaceEntry; label: string; starred: boolean }
  | { key: string; source: "shared"; row: SharedPlace; label: string; starred: boolean };
export type Section = "places" | "folders" | "avoided";
/** A place ready for the waypoint form, from my places or a folder. */
type WaypointCandidate = { name: string; placeName: string; kind: SavedPlaceKind; province: string | null; starred: boolean; place: PlaceSearchResult; current: () => boolean };


const kindLabel = (kind: SavedPlaceKind) => (kind === "restaurant" ? "식당" : "라이딩 스팟");
/** Address line; a region-only map point says it has no detail address. */
const placeLine = (p: { alias: string | null; place: PlaceSearchResult }) =>
  isRegionOnlyPlace(p.place)
    ? `${p.place.name} · 상세 주소 없음`
    : p.alias
      ? `${p.place.name} · ${p.place.roadAddress ?? p.place.address}`
      : p.place.roadAddress ?? p.place.address;
const itemName = (item: Item) => item.row.alias ?? item.row.place.name;
const starLabel = (starred: boolean) => (starred ? "자주 찾는 장소에서 빼기" : "자주 찾는 장소에 추가");

export function SavedPlacesManager(props: SavedPlacesManagerProps) {
  const { accountEpoch } = useSavedPlaces();
  const shared = useSharedFolders();
  return <SavedPlacesManagerContent key={`${accountEpoch}:${shared.accountEpoch}`} {...props} />;
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
  /** Which of "장소 / 공유 폴더 / 기피 장소" opens first. */
  initialSection?: Section;
};

function SavedPlacesManagerContent({
  onBack,
  onAddWaypoint,
  routePoints,
  routePath,
  disabled = false,
  initialWaypoint,
  initialSection = "places",
}: SavedPlacesManagerProps) {
  const saved = useSavedPlaces();
  const shared = useSharedFolders();
  const sharedPopup = useSharedPopup();
  const [section, setSection] = useState<Section>(initialSection);
  const [openFolder, setOpenFolder] = useState<{ id: string; notice?: string } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [listNotice, setListNotice] = useState("");
  const [createUnknown, setCreateUnknown] = useState(false);
  const [tab, setTab] = useState<"starred" | SavedPlaceKind>("riding_spot");
  const [province, setProvince] = useState("");
  const [spots, setSpots] = useState(true);
  const [restaurants, setRestaurants] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sharedSelectedId, setSharedSelectedId] = useState<string | null>(null);
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
  // Runs read the provider's state at the moment they run: a list that failed to load is empty
  // but proves nothing, and a re-read list is used before the next render.
  const statusRef = { get current() { return saved.current().status; } };
  const [adding, setAdding] = useState<WaypointCandidate | null>(null);
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
  // "폴더 열기" from the invite page: read once, then forget.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = window.sessionStorage.getItem(OPEN_FOLDER_STORAGE_KEY);
      window.sessionStorage.removeItem(OPEN_FOLDER_STORAGE_KEY);
    } catch {
      id = null;
    }
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    const folderId = id;
    const task = window.setTimeout(() => { setSection("folders"); setOpenFolder({ id: folderId }); }, 0);
    return () => window.clearTimeout(task);
  }, []);
  // Entering 즐겨찾기 re-reads folders: other members' and other devices' changes appear here.
  const { refresh, enabled: sharedEnabled } = shared;
  useEffect(() => {
    if (!sharedEnabled) return;
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [refresh, sharedEnabled]);
  // A personal star change re-reads my combined star list (personal + shared).
  const { reloadStars } = shared;
  useEffect(() => { if (saved.status === "ready") void reloadStars(); }, [saved.places, saved.status, reloadStars]);
  const picker = useRef<MapPlacePickerHandle>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const snapshot = shared.snapshot;
  const sharedReady = shared.enabled && shared.status === "ready";
  const enabledFolderIds = useMemo(
    () => (sharedReady ? snapshot.preferences.filter((row) => row.enabled && snapshot.folders.some((f) => f.id === row.folderId)).map((row) => row.folderId) : []),
    [sharedReady, snapshot.preferences, snapshot.folders],
  );
  // Contract §1: my place wins; among folders the earliest (created_at, id) row stands for the rest.
  const merged = useMemo<Item[]>(() => {
    const byId = new Map(snapshot.places.map((row) => [row.id, row]));
    return mergePlaces(
      saved.places.map((row) => ({ id: row.id, kakaoPlaceId: row.place.kakaoPlaceId })),
      sharedReady ? snapshot.places.map((row) => ({ id: row.id, folderId: row.folderId, kakaoPlaceId: row.place.kakaoPlaceId, createdAt: row.createdAt })) : [],
      enabledFolderIds,
    ).flatMap((entry): Item[] => {
      const label = sourceLabel(entry, (id) => folderNameOf(snapshot, id));
      if (entry.source === "saved") {
        const row = saved.places.find((p) => p.id === entry.id)!;
        return [{ key: row.id, source: "saved", row, label, starred: row.starPosition !== null }];
      }
      const row = byId.get(entry.id)!;
      return [{ key: `shared:${row.id}`, source: "shared", row, label, starred: row.starred }];
    });
  }, [saved.places, snapshot, sharedReady, enabledFolderIds]);
  // Frequent places ignore folder toggles: every star, ordered by when it was starred.
  const starredItems = useMemo<Item[]>(() => {
    if (!sharedReady) return saved.places.filter((p) => p.starPosition !== null).sort((a, b) => a.starPosition! - b.starPosition!).map((row) => ({ key: row.id, source: "saved", row, label: "내 장소", starred: true }));
    return snapshot.stars.flatMap((star): Item[] => {
      if (star.source === "saved") {
        const row = saved.places.find((p) => p.id === star.id);
        return row ? [{ key: row.id, source: "saved", row, label: "내 장소", starred: true }] : [];
      }
      const row = snapshot.places.find((p) => p.id === star.id);
      return row ? [{ key: `shared:${row.id}`, source: "shared", row, label: `공유 · ${folderNameOf(snapshot, row.folderId)}`, starred: true }] : [];
    });
  }, [sharedReady, saved.places, snapshot]);
  const selected = saved.places.find((p) => savedSelection ? p.place.kakaoPlaceId === savedSelection : p.id === selectedId);
  const sharedSelected = sharedSelectedId ? snapshot.places.find((p) => p.id === sharedSelectedId) : undefined;
  const preview = selected || sharedSelected ? undefined : merged.find((item) => item.key === previewId);
  function selectPlace(id: string | null) { setSavedSelection(null); setSharedSelectedId(null); setSelectedId(id); }
  function selectItem(item: Item) { if (item.source === "saved") selectPlace(item.row.id); else { selectPlace(null); setSharedSelectedId(item.row.id); } }
  const blocked = saved.busy || saved.status !== "ready";
  const inRegion = useMemo(
    () =>
      merged.filter(
        (p) =>
          !province ||
          (province === "unknown" ? p.row.province === null : p.row.province === province),
      ),
    [merged, province],
  );
  const matchesQuery = (p: Item) =>
    !query.trim() ||
    `${itemName(p)} ${p.row.place.name} ${p.row.place.address}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  // The saved-place search narrows only the list and its count; map pins follow region and layers.
  const starredCount = sharedReady ? snapshot.stars.length : saved.favorites.length;
  const full = starredCount >= FREQUENT_PLACE_LIMIT;
  const list = tab === "starred"
    ? starredItems.filter((p) => (!province || (province === "unknown" ? p.row.province === null : p.row.province === province)) && matchesQuery(p))
    : inRegion.filter((p) => p.row.kind === tab && matchesQuery(p));
  const sharedInList = tab === "starred" ? 0 : list.filter((p) => p.source === "shared").length;
  const avoidedOf = (place: PlaceSearchResult) => (sharedReady ? avoidedFor(snapshot.avoided, place) : undefined);
  // Map pins = region + layer toggles (FP01); list tabs and search never change them. Avoided
  // places are always drawn on their own (AV05) and a matching place uses the avoided pin.
  const pins = useMemo<SavedMapPin[]>(() => {
    const matched = new Set<string>();
    const regular = inRegion.flatMap((p): SavedMapPin[] => {
      const avoided = sharedReady ? avoidedFor(snapshot.avoided, p.row.place) : undefined;
      if (avoided) matched.add(avoided.id);
      if (!avoided && !(p.row.kind === "restaurant" ? restaurants : spots)) return [];
      return [{ id: p.key, label: itemName(p), kind: p.row.kind, starred: p.starred, avoided: Boolean(avoided), latitude: p.row.place.latitude, longitude: p.row.place.longitude }];
    });
    const avoidedOnly = sharedReady
      ? snapshot.avoided.filter((row) => !matched.has(row.id)).map((row): SavedMapPin => ({ id: `avoid:${row.id}`, label: row.place.name, kind: "restaurant", avoided: true, latitude: row.place.latitude, longitude: row.place.longitude }))
      : [];
    return [...regular, ...avoidedOnly];
  }, [inRegion, sharedReady, snapshot.avoided, spots, restaurants]);
  const clusterPlaces = clusterIds ? merged.filter((p) => clusterIds.includes(p.key)) : [];
  const failure = saved.failureTitle && saved.status === "ready" ? (
    <div className={styles.errorCard} role="alert"><strong>{saved.failureTitle}</strong><p>{saved.message}</p></div>
  ) : null;
  const startView = selected?.place ?? routePoints[0] ?? saved.places[0]?.place ?? { latitude: 37.5665, longitude: 126.978 };
  function manageStars() { selectPlace(null); setSection("places"); setTab("starred"); setProvince(""); setQuery(""); }
  function selectPin(id: string) {
    if (id.startsWith("avoid:")) return;
    const item = merged.find((p) => p.key === id);
    if (!item) return;
    if (wide) selectItem(item);
    else setPreviewId(id);
  }

  const latest = (id: string) => saved.current().places.find((row) => row.id === id);
  const placeCard = (p: SavedPlaceEntry, withProvince = true) => ({
    eyebrow: withProvince ? `${kindLabel(p.kind)} · ${p.province ?? "지역 미확인"}` : kindLabel(p.kind),
    region: false,
    name: savedPlaceName(p),
    line: p.alias ? `원래 이름 · ${p.place.name}` : placeLine(p),
  });
  const notFound: SavedPlaceWrite = { ok: false, reason: "rejected", title: "장소를 찾지 못했어요", message: "다른 곳에서 삭제됐을 수 있어요. 최신 목록을 확인해 주세요." };
  const unreadable: SavedPlaceWrite = { ok: false, reason: "blocked", title: "목록을 확인하지 못했어요", message: "목록을 다시 불러온 뒤에 시도할 수 있어요." };
  /** Popup replaced by another one; the old popup shows nothing. */
  const replaced: SavedPlaceWrite = { ok: false, reason: "blocked", title: "", message: "" };
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
            if (statusRef.current !== "ready") return unreadable;
            const current = latest(p.id);
            // Absent from a list that did load: already deleted.
            if (!current) return { ok: true };
            const write = await saved.deletePlace(current);
            if (write.ok) selectPlace(null);
            return write;
          },
          onApplied: () => selectPlace(null),
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
          if (statusRef.current !== "ready") return unreadable;
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
  function confirmItemStar(item: Item) {
    if (item.source === "saved") confirm(item.row, "star");
    else sharedPopup.open(sharedStarPopup(shared, item.row, () => { sharedPopup.close(); manageStars(); }));
  }

  /** FP38. `edits` holds only the fields the rider changed; the others always follow the newest row. */
  function confirmEdit(base: SavedPlaceEntry, edits: { alias?: string; kind?: SavedPlaceKind }, retryNote?: string) {
    const alias = edits.alias ?? base.alias ?? "";
    const kind = edits.kind ?? base.kind;
    const place = base.place;
    const region = isRegionOnlyPlace(place);
    const changes = [
      ...((base.alias ?? "") !== alias ? [{ label: "별명", before: base.alias ?? `${place.name} (없음)`, after: alias || `${place.name} (없음)` }] : []),
      ...(base.kind !== kind ? [{ label: "분류", before: kindLabel(base.kind), after: kindLabel(kind) }] : []),
    ];
    const card = { line: `원래 이름 · ${place.name}`, line2: region ? `상세 주소 없음 · ${place.address}` : place.roadAddress ?? place.address };
    if (!changes.length) {
      // Another device already made the same change; nothing is left to send.
      open({
        title: "이미 같은 값이에요",
        card,
        note: "다른 곳에서 같은 내용으로 바뀌었어요. 바뀐 것은 없어요.",
        buttons: [{ label: "닫기", primary: true, onClick: () => { setPending(null); setForm(null); } }],
      });
      return;
    }
    const reopen = (fresh: SavedPlaceEntry) => confirmEdit(fresh, edits, "다른 곳에서 바뀐 내용을 반영했어요. 바뀐 값만 다시 확인해 주세요.");
    open({
      title: "별명과 분류를 수정할까요?",
      card,
      changes,
      note: retryNote ?? "바뀐 값만 보여요. 원래 이름·위치와 자주 찾는 장소 별표는 그대로예요.",
      confirm: {
        label: "확인하고 수정",
        busyLabel: "수정하는 중…",
        checking: "수정됐는지 확인하고 있어요",
        notApplied: { title: "수정되지 않았어요", message: "목록을 다시 확인했지만 바뀐 내용이 없어요. 입력 내용은 그대로예요. 다시 수정하려면 \"확인하고 수정\"을 눌러 주세요." },
        run: async () => {
          if (statusRef.current !== "ready") return unreadable;
          const current = latest(base.id);
          if (!current) return notFound;
          // A newer row changes what "before" means: show the recalculated change first.
          if (current.revision !== base.revision) { reopen(current); return replaced; }
          const write = await saved.edit(current, alias, kind);
          if (write.ok) setForm(null);
          else if (write.stale) {
            const fresh = latest(base.id);
            if (!fresh) return notFound;
            reopen(fresh);
            return replaced;
          }
          return write;
        },
        onApplied: () => setForm(null),
      },
    });
  }

  function confirmSave(place: PlaceSearchResult, alias: string, kind: SavedPlaceKind, starred: boolean, existing?: SavedPlaceEntry, retryNote?: string) {
    if (existing) {
      const name = alias.trim();
      confirmEdit(existing, {
        ...((existing.alias ?? "") !== name ? { alias: name } : {}),
        ...(existing.kind !== kind ? { kind } : {}),
      }, retryNote);
      return;
    }
    const region = isRegionOnlyPlace(place);
    const name = alias.trim();
    const rows = [
      { label: "별명", value: name || "없음 · 원래 이름으로 표시" },
      { label: "분류", value: kindLabel(kind) },
      ...(region ? [{ label: "주소", value: `상세 주소 없음 · ${place.address}` }] : []),
      starred
        ? { label: "자주 찾는 장소", value: "추가", count: `${starredCount} → ${starredCount + 1} / ${FREQUENT_PLACE_LIMIT}` }
        : { label: "자주 찾는 장소", value: full ? `추가 안 함 · ${starredCount} / ${FREQUENT_PLACE_LIMIT} 가득 참` : "추가 안 함" },
    ];
    open({
      title: "이 장소를 저장할까요?",
      card: { eyebrow: kindLabel(kind), region, name: name || place.name, line: name ? `원래 이름 · ${place.name}` : place.roadAddress ?? place.address },
      rows,
      note: retryNote ?? (!starred && full ? "자주 찾는 장소가 가득 차 별표 없이 저장해요." : "원래 위치는 그대로 저장돼요."),
      confirm: {
        label: "확인하고 저장",
        busyLabel: "저장하는 중…",
        checking: "저장됐는지 확인하고 있어요",
        notApplied: { title: "저장되지 않았어요", message: "목록을 다시 확인했지만 이 장소가 없어요. 입력 내용은 그대로예요. 다시 저장하려면 \"확인하고 저장\"을 눌러 주세요." },
        run: async () => {
          if (statusRef.current !== "ready") return unreadable;
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
            return replaced;
          }
          if (write.ok) {
            setForm(null);
            setSavedSelection(place.kakaoPlaceId);
          } else if (write.reason === "star_limit") {
            // Another device filled the stars first: confirm saving without a star (FP29b).
            confirmSave(place, alias, kind, false, undefined, "자주 찾는 장소가 가득 차 별표 없이 저장할지 다시 확인해 주세요. 목록을 새로 불러왔어요.");
            return replaced;
          }
          return write;
        },
        onApplied: () => { setForm(null); setSavedSelection(place.kakaoPlaceId); },
      },
    });
  }

  function savedCandidate(p: SavedPlaceEntry): WaypointCandidate {
    return { name: savedPlaceName(p), placeName: p.place.name, kind: p.kind, province: p.province, starred: p.starPosition !== null, place: p.place, current: () => saved.places.some((row) => row.id === p.id && row.revision === p.revision) };
  }
  function sharedCandidate(p: SharedPlace): WaypointCandidate {
    // The shared place's original place, signature included, is used unchanged.
    return { name: p.alias ?? p.place.name, placeName: p.place.name, kind: p.kind, province: p.province, starred: p.starred, place: p.place, current: () => shared.current().snapshot.places.some((row) => row.id === p.id && row.revision === p.revision) };
  }
  /** Avoid status for my own place (memo: "내 장소 상세에도 같은 버튼"). */
  function avoidButton(p: SavedPlaceEntry) {
    if (!sharedReady) return null;
    const avoided = avoidedOf(p.place);
    const source = { icon: "pin" as const, text: "내 장소" };
    return avoided ? (
      <>
        <button type="button" className={styles.avoidSaved} aria-label="기피 장소로 표시됨, 눌러서 해제" disabled={shared.busy} onClick={() => sharedPopup.open(unavoidPopup(shared, avoided, { eyebrow: `${kindLabel(p.kind)} · ${p.province ?? "지역 미확인"}`, name: savedPlaceName(p), source, note: "식당 추천 후보에 다시 들어가요. 내 장소는 그대로예요." }))}>
          <LineIcon name="ban" /><span>기피 장소로 표시됨 · 나에게만</span>
        </button>
        <p className={styles.helper}>누르면 기피를 해제할지 다시 확인해요. 식당 추천에서 빠져요.</p>
      </>
    ) : (
      <button type="button" className={styles.secondaryButton} disabled={shared.busy} onClick={() => sharedPopup.open(avoidPopup(shared, p.place, { kind: p.kind, province: p.province, name: savedPlaceName(p), source }))}>⊘ 기피 장소로 표시 · 나에게만</button>
    );
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
  const folderCount = sharedReady ? snapshot.folders.length : 0;
  // G00g: a failed shared read keeps my places and says so instead of passing for an empty folder list.
  const sharedFailed = shared.enabled && shared.status === "error";
  const showSource = Boolean(folderCount) || sharedFailed;
  // G00/G00b: hidden without folders; "공유 폴더 n / m" when any is on, "공유 폴더 끔" otherwise.
  const folderToggle = sharedFailed ? (
    <button type="button" className={styles.folderToggle} aria-label="공유 폴더, 불러오지 못해 고를 수 없음" disabled>
      <span aria-hidden="true">공유 폴더</span>
      <LineIcon name="chevron-down" />
    </button>
  ) : folderCount ? (
    <button
      type="button"
      className={`${styles.folderToggle}${enabledFolderIds.length ? ` ${styles.folderToggleOn}` : ""}`}
      aria-haspopup="dialog"
      aria-label={`공유 폴더 ${enabledFolderIds.length} / ${folderCount} 켬, 고르기`}
      disabled={shared.busy}
      onClick={() => sharedPopup.open(folderPickerPopup(shared, enabledFolderIds))}
    >
      {enabledFolderIds.length ? <LineIcon name="check" /> : null}
      <span aria-hidden="true">{enabledFolderIds.length ? <>공유 폴더 <b className={styles.countNumber}>{enabledFolderIds.length} / {folderCount}</b></> : "공유 폴더 끔"}</span>
      <LineIcon name="chevron-down" />
    </button>
  ) : null;
  const sourceLine = (item: Item) => <span className={styles.sourceLine}><LineIcon name={item.source === "saved" ? "pin" : "folder"} />{item.label}</span>;
  const switcher = (
    <nav className={styles.sectionSwitch} aria-label="즐겨찾기 보기">
      {([["places", "장소"], ["folders", "공유 폴더"], ["avoided", "기피 장소"]] as const).map(([key, label]) => (
        <button type="button" key={key} aria-pressed={section === key} onClick={() => { setSection(key); selectPlace(null); setPreviewId(null); }}>
          {section === key ? <LineIcon name="check" /> : null}{label}
        </button>
      ))}
    </nav>
  );

  if (openFolder) {
    return (
      <>
        <SharedFolderDetail
          key={openFolder.id}
          folderId={openFolder.id}
          wide={wide}
          disabled={disabled}
          notice={openFolder.notice}
          onBack={() => setOpenFolder(null)}
          onAddWaypoint={(row) => setAdding(sharedCandidate(row))}
        />
        {adding ? <WaypointDialog candidate={adding} initial={initialWaypoint} disabled={disabled} onClose={() => setAdding(null)} onAddWaypoint={onAddWaypoint} onAdded={() => setAdding(null)} /> : null}
      </>
    );
  }

  return (
    <section className={`${styles.page}${section !== "places" ? ` ${styles.sectionPage}` : ""}`} aria-labelledby="saved-places-title">
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
        {section === "places" ? <button type="button" className={`primary-button ${styles.desktopOnly}`} disabled={blocked || saved.places.length >= 1000} onClick={() => setForm({ place: null })}>장소 등록하기</button> : null}
      </header>
      {shared.enabled ? switcher : null}
      {section === "folders" ? (
        <div className={styles.sectionBody}>
          {listNotice ? <p className={styles.noticeCard} role="status">{listNotice}</p> : null}
          {/* G01b: a lost create reply with a same-name folder in the list; nothing is claimed. */}
          {createUnknown ? (
            <div className={styles.noticeCard} role="status">
              <strong>폴더를 만들었는지 확인하지 못했어요</strong>
              <p>응답을 받지 못했어요. 목록에 같은 이름의 새 폴더가 있지만 이 기기에서 만든 폴더인지 확인하지 못했어요. 폴더를 열어 확인한 뒤 써 주세요.</p>
            </div>
          ) : null}
          <SharedFolderList onOpen={(id) => { setListNotice(""); setCreateUnknown(false); setOpenFolder({ id }); }} onCreate={() => setCreatingFolder(true)} />
          {creatingFolder ? <FolderCreate onClose={() => setCreatingFolder(false)} onUncertain={() => { setCreatingFolder(false); setListNotice(""); setCreateUnknown(true); }} onCreated={(id) => { setCreatingFolder(false); setOpenFolder({ id, notice: "공유 폴더를 만들었어요. 메뉴의 초대 링크에서 링크를 만들어 회원을 불러 보세요." }); }} /> : null}
        </div>
      ) : section === "avoided" ? (
        <div className={styles.sectionBody}><AvoidedPlacesView startView={startView} /></div>
      ) : <>
      <div className={`${styles.mobileRegion} ${styles.mobileOnly}`}>{regionSelect("large")}</div>
      <div className={styles.columns}>
        <div className={styles.mapColumn}>
          <div className={`${styles.layers}${folderToggle ? ` ${styles.layersWithFolders}` : ""}`} role="group" aria-label="지도 핀 표시">
            {layerToggle("라이딩 스팟", spots, setSpots)}
            {layerToggle("식당", restaurants, setRestaurants)}
            {folderToggle}
          </div>
          {sharedFailed ? (
            <div className={styles.errorCard} role="alert">
              <strong>공유 폴더 장소를 불러오지 못했어요</strong>
              <p>내 장소는 그대로 볼 수 있어요. 공유 폴더 장소는 지도와 목록에서 잠시 빠져 있어요.</p>
              <button type="button" className={styles.secondaryButton} disabled={shared.busy} onClick={shared.retry}>공유 폴더 다시 불러오기</button>
            </div>
          ) : null}
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
              onSelectSavedPin={selectPin}
              selectedSavedPinId={selected?.id ?? (sharedSelected ? `shared:${sharedSelected.id}` : preview?.key ?? null)}
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
          {/* AV05: avoided pins ignore the layer toggles and are never clustered. */}
          {pins.some((pin) => pin.avoided) ? <p className={styles.helper}>기피 장소는 라이딩 스팟·식당 토글과 관계없이 항상 보여요. 묶음 개수에 넣지 않아요.</p> : null}
          {!spots && !restaurants ? <p className={styles.notice} role="status">저장 장소 핀을 모두 숨겼어요. 현재 일정의 지점과 지도는 유지돼요.</p> : null}
          {preview && !wide ? (
            <div className={styles.previewCard}>
              <button type="button" aria-label={`${itemName(preview)} 상세 보기`} onClick={() => { setPreviewId(null); selectItem(preview); }}>
                <span className={styles.placeKind}>{kindLabel(preview.row.kind)} · {preview.row.province ?? "지역 미확인"}{preview.starred ? " · 자주 찾는 장소" : ""}</span>
                <strong>{itemName(preview)}</strong>
                <span>{placeLine(preview.row)}</span>
                {showSource ? sourceLine(preview) : null}
              </button>
              <StarIconButton starred={preview.starred} disabled={preview.source === "saved" ? blocked : shared.busy} onClick={() => confirmItemStar(preview)} />
            </div>
          ) : null}
        </div>
        <section
          className={styles.listColumn}
          aria-label={(selected || sharedSelected) && wide ? "장소 상세" : `${tab === "starred" ? "자주 찾는 장소" : kindLabel(tab)} 목록`}
        >
          {sharedSelected && wide ? (
            <SharedPlaceDetail placeId={sharedSelected.id} wide disabled={disabled} onClose={() => setSharedSelectedId(null)} onAddWaypoint={(row) => setAdding(sharedCandidate(row))} onManageStars={manageStars} />
          ) : selected && wide ? (
            <div className={styles.pcDetail}>
              <div className={styles.pcDetailHeading}>
                <button type="button" className={styles.iconButton} aria-label="장소 상세 뒤로" onClick={() => selectPlace(null)}><LineIcon name="chevron-left" /></button>
                <h2>장소 상세</h2>
              </div>
              <div className={`${styles.placeSummary} ${styles.detailSummary}`}>
                <span className={styles.placeKind}>{kindLabel(selected.kind)} · {selected.province ?? "지역 미확인"}{selected.starPosition !== null ? " · 자주 찾는 장소" : ""}</span>
                <strong>{savedPlaceName(selected)}</strong>
                <span>{placeLine(selected)}</span>
                <StarIconButton starred={selected.starPosition !== null} disabled={blocked} onClick={() => confirm(selected, "star")} />
              </div>
              {failure}
              <StarButton place={selected} full={full} count={starredCount} disabled={blocked} onClick={() => confirm(selected, "star")} />
              {selected.starPosition === null && full ? <p className={styles.helper}>자주 찾는 장소 {FREQUENT_PLACE_LIMIT}곳이 모두 찼어요. 다른 장소의 별표를 빼면 추가할 수 있어요.</p> : null}
              {avoidButton(selected)}
              <button type="button" className={styles.secondaryButton} disabled={blocked || disabled} onClick={() => setAdding(savedCandidate(selected))}>경유지에 추가</button>
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
          {/* FP01/FP04 + G00a: starred "8 / 10"; kind tabs "41곳 (공유 12) · 내 저장 장소 46 / 1,000". */}
          <p className={styles.listCount}>
            <strong>{tab === "starred" ? "자주 찾는 장소" : kindLabel(tab)}</strong>
            {tab === "starred" ? <b className={styles.countNumber}>{starredCount} / {FREQUENT_PLACE_LIMIT}</b> : <>
              <b className={styles.countNumber}>{list.length.toLocaleString()}</b>
              <span>곳{sharedInList ? ` (공유 ${sharedInList.toLocaleString()})` : ""} · 내 저장 장소</span>
              <b className={styles.countNumber}>{saved.places.length.toLocaleString()} / 1,000</b>
            </>}
          </p>
          {tab === "starred" ? <p className={`${styles.helper} ${styles.mobileOnly}`}>{folderCount ? `라이딩 스팟·식당과 공유 폴더 장소를 합쳐 최대 ${FREQUENT_PLACE_LIMIT}곳까지 별표할 수 있어요. 공유 폴더를 꺼 둬도 별표한 장소는 이 탭에 모두 보여요.` : `라이딩 스팟과 식당을 합쳐 최대 ${FREQUENT_PLACE_LIMIT}곳까지 별표할 수 있어요.`}</p> : null}
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
                <li key={p.key} className={styles.placeCard}>
                  <button
                    type="button"
                    onClick={() => selectItem(p)}
                    aria-label={`${itemName(p)} 상세 보기`}
                  >
                    <span className={styles.placeKind}>{kindLabel(p.row.kind)} · {p.row.province ?? "지역 미확인"}{avoidedOf(p.row.place) ? <span className={styles.chip}>기피</span> : null}</span>
                    <strong>{itemName(p)}</strong>
                    <span>{placeLine(p.row)}</span>
                    {showSource ? sourceLine(p) : null}
                  </button>
                  <StarIconButton starred={p.starred} disabled={p.source === "saved" ? blocked : shared.busy} onClick={() => confirmItemStar(p)} />
                </li>
              ))}
            </ul>
          )}
          {tab === "starred" && list.length ? <p className={`${styles.notice} ${styles.mobileOnly}`}>{folderCount ? "별표를 빼도 라이딩 스팟·식당 목록과 공유 폴더에는 그대로 남아 있어요." : "별표를 빼도 라이딩 스팟·식당 목록에는 그대로 남아 있어요."}</p> : null}
          {tab !== "starred" && folderCount ? <p className={`${styles.notice} ${styles.mobileOnly}`}>{enabledFolderIds.length ? "같은 장소가 내 장소와 공유 폴더에 함께 있으면 내 장소 하나만 보여요. 여러 폴더에만 있으면 하나로 묶고 \"외 n\"으로 표시해요." : "공유 폴더를 모두 꺼서 내 장소만 보여요. 별표한 공유 장소는 자주 찾는 장소 탭에서 계속 볼 수 있어요."}</p> : null}
          {sharedFailed ? <p className={styles.noticeCard}>다시 불러오면 공유 폴더 장소가 지도와 목록에 함께 보여요. 별표한 공유 장소도 그때 자주 찾는 장소 탭에 보여요.</p> : null}
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
      </>}
      {saved.message && saved.status === "ready" && !saved.failureTitle ? (
        <p role="status" aria-live="polite">
          {saved.message}
        </p>
      ) : !selected ? failure : null}
      {shared.message && section !== "folders" ? <p className={styles.srOnly} role="status" aria-live="polite">{shared.message}</p> : null}
      {clusterIds ? (
        <SavedDialog title={`이 위치의 장소 ${clusterPlaces.length}곳`} onClose={() => setClusterIds(null)}>
          <ul className={styles.list}>
            {clusterPlaces.map((p) => (
              <li key={p.key} className={styles.placeCard}>
                <button type="button" aria-label={`${itemName(p)} 상세 보기`} onClick={() => { setClusterIds(null); selectItem(p); }}>
                  <span className={styles.placeKind}>{kindLabel(p.row.kind)} · {p.row.province ?? "지역 미확인"}</span>
                  <strong>{itemName(p)}</strong>
                  <span>{placeLine(p.row)}</span>
                  {showSource ? sourceLine(p) : null}
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
            <StarIconButton starred={selected.starPosition !== null} disabled={blocked} onClick={() => confirm(selected, "star")} />
          </div>
          <div className={styles.detailMap}><KakaoMapCanvas points={[]} allowEmptyMap savedPins={[{ id: selected.id, label: savedPlaceName(selected), kind: selected.kind, starred: selected.starPosition !== null, avoided: Boolean(avoidedOf(selected.place)), latitude: selected.place.latitude, longitude: selected.place.longitude }]} selectedSavedPinId={selected.id} showLegend={false} allowFullscreen={false} /></div>
          {failure}
          <StarButton place={selected} full={full} count={starredCount} disabled={blocked} onClick={() => confirm(selected, "star")} />
          {selected.starPosition === null && full ? (
            <>
              <p className={styles.helper}>자주 찾는 장소 {FREQUENT_PLACE_LIMIT}곳이 모두 찼어요. 다른 장소의 별표를 빼면 추가할 수 있어요.</p>
              <button type="button" className={styles.textButton} onClick={manageStars}>자주 찾는 장소 관리</button>
            </>
          ) : null}
          {avoidButton(selected)}
          <button type="button" className={styles.secondaryButton} disabled={blocked || disabled} onClick={() => setAdding(savedCandidate(selected))}>경유지에 추가</button>
          <button type="button" className={styles.secondaryButton} disabled={blocked} onClick={() => setForm({ place: selected.place, existing: selected })}>별명·분류 수정</button>
          <button type="button" className={styles.dangerButton} disabled={blocked} onClick={() => confirm(selected, "delete")}>장소 삭제</button>
          </div>
          {sharedPopup.popup}
        </SavedDialog>
      ) : null}
      {sharedSelected && !wide ? <SharedPlaceDetail placeId={sharedSelected.id} wide={false} disabled={disabled} onClose={() => setSharedSelectedId(null)} onAddWaypoint={(row) => setAdding(sharedCandidate(row))} onManageStars={manageStars} /> : null}
      {adding ? <WaypointDialog candidate={adding} initial={initialWaypoint} disabled={disabled || blocked} onClose={() => setAdding(null)} onAddWaypoint={onAddWaypoint} onAdded={() => { setAdding(null); selectPlace(null); }} /> : null}
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
        <ConfirmPopup<SavedPlaceEntry[]>
          key={pending.key}
          pending={pending}
          busy={saved.busy}
          verifying={saved.verifying}
          recheck={saved.recheck}
          capture={saved.captureSnapshot}
          onClose={() => setPending(null)}
        />
      ) : null}
      {selected && !wide ? null : sharedPopup.popup}
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
function StarIconButton({ starred, disabled, onClick }: {
  starred: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
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

function WaypointDialog({ candidate, initial, disabled, onClose, onAddWaypoint, onAdded }: {
  candidate: WaypointCandidate;
  initial?: { role: WaypointRole; dwellMinutes: number };
  disabled: boolean;
  onClose: () => void;
  onAddWaypoint: SavedPlacesManagerProps["onAddWaypoint"];
  onAdded: () => void;
}) {
  return (
    <SavedWaypointForm
      place={candidate}
      initial={initial}
      disabled={disabled}
      onClose={onClose}
      onAdd={(role, dwell) => {
        if (disabled || !candidate.current()) return "장소가 변경되었습니다. 목록에서 다시 선택해 주세요.";
        const failure = onAddWaypoint(candidate.place, role, dwell);
        if (!failure) onAdded();
        return failure;
      }}
    />
  );
}

function SavedWaypointForm({
  place,
  initial,
  disabled,
  onClose,
  onAdd,
}: {
  place: WaypointCandidate;
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
        <span className={styles.placeKind}>{kindLabel(place.kind)}{place.starred ? <span aria-label="자주 찾는 장소"><StarMark filled /></span> : null}</span>
        <strong>{place.name}</strong>
        <span>{place.placeName} · {place.province ?? "지역 미확인"}</span>
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

