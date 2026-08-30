import Link from "next/link";
import { notFound } from "next/navigation";

import { SharedRideSnapshotView } from "@/components/shared-ride-snapshot";
import { resolvePublicShare } from "@/lib/sharing/resolve";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SharedRidePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolvePublicShare(token);
  if (result.status === "not-found") notFound();
  if (result.status !== "found") {
    return (
      <main className="shared-ride-shell">
        <header className="shared-ride-header">
          <Link className="brand" href="/" aria-label="MOTOCAST 홈"><span className="brand-mark">M</span><span>MOTOCAST</span></Link>
        </header>
        <section className="shared-unavailable" role="alert">
          <h1>공유 정보를 지금 불러올 수 없습니다.</h1>
          <p>링크가 회수된 것으로 처리하지 않았습니다. 잠시 뒤 다시 시도해 주세요.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shared-ride-shell">
      <header className="shared-ride-header">
        <Link className="brand" href="/" aria-label="MOTOCAST 홈"><span className="brand-mark">M</span><span>MOTOCAST</span></Link>
        <span className="immutable-pill">불변 공유본</span>
      </header>
      <SharedRideSnapshotView snapshot={result.snapshot} referenceTime={new Date().toISOString()} />
      <footer className="shared-footer"><strong>불변 공유본</strong><span>링크 소유자가 회수하면 이후 온라인 접근이 거부됩니다.</span></footer>
    </main>
  );
}
