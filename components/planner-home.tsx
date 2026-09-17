"use client";

import type { ReactNode } from "react";
import Image from "next/image";

export function PlannerHome({ connected, busy, status, onNewRoute, onCollections, collections }: { connected: boolean; busy: boolean; status?: string; onNewRoute: () => void; onCollections: () => void; collections?: ReactNode }) {
  return (
    <section className="planner-home" aria-labelledby="planner-home-title">
      <div className="planner-home-hero">
        <div className="planner-home-copy">
          <p className="eyebrow">경로부터 날씨까지, 한 번에.</p>
          <h1 id="planner-home-title" data-view-title="home" tabIndex={-1}><span>오늘은 어디로</span> <span>달려볼까요?</span></h1>
          <p className="planner-home-description"><span>갈 곳을 정하면 달리는 시간에 맞춰</span><span>지도와 구간별 날씨를 함께 확인할 수 있어요.</span></p>
        </div>
        <Image className="planner-home-motorcycle" src="/figma/motorcycle.svg" alt="" width={224} height={210} priority />
      </div>
      <p className="planner-home-mobile-description"><span>갈 곳을 정하면, 달리는 시간에 맞춰</span><span>경로와 날씨를 함께 확인할 수 있어요.</span></p>
      <div className="planner-home-entry-grid">
        <article><p>01&nbsp;&nbsp;새로운 라이딩</p><h2>새 경로 만들기</h2><p>출발지와 도착지, 중간에 들를 곳을 정하세요.</p><button className="primary-button" type="button" disabled={busy} onClick={onNewRoute}>+&nbsp;&nbsp;새 경로 만들기</button></article>
        {connected ? <article><p>02&nbsp;&nbsp;다시 달리고 싶은 길</p><h2>저장한 경로 모음</h2><p>저장한 경로를 비교하고 새 출발 일정을 정하세요.</p><button type="button" onClick={onCollections}>저장한 경로 보기</button></article> : <article><p>02&nbsp;&nbsp;예시로 둘러보기</p><h2>예시 경로 편집</h2><p>데모 경로로 장소와 일정을 바꿔 볼 수 있어요.</p><button type="button" onClick={onNewRoute}>예시 경로 보기</button></article>}
      </div>
      {status ? <p className="planner-home-status" role="status">{status}</p> : null}
      {connected && collections ? <><div className="planner-home-collections"><div className="planner-home-section-heading"><h2><span className="desktop-home-heading">최근 저장한 경로</span><span className="mobile-home-heading">저장한 경로</span></h2><button type="button" onClick={onCollections}>전체 보기</button><p>경로를 고른 뒤 출발 날짜·시간을 정하세요.</p></div>{collections}</div><aside className="planner-home-save-note"><strong>마음에 드는 경로를 모아두세요</strong><span><span>라이딩 결과 화면의 공유 · 저장에서</span><span>경로를 저장할 수 있어요.</span></span></aside></> : null}
    </section>
  );
}
