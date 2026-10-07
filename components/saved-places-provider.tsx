"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { withClientTimeout } from "@/lib/planner/client-timeout";
import {
  favoritePlacePayload,
  type PlaceFavorite,
} from "@/lib/places/favorites";
import {
  FREQUENT_PLACE_LIMIT,
  parseSavedPlace,
  parseSavedPlaceEntries,
  parseSavedPlaceEntry,
  savedPlaceName,
  type SavedPlace,
  type SavedPlaceEntry,
  type SavedPlaceKind,
} from "@/lib/places/saved";
import type { PlaceSearchResult } from "@/lib/places/search";

type State = "loading" | "ready" | "error";
/** What a write said it committed; the list must show it (or something newer). */
type Receipt =
  | { id: string; deleted: true }
  | {
      id: string;
      deleted?: false;
      revision: number;
      alias: string | null;
      kind: SavedPlaceKind;
      starPosition?: SavedPlaceEntry["starPosition"];
    };
/**
 * Outcome of one confirmed write (Figma memo 392:10916, decision "option A"):
 * - ok: committed (or the re-read list already shows it). `duplicate` means the place was saved before.
 * - rejected: the server refused with a known code; the input stays and the user may confirm again.
 * - star_limit: an 11th star; the list was re-read (FP03).
 * - unknown: the result is unknown (lost response, timeout, malformed reply, list mismatch). The list was
 *   re-read and does not show the change, so the confirm button is enabled again. Nothing is resent.
 */
export type SavedPlaceWrite =
  | { ok: true; id?: string; duplicate?: boolean }
  | {
      ok: false;
      /**
       * - unknown: no readable result. `checked` says whether a fresh list was read; only then may the
       *   rider confirm one new request. Without it, `recheck` (read only) must succeed first.
       * - mismatch: the server returned a receipt but the list still disagrees after the fixed re-reads.
       *   The write is committed, so only `recheck` is allowed, never a resend.
       */
      reason: "rejected" | "star_limit" | "unknown" | "mismatch" | "blocked";
      title: string;
      message: string;
      checked?: boolean;
      stale?: boolean;
      recheck?: (list: SavedPlaceEntry[]) => boolean;
    };
/** Outcome of a read-only recheck of an earlier write. */
export type SavedPlaceRecheck = "applied" | "missing" | "unreadable";

/** Client time limits. Supabase's `authenticated` role ends statements after 8s
 * (statement_timeout), so a write still pending after 15s (8s plus network and auth refresh margin)
 * is treated as an unknown result and checked by reading the list. A list read gets 10s. */
export const SAVED_PLACE_WRITE_TIMEOUT_MS = 15_000;
export const SAVED_PLACE_READ_TIMEOUT_MS = 10_000;
type SavedPlacesControls = {
  accountEpoch: number;
  places: SavedPlaceEntry[];
  favorites: PlaceFavorite[];
  status: State;
  busy: boolean;
  message: string;
  /** Non-empty when the last write failed; `message` then explains why. */
  failureTitle: string;
  /** True while an unknown write result is checked against a fresh list (FP39a). */
  verifying: boolean;
  /** The latest loaded list and its state, as known right now (not as of the last render). */
  current: () => { status: State; places: SavedPlaceEntry[] };
  /** Read-only check of an earlier write against a fresh list; never sends a write. */
  recheck: (applied: (list: SavedPlaceEntry[]) => boolean) => Promise<SavedPlaceRecheck>;
  retry: () => void;
  captureSnapshot: () => () => boolean;
  save: (
    place: PlaceSearchResult,
    alias: string,
    kind: SavedPlaceKind,
    starred: boolean,
  ) => Promise<SavedPlaceWrite>;
  edit: (
    place: SavedPlace,
    alias: string,
    kind: SavedPlaceKind,
  ) => Promise<SavedPlaceWrite>;
  star: (place: SavedPlace, starred: boolean) => Promise<SavedPlaceWrite>;
  deletePlace: (place: SavedPlace) => Promise<SavedPlaceWrite>;
  add: (place: PlaceSearchResult) => Promise<boolean>;
  remove: (place: PlaceFavorite) => Promise<boolean>;
};
const Context = createContext<SavedPlacesControls | null>(null);

