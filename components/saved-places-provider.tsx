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
type SavedPlacesControls = {
  accountEpoch: number;
  places: SavedPlaceEntry[];
  favorites: PlaceFavorite[];
  status: State;
  busy: boolean;
  message: string;
  /** Non-empty when the last write failed; `message` then explains why. */
  failureTitle: string;
  retry: () => void;
  captureSnapshot: () => () => boolean;
  save: (
    place: PlaceSearchResult,
    alias: string,
    kind: SavedPlaceKind,
    starred: boolean,
  ) => Promise<boolean>;
  edit: (
    place: SavedPlace,
    alias: string,
    kind: SavedPlaceKind,
  ) => Promise<boolean>;
  star: (place: SavedPlace, starred: boolean) => Promise<boolean>;
  deletePlace: (place: SavedPlace) => Promise<boolean>;
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
  const mounted = useRef(false);
  const generation = useRef(0);
  const session = useRef(0);
  const user = useRef<string | null | undefined>(undefined);
  const operation = useRef<symbol | null>(null);

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
        const { data, error } = await client
          .from("saved_place_entries")
          .select(
            "id,place,alias,kind,province,star_slot,star_position,revision,created_at,updated_at",
          )
          .order("created_at")
          .limit(1001);
        if (
          !mounted.current ||
          read !== generation.current ||
          epoch !== session.current
        )
          return null;
        if (error) throw new Error("READ_FAILED");
        const entries = parseSavedPlaceEntries(data);
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
              setAccountEpoch(session.current);
              setPlaces([]);
              setBusy(false);
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
    ) => {
      const client = getBrowserSupabase();
      if (!enabled || !client || operation.current || status !== "ready")
        return false;
      const id = Symbol();
      operation.current = id;
      const epoch = session.current;
      generation.current++;
      setBusy(true);
      const current = () =>
        mounted.current &&
        epoch === session.current &&
        operation.current === id;
      try {
        const { data, error } = await client.rpc(name, args);
        if (!current()) return false;
        if (error) {
          const [title, reason] = writeFailure(error.message);
          const checked = await load(id);
          if (current()) {
            setMessage(
              `${reason}${checked ? " 목록을 새로 불러왔어요." : " 최신 목록도 확인하지 못했어요."}`,
            );
            setFailureTitle(title);
          }
          return false;
        }
        const single = Array.isArray(data) && data.length === 1 ? data[0] : null;
        let receipt: Receipt;
        if (result === "delete") {
          receipt = { id: String(args.saved_place_id), deleted: true };
        } else if (result === "entry") {
          receipt = { ...parseSavedPlaceEntry(single), deleted: false };
        } else {
          const row = parseSavedPlace(single);
          receipt = { id: row.id, revision: row.revision, alias: row.alias, kind: row.kind };
        }
        // A list that does not show the committed write yet is read once more;
        // a second disagreement is an error, never a local repair or a resend.
        for (let attempt = 0; attempt < 2; attempt++) {
          const list = await load(id);
          if (!current() || !list) return false;
          if (listShows(list, receipt)) {
            setMessage(success);
            setFailureTitle("");
            return true;
          }
        }
        setPlaces([]);
        setStatus("error");
        setFailureTitle("");
        setMessage(
          "변경 결과가 최신 목록과 달라요. 목록을 다시 확인해 주세요. 자동으로 다시 보내지 않았습니다.",
        );
        return false;
      } catch {
        if (current()) {
          const checked = await load(id);
          if (current()) {
            setMessage(
              checked
                ? "변경 결과가 불확실해 최신 목록을 다시 확인했어요. 자동으로 재시도하지 않았습니다."
                : "변경 결과와 최신 목록을 확인하지 못했어요.",
            );
            setFailureTitle("변경을 확인하지 못했어요");
          }
        }
        return false;
      } finally {
        if (operation.current === id) {
          operation.current = null;
          if (mounted.current && epoch === session.current) setBusy(false);
        }
      }
    },
    [enabled, load, status],
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
        "저장한 장소를 확인했어요. 이미 저장한 장소의 정보는 유지됩니다.",
        "entry",
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
        ),
      deletePlace: (p) =>
        mutate(
          "delete_saved_place",
          { saved_place_id: p.id, expected_revision: p.revision },
          "선택한 장소를 삭제했어요. 기존 코스와 공유 결과는 유지됩니다.",
          "delete",
        ),
      add: (p) => {
        const existing = places.find(
          (row) => row.place.kakaoPlaceId === p.kakaoPlaceId,
        );
        return existing
          ? star(existing, true)
          : save(p, "", "riding_spot", true);
      },
      remove: (p) => {
        const existing = places.find(
          (row) =>
            row.place.kakaoPlaceId === p.place.kakaoPlaceId &&
            row.starPosition === p.slot,
        );
        return existing ? star(existing, false) : Promise.resolve(false);
      },
    }),
    [
      accountEpoch,
      places,
      status,
      busy,
      message,
      failureTitle,
      load,
      captureSnapshot,
      save,
      star,
      mutate,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function writeFailure(code: string): [title: string, reason: string] {
  if (code.includes("STAR_LIMIT") || code.includes("FAVORITE_LIMIT"))
    return [
      "자주 찾는 장소에 추가하지 못했어요",
      `이미 ${FREQUENT_PLACE_LIMIT}곳이 별표돼 있어요. 다른 기기에서 먼저 추가했을 수 있어요.`,
    ];
  if (code.includes("LIMIT"))
    return ["장소를 저장하지 못했어요", "저장 장소는 합계 1,000개까지예요. 기존 장소를 정리해 주세요."];
  if (code.includes("INVALID_SAVED_PLACE_METADATA"))
    return [
      "장소를 저장하지 못했어요",
      "별명을 입력해 주세요. 상세 주소가 없는 지점은 별명이 있어야 저장할 수 있어요.",
    ];
  if (code.includes("STALE") || code.includes("NOT_FOUND"))
    return ["변경하지 못했어요", "다른 곳에서 목록이 바뀌었어요. 최신 장소를 다시 선택해 주세요."];
  return ["변경을 확인하지 못했어요", "변경 결과를 확인하지 못했어요. 최신 목록을 확인한 뒤 다시 선택해 주세요."];
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
