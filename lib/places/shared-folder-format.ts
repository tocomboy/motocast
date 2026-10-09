import type { FolderMember, FolderRole, PlaceFolder, SharedPlace } from "./shared-folders";

const parts = (iso: string) => {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return { month: Number(values.month), day: Number(values.day), time: `${values.hour}:${values.minute}` };
};

/** "10월 6일 14:20" in Seoul time. */
export const dateTimeLabel = (iso: string) => { const p = parts(iso); return `${p.month}월 ${p.day}일 ${p.time}`; };
/** "10월 6일". */
export const dateLabel = (iso: string) => { const p = parts(iso); return `${p.month}월 ${p.day}일`; };
/** Invite links last 7 days (contract §2 limits); a client clock a little behind the server never shows 8. */
const INVITE_LIFETIME_DAYS = 7;
/**
 * Invite expiry "10/14 15:00" and the time left, rounded up: a link made just now shows "7일" (G11),
 * a day or more shows whole days, under a day shows hours ("5시간"). At or past the expiry time
 * `expired` is true and callers show "만료됨" (as on Android), never "0시간".
 */
export function expiryLabel(iso: string, now = Date.now()) {
  const p = parts(iso);
  const left = Date.parse(iso) - now;
  const days = Math.min(INVITE_LIFETIME_DAYS, Math.ceil(left / 86_400_000));
  const hours = Math.max(0, Math.ceil(left / 3_600_000));
  return { at: `${p.month}/${p.day} ${p.time}`, left: left >= 86_400_000 ? `${days}일` : `${hours}시간`, expired: left <= 0 };
}

export const roleLabel = (role: FolderRole) => (role === "owner" ? "주인" : "회원");
/** Permission text shown per member row (GP memo: text, not color only). */
export const permissionLabel = (role: FolderRole) => (role === "owner" ? "전체 권한" : role === "editor" ? "편집 가능" : "보기만");
export const canEditPlaces = (role: FolderRole | null | undefined) => role === "owner" || role === "editor";

export function memberName(members: readonly FolderMember[], folderId: string, userId: string, me: string | null) {
  const member = members.find((row) => row.folderId === folderId && row.memberId === userId);
  if (!member) return "나간 회원";
  return userId === me ? `${member.displayName}(나)` : member.displayName;
}

/** "마지막 수정 · <name> · 10월 6일 14:20" for a shared place. */
export function lastEditLine(place: SharedPlace, me: string | null) {
  const name = place.updatedByLeft || place.updatedByDisplayName === null
    ? "나간 회원"
    : place.updatedBy === me ? `${place.updatedByDisplayName}(나)` : place.updatedByDisplayName;
  return `마지막 수정 · ${name} · ${dateTimeLabel(place.updatedAt)}`;
}

/** Folder card "마지막 수정": the newest place change, or the folder itself when it has no places. */
export function folderLastEdit(folder: PlaceFolder, places: readonly SharedPlace[], members: readonly FolderMember[], me: string | null) {
  const latest = places.reduce<SharedPlace | null>((best, row) => (!best || Date.parse(row.updatedAt) > Date.parse(best.updatedAt) ? row : best), null);
  if (latest && Date.parse(latest.updatedAt) >= Date.parse(folder.updatedAt)) {
    const name = latest.updatedByLeft || latest.updatedByDisplayName === null ? "나간 회원" : latest.updatedBy === me ? "나" : latest.updatedByDisplayName;
    return `마지막 수정 · ${name} · ${dateTimeLabel(latest.updatedAt)}`;
  }
  const owner = members.find((row) => row.folderId === folder.id && row.role === "owner");
  const name = folder.ownerId === me ? "나" : owner?.displayName ?? "나간 회원";
  return `마지막 수정 · ${name} · ${dateTimeLabel(folder.updatedAt)}`;
}