export function SavedPlacesProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [places, setPlaces] = useState<SavedPlaceEntry[]>([]);
  const [status, setStatus] = useState<State>(enabled ? "loading" : "ready");
  const [busy, setBusy] = useState(false);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const [message, setMessage] = useState(
    enabled ? "" : "데모 모드에서는 저장 장소를 저장하지 않습니다.",
  );
  const [failureTitle, setFailureTitle] = useState("");
  const [verifying, setVerifying] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const session = useRef(0);
  const user = useRef<string | null | undefined>(undefined);
  const operation = useRef<symbol | null>(null);
  // Writes decide on the current state, not on the render that created the callback.
  const statusRef = useRef<State>(status);
  const placesRef = useRef<SavedPlaceEntry[]>(places);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { placesRef.current = places; }, [places]);
  // Only the operation that started checking may end the FP39a state.
  const verifyingOwner = useRef<symbol | null>(null);

  const load = useCallback(
    async (owner?: symbol): Promise<SavedPlaceEntry[] | null> => {
      if (operation.current && operation.current !== owner) return null;
      const read = ++generation.current;
      const epoch = session.current;
      if (!enabled) return null;
      setStatus("loading");
      try {
        const client = getBrowserSupabase();
        if (!client) throw new Error("UNAVAILABLE");
        // One view select is one snapshot of places, stars and revisions.
        const { data, error } = await withClientTimeout<{ data: unknown; error: unknown }>(
          client
            .from("saved_place_entries")
            .select(
              "id,place,alias,kind,province,star_slot,star_position,revision,created_at,updated_at",
            )
            .order("created_at")
            .limit(1001),
          SAVED_PLACE_READ_TIMEOUT_MS,
        );
        if (
          !mounted.current ||
          read !== generation.current ||
          epoch !== session.current
        )
          return null;
        if (error) throw new Error("READ_FAILED");
        const entries = parseSavedPlaceEntries(data);
        placesRef.current = entries;
        statusRef.current = "ready";
        setPlaces(entries);
        setStatus("ready");
        setMessage("");
        setFailureTitle("");
        return entries;
      } catch {
        if (
          mounted.current &&
          read === generation.current &&
          epoch === session.current
        ) {
          // A late reply of this read must not overwrite the error state.
          generation.current++;
          statusRef.current = "error";
          setPlaces([]);
          setStatus("error");
          setMessage(
            "저장한 장소를 확인하지 못했어요. 목록을 다시 확인해 주세요.",
          );
          setFailureTitle("");
        }
        return null;
      }
    },
    [enabled],
  );

  useEffect(() => {
    mounted.current = true;
    const task = window.setTimeout(() => void load(), 0);
    const client = getBrowserSupabase();
    const subscription =
      enabled && client?.auth
        ? client.auth.onAuthStateChange(
            (_event: AuthChangeEvent, next: Session | null) => {
              const id = next?.user.id ?? null;
              if (user.current === id) return;
              user.current = id;
              session.current++;
              generation.current++;
              operation.current = null;
              verifyingOwner.current = null;
              setAccountEpoch(session.current);
              setPlaces([]);
              setBusy(false);
              setVerifying(false);
              if (id) {
                window.setTimeout(() => {
                  if (mounted.current) void load();
                }, 0);
              } else {
                setStatus("error");
                setMessage("로그인 후 저장한 장소를 다시 확인해 주세요.");
              }
            },
          ).data.subscription
        : null;
    return () => {
      mounted.current = false;
      session.current += 1;
      generation.current += 1;
      operation.current = null;
      window.clearTimeout(task);
      subscription?.unsubscribe();
    };
  }, [enabled, load]);

  const mutate = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
      success: string,
      result: "entry" | "place" | "delete",
      applied: (list: SavedPlaceEntry[]) => boolean,
      unknownMessage: string,
    ): Promise<SavedPlaceWrite> => {
      const client = getBrowserSupabase();
      if (!enabled || !client || operation.current || statusRef.current !== "ready")
        return { ok: false, reason: "blocked", title: "지금은 변경할 수 없어요", message: "목록을 확인한 뒤 다시 시도해 주세요." };
      const id = Symbol();
      operation.current = id;
      const epoch = session.current;
      const before = new Set(placesRef.current.map((p) => p.id));
      generation.current++;
      setBusy(true);
      const current = () =>
        mounted.current &&
        epoch === session.current &&
        operation.current === id;
      const gone: SavedPlaceWrite = { ok: false, reason: "blocked", title: "계정이 바뀌었어요", message: "최신 목록을 다시 확인해 주세요." };
      const succeed = (message: string, extra: { id?: string; duplicate?: boolean } = {}): SavedPlaceWrite => {
        setMessage(message);
        setFailureTitle("");
        return { ok: true, ...extra };
      };
      // No readable result: compare a fresh list with what the write should have changed.
      const verify = async (): Promise<SavedPlaceWrite> => {
        verifyingOwner.current = id;
        setVerifying(true);
        let list: SavedPlaceEntry[] | null;
        try {
          list = await load(id);
        } finally {
          if (verifyingOwner.current === id) {
            verifyingOwner.current = null;
            if (mounted.current && epoch === session.current) setVerifying(false);
          }
        }
        if (!current()) return gone;
        if (list && applied(list)) return succeed(success);
        setMessage("");
        setFailureTitle("");
        return list
          ? { ok: false, reason: "unknown", checked: true, title: "변경을 확인하지 못했어요", message: unknownMessage, recheck: applied }
          : { ok: false, reason: "unknown", checked: false, title: "목록을 확인하지 못했어요", message: "변경됐는지 아직 몰라요. 목록을 다시 확인한 뒤에 다시 시도할 수 있어요.", recheck: applied };
      };
      let response: { data: unknown; error: { message: string } | null };
      try {
        response = await withClientTimeout<{ data: unknown; error: { message: string } | null }>(client.rpc(name, args), SAVED_PLACE_WRITE_TIMEOUT_MS);
      } catch {
        // Lost or timed-out reply: the result is unknown, and a late reply is ignored.
        if (!current()) return gone;
        try { return await verify(); } finally { finish(); }
      }
      try {
        if (!current()) return gone;
        const { data, error } = response;
        if (error) {
          const failure = writeFailure(error.message);
          if (!failure) return await verify();
          const checked = await load(id);
          if (!current()) return gone;
          const message = `${failure.message}${checked ? " 목록을 새로 불러왔어요." : " 최신 목록도 확인하지 못했어요."}`;
          // The page shows the FP03 card for an 11th star; other refusals stay in the popup.
          setMessage(failure.reason === "star_limit" ? message : "");
          setFailureTitle(failure.reason === "star_limit" ? failure.title : "");
          return { ok: false, reason: failure.reason, stale: failure.stale, title: failure.title, message };
        }
        let receipt: Receipt;
        try {
          const single = Array.isArray(data) && data.length === 1 ? data[0] : null;
          if (result === "delete") {
            receipt = { id: String(args.saved_place_id), deleted: true };
          } else if (result === "entry") {
            receipt = { ...parseSavedPlaceEntry(single), deleted: false };
          } else {
            const row = parseSavedPlace(single);
            receipt = { id: row.id, revision: row.revision, alias: row.alias, kind: row.kind };
          }
        } catch {
          // A malformed reply is not a receipt; only the field check is possible.
          return await verify();
        }
        // With a receipt, the list must show it with an equal or newer revision within two reads.
        const shows = (list: SavedPlaceEntry[]) => listShows(list, receipt);
        let readable = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          const list = await load(id);
          if (!current()) return gone;
          if (!list) continue;
          readable = true;
          if (shows(list))
            return succeed(success, { id: receipt.id, duplicate: result === "entry" && before.has(receipt.id) });
        }
        setMessage("");
        setFailureTitle("");
        return {
          ok: false,
          reason: "mismatch",
          checked: readable,
          title: "목록에서 변경을 확인하지 못했어요",
          message: "변경 요청은 접수됐지만 최신 목록에 아직 보이지 않아요. 같은 요청은 다시 보내지 않아요. 목록을 다시 확인해 주세요.",
          recheck: shows,
        };
      } finally {
        finish();
      }
      function finish() {
        if (operation.current === id) {
          operation.current = null;
          if (mounted.current && epoch === session.current) setBusy(false);
        }
      }
    },
    [enabled, load],
  );

  const recheck = useCallback(
    async (applied: (list: SavedPlaceEntry[]) => boolean): Promise<SavedPlaceRecheck> => {
      if (!enabled || operation.current) return "unreadable";
      const id = Symbol();
      operation.current = id;
      const epoch = session.current;
      setBusy(true);
      try {
        const list = await load(id);
        if (!mounted.current || epoch !== session.current || operation.current !== id || !list) return "unreadable";
        return applied(list) ? "applied" : "missing";
      } finally {
        if (operation.current === id) {
          operation.current = null;
          if (mounted.current && epoch === session.current) setBusy(false);
        }
      }
    },
    [enabled, load],
  );

  const star = useCallback(
    (place: SavedPlace, starred: boolean) =>
      mutate(
        "set_place_star",
        {
          saved_place_id: place.id,
          expected_revision: place.revision,
          starred,
        },
        starred
          ? "자주 찾는 장소에 추가했어요."
          : "자주 찾는 장소에서 뺐어요. 저장한 장소는 그대로 남아 있어요.",
        "entry",
        (list) => list.some((row) => row.id === place.id && (row.starPosition !== null) === starred),
        starred
          ? "추가됐는지 확인했는데 반영되지 않았어요. 다시 시도하면 최신 목록으로 한 번 요청해요."
          : "별표를 뺐는지 확인했는데 반영되지 않았어요. 다시 시도하면 최신 목록으로 한 번 요청해요.",
      ),
    [mutate],
  );
  const save = useCallback(
    (
      place: PlaceSearchResult,
      alias: string,
      kind: SavedPlaceKind,
      starred: boolean,
    ) =>
      mutate(
        "save_place_v2",
        {
          saved_place: {
            ...favoritePlacePayload(place),
            roadAddress: place.roadAddress,
          },
          place_alias: alias.trim() || null,
          place_kind: kind,
          starred,
        },
        "장소를 저장했어요.",
        "entry",
        (list) => list.some((row) => row.place.kakaoPlaceId === place.kakaoPlaceId),
        "저장됐는지 확인했는데 반영되지 않았어요. 입력 내용은 그대로예요.",
      ),
    [mutate],
  );
  const captureSnapshot = useCallback(() => {
    const read = generation.current;
    const epoch = session.current;
    return () =>
      mounted.current &&
      read === generation.current &&
      epoch === session.current;
  }, []);
  const value = useMemo<SavedPlacesControls>(
    () => ({
      accountEpoch,
      places,
      status,
      busy,
      message,
      failureTitle,
      verifying,
      recheck,
      current: () => ({ status: statusRef.current, places: placesRef.current }),
      retry: () => {
        void load();
      },
      captureSnapshot,
      save,
      star,
      favorites: places
        .flatMap((p): PlaceFavorite[] =>
          p.starPosition === null
            ? []
            : [{ slot: p.starPosition, place: p.place, createdAt: p.createdAt, displayName: savedPlaceName(p) }],
        )
        .sort((a, b) => a.slot - b.slot),
      edit: (p, alias, kind) =>
        mutate(
          "update_saved_place",
          {
            saved_place_id: p.id,
            expected_revision: p.revision,
            place_alias: alias.trim() || null,
            place_kind: kind,
          },
          "장소 정보를 수정했어요.",
          "place",
          (list) => list.some((row) => row.id === p.id && row.alias === (alias.trim() || null) && row.kind === kind),
          "수정됐는지 확인했는데 반영되지 않았어요. 입력 내용은 그대로예요.",
        ),
      deletePlace: (p) =>
        mutate(
          "delete_saved_place",
          { saved_place_id: p.id, expected_revision: p.revision },
          "선택한 장소를 삭제했어요. 기존 코스와 공유 결과는 유지됩니다.",
          "delete",
          (list) => !list.some((row) => row.id === p.id),
          "삭제됐는지 확인했는데 반영되지 않았어요. 다시 시도하면 최신 목록으로 한 번 요청해요.",
        ),
      add: (p) => {
        const existing = places.find(
          (row) => row.place.kakaoPlaceId === p.kakaoPlaceId,
        );
        return (existing
          ? star(existing, true)
          : save(p, "", "riding_spot", true)).then((write) => write.ok);
      },
      remove: (p) => {
        const existing = places.find(
          (row) =>
            row.place.kakaoPlaceId === p.place.kakaoPlaceId &&
            row.starPosition === p.slot,
        );
        return existing ? star(existing, false).then((write) => write.ok) : Promise.resolve(false);
      },
    }),
    [
      accountEpoch,
      places,
      status,
      busy,
      message,
      failureTitle,
      verifying,
      recheck,
      load,
      captureSnapshot,
      save,
      star,
      mutate,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Known server refusals; anything else (network, timeout, unexpected reply) has an unknown result. */
function writeFailure(code: string): { reason: "rejected" | "star_limit"; title: string; message: string; stale?: boolean } | null {
  if (code.includes("STAR_LIMIT") || code.includes("FAVORITE_LIMIT"))
    return {
      reason: "star_limit",
      title: "자주 찾는 장소에 추가하지 못했어요",
      message: `이미 ${FREQUENT_PLACE_LIMIT}곳이 별표돼 있어요. 다른 기기에서 먼저 추가했을 수 있어요.`,
    };
  if (code.includes("SAVED_PLACE_LIMIT"))
    return { reason: "rejected", title: "장소를 저장하지 못했어요", message: "저장 장소는 합계 1,000개까지예요. 기존 장소를 정리해 주세요." };
  if (code.includes("INVALID_SAVED_PLACE_METADATA"))
    return {
      reason: "rejected",
      title: "장소를 저장하지 못했어요",
      message: "별명을 입력해 주세요. 상세 주소가 없는 지점은 별명이 있어야 저장할 수 있어요.",
    };
  if (code.includes("SAVED_PLACE_STALE") || code.includes("SAVED_PLACE_NOT_FOUND"))
    return { reason: "rejected", stale: true, title: "변경하지 못했어요", message: "다른 곳에서 목록이 바뀌었어요. 최신 정보로 다시 확인해 주세요." };
  if (/\b[A-Z][A-Z_]{3,}\b/.test(code) && /INVALID|DENIED|FORBIDDEN|MEMBER/.test(code))
    return { reason: "rejected", title: "변경하지 못했어요", message: "요청이 거부됐어요. 입력 내용을 확인한 뒤 다시 시도해 주세요." };
  return null;
}

function listShows(list: SavedPlaceEntry[], receipt: Receipt) {
  const row = list.find((entry) => entry.id === receipt.id);
  if (receipt.deleted) return !row;
  if (!row) return false;
  // A newer revision means another write landed after ours; the list is current.
  if (row.revision !== receipt.revision) return row.revision > receipt.revision;
  return (
    row.alias === receipt.alias &&
    row.kind === receipt.kind &&
    (receipt.starPosition === undefined || row.starPosition === receipt.starPosition)
  );
}

export function useSavedPlaces() {
  const value = useContext(Context);
  if (!value) throw new Error("SAVED_PLACES_PROVIDER_REQUIRED");
  return value;
}
