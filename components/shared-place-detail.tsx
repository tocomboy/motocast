"use client";

import { useState } from "react";
import { LineIcon, StarMark } from "@/components/line-icon";
import { KakaoMapCanvas } from "./kakao-map-canvas";
import { SavedDialog } from "./saved-dialog";
import { SavedPlaceRegistration } from "./saved-place-registration";
import { useSharedFolders } from "./shared-folders-provider";
import {
  avoidedFor,
  avoidPopup,
  deleteSharedPopup,
  editSharedPopup,
  folderNameOf,
  kindLabel,
  placeAddress,
  sharedName,
  sharedStarPopup,
  unavoidPopup,
  useSharedPopup,
} from "./shared-place-actions";
import { FREQUENT_PLACE_LIMIT } from "@/lib/places/saved";
import { canEditPlaces, dateTimeLabel, lastEditLine, memberName } from "@/lib/places/shared-folder-format";
import type { SharedPlace } from "@/lib/places/shared-folders";
import styles from "./saved-places-manager.module.css";

/**
 * Shared place detail (Figma G14 379:12151, G14b 434:16190, AV04 384:12314, GP07 387:13666):
 * FP02/FP02b structure with a source line, my star and my avoided mark as status buttons, and
 * folder edits only for editors and the owner.
 */
