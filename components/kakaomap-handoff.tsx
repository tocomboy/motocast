"use client";

import { useId, useRef, useState } from "react";
import { handoffPlatform, kakaoMapStores, kakaoMapUrl, type HandoffPlatform, type HandoffResult } from "@/lib/planner/kakaomap-handoff";

type Source = { identity: string; result: HandoffResult };
type Panel = "confirm" | "blocked" | "install" | "after";

export function KakaoMapHandoff({ context, readSource, onPrepare }: {
  context: "owner" | "shared";
  readSource: () => Source;
  onPrepare: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ identity: string; url: string } | null>(null);
  const launched = useRef(false);
  const [panel, setPanel] = useState<Panel>("confirm");
  const [platform, setPlatform] = useState<HandoffPlatform>("desktop");
  const [blocked, setBlocked] = useState<Extract<HandoffResult, { status: "blocked" }> | null>(null);

  function prepare() {
    const target = handoffPlatform(navigator.userAgent, navigator.maxTouchPoints);
    setPlatform(target);
    const source = readSource();
    launched.current = false;
    if (source.result.status === "blocked") {
      attempt.current = null;
      setBlocked(source.result);
      setPanel("blocked");
    } else {
      attempt.current = { identity: source.identity, url: kakaoMapUrl(source.result.places, target) };
      setPanel("confirm");
    }
    if (!dialog.current?.open) dialog.current?.showModal();
  }

  function execute() {
    if (launched.current || !attempt.current) return;
    const current = readSource();
    const currentUrl = current.result.status === "ready" ? kakaoMapUrl(current.result.places, platform) : null;
    if (current.result.status !== "ready" || current.identity !== attempt.current.identity || currentUrl !== attempt.current.url) {
      setBlocked(current.result.status === "blocked" ? current.result : { status: "blocked", reason: "changed" });
      attempt.current = null;
      setPanel("blocked");
      return;
    }
    launched.current = true;
    setPanel("after");
    try {
      if (platform === "desktop") window.open(currentUrl!, "_blank", "noopener,noreferrer");
      else window.location.assign(currentUrl!);
    } catch {
      // Unsupported scheme / browser policy: explicit recovery, never a web fallback.
      setPanel(platform === "desktop" ? "after" : "install");
    }
  }

  function close() {
    attempt.current = null;
    dialog.current?.close();
    trigger.current?.focus();
  }

  const mobile = platform !== "desktop";
  const isOver = blocked?.reason === "over-limit";
  const title = panel === "install" ? "카카오맵 앱이 필요합니다"
    : panel === "after" ? "카카오맵에서 경로를 확인해 주세요"
      : panel === "blocked" ? isOver ? "경유지를 줄여 주세요" : blocked?.reason === "stale" ? "경로를 다시 계산해 주세요" : "실행할 경로를 다시 확인해 주세요"
        : "카카오맵에서 경로 옵션을 확인해 주세요";

  return <>
    <button ref={trigger} className="primary-button kakaomap-trigger" type="button" onClick={prepare}>경로 실행</button>
    <dialog ref={dialog} className="kakaomap-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => { attempt.current = null; }} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}>
      <h2 id={titleId}>{title}</h2>
      {panel === "confirm" ? <>
        {context === "shared" ? <p>공유 당시 시간·날씨는 현재 주행 기준이 아닙니다. 장소와 방문 순서만 전달합니다.</p> : null}
        <p>오토바이 주행 전 <strong>‘자동차전용도로 제외’</strong> 경로를 선택해 주세요.</p>
        <p>카카오맵에는 경유지를 최대 5개까지 전달할 수 있습니다.</p>
        <p>카카오맵에서 계산한 경로와 도착 시간은 {context === "shared" ? "공유 요약" : "MOTOCAST"}과 다를 수 있습니다.</p>
        <button className="primary-button" type="button" onClick={execute}>확인하고 카카오맵 열기</button>
        {mobile ? <button type="button" onClick={() => setPanel("install")}>카카오맵 설치 안내</button> : <p className="kakaomap-hint">PC에서는 카카오맵을 새 탭으로 열어요.</p>}
      </> : null}
      {panel === "blocked" ? <>
        <p role="alert">{isOver ? `현재 경유지 ${blocked.count}개 - 경유지 5개 제한 초과` : blocked?.reason === "stale" ? "경로·출발 시간을 확인하고 다시 계산한 뒤 실행해 주세요." : "장소와 방문 순서를 확인할 수 없거나 요약이 바뀌었습니다. 경로를 다시 준비해 주세요."}</p>
        {isOver ? <p>{context === "shared" ? "‘새 일정으로 출발’에서 경유지를 직접 5개 이하로 줄이고 다시 계산해 주세요." : "경유지를 5개 이하로 줄인 뒤 다시 계산해 주세요."}</p> : null}
        <button className="primary-button" type="button" onClick={() => { close(); onPrepare(); }}>{context === "shared" ? "새 일정으로 출발" : "경로 편집으로"}</button>
        {isOver ? <p className="kakaomap-hint">임의 삭제·순서 변경·자동 분할은 하지 않아요.</p> : null}
      </> : null}
      {panel === "install" ? <>
        <p>카카오맵이 열리지 않으면 앱을 설치한 뒤 MOTOCAST로 돌아와 다시 실행해 주세요.</p>
        {(platform === "android" || platform === "mobile") ? <a className="primary-button" href={kakaoMapStores.android} target="_blank" rel="noopener noreferrer">카카오맵 설치 · Android</a> : null}
        {(platform === "ios" || platform === "mobile") ? <a className="primary-button" href={kakaoMapStores.ios} target="_blank" rel="noopener noreferrer">카카오맵 설치 · iPhone</a> : null}
        <p>이 화면으로 돌아와 ‘다시 실행’을 눌러 주세요. 화면이 초기화되면 {context === "shared" ? "받은 공유 링크를 다시 열어 주세요." : "경로와 출발 시간을 다시 준비해 주세요."}</p>
        <button type="button" onClick={prepare}>다시 실행</button>
      </> : null}
      {panel === "after" ? <>
        <p>방문 순서와 ‘자동차전용도로 제외’ 옵션을 확인한 뒤 카카오맵에서 안내를 시작해 주세요.</p>
        <p>{mobile ? "앱이 열리지 않았다면 설치를 확인해 주세요." : "새 탭이 열리지 않았다면 브라우저의 팝업 차단을 확인한 뒤 다시 실행해 주세요."}</p>
        <button className="primary-button" type="button" onClick={prepare}>다시 실행</button>
        {mobile ? <button type="button" onClick={() => setPanel("install")}>카카오맵 설치 안내</button> : null}
        {context === "shared" ? <p className="kakaomap-hint">공유 당시 시간·날씨는 현재 주행 기준이 아니에요.</p> : null}
      </> : null}
      <button type="button" onClick={close}>{panel === "after" ? "요약으로 돌아가기" : "취소"}</button>
    </dialog>
  </>;
}
