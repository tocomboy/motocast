"use client";

import { useRef, useState } from "react";
import { LineIcon } from "@/components/line-icon";
import { SavedPlaceRegistration } from "./saved-place-registration";
import { useSharedFolders } from "./shared-folders-provider";
import { avoidPopup, folderNameOf, placeAddress, unavoidPopup, useSharedPopup } from "./shared-place-actions";
import { AVOIDED_PLACE_LIMIT, type AvoidedPlace } from "@/lib/places/shared-folders";
import { dateLabel } from "@/lib/places/shared-folder-format";
import styles from "./saved-places-manager.module.css";

/** How the avoided place was added (AV01): from a shared folder, a map point, or a search. */
function originLine(row: AvoidedPlace, folderOf: (sharedPlaceId: string) => string | null) {
  const date = dateLabel(row.createdAt);
  if (row.sourceSharedPlaceId) {
    const folder = folderOf(row.sourceSharedPlaceId);
    return folder ? `공유 폴더 "${folder}"에서 표시 · ${date}` : `공유 폴더에서 표시 · ${date}`;
  }
  return row.place.kakaoPlaceId.startsWith("map:") ? `지도에서 등록 · ${date}` : `직접 등록 · ${date}`;
}

/**
 * Avoided places (Figma AV01 384:12201, AV02 384:12261, AV03 384:12287, AV06 384:12432,
 * AV09 436:11516): a personal list of at most 200, removed only after a centered confirmation.
 */
export function AvoidedPlacesView({ startView }: { startView: { latitude: number; longitude: number } }) {
  const shared = useSharedFolders();
  const { open, close, popup } = useSharedPopup();
  const [registering, setRegistering] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const { snapshot } = shared;
  const blocked = shared.busy || shared.status !== "ready";
  const count = snapshot.avoided.length;
  const full = count >= AVOIDED_PLACE_LIMIT;
  const folderOf = (sharedPlaceId: string) => {
    const source = snapshot.places.find((row) => row.id === sharedPlaceId);
    return source ? folderNameOf(snapshot, source.folderId) : null;
  };
  return (
    <>
      <p className={styles.sectionCount}><strong>기피 장소</strong><b className={styles.countNumber}>{count} / {AVOIDED_PLACE_LIMIT}</b></p>
      <p className={styles.helper}>식당 추천에서 빼고, 지도에 기피 표시로 보여요. 나에게만 적용돼요.</p>
      {shared.status === "loading" ? (
        <div className={styles.stateCard} role="status"><strong>기피 장소를 불러오고 있어요</strong><p>잠시만 기다려 주세요.</p></div>
      ) : shared.status === "error" ? (
        <div className={`${styles.stateCard} ${styles.errorState}`} role="alert">
          <strong>기피 장소를 불러오지 못했어요</strong>
          <p>연결을 확인하고 다시 시도해 주세요. 내 장소는 그대로 쓸 수 있어요.</p>
          <button type="button" disabled={shared.busy} onClick={shared.retry}>다시 시도</button>
        </div>
      ) : !count ? (
        <div className={styles.stateCard}>
          <strong>기피 장소가 없어요</strong>
          <p>다시 가고 싶지 않은 식당이나 피하고 싶은 지점을 등록하면 식당 추천에서 빼 드려요. 공유 폴더 장소에서도 바로 표시할 수 있어요.</p>
        </div>
      ) : (
        <>
          {full ? <div className={styles.noticeCard} role="status"><strong>기피 장소 200곳이 모두 찼어요</strong><p>더 등록하려면 쓰지 않는 기피 장소를 해제해 주세요.</p></div> : null}
          <ul className={styles.list}>
            {snapshot.avoided.map((row) => {
              const origin = originLine(row, folderOf);
              return (
                <li key={row.id} className={`${styles.placeCard} ${styles.avoidCard}`}>
                  <span className={styles.avoidIcon}><LineIcon name="ban" /></span>
                  <div>
                    <strong>{row.place.name}</strong>
                    <span>{placeAddress(row.place)}</span>
                    <span>{origin}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.releaseButton}
                    aria-label={`${row.place.name} 기피 해제`}
                    disabled={blocked}
                    onClick={() => open(unavoidPopup(shared, row, {
                      eyebrow: `기피 장소 · ${origin.split(" · ")[0]}`,
                      note: "식당 추천 후보에 다시 들어가요. 내 장소·공유 폴더에 있는 장소라면 그곳에는 그대로 남아 있어요.",
                    }))}
                  >
                    해제
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {shared.message && shared.status === "ready" ? <p className={styles.srOnly} role="status" aria-live="polite">{shared.message}</p> : null}
      <footer className={styles.registerFooter}>
        <button ref={addButton} type="button" className="primary-button" disabled={blocked || full} onClick={() => setRegistering(true)}>＋ 기피 장소 등록</button>
        {full ? <p className={styles.footerHint}>한도가 차서 등록할 수 없어요.</p> : null}
      </footer>
      {registering ? (
        <SavedPlaceRegistration
          initialPlace={null}
          stars={0}
          blocked={blocked}
          startView={startView}
          variant={{ kind: "avoid" }}
          onClose={() => { setRegistering(false); addButton.current?.focus(); }}
          onSave={(place) => open(avoidPopup(shared, place, { registration: true }, () => { close(); setRegistering(false); }))}
        />
      ) : null}
      {popup}
    </>
  );
}