export function SharedPlaceDetail({
  placeId,
  wide,
  disabled,
  onClose,
  onAddWaypoint,
  onManageStars,
  onBackToFolder,
}: {
  placeId: string;
  wide: boolean;
  disabled: boolean;
  onClose: () => void;
  onAddWaypoint: (row: SharedPlace) => void;
  onManageStars?: () => void;
  /** GP08 "폴더로 돌아가기"; defaults to closing the detail. */
  onBackToFolder?: () => void;
}) {
  const shared = useSharedFolders();
  const { open, close, popup } = useSharedPopup();
  const [editing, setEditing] = useState(false);
  const { snapshot } = shared;
  const row = snapshot.places.find((p) => p.id === placeId);
  const blocked = shared.busy || shared.status !== "ready";
  if (!row) {
    // Deleted here or by another member, or the folder is no longer visible.
    return (
      <Container wide={wide} onClose={onClose}>
        <div className={styles.stateCard} role="status"><strong>장소를 찾지 못했어요</strong><p>폴더에서 삭제됐거나 더 볼 수 없는 장소예요. 이미 만든 일정·코스·공유 결과는 그대로예요.</p></div>
        {popup}
      </Container>
    );
  }
  const me = snapshot.userId;
  const role = snapshot.members.find((m) => m.folderId === row.folderId && m.memberId === me)?.role;
  const editable = canEditPlaces(role);
  const folder = folderNameOf(snapshot, row.folderId);
  const stars = snapshot.stars.length;
  const full = stars >= FREQUENT_PLACE_LIMIT;
  const avoided = avoidedFor(snapshot.avoided, row.place);
  const source = { icon: "folder" as const, text: `공유 · ${folder}` };
  const backToFolder = () => { close(); (onBackToFolder ?? onClose)(); };
  const starPopup = () => open(sharedStarPopup(shared, row, onManageStars ? () => { close(); onManageStars(); } : undefined));
  return (
    <Container wide={wide} onClose={onClose}>
      <div className={`${styles.placeSummary} ${styles.detailSummary} ${styles.sharedSummary}`}>
        <span className={styles.placeKind}>{kindLabel(row.kind)} · {row.province ?? "지역 미확인"}</span>
        <strong>{sharedName(row)}</strong>
        <span>{placeAddress(row.place)}</span>
        <span className={styles.sourceLine}><LineIcon name="folder" />{source.text}</span>
        <button type="button" className={styles.starIconButton} aria-label={row.starred ? "자주 찾는 장소에서 빼기" : "자주 찾는 장소에 추가"} aria-pressed={row.starred} disabled={blocked} onClick={starPopup}>
          <StarMark filled={row.starred} />
        </button>
      </div>
      {!wide ? (
        <div className={styles.detailMap}>
          <KakaoMapCanvas points={[]} allowEmptyMap savedPins={[{ id: row.id, label: sharedName(row), kind: row.kind, starred: row.starred, avoided: Boolean(avoided), latitude: row.place.latitude, longitude: row.place.longitude }]} selectedSavedPinId={row.id} showLegend={false} allowFullscreen={false} />
        </div>
      ) : null}
      <div className={styles.metaLines}>
        <p>추가 · {memberName(snapshot.members, row.folderId, row.createdBy, me)} · {dateTimeLabel(row.createdAt)}</p>
        <p>{lastEditLine(row, me)}</p>
      </div>
      {row.starred ? (
        <>
          <button type="button" className={styles.starSaved} aria-label="자주 찾는 장소에 저장됨, 눌러서 빼기" disabled={blocked} onClick={starPopup}>
            <StarMark filled />
            <span>자주 찾는 장소에 저장됨</span>
            <b className={styles.countNumber}>· {stars} / {FREQUENT_PLACE_LIMIT}</b>
          </button>
          <p className={styles.helper}>누르면 자주 찾는 장소에서 뺄지 다시 확인해요.</p>
        </>
      ) : (
        <button type="button" className={styles.starToggle} aria-pressed={false} disabled={blocked} onClick={starPopup}>
          {`☆ 자주 찾는 장소에 추가 · ${stars} / ${FREQUENT_PLACE_LIMIT}${full ? " 가득 참" : ""}`}
        </button>
      )}
      {avoided ? (
        <>
          <button
            type="button"
            className={styles.avoidSaved}
            aria-label="기피 장소로 표시됨, 눌러서 해제"
            disabled={blocked}
            onClick={() => open(unavoidPopup(shared, avoided, { eyebrow: `${kindLabel(row.kind)} · ${row.province ?? "지역 미확인"}`, name: sharedName(row), source, note: "식당 추천 후보에 다시 들어가요. 공유 폴더 장소는 그대로예요." }))}
          >
            <LineIcon name="ban" />
            <span>기피 장소로 표시됨 · 나에게만</span>
          </button>
          <p className={styles.helper}>누르면 기피를 해제할지 다시 확인해요. 식당 추천에서 빠지고, 다른 회원에게는 보이지 않아요.</p>
        </>
      ) : (
        <button type="button" className={styles.secondaryButton} disabled={blocked} onClick={() => open(avoidPopup(shared, row.place, { kind: row.kind, province: row.province, name: sharedName(row), source, sharedPlaceId: row.id }))}>
          ⊘ 기피 장소로 표시 · 나에게만
        </button>
      )}
      <button type="button" className={styles.secondaryButton} disabled={blocked || disabled} onClick={() => onAddWaypoint(row)}>경유지에 추가</button>
      {editable ? (
        <>
          <button type="button" className={styles.secondaryButton} disabled={blocked} onClick={() => setEditing(true)}>별명·분류 수정</button>
          <button type="button" className={styles.dangerButton} disabled={blocked} onClick={() => open(deleteSharedPopup(shared, row, () => { close(); onClose(); }))}>폴더에서 삭제</button>
        </>
      ) : (
        <p className={styles.helper}>보기만 권한이라 별명·분류 수정과 폴더에서 삭제는 할 수 없어요.</p>
      )}
      {editing ? (
        <SavedPlaceRegistration
          initialPlace={row.place}
          existing={{ id: row.id, place: row.place, alias: row.alias, kind: row.kind, province: row.province, starSlot: null, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt }}
          stars={stars}
          blocked={blocked}
          startView={row.place}
          variant={{ kind: "folder-edit" }}
          onClose={() => setEditing(false)}
          onSave={(_place, alias, kind) => {
            const edits = { ...((row.alias ?? "") !== alias.trim() ? { alias: alias.trim() } : {}), ...(row.kind !== kind ? { kind } : {}) };
            const done = { onSaved: () => { close(); setEditing(false); }, onBackToFolder: () => { setEditing(false); backToFolder(); }, reopen: open };
            open(editSharedPopup(shared, row, edits, done));
          }}
        />
      ) : null}
      {popup}
    </Container>
  );
}

function Container({ wide, onClose, children }: { wide: boolean; onClose: () => void; children: React.ReactNode }) {
  if (wide)
    return (
      <div className={styles.pcDetail}>
        <div className={styles.pcDetailHeading}>
          <button type="button" className={styles.iconButton} aria-label="장소 상세 뒤로" onClick={onClose}><LineIcon name="chevron-left" /></button>
          <h2>장소 상세</h2>
        </div>
        {children}
      </div>
    );
  return (
    <SavedDialog title="장소 상세" onBack={onClose} onClose={onClose} fullScreen>
      <div className={`${styles.waypointBody} ${styles.detailBody}`}>{children}</div>
    </SavedDialog>
  );
}
