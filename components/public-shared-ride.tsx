"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SharedRideSnapshotView } from "@/components/shared-ride-snapshot";
import { PlannerDashboard } from "@/components/planner-dashboard";
import { KakaoMapHandoff } from "@/components/kakaomap-handoff";
import { sharedHandoff } from "@/lib/planner/kakaomap-sources";
import { parseCollectionCourse, type CollectionCourse } from "@/lib/collections/contracts";
import { parseSharedRideSnapshot, type SharedRideSnapshot } from "@/lib/sharing/contracts";

type LoadState =
  | { status: "loading" }
  | { status: "found"; snapshot: SharedRideSnapshot; referenceTime: string }
  | { status: "not-found" | "unavailable" | "invalid-link" };

export function PublicSharedRide() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [saveTitle, setSaveTitle] = useState("");
  const [saveState, setSaveState] = useState<{ status: "idle" | "busy" | "saved" | "error"; message?: string; needsLogin?: boolean }>({ status: "idle" });
  const [courseState, setCourseState] = useState<{ status: "idle" | "busy" | "error"; message?: string; needsLogin?: boolean }>({ status: "idle" });
  const [planningCourse, setPlanningCourse] = useState<CollectionCourse | null>(null);
  const mountedRef = useRef(false);
  const resolutionRef = useRef<Promise<void> | null>(null);
  const resolutionSequenceRef = useRef(0);
  const saveSequenceRef = useRef(0);
  const courseSequenceRef = useRef(0);
  const shareTokenRef = useRef("");
  const saveInFlightRef = useRef<number | null>(null);
  const saveAttemptRef = useRef<{ key: string; operationId: string } | null>(null);
  const saveDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    const resolveFragment = () => {
      const token = window.location.hash.slice(1);
      const resolutionSequence = ++resolutionSequenceRef.current;
      shareTokenRef.current = "";
      saveSequenceRef.current += 1;
      courseSequenceRef.current += 1;
      saveInFlightRef.current = null;
      saveAttemptRef.current = null;
      setSaveState({ status: "idle" });
      setCourseState({ status: "idle" });
      setPlanningCourse(null);
      saveDialogRef.current?.close();
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
      shareTokenRef.current = token;

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
            const snapshot = parseSharedRideSnapshot(body.snapshot);
            setSaveTitle(snapshot.trip.title.slice(0, 120));
            setState({ status: "found", snapshot, referenceTime: new Date().toISOString() });
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

  function openSaveDialog() {
    saveDialogRef.current?.showModal();
  }

  async function saveToCollections() {
    const title = saveTitle.trim();
    const token = shareTokenRef.current;
    if (!title || title.length > 120 || !/^[A-Za-z0-9_-]{43}$/.test(token) || saveInFlightRef.current !== null) return;
    const attemptKey = `${token}\n${title}`;
    if (!saveAttemptRef.current || saveAttemptRef.current.key !== attemptKey) {
      saveAttemptRef.current = { key: attemptKey, operationId: crypto.randomUUID() };
    }
    const operationId = saveAttemptRef.current.operationId;
    const saveSequence = ++saveSequenceRef.current;
    saveInFlightRef.current = saveSequence;
    setSaveState({ status: "busy" });
    try {
      const response = await fetch("/api/shares/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, saveOperationId: operationId, title }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { error?: unknown };
      if (!mountedRef.current || saveSequence !== saveSequenceRef.current || token !== shareTokenRef.current) return;
      if (response.ok) {
        setSaveState({ status: "saved", message: `${title}을(를) 내 라이딩 컬렉션에 저장했습니다.` });
        return;
      }
      const fallback = response.status === 401
        ? "로그인 후 이 창으로 돌아와 다시 저장해 주세요."
        : response.status === 403
          ? "이 계정에는 서비스 이용 권한이 없습니다."
          : "내 경로로 지금 저장할 수 없습니다. 잠시 뒤 다시 시도해 주세요.";
      setSaveState({ status: "error", message: typeof body.error === "string" ? body.error : fallback, needsLogin: response.status === 401 });
    } catch {
      if (mountedRef.current && saveSequence === saveSequenceRef.current && token === shareTokenRef.current) {
        setSaveState({ status: "error", message: "내 경로로 지금 저장할 수 없습니다. 잠시 뒤 다시 시도해 주세요." });
      }
    } finally {
      if (saveInFlightRef.current === saveSequence) saveInFlightRef.current = null;
    }
  }

  async function startNewSchedule() {
    if (courseState.status === "busy") return;
    const token = shareTokenRef.current;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const sequence = ++courseSequenceRef.current;
    setCourseState({ status: "busy" });
    try {
      const response = await fetch("/api/shares/course", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { course?: unknown; error?: unknown };
      if (!mountedRef.current || sequence !== courseSequenceRef.current || token !== shareTokenRef.current) return;
      if (!response.ok) {
        const fallback = response.status === 401 ? "로그인 후 이 창으로 돌아와 다시 시도해 주세요." : response.status === 403 ? "이 계정에는 서비스 이용 권한이 없습니다." : "새 일정을 지금 시작할 수 없습니다.";
        setCourseState({ status: "error", message: typeof body.error === "string" ? body.error : fallback, needsLogin: response.status === 401 });
        return;
      }
      setPlanningCourse(parseCollectionCourse(body.course));
      setCourseState({ status: "idle" });
    } catch {
      if (mountedRef.current && sequence === courseSequenceRef.current && token === shareTokenRef.current) setCourseState({ status: "error", message: "새 일정을 지금 시작할 수 없습니다. 잠시 뒤 다시 시도해 주세요." });
    }
  }

  return (
    <main className="shared-ride-shell">
      <header className="shared-ride-header">
        <Link className="brand" href="/" aria-label="MOTOCAST 홈"><span>MOTOCAST</span></Link>
        {state.status === "found" ? <span className="immutable-pill">불변 공유본</span> : null}
      </header>
      {state.status === "found" ? (
        planningCourse ? <section className="shared-planner-embed" aria-label="공유 경로 새 일정"><button className="shared-back-button" type="button" onClick={() => setPlanningCourse(null)}>← 공유 요약으로</button><PlannerDashboard connected initialCourse={planningCourse} initialTitle={state.snapshot.trip.title} navigationMode="memory" onExit={() => setPlanningCourse(null)} /></section> : <>
          <SharedRideSnapshotView snapshot={state.snapshot} referenceTime={state.referenceTime} backAction={<Link className="shared-home-link" href="/" aria-label="홈으로">홈으로</Link>} actions={<>
            <KakaoMapHandoff context="shared" readSource={() => ({ identity: String(resolutionSequenceRef.current), result: sharedHandoff(state.snapshot) })} onPrepare={() => void startNewSchedule()} />
            <div className="shared-summary-secondary"><button className="secondary-button" type="button" disabled={courseState.status === "busy"} onClick={() => void startNewSchedule()}>{courseState.status === "busy" ? "경로 준비 중…" : "새 일정으로 출발"}</button><button className="secondary-button" type="button" onClick={openSaveDialog}>내 경로로 저장</button></div>
          </>} />
          <p className="shared-save-scope">장소와 경유 순서만 저장됩니다. 날짜·출발 시각·공유 당시 날씨는 포함되지 않습니다.</p>
          {courseState.status === "error" ? <div className="shared-course-error" role="alert"><span>{courseState.message}</span>{courseState.needsLogin ? <Link href="/" target="_blank" rel="noreferrer">로그인 화면을 새 탭에서 열기</Link> : <button type="button" onClick={() => void startNewSchedule()}>다시 시도</button>}</div> : null}
          <dialog ref={saveDialogRef} className="shared-save-dialog" aria-labelledby="shared-save-dialog-title" onCancel={(event) => { if (saveInFlightRef.current !== null) event.preventDefault(); }}>
            <div className="shared-save-dialog-heading">
              <div><p className="eyebrow">MY RIDING COLLECTIONS</p><h2 id="shared-save-dialog-title">내 경로로 저장</h2></div>
              <button type="button" aria-label="저장 창 닫기" disabled={saveState.status === "busy"} onClick={() => saveDialogRef.current?.close()}>×</button>
            </div>
            <p>새 컬렉션 이름을 정해 주세요. 날짜와 출발 시각은 저장 후 새로 선택합니다.</p>
            <label><span>컬렉션 이름</span><input autoFocus disabled={saveState.status === "busy"} maxLength={120} value={saveTitle} onChange={(event) => { setSaveTitle(event.target.value); setSaveState({ status: "idle" }); }} /></label>
            {saveState.status === "saved" ? (
              <div className="shared-save-result" role="status">
                <strong>{saveState.message}</strong>
                <div><Link href="/">홈으로</Link><Link href="/#collections">내 컬렉션 보기</Link></div>
              </div>
            ) : (
              <>
                {saveState.status === "error" ? (
                  <div className="shared-save-error" role="alert">
                    <span>{saveState.message}</span>
                    {saveState.needsLogin ? <Link href="/" target="_blank" rel="noreferrer">로그인 화면을 새 탭에서 열기</Link> : null}
                  </div>
                ) : null}
                <div className="shared-save-actions">
                  <button type="button" disabled={saveState.status === "busy"} onClick={() => saveDialogRef.current?.close()}>취소</button>
                  <button className="primary-button" type="button" disabled={saveState.status === "busy" || !saveTitle.trim()} onClick={() => void saveToCollections()}>{saveState.status === "busy" ? "저장 중…" : "저장"}</button>
                </div>
              </>
            )}
          </dialog>
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
