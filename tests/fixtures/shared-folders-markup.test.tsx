import { writeFileSync } from "node:fs";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseSavedPlaceEntry } from "@/lib/places/saved";
import {
  parseAvoidedPlace,
  parseFolderMember,
  parseFolderPreference,
  parsePlaceFolder,
  parseSharedPlace,
  parseStarEntries,
} from "@/lib/places/shared-folders";
import { ConfirmPopup, type Pending } from "@/components/confirm-popup";
import { folderPickerPopup, SavedPlacesManager } from "@/components/saved-places-manager";
import { SharedFolderDetail } from "@/components/shared-folder-detail";
import { FolderSettings } from "@/components/shared-folder-settings";
import { deleteSharedPopup, sharedStarPopup } from "@/components/shared-place-actions";
import type { SharedSnapshot } from "@/components/shared-folders-provider";
import { F1, ME, sampleSaved, sampleTables } from "./shared-folders";

/*
 * Production markup of the #124 favorites screens with synthetic folder data, for the
 * responsive layout checks in tests/e2e/shared-folders-responsive.spec.ts (the local E2E
 * server runs without Supabase, so data screens are checked from this markup).
 */
const tables = sampleTables();
const snapshot: SharedSnapshot = {
  userId: ME,
  folders: tables.place_folders.map(parsePlaceFolder),
  members: tables.place_folder_members.map(parseFolderMember),
  preferences: tables.place_folder_preferences.map(parseFolderPreference),
  places: tables.shared_place_entries.map(parseSharedPlace),
  stars: parseStarEntries(tables.my_star_entries),
  avoided: tables.avoided_places.map(parseAvoidedPlace),
};
const places = sampleSaved().map(parseSavedPlaceEntry);
const shared = {
  accountEpoch: 0, enabled: true, status: "ready", busy: false, verifying: false, message: "", snapshot,
  current: () => ({ status: "ready" as const, snapshot }), retry: () => undefined, refresh: async () => null, reloadStars: async () => undefined,
  captureSnapshot: () => () => true, recheck: async () => "unreadable" as const, write: async () => ({ ok: true as const }), call: async () => ({ data: null, code: null, lost: false }),
};
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => null }));
vi.mock("@/components/saved-places-provider", async () => {
  const actual = await vi.importActual<typeof import("@/components/saved-places-provider")>("@/components/saved-places-provider");
  return {
    ...actual,
    useSavedPlaces: () => ({
      accountEpoch: 1, places, favorites: [], status: "ready", busy: false, verifying: false, message: "", failureTitle: "",
      current: () => ({ status: "ready", places }), captureSnapshot: () => () => true, recheck: async () => "unreadable", retry: () => undefined,
    }),
  };
});
vi.mock("@/components/shared-folders-provider", async () => {
  const actual = await vi.importActual<typeof import("@/components/shared-folders-provider")>("@/components/shared-folders-provider");
  return { ...actual, useSharedFolders: () => shared };
});

const page = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);
const popup = (pending: Pending<SharedSnapshot>) =>
  page(<ConfirmPopup<SharedSnapshot> pending={pending} busy={false} verifying={false} recheck={async () => "unreadable"} capture={() => () => true} onClose={() => undefined} />);

describe("shared folder screens production markup", () => {
  it("renders every checked screen", () => {
    const manager = (section: "places" | "folders" | "avoided") =>
      page(<SavedPlacesManager onBack={() => undefined} onAddWaypoint={() => null} routePoints={[]} initialSection={section} />);
    const markup = {
      places: manager("places"),
      folders: manager("folders"),
      avoided: manager("avoided"),
      folderDetail: page(<SharedFolderDetail folderId={F1} wide={false} disabled={false} onBack={() => undefined} onAddWaypoint={() => undefined} />),
      members: page(<FolderSettings folderId={F1} page="members" onClose={() => undefined} onLeft={() => undefined} />),
      folderPopup: popup({ key: 1, ...folderPickerPopup(shared as never, snapshot.preferences.filter((row) => row.enabled).map((row) => row.folderId)) }),
      starPopup: popup({ key: 2, ...sharedStarPopup(shared as never, snapshot.places[3]) }),
      deletePopup: popup({ key: 3, ...deleteSharedPopup(shared as never, snapshot.places[3], () => undefined) }),
    };
    expect(markup.places).toContain("공유 · 남한강 맛집 외 1");
    expect(markup.folders).toContain("내 공유 폴더");
    expect(markup.avoided).toContain("기피 장소");
    expect(markup.folderDetail).toContain("폴더 장소");
    expect(markup.members).toContain("회원·권한 관리");
    expect(markup.folderPopup).toContain("지도와 목록에 보일 공유 폴더");
    expect(markup.deletePopup).toContain("폴더에서 이 장소를 삭제할까요?");
    const outputPath = process.env.MOTOCAST_SHARED_FOLDERS_MARKUP_OUTPUT?.trim();
    if (outputPath) writeFileSync(outputPath, JSON.stringify(markup), "utf8");
  });
});
