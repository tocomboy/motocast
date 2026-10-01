import { redirect } from "next/navigation";

/** Retired bookmarks return to the existing membership-gated home. */
export default function RetiredInvitesPage() { redirect("/"); }
