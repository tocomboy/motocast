"use client";

import { useEffect, useMemo, useState } from "react";
import { LineIcon, StarMark } from "@/components/line-icon";
import { KakaoMapCanvas, type MapDisplayState } from "./kakao-map-canvas";
import { SavedDialog } from "./saved-dialog";
import { SavedPlaceRegistration } from "./saved-place-registration";
import { useSavedPlaces } from "./saved-places-provider";
import { useSharedFolders, type SharedSnapshot } from "./shared-folders-provider";
import {
  addSharedPopup,
  avoidedFor,
  cardLine,
  kindLabel,
  sharedName,
  sharedStarPopup,
  starAfterAdd,
  useSharedPopup,
} from "./shared-place-actions";
import { SharedPlaceDetail } from "./shared-place-detail";
import { RoleChip, SavedPlacePicker, selectionCounts } from "./shared-folder-list";
import { FolderSettings, useInvites, type SettingsPage } from "./shared-folder-settings";
import { FREQUENT_PLACE_LIMIT, PROVINCES, type SavedPlaceKind } from "@/lib/places/saved";
import { PLACE_FOLDER_MEMBER_LIMIT, PLACE_FOLDER_PLACE_LIMIT, type SharedPlace } from "@/lib/places/shared-folders";
import { canEditPlaces, expiryLabel, lastEditLine, permissionLabel } from "@/lib/places/shared-folder-format";
import styles from "./saved-places-manager.module.css";

type AddFlow = null | "choose" | "search" | "import";

/**
 * Shared folder detail (Figma G10 379:11674, GW01 385:12362, GS02 385:12541, GP06 387:13593,
 * G17 379:12360): the #123 FP01/FP04 structure for one folder's places.
 */
