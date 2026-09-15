"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SharedRideSnapshotView } from "@/components/shared-ride-snapshot";
import { parseSharedRideSnapshot, type SharedRideSnapshot } from "@/lib/sharing/contracts";

type LoadState =
  | { status: "loading" }
  | { status: "found"; snapshot: SharedRideSnapshot; referenceTime: string }
  | { status: "not-found" | "unavailable" | "invalid-link" };

export function PublicSharedRide() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const mountedRef = useRef(false);
  const resolutionRef = useRef<Promise<void> | null>(null);
  const resolutionSequenceRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const resolveFragment = () => {
      const token = window.location.hash.slice(1);
      const resolutionSequence = ++resolutionSequenceRef.current;
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      } catch {
        resolutionRef.current = Promise.resolve().then(() => {
          if (mountedRef.current && resolutionSequence === resolutionSequenceRef.current) {
            setState({ status: "unavailable" });
          }
        });
        return;
      }

      setState({ status: "loading" });
      resolutionRef.current = (async () => {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
          if (mountedRef.current && resolutionSequence === resolutionSequenceRef.current) {
            setState({ status: "invalid-link" });
          }
          return;
        }
        const response = await fetch("/api/shares/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });
        if (!mountedRef.current || resolutionSequence !== resolutionSequenceRef.current) return;
        if (response.status === 404) setState({ status: "not-found" });
        else if (!response.ok) setState({ status: "unavailable" });
        else {
          const body = await response.json() as { snapshot?: unknown };
          if (mountedRef.current && resolutionSequence === resolutionSequenceRef.current) {
            setState({ status: "found", snapshot: parseSharedRideSnapshot(body.snapshot), referenceTime: new Date().toISOString() });
          }
        }
      })().catch(() => {
        if (mountedRef.current && resolutionSequence === resolutionSequenceRef.current) {
          setState({ status: "unavailable" });
        }
      });
    };
    const handleHashChange = () => resolveFragment();
    window.addEventListener("hashchange", handleHashChange);
    if (!resolutionRef.current) resolveFragment();
    return () => {
      mountedRef.current = false;
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (state.status !== "found") return;
    const timer = window.setInterval(() => {
      setState((current) => current.status === "found"
        ? { ...current, referenceTime: new Date().toISOString() }
        : current);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  return (
    <main className="shared-ride-shell">
      <header className="shared-ride-header">
        <Link className="brand" href="/" aria-label="MOTOCAST 홈"><span className="brand-mark">M</span><span>MOTOCAST</span></Link>
        {state.status === "found" ? <span className="immutable-pill">불변 공유본</span> : null}
      </header>
      {state.status === "found" ? (
        <>
          <SharedRideSnapshotView snapshot={state.snapshot} referenceTime={state.referenceTime} />
          <footer className="shared-footer"><strong>불변 공유본</strong><span>링크 소유자가 회수하면 이후 온라인 접근이 거부됩니다.</span></footer>
        </>
      ) : (
        <section className="shared-unavailable" role={state.status === "loading" ? "status" : "alert"}>
          <h1>{state.status === "loading" ? "공유 라이딩을 확인하는 중입니다." : state.status === "not-found" ? "공유 링크가 없거나 회수되었습니다." : state.status === "invalid-link" ? "공유 링크 형식을 확인해 주세요." : "공유 정보를 지금 불러올 수 없습니다."}</h1>
          {state.status === "unavailable" ? <p>링크가 회수된 것으로 처리하지 않았습니다. 잠시 뒤 다시 시도해 주세요.</p> : null}
        </section>
      )}
    </main>
  );
}
