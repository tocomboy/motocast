"use client";

import { useEffect, useId, useRef, useState } from "react";
import { handoffPlatform, kakaoMapStores, kakaoMapUrl, type HandoffPlatform, type HandoffResult } from "@/lib/planner/kakaomap-handoff";
import { launchKakaoMap } from "@/lib/planner/kakaomap-launch";

type Source = { identity: string; result: HandoffResult };
type Panel = "confirm" | "blocked" | "after";

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
  const cancelLaunch = useRef<() => void>(() => {});
  const sourceReader = useRef(readSource);
  useEffect(() => { sourceReader.current = readSource; });
  useEffect(() => () => cancelLaunch.current(), []);
  const [panel, setPanel] = useState<Panel>("confirm");
  const [platform, setPlatform] = useState<HandoffPlatform>("desktop");
  const [launchFailed, setLaunchFailed] = useState(false);
  const [blocked, setBlocked] = useState<Extract<HandoffResult, { status: "blocked" }> | null>(null);

  function prepare() {
    cancelLaunch.current();
    setLaunchFailed(false);
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
      const identity = current.identity;
      cancelLaunch.current = launchKakaoMap(currentUrl!, platform, () => {
        const latest = sourceReader.current();
        return dialog.current?.open === true && latest.identity === identity && latest.result.status === "ready"
          && kakaoMapUrl(latest.result.places, platform) === currentUrl;
      }, () => setLaunchFailed(true));
    } catch {
      // The browser rejected the request. Recovery links remain in the return panel.
      setPanel("after");
      setLaunchFailed(true);
    }
  }

  function close() {
    cancelLaunch.current();
    attempt.current = null;
    dialog.current?.close();
    trigger.current?.focus();
  }

  const mobile = platform !== "desktop";
  const isOver = blocked?.reason === "over-limit";
  const title = panel === "after" ? "카카오맵에서 경로를 확인해 주세요"
      : panel === "blocked" ? isOver ? "경유지를 줄여 주세요" : blocked?.reason === "stale" ? "경로를 다시 계산해 주세요" : "실행할 경로를 다시 확인해 주세요"
        : "카카오맵에서 경로 옵션을 확인해 주세요";

  return <>
    <button ref={trigger} className="primary-button kakaomap-trigger" type="button" onClick={prepare}>경로 실행</button>
    <dialog ref={dialog} className="kakaomap-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => { cancelLaunch.current(); attempt.current = null; }} onKeyDown={(event) => {
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
        <p><strong>경유지 최대 5개</strong></p>
        <p><strong>자동차전용도로 제외</strong><br />카카오맵에서 직접 선택해 주세요.</p>
        <button className="primary-button" type="button" onClick={execute}>확인하고 카카오맵 열기</button>
      </> : null}
      {panel === "blocked" ? <>
        <p role="alert">{isOver ? `현재 경유지 ${blocked.count}개 - 경유지 5개 제한 초과` : blocked?.reason === "stale" ? "경로·출발 시간을 확인하고 다시 계산한 뒤 실행해 주세요." : "장소와 방문 순서를 확인할 수 없거나 요약이 바뀌었습니다. 경로를 다시 준비해 주세요."}</p>
        {isOver ? <p>{context === "shared" ? "‘새 일정으로 출발’에서 경유지를 직접 5개 이하로 줄이고 다시 계산해 주세요." : "경유지를 5개 이하로 줄인 뒤 다시 계산해 주세요."}</p> : null}
        <button className="primary-button" type="button" onClick={() => { close(); onPrepare(); }}>{context === "shared" ? "새 일정으로 출발" : "경로 편집으로"}</button>
        {isOver ? <p className="kakaomap-hint">임의 삭제·순서 변경·자동 분할은 하지 않아요.</p> : null}
      </> : null}
      {panel === "after" ? <>
        {launchFailed ? <p role="alert">브라우저가 외부 화면 열기를 허용하지 않았습니다. 아래 안내에 따라 다시 시도해 주세요.</p> : null}
        <p>방문 순서와 ‘자동차전용도로 제외’ 옵션을 확인한 뒤 카카오맵에서 안내를 시작해 주세요.</p>
        <p>{mobile ? "카카오맵 미설치 시 공식 스토어로 이동합니다. 설치 후 돌아와 ‘다시 실행’을 눌러 주세요." : "새 탭이 열리지 않았다면 브라우저의 팝업 차단을 확인한 뒤 다시 실행해 주세요."}</p>
        <button className="primary-button" type="button" onClick={prepare}>다시 실행</button>
        {mobile ? <>
          <p className="kakaomap-hint">스토어가 열리지 않았다면 아래 링크를 이용해 주세요. 화면이 초기화되면 {context === "shared" ? "받은 공유 링크를 다시 열어 주세요." : "경로와 출발 시간을 다시 준비해 주세요."}</p>
          {(platform === "android" || platform === "mobile") ? <a href={kakaoMapStores.android} target="_blank" rel="noopener noreferrer">Google Play에서 카카오맵 설치</a> : null}
          {(platform === "ios" || platform === "mobile") ? <a href={kakaoMapStores.ios} target="_blank" rel="noopener noreferrer">App Store에서 카카오맵 설치</a> : null}
        </> : null}
        {context === "shared" ? <p className="kakaomap-hint">공유 당시 시간·날씨는 현재 주행 기준이 아니에요.</p> : null}
      </> : null}
      <button type="button" onClick={close}>{panel === "after" ? "요약으로 돌아가기" : "취소"}</button>
    </dialog>
  </>;
}