export function SharedFolderDetail({
  folderId,
  wide,
  disabled,
  notice,
  onBack,
  onAddWaypoint,
}: {
  folderId: string;
  wide: boolean;
  disabled: boolean;
  notice?: string;
  onBack: () => void;
  onAddWaypoint: (row: SharedPlace) => void;
}) {
  const shared = useSharedFolders();
  const { open, popup } = useSharedPopup();
  const [tab, setTab] = useState<SavedPlaceKind>("riding_spot");
  const [province, setProvince] = useState("");
  const [spots, setSpots] = useState(true);
  const [restaurants, setRestaurants] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapStatus, setMapStatus] = useState<MapDisplayState>("loading");
  const [clustersVisible, setClustersVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsPage | null>(null);
  const [adding, setAdding] = useState<AddFlow>(null);
  const [status, setStatus] = useState(notice ?? "");
  // V3-6: the place was saved but its star failed or is unknown; shown until it is resolved.
  const [starIssue, setStarIssue] = useState<{ placeId: string | null; title: string; message: string; unknown: boolean } | null>(null);
  // Success text from a write made on this screen replaces the entry notice.
  const [baseline] = useState(shared.message);
  // Opening a folder re-reads it (memo G10: entry, refresh and right after a save).
  const { refresh } = shared;
  useEffect(() => {
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [refresh, folderId]);
  const { snapshot } = shared;
  const folder = snapshot.folders.find((row) => row.id === folderId);
  const me = snapshot.userId;

  /** The star asked for in G13b, sent once after the save; its own result is kept apart (V3-6). */
  async function starNewPlace(row: SharedPlace | null) {
    if (!row) { setStarIssue({ placeId: null, title: "자주 찾는 장소에는 추가하지 못했어요", message: "장소는 폴더에 저장했어요. 별표할 장소를 목록에서 찾지 못했어요. 장소 상세에서 다시 추가해 주세요.", unknown: false }); return; }
    const result = await starAfterAdd(shared, row);
    if (result.ok) { setStarIssue(null); return; }
    const unknown = result.reason === "unknown" || result.reason === "mismatch";
    setStarIssue({
      placeId: row.id,
      unknown,
      title: unknown ? "별표가 반영됐는지 확인하지 못했어요" : "자주 찾는 장소에는 추가하지 못했어요",
      message: unknown
        ? "장소는 폴더에 저장했어요. 별표 요청은 다시 보내지 않아요. 목록을 다시 확인해 주세요."
        : result.reason === "star_limit"
          ? `장소는 폴더에 저장했어요. 자주 찾는 장소 ${FREQUENT_PLACE_LIMIT}곳이 모두 차서 별표하지 못했어요. 다른 별표를 뺀 뒤 장소 상세에서 추가해 주세요.`
          : `장소는 폴더에 저장했어요. ${result.message || "별표하지 못했어요."} 장소 상세에서 다시 추가할 수 있어요.`,
    });
  }
  async function recheckStar(placeId: string) {
    const fresh = await shared.refresh();
    if (!fresh) { setStarIssue({ placeId, unknown: true, title: "목록을 확인하지 못했어요", message: "장소는 폴더에 저장했어요. 별표가 반영됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요." }); return; }
    if (fresh.places.some((p) => p.id === placeId && p.starred)) { setStarIssue(null); setStatus("폴더에 저장하고 자주 찾는 장소에도 추가했어요."); return; }
    setStarIssue({ placeId, unknown: false, title: "자주 찾는 장소에는 추가되지 않았어요", message: "장소는 폴더에 저장했어요. 별표는 없어요. 장소 상세에서 다시 추가할 수 있어요." });
  }
  const members = snapshot.members.filter((row) => row.folderId === folderId);
  const role = members.find((row) => row.memberId === me)?.role;
  const editable = canEditPlaces(role);
  const places = useMemo(() => snapshot.places.filter((row) => row.folderId === folderId), [snapshot.places, folderId]);
  const blocked = shared.busy || shared.status !== "ready";
  const full = places.length >= PLACE_FOLDER_PLACE_LIMIT;
  const inRegion = places.filter((row) => !province || (province === "unknown" ? row.province === null : row.province === province));
  const list = inRegion
    .filter((row) => row.kind === tab)
    .filter((row) => !query.trim() || `${sharedName(row)} ${row.place.name} ${row.place.address}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pins = inRegion
    .filter((row) => (row.kind === "restaurant" ? restaurants : spots))
    .map((row) => ({ id: row.id, label: sharedName(row), kind: row.kind, starred: row.starred, avoided: Boolean(avoidedFor(snapshot.avoided, row.place)), latitude: row.place.latitude, longitude: row.place.longitude }));

  if (!folder) {
    return (
      <section className={styles.page} aria-labelledby="shared-folder-title">
        <header className={styles.heading}>
          <button type="button" className={styles.iconButton} aria-label="공유 폴더 목록으로" onClick={onBack}><LineIcon name="chevron-left" /></button>
          <h1 id="shared-folder-title" data-view-title="favorites" tabIndex={-1}>공유 폴더</h1>
        </header>
        {shared.status === "loading" ? (
          <div className={styles.stateCard} role="status"><strong>폴더를 불러오고 있어요</strong><p>잠시만 기다려 주세요.</p></div>
        ) : shared.status === "error" ? (
          <div className={`${styles.stateCard} ${styles.errorState}`} role="alert"><strong>폴더를 불러오지 못했어요</strong><p>연결을 확인하고 다시 시도해 주세요.</p><button type="button" onClick={shared.retry}>다시 시도</button></div>
        ) : (
          <div className={styles.stateCard} role="alert"><strong>이 폴더를 더 볼 수 없어요</strong><p>폴더가 삭제됐거나 이 폴더에서 나갔어요. 이미 만든 일정·코스·공유 결과는 그대로예요.</p><button type="button" onClick={onBack}>공유 폴더 목록</button></div>
        )}
      </section>
    );
  }
  const selected = places.find((row) => row.id === selectedId);
  const provinceLabel = !province ? "전국" : province === "unknown" ? "지역 미확인" : province;
  const layerToggle = (label: string, checked: boolean, onChange: (value: boolean) => void) => (
    <label className={styles.layerToggle}>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {checked ? <LineIcon name="check" /> : null}
      <span aria-hidden="true">{checked ? label : `${label} 숨김`}</span>
    </label>
  );
  const regionSelect = (variant: "large" | "compact") => (
    <label className={variant === "large" ? styles.regionLarge : styles.regionCompact}>
      <span aria-hidden="true"><b>{provinceLabel}</b>{variant === "large" ? <small>· 이 폴더 장소</small> : null}<LineIcon name="chevron-down" /></span>
      <select aria-label="시·도" value={province} onChange={(e) => setProvince(e.target.value)}>
        <option value="">전국</option>
        {PROVINCES.map((p) => <option key={p}>{p}</option>)}
        <option value="unknown">지역 미확인</option>
      </select>
    </label>
  );
  const addReason = !editable ? "보기만 권한이라 추가할 수 없어요. 필요하면 주인에게 권한 변경을 요청하세요." : full ? "장소 한도가 차서 추가할 수 없어요." : "";
  const addButton = (className: string, label: string) => (
    <button type="button" className={className} aria-label="＋ 이 폴더에 장소 추가" disabled={blocked || !editable || full} onClick={() => setAdding("choose")}>{label}</button>
  );
  return (
    <section className={`${styles.page} ${styles.folderPage}`} aria-labelledby="shared-folder-title">
      <header className={styles.heading}>
        <button type="button" className={styles.iconButton} aria-label="공유 폴더 목록으로" onClick={onBack}><LineIcon name="chevron-left" /></button>
        <div className={styles.folderHeading}>
          <h1 id="shared-folder-title" data-view-title="favorites" tabIndex={-1}>{folder.name}</h1>
          <p className={styles.folderMeta}>
            <RoleChip owner={role === "owner"} />
            {role === "viewer" ? <><b>보기만</b><span>· 폴더 회원</span></> : <span>회원</span>}
            <b className={styles.countNumber}>{members.length} / {PLACE_FOLDER_MEMBER_LIMIT}</b>
          </p>
        </div>
        {role === "owner" ? <button type="button" className={`${styles.secondaryButton} ${styles.desktopOnly} ${styles.headerButton}`} onClick={() => setSettings("invites")}>초대 링크</button> : null}
        {addButton(`primary-button ${styles.desktopOnly} ${styles.headerButton}`, "＋ 이 폴더에 장소 추가")}
        <button type="button" className={styles.iconButton} aria-label="폴더 메뉴" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}><LineIcon name="more-vertical" /></button>
      </header>
      <div className={`${styles.mobileRegion} ${styles.mobileOnly}`}>{regionSelect("large")}</div>
      {shared.message !== baseline ? <p className={styles.noticeCard} role="status">{shared.message}</p> : status ? <p className={styles.noticeCard} role="status">{status}</p> : null}
      {starIssue ? (
        <div className={styles.errorCard} role="alert">
          <strong>{starIssue.title}</strong>
          <p>{starIssue.message}</p>
          {starIssue.unknown && starIssue.placeId ? <button type="button" className={styles.secondaryButton} disabled={shared.busy} onClick={() => void recheckStar(starIssue.placeId!)}>목록 다시 확인</button> : null}
        </div>
      ) : null}
      <div className={styles.columns}>
        <div className={styles.mapColumn}>
          <div className={styles.layers} role="group" aria-label="지도 핀 표시">
            {layerToggle("라이딩 스팟", spots, setSpots)}
            {layerToggle("식당", restaurants, setRestaurants)}
          </div>
          {mapStatus === "error" ? <div className={styles.mapFailure} role="alert"><strong>지도를 불러오지 못했어요</strong><p>목록과 검색은 그대로 쓸 수 있어요.</p></div> : null}
          <div className={styles.map} hidden={mapStatus === "error"}>
            <KakaoMapCanvas
              points={[]}
              allowEmptyMap
              savedPins={pins}
              savedViewportKey={`${folderId}:${province}`}
              onSelectSavedPin={setSelectedId}
              selectedSavedPinId={selected?.id ?? null}
              showLegend={false}
              onClustersChange={setClustersVisible}
              fullscreenTitle={`${folder.name} 지도`}
              onStatusChange={setMapStatus}
            />
          </div>
          {clustersVisible ? <p className={styles.helper}>숫자는 그 자리에 묶인 장소 수예요. 누르면 확대돼요. 별 배지는 자주 찾는 장소가 포함된 묶음이에요.</p> : null}
          {full ? <div className={styles.noticeCard} role="status"><strong>이 폴더의 장소 {PLACE_FOLDER_PLACE_LIMIT.toLocaleString()}곳이 모두 찼어요</strong><p>쓰지 않는 장소를 삭제하면 다시 추가할 수 있어요.</p></div> : null}
        </div>
        <section className={styles.listColumn} aria-label={selected && wide ? "장소 상세" : `${kindLabel(tab)} 목록`}>
          {selected && wide ? (
            <SharedPlaceDetail placeId={selected.id} wide disabled={disabled} onClose={() => setSelectedId(null)} onAddWaypoint={onAddWaypoint} />
          ) : <>
            <nav className={styles.tabs} aria-label="폴더 장소 목록">
              {(["riding_spot", "restaurant"] as const).map((kind) => <button type="button" key={kind} aria-pressed={tab === kind} onClick={() => setTab(kind)}>{kindLabel(kind)}</button>)}
            </nav>
            <div className={styles.filters}>
              <label className={styles.searchField}>
                <LineIcon name="search" />
                <span className={styles.srOnly}>폴더 장소 찾기</span>
                <input value={query} maxLength={100} placeholder="별명, 장소명, 주소" onChange={(e) => setQuery(e.target.value)} />
              </label>
              <div className={styles.desktopOnly}>{regionSelect("compact")}</div>
            </div>
            <p className={styles.listCount}>
              <strong>{kindLabel(tab)}</strong>
              <b className={styles.countNumber}>{list.length.toLocaleString()}</b>
              <span>곳 · 폴더 장소</span>
              <b className={styles.countNumber}>{places.length.toLocaleString()} / {PLACE_FOLDER_PLACE_LIMIT.toLocaleString()}</b>
            </p>
            {!list.length ? (
              <div className={styles.stateCard}>
                <strong>{query || province ? "조건에 맞는 장소가 없어요" : `이 폴더에 ${kindLabel(tab)}${tab === "restaurant" ? "이" : "이"} 없어요`}</strong>
                <p>{query || province ? "검색어 또는 지역 필터를 바꿔 보세요." : editable ? "＋ 이 폴더에 장소 추가로 검색·지도나 내 장소에서 추가할 수 있어요." : "편집 권한이 있는 회원이 장소를 추가하면 여기에 보여요."}</p>
              </div>
            ) : (
              <ul className={styles.list}>
                {list.map((row) => (
                  <li key={row.id} className={styles.placeCard}>
                    <button type="button" onClick={() => setSelectedId(row.id)} aria-label={`${sharedName(row)} 상세 보기`}>
                      <span className={styles.placeKind}>{kindLabel(row.kind)} · {row.province ?? "지역 미확인"}{avoidedFor(snapshot.avoided, row.place) ? <span className={styles.chip}>기피</span> : null}</span>
                      <strong>{sharedName(row)}</strong>
                      <span>{cardLine(row)}</span>
                      <span>{lastEditLine(row, me)}</span>
                    </button>
                    <button type="button" className={styles.starIconButton} aria-label={row.starred ? "자주 찾는 장소에서 빼기" : "자주 찾는 장소에 추가"} aria-pressed={row.starred} disabled={blocked} onClick={() => open(sharedStarPopup(shared, row))}>
                      <StarMark filled={row.starred} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>}
        </section>
      </div>
      <footer className={`${styles.registerFooter} ${styles.mobileOnly}`}>
        {addButton("primary-button", "＋ 이 폴더에 장소 추가")}
        {addReason ? <p className={styles.footerHint}>{addReason}</p> : null}
      </footer>
      {addReason ? <p className={`${styles.helper} ${styles.desktopOnly}`}>{addReason}</p> : null}
      {selected && !wide ? <SharedPlaceDetail placeId={selected.id} wide={false} disabled={disabled} onClose={() => setSelectedId(null)} onAddWaypoint={onAddWaypoint} /> : null}
      {menuOpen ? <FolderMenu folderId={folderId} onClose={() => setMenuOpen(false)} onOpen={(page) => { setMenuOpen(false); setSettings(page); }} /> : null}
      {settings ? <FolderSettings folderId={folderId} page={settings} onClose={() => setSettings(null)} onLeft={(message) => { setSettings(null); onBack(); if (message) setStatus(message); }} /> : null}
      {adding === "choose" ? <AddMethodSheet onClose={() => setAdding(null)} onSearch={() => setAdding("search")} onImport={() => setAdding("import")} /> : null}
      {adding === "search" ? (
        <SavedPlaceRegistration
          initialPlace={null}
          stars={snapshot.stars.length}
          blocked={blocked}
          startView={places[0]?.place ?? { latitude: 37.5665, longitude: 126.978 }}
          variant={{ kind: "folder-add", folderName: folder.name, members: members.length }}
          onClose={() => setAdding(null)}
          onSave={(place, alias, kind, starred) => open(addSharedPopup(shared, folderId, { place, alias, kind, starred }, {
            onSaved: (row) => {
              setAdding(null);
              if (row) setTab(row.kind);
              if (starred) void starNewPlace(row);
            },
            onBackToFolder: () => setAdding(null),
            onExisting: (row) => open({
              title: "이미 폴더에 있는 장소예요",
              card: { eyebrow: kindLabel(row.kind), name: sharedName(row), line: cardLine(row) },
              note: "같은 장소가 이미 이 폴더에 있어요. 기존 정보는 바뀌지 않았어요.",
              buttons: [{ label: "기존 장소 열기", primary: true, onClick: () => { setAdding(null); setSelectedId(row.id); } }, { label: "닫기", onClick: () => undefined }],
            }),
          }))}
        />
      ) : null}
      {adding === "import" ? <ImportPlaces folderId={folderId} onClose={() => setAdding(null)} /> : null}
      {popup}
    </section>
  );
}

/** G11 (owner) / G12 (member): a bottom sheet of folder actions. */
function FolderMenu({ folderId, onClose, onOpen }: { folderId: string; onClose: () => void; onOpen: (page: SettingsPage) => void }) {
  const shared = useSharedFolders();
  const { snapshot } = shared;
  const folder = snapshot.folders.find((row) => row.id === folderId);
  const members = snapshot.members.filter((row) => row.folderId === folderId);
  const mine = members.find((row) => row.memberId === snapshot.userId);
  const owner = mine?.role === "owner";
  const { invites, state } = useInvites(shared, folderId, owner);
  if (!folder || !mine) return null;
  // G11: "사용 중인 링크 1개 · 7일 뒤 만료" (the link that expires first).
  const soonest = invites?.reduce<string | null>((first, row) => (!first || row.expiresAt < first ? row.expiresAt : first), null);
  const inviteLine = state !== "ready" || !invites
    ? "만들기·회수 · 링크는 7일 동안 쓸 수 있어요"
    : invites.length && soonest ? `사용 중인 링크 ${invites.length}개 · ${expiryLabel(soonest).left} 뒤 만료` : "사용 중인 링크 없음";
  const row = (icon: "link" | "person" | "folder", title: string, sub: string, page: SettingsPage) => (
    <li><button type="button" className={styles.menuRow} onClick={() => onOpen(page)}><LineIcon name={icon} /><span><strong>{title}</strong><span>{sub}</span></span><LineIcon name="chevron-right" /></button></li>
  );
  return (
    <SavedDialog title={folder.name} onClose={onClose} sheet>
      {!owner ? <p className={styles.helper}>내 권한 · {permissionLabel(mine.role)} (주인이 회원 관리에서 바꿀 수 있어요)</p> : null}
      <ul className={styles.menuList}>
        {owner ? row("link", "초대 링크", inviteLine, "invites") : null}
        {row("person", owner ? "회원·권한 관리" : "회원 보기", `${members.length} / ${PLACE_FOLDER_MEMBER_LIMIT}명`, "members")}
        {row("person", "이 폴더에서 쓰는 내 이름", mine.displayName, "display-name")}
        {owner ? row("folder", "폴더 이름 바꾸기", folder.name, "rename") : null}
        <li>
          <button type="button" className={`${styles.menuRow} ${styles.menuDanger}`} onClick={() => onOpen(owner ? "delete" : "leave")}>
            <LineIcon name="close" /><span><strong>{owner ? "폴더 삭제" : "폴더 나가기"}</strong></span>
          </button>
        </li>
      </ul>
      <p className={styles.helper}>{owner ? "주인은 폴더를 나갈 수 없어요. 그만 쓰려면 폴더를 삭제하세요." : "초대 링크·회원 내보내기·폴더 삭제는 주인만 할 수 있어요."}</p>
    </SavedDialog>
  );
}

/** GI01: search or map, or copy from my places. Only editors and the owner reach it. */
function AddMethodSheet({ onClose, onSearch, onImport }: { onClose: () => void; onSearch: () => void; onImport: () => void }) {
  return (
    <SavedDialog title="이 폴더에 장소 추가" onClose={onClose} sheet>
      <ul className={styles.menuList}>
        <li><button type="button" className={styles.menuRow} onClick={onSearch}><LineIcon name="search" /><span><strong>검색·지도로 추가</strong><span>장소 이름·주소 검색 또는 지도에서 지점 고르기</span></span><LineIcon name="chevron-right" /></button></li>
        <li><button type="button" className={styles.menuRow} onClick={onImport}><LineIcon name="pin" /><span><strong>내 장소에서 가져오기</strong><span>내 라이딩 스팟·식당을 골라 폴더에 복사</span></span><LineIcon name="chevron-right" /></button></li>
      </ul>
    </SavedDialog>
  );
}

/** GI02–GI09: copy my places into the folder; all or nothing on the server. */
function ImportPlaces({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const shared = useSharedFolders();
  const saved = useSavedPlaces();
  const { open, close, popup } = useSharedPopup();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const { snapshot } = shared;
  const folder = snapshot.folders.find((row) => row.id === folderId);
  const inFolder = new Set(snapshot.places.filter((row) => row.folderId === folderId).map((row) => row.place.kakaoPlaceId));
  const count = inFolder.size;
  const room = Math.max(0, PLACE_FOLDER_PLACE_LIMIT - count);
  const valid = new Set([...selected].filter((id) => saved.places.some((row) => row.id === id && !inFolder.has(row.place.kakaoPlaceId))));
  const { spots, restaurants } = selectionCounts(saved.places, valid);
  const blocked = shared.busy || shared.status !== "ready" || saved.status !== "ready";
  function submit() {
    if (!folder) return;
    const rows = saved.places.filter((row) => valid.has(row.id));
    const fresh = shared.current().snapshot.places.filter((row) => row.folderId === folderId);
    const freshIds = new Set(fresh.map((row) => row.place.kakaoPlaceId));
    const skipped = rows.filter((row) => freshIds.has(row.place.kakaoPlaceId)).length;
    const adding = rows.length - skipped;
    const ids = rows.map((row) => row.id);
    const covered = (s: SharedSnapshot) => rows.every((row) => s.places.some((p) => p.folderId === folderId && p.place.kakaoPlaceId === row.place.kakaoPlaceId));
    open({
      title: `내 장소 ${rows.length}곳을 가져올까요?`,
      rows: [
        { label: "라이딩 스팟 · 식당", value: "", count: `${rows.filter((r) => r.kind === "riding_spot").length} · ${rows.filter((r) => r.kind === "restaurant").length}` },
        { label: "폴더 장소", value: "", count: `${fresh.length.toLocaleString()} → ${(fresh.length + adding).toLocaleString()} / ${PLACE_FOLDER_PLACE_LIMIT.toLocaleString()}` },
      ],
      note: `"${folder.name}" 폴더에 복사돼요.${skipped ? ` 이미 폴더에 있는 ${skipped}곳은 빠져요.` : ""} 가져온 뒤 내 장소를 고쳐도 폴더 장소는 바뀌지 않아요.`,
      confirm: {
        label: "가져오기",
        retryLabel: "확인하고 가져오기",
        busyLabel: "가져오는 중…",
        checking: "가져왔는지 확인하고 있어요",
        checkingMessage: "응답을 받지 못해 폴더를 다시 읽는 중이에요. 같은 요청을 다시 보내지 않아요.",
        notApplied: { title: "장소를 가져오지 못했어요", message: `응답을 받지 못해 폴더를 다시 확인했지만 장소가 들어오지 않았어요. 고른 ${rows.length}곳은 그대로예요. 다시 가져오려면 "확인하고 가져오기"를 눌러 주세요.` },
        run: async () => {
          const write = await shared.write({
            rpc: "import_saved_places_to_folder",
            args: { folder_id: folderId, saved_place_ids: ids },
            success: `내 장소를 폴더에 가져왔어요.`,
            receipt: (data) => {
              const body = data as { added?: unknown; skipped_existing?: unknown };
              if (!Number.isInteger(body?.added) || !Number.isInteger(body?.skipped_existing)) throw new Error("NO_RECEIPT");
              return covered;
            },
            applied: covered,
            unknownMessage: "가져왔는지 확인했는데 반영되지 않았어요. 고른 장소는 그대로예요.",
            refusal: (code) => {
              if (code === "PLACE_FOLDER_PLACE_LIMIT") {
                const left = Math.max(0, PLACE_FOLDER_PLACE_LIMIT - shared.current().snapshot.places.filter((p) => p.folderId === folderId).length);
                return { reason: "rejected", title: "폴더 자리가 부족해 가져오지 못했어요", message: `그 사이 다른 회원이 장소를 추가해 남은 자리가 ${left}곳이 됐어요. ${Math.max(0, adding - left)}곳을 해제하고 다시 가져와 주세요. 폴더는 바뀌지 않았어요.` };
              }
              if (code === "PLACE_FOLDER_FORBIDDEN")
                return { reason: "rejected", title: "장소를 가져오지 못했어요", message: "방금 주인이 내 권한을 \"보기만\"으로 바꿨어요. 폴더는 바뀌지 않았어요." };
              if (code === "SAVED_PLACE_NOT_FOUND")
                return { reason: "rejected", title: "고른 장소가 바뀌었어요", message: "고른 내 장소 중 삭제된 것이 있어요. 선택을 확인한 뒤 다시 가져와 주세요." };
              return null;
            },
          });
          if (write.ok) onClose();
          return write;
        },
        onApplied: onClose,
        finalOnRefusal: (write) => [
          { label: write.title.startsWith("폴더 자리") || write.title.startsWith("고른") ? "선택 고치기" : "폴더로 돌아가기", primary: true, onClick: () => { close(); if (!write.title.startsWith("폴더 자리") && !write.title.startsWith("고른")) onClose(); } },
          { label: "닫기", onClick: () => { close(); onClose(); } },
        ],
      },
    });
  }
  if (!folder) return null;
  return (
    <SavedDialog title="내 장소에서 가져오기" onBack={onClose} onClose={onClose} fullScreen>
      <div className={`${styles.waypointBody} ${styles.formBody}`}>
        <p className={styles.helper}>{folder.name} · 남은 자리 <b className={styles.countNumber}>{room.toLocaleString()}</b> 곳</p>
        <p className={styles.helper}>고른 장소는 폴더에 복사돼요. 이미 폴더에 있는 장소는 고를 수 없어요.</p>
        <SavedPlacePicker places={saved.places} selected={valid} onChange={setSelected} taken={inFolder} room={room} />
      </div>
      <div className={styles.waypointFooter}>
        <p className={styles.selectionSummary}>라이딩 스팟 <b className={styles.countNumber}>{spots}</b> · 식당 <b className={styles.countNumber}>{restaurants}</b> 선택</p>
        <button type="button" className="primary-button" disabled={blocked || !valid.size} onClick={submit}>가져오기 · {valid.size}곳</button>
      </div>
      {popup}
    </SavedDialog>
  );
}
