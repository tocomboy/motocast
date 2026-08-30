"use client";

import { useCallback, useEffect, useState } from "react";

import { formatKoreanTime } from "@/lib/planner/schedule";
import { parseSharedRideSnapshot, type SharedRideSnapshot } from "@/lib/sharing/contracts";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type ShareLinkRow = { id: string; createdAt: string; revokedAt: string | null };

export function ShareManager({ tripId }: { tripId: string | null }) {
  const [links, setLinks] = useState<ShareLinkRow[]>([]);
  const [preview, setPreview] = useState<SharedRideSnapshot | null>(null);
  const [previewRaw, setPreviewRaw] = useState<unknown>(null);
  const [previewTripId, setPreviewTripId] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ tripId: string; url: string } | null>(null);
  const [status, setStatus] = useState("공유는 미리보기 후에만 발행됩니다.");
  const [busy, setBusy] = useState(false);

  const loadLinks = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const { data, error } = await supabase
      .from("share_links")
      .select("id,created_at,revoked_at")
      .order("created_at", { ascending: false });
    if (error || !Array.isArray(data)) {
      setStatus("공유 발행 기록을 불러오지 못했습니다.");
      return;
    }
    const parsed = data.flatMap((row) => (
      row && typeof row.id === "string" && typeof row.created_at === "string" &&
      (row.revoked_at === null || typeof row.revoked_at === "string")
        ? [{ id: row.id, createdAt: row.created_at, revokedAt: row.revoked_at }]
        : []
    ));
    if (parsed.length !== data.length) {
      setStatus("공유 발행 기록 응답을 안전하게 확인하지 못했습니다.");
      return;
    }
    setLinks(parsed);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void loadLinks(), 0);
    return () => window.clearTimeout(task);
  }, [loadLinks]);

  const activePreview = previewTripId === tripId ? preview : null;
  const issuedUrl = issued?.tripId === tripId ? issued.url : null;

  async function createPreview() {
    if (!tripId) {
      setStatus("실제 경로를 계산해 계획을 저장한 뒤 공유할 수 있습니다.");
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("preview_trip_share", { target_trip_id: tripId });
    setBusy(false);
    if (error) {
      setStatus("공유 미리보기를 만들지 못했습니다. 저장 상태와 권한을 확인해 주세요.");
      return;
    }
    try {
      setPreview(parseSharedRideSnapshot(data));
      setPreviewRaw(data);
      setPreviewTripId(tripId);
      setIssued(null);
      setStatus("아래 전체 내용을 확인한 뒤에만 링크를 발행하세요.");
    } catch {
      setStatus("공유 미리보기 응답을 안전하게 확인하지 못했습니다.");
    }
  }

  async function publish() {
    if (!tripId || !activePreview || previewRaw === null) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("publish_trip_share", { target_trip_id: tripId });
    if (error || !Array.isArray(data) || data.length !== 1) {
      setBusy(false);
      setStatus("공유 링크를 발행하지 못했습니다.");
      return;
    }
    const result = data[0] as { share_id?: unknown; share_token?: unknown; published_snapshot?: unknown };
    const token = result.share_token;
    const shareId = result.share_id;
    const matchesPreview = JSON.stringify(result.published_snapshot) === JSON.stringify(previewRaw);
    if (
      typeof shareId !== "string" || typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) || !matchesPreview
    ) {
      if (typeof shareId === "string") await supabase.rpc("revoke_share", { target_share_id: shareId });
      setBusy(false);
      setStatus("발행본이 승인한 미리보기와 일치하지 않아 링크를 즉시 회수했습니다.");
      await loadLinks();
      return;
    }
    setBusy(false);
    setIssued({ tripId, url: `${window.location.origin}/share/${token}` });
    setStatus("불변 공유 링크를 발행했습니다. 원본을 수정해도 이 링크의 내용은 바뀌지 않습니다.");
    await loadLinks();
  }

  async function revoke(link: ShareLinkRow) {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.rpc("revoke_share", { target_share_id: link.id });
    setBusy(false);
    if (error) {
      setStatus("공유 링크를 회수하지 못했습니다. 이미 회수됐거나 권한이 없습니다.");
      return;
    }
    setIssued(null);
    setStatus("공유 링크를 회수했습니다. 다시 공유하려면 새 미리보기와 새 링크를 발행하세요.");
    await loadLinks();
  }

  async function copyIssuedUrl() {
    if (!issuedUrl) return;
    try {
      await navigator.clipboard.writeText(issuedUrl);
      setStatus("공유 링크를 복사했습니다.");
    } catch {
      setStatus("자동 복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.");
    }
  }

  return (
    <section className="share-manager" aria-labelledby="share-heading">
      <div className="collection-heading-row">
        <div><p className="eyebrow">EXPLICIT SHARING</p><h2 id="share-heading">라이딩 공유</h2></div>
        <button className="secondary-button" type="button" disabled={busy || !tripId} onClick={() => void createPreview()}>
          {busy ? "처리 중…" : "전체 공유 미리보기"}
        </button>
      </div>

      {activePreview ? (
        <div className="share-preview">
          <div className="share-preview-warning"><strong>아직 공개되지 않았습니다.</strong><span>장소·시각·경로·날씨를 모두 확인하세요.</span></div>
          <h3>{activePreview.trip.title}</h3>
          <dl>
            <div><dt>날짜</dt><dd>{activePreview.trip.serviceDate}</dd></div>
            <div><dt>출발</dt><dd>{activePreview.trip.origin.label} · {formatKoreanTime(activePreview.trip.departureAt)}</dd></div>
            <div><dt>복귀</dt><dd>{activePreview.trip.destination.label} · 최종 {formatKoreanTime(activePreview.trip.hardReturnAt)}</dd></div>
            <div><dt>점심</dt><dd>{activePreview.trip.lunchStop.label}</dd></div>
            <div><dt>저녁</dt><dd>{activePreview.trip.dinnerStop?.label ?? "없음"}</dd></div>
            <div><dt>날씨</dt><dd>{activePreview.weather ? `${activePreview.weather.segments.length}개 지점 · ${formatKoreanTime(activePreview.weather.issuedAt)} 발행` : "저장된 예보 없음"}</dd></div>
          </dl>
          <ol>
            {activePreview.waypoints.map((point) => (
              <li key={point.position}><strong>{point.label}</strong><span>{point.kind} · {point.dwellMinutes}분 · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</span></li>
            ))}
          </ol>
          <div className="share-route-summary">
            {activePreview.routes.map((route) => (
              <span key={route.candidate.id}><strong>{route.candidate.label}</strong>{Math.round(route.totalDistanceMeters / 100) / 10} km · {Math.ceil(route.totalDurationSeconds / 60)}분</span>
            ))}
          </div>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void publish()}>이 내용 그대로 불변 링크 발행</button>
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
            <li key={link.id}>
              <span><strong>{new Date(link.createdAt).toLocaleString("ko-KR")}</strong>{link.revokedAt ? "회수됨" : "공개 중"}</span>
              {!link.revokedAt ? <button className="danger-text" type="button" disabled={busy} onClick={() => void revoke(link)}>링크 회수</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="manager-status" role="status" aria-live="polite">{status}</p>
    </section>
  );
}
