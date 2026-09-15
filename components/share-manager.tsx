"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SharedRideSnapshotView } from "@/components/shared-ride-snapshot";
import { parseSharedRideSnapshot, type SharedRideSnapshot } from "@/lib/sharing/contracts";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type ShareLinkRow = { id: string; createdAt: string; revokedAt: string | null };
type ShareStatus = { epoch: number; message: string };

export function ShareManager({ tripId, sessionEpoch = 0, previewRequest = 0, disabled = false }: { tripId: string | null; sessionEpoch?: number; previewRequest?: number; disabled?: boolean }) {
  const [links, setLinks] = useState<ShareLinkRow[]>([]);
  const [preview, setPreview] = useState<SharedRideSnapshot | null>(null);
  const [previewRaw, setPreviewRaw] = useState<unknown>(null);
  const [previewTripId, setPreviewTripId] = useState<string | null>(null);
  const [previewEpoch, setPreviewEpoch] = useState(-1);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewReferenceTime, setPreviewReferenceTime] = useState<string>(new Date(0).toISOString());
  const [issued, setIssued] = useState<{ epoch: number; tripId: string; shareId: string; url: string } | null>(null);
  const [status, setStatus] = useState<ShareStatus>({
    epoch: sessionEpoch,
    message: "여행 루트와 날씨 요약을 확인한 뒤에만 발행됩니다.",
  });
  const [busyEpoch, setBusyEpoch] = useState<number | null>(null);
  const handledPreviewRequestRef = useRef(0);
  const linksRequestRef = useRef(0);
  const sessionEpochRef = useRef(sessionEpoch);
  const busy = busyEpoch === sessionEpoch;

  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  const loadLinks = useCallback(async (reportErrors = true) => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const linksRequest = ++linksRequestRef.current;
    const { data, error } = await supabase
      .from("share_links")
      .select("id,created_at,revoked_at")
      .order("created_at", { ascending: false });
    if (linksRequest !== linksRequestRef.current) return;
    if (error || !Array.isArray(data)) {
      if (reportErrors) setStatus({ epoch: sessionEpochRef.current, message: "공유 발행 기록을 불러오지 못했습니다." });
      return;
    }
    const parsed = data.flatMap((row) => (
      row && typeof row.id === "string" && typeof row.created_at === "string" &&
      (row.revoked_at === null || typeof row.revoked_at === "string")
        ? [{ id: row.id, createdAt: row.created_at, revokedAt: row.revoked_at }]
        : []
    ));
    if (parsed.length !== data.length) {
      if (reportErrors) setStatus({ epoch: sessionEpochRef.current, message: "공유 발행 기록 응답을 안전하게 확인하지 못했습니다." });
      return;
    }
    setLinks(parsed);
  }, []);

  const createPreview = useCallback(async () => {
    if (disabled) return;
    if (!tripId) {
      setStatus({ epoch: sessionEpoch, message: "실제 경로와 유효한 최신 날씨를 준비한 뒤 공유할 수 있습니다." });
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const operationEpoch = sessionEpoch;
    setBusyEpoch(operationEpoch);
    const { data, error } = await supabase.rpc("preview_trip_share", { target_trip_id: tripId });
    if (sessionEpochRef.current !== operationEpoch) return;
    setBusyEpoch(null);
    if (error) {
      setStatus({
        epoch: operationEpoch,
        message: error.message.includes("SHARE_WEATHER_NOT_FRESH")
          ? "아직 유효한 최신 날씨가 없어 공유 미리보기를 만들 수 없습니다. 날씨를 다시 조회해 주세요."
          : "공유 미리보기를 만들지 못했습니다. 저장 상태와 권한을 확인해 주세요.",
      });
      return;
    }
    if (!Array.isArray(data) || data.length !== 1) {
      setStatus({ epoch: operationEpoch, message: "공유 미리보기 응답을 안전하게 확인하지 못했습니다." });
      return;
    }
    const row = data[0] as { preview_snapshot?: unknown; preview_token?: unknown };
    if (typeof row.preview_token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row.preview_token)) {
      setStatus({ epoch: operationEpoch, message: "공유 미리보기 승인 정보를 안전하게 확인하지 못했습니다." });
      return;
    }
    try {
      setPreview(parseSharedRideSnapshot(row.preview_snapshot));
      setPreviewRaw(row.preview_snapshot);
      setPreviewToken(row.preview_token);
      setPreviewTripId(tripId);
      setPreviewEpoch(operationEpoch);
      setPreviewReferenceTime(new Date().toISOString());
      setIssued(null);
      setStatus({ epoch: operationEpoch, message: "아래 여행 루트와 날씨 요약을 확인한 뒤 링크를 발행하세요." });
    } catch {
      setStatus({ epoch: operationEpoch, message: "공유 미리보기 응답을 안전하게 확인하지 못했습니다." });
    }
  }, [disabled, sessionEpoch, tripId]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadLinks(), 0);
    return () => window.clearTimeout(task);
  }, [loadLinks]);

  useEffect(() => {
    if (previewRequest <= handledPreviewRequestRef.current || !tripId || disabled || busy) return;
    handledPreviewRequestRef.current = previewRequest;
    void createPreview();
  }, [previewRequest, tripId, disabled, busy, createPreview]);

  const activePreview = previewEpoch === sessionEpoch && previewTripId === tripId ? preview : null;
  const issuedUrl = issued?.epoch === sessionEpoch && issued.tripId === tripId ? issued.url : null;
  const visibleStatus = !tripId
    ? "실제 경로와 유효한 최신 날씨를 준비한 뒤 공유할 수 있습니다."
    : status.epoch === sessionEpoch
      ? status.message
      : "여행 루트와 날씨 요약을 확인한 뒤에만 발행됩니다.";

  async function publish() {
    if (disabled) return;
    if (!tripId || !activePreview || previewEpoch !== sessionEpoch || previewRaw === null || !previewToken) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const operationEpoch = sessionEpoch;
    setBusyEpoch(operationEpoch);
    const { data, error } = await supabase.rpc("publish_trip_share", {
      target_trip_id: tripId,
      approved_preview_token: previewToken,
    });
    if (sessionEpochRef.current !== operationEpoch) {
      if (!error) await loadLinks(false);
      return;
    }
    if (error || !Array.isArray(data) || data.length !== 1) {
      setBusyEpoch(null);
      if (error?.message.includes("SHARE_PREVIEW")) {
        setPreviewToken(null);
        setStatus({ epoch: operationEpoch, message: "미리보기가 만료됐거나 원본이 바뀌었습니다. 공유 요약 미리보기를 다시 만들어 주세요." });
      } else if (error?.message.includes("SHARE_WEATHER_NOT_FRESH")) {
        setPreviewToken(null);
        setStatus({ epoch: operationEpoch, message: "날씨가 오래됐거나 만료되어 발행하지 않았습니다. 날씨를 다시 조회하고 새 미리보기를 확인해 주세요." });
      } else {
        setStatus({ epoch: operationEpoch, message: "공유 링크를 발행하지 못했습니다." });
      }
      return;
    }
    const result = data[0] as { share_id?: unknown; share_token?: unknown };
    const token = result.share_token;
    const shareId = result.share_id;
    if (typeof shareId !== "string" || typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setBusyEpoch(null);
      setStatus({ epoch: operationEpoch, message: "발행 결과를 안전하게 확인하지 못했습니다. 공유 기록에서 공개 상태를 확인해 주세요." });
      return;
    }
    setBusyEpoch(null);
    setPreviewToken(null);
    setIssued({ epoch: operationEpoch, tripId, shareId, url: `${window.location.origin}/share#${token}` });
    setStatus({ epoch: operationEpoch, message: "불변 공유 링크를 발행했습니다. 원본을 수정해도 이 링크의 내용은 바뀌지 않습니다." });
    await loadLinks();
  }

  async function revoke(link: ShareLinkRow) {
    if (disabled) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const operationEpoch = sessionEpoch;
    setBusyEpoch(operationEpoch);
    const { error } = await supabase.rpc("revoke_share", { target_share_id: link.id });
    if (sessionEpochRef.current !== operationEpoch) {
      if (!error) await loadLinks(false);
      return;
    }
    setBusyEpoch(null);
    if (error) {
      setStatus({ epoch: operationEpoch, message: "공유 링크를 회수하지 못했습니다. 이미 회수됐거나 권한이 없습니다." });
      return;
    }
    if (issued?.shareId === link.id) setIssued(null);
    setStatus({ epoch: operationEpoch, message: "공유 링크를 회수했습니다. 다시 공유하려면 새 미리보기와 새 링크를 발행하세요." });
    await loadLinks();
  }

  async function copyIssuedUrl() {
    if (!issuedUrl) return;
    try {
      await navigator.clipboard.writeText(issuedUrl);
      setStatus({ epoch: sessionEpoch, message: "공유 링크를 복사했습니다." });
    } catch {
      setStatus({ epoch: sessionEpoch, message: "자동 복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요." });
    }
  }

  return (
    <section className="share-manager" aria-labelledby="share-heading">
      <div className="collection-heading-row">
        <div><p className="eyebrow">EXPLICIT SHARING</p><h2 id="share-heading">라이딩 공유</h2></div>
        <button className="secondary-button" type="button" disabled={disabled || busy || !tripId} onClick={() => void createPreview()}>
          {busy ? "처리 중…" : "공유 요약 미리보기"}
        </button>
      </div>

      {activePreview ? (
        <div className="share-preview">
          <div className="share-preview-warning"><strong>아직 공개되지 않았습니다.</strong><span>여행 루트와 구간별 날씨를 확인하세요.</span></div>
          <SharedRideSnapshotView snapshot={activePreview} referenceTime={previewReferenceTime} preview />
          <button className="primary-button" type="button" disabled={disabled || busy || !previewToken} onClick={() => void publish()}>이 요약으로 불변 링크 발행</button>
        </div>
      ) : null}

      {issuedUrl ? (
        <div className="issued-link">
          <label><span>이번에 발행한 링크 · 원문은 다시 조회할 수 없음</span><input readOnly value={issuedUrl} onFocus={(event) => event.currentTarget.select()} /></label>
          <button type="button" onClick={() => void copyIssuedUrl()}>복사</button>
        </div>
      ) : null}

      {links.length ? (
        <ul className="share-link-list" aria-label="내 공유 발행 기록">
          {links.map((link) => (
            <li key={link.id} data-share-id={link.id}>
              <span><strong>{new Date(link.createdAt).toLocaleString("ko-KR")}</strong>{link.revokedAt ? "회수됨" : "공개 중"}</span>
              {!link.revokedAt ? <button className="danger-text" type="button" disabled={disabled || busy} onClick={() => void revoke(link)}>링크 회수</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="manager-status" role="status" aria-live="polite">{visibleStatus}</p>
    </section>
  );
}
