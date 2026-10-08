import type { Metadata } from "next";

import { FolderInvite } from "@/components/folder-invite";

export const metadata: Metadata = { title: "공유 폴더 초대 — MOTOCAST", referrer: "no-referrer" };

export default function FolderInvitePage() {
  return <FolderInvite />;
}
