import Link from "next/link";
import { notFound } from "next/navigation";

import { KakaoMapCanvas } from "@/components/kakao-map-canvas";
import { formatKoreanTime } from "@/lib/planner/schedule";
import { resolvePublicShare } from "@/lib/sharing/resolve";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SharedRidePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snapshot = await resolvePublicShare(token);
  if (!snapshot) notFound();

  const selected = snapshot.routes.find((route) => route.candidate.id === snapshot.trip.selectedProfile) ?? snapshot.routes[0];
  const path = selected.legs.flatMap((leg) => leg.sections.flatMap((section) => section.roads.flatMap((road) => {
    const points = [];
    for (let index = 0; index < road.vertexes.length; index += 2) {
      points.push({ longitude: road.vertexes[index], latitude: road.vertexes[index + 1] });
    }
    return points;
  })));
  const points = [selected.legs[0].from, ...selected.legs.map((leg) => leg.to)];

  return (
    <main className="shared-ride-shell">
      <header className="shared-ride-header">
        <Link className="brand" href="/" aria-label="MOTOCAST 홈"><span className="brand-mark">M</span><span>MOTOCAST</span></Link>
        <span className="immutable-pill">불변 공유본</span>
      </header>
      <section className="shared-hero">
        <div>
          <p className="eyebrow">SHARED RIDE SNAPSHOT</p>
          <h1>{snapshot.trip.title}</h1>
          <p>원본 계획을 수정해도 이 발행본은 바뀌지 않습니다. 링크 소유자가 회수하면 즉시 접근할 수 없습니다.</p>
        </div>
        <dl>
          <div><dt>라이딩 날짜</dt><dd>{snapshot.trip.serviceDate}</dd></div>
          <div><dt>출발</dt><dd>{formatKoreanTime(snapshot.trip.departureAt)}</dd></div>
          <div><dt>최종 복귀</dt><dd>{formatKoreanTime(snapshot.trip.hardReturnAt)}</dd></div>
          <div><dt>선택 경로</dt><dd>{selected.candidate.label}</dd></div>
        </dl>
      </section>
      <section className="shared-map" aria-label="공유된 라이딩 경로">
        <KakaoMapCanvas points={points} path={path} />
        <div className="shared-map-summary">
          <strong>{snapshot.trip.origin.label} → {snapshot.trip.destination.label}</strong>
          <span>{Math.round(selected.totalDistanceMeters / 100) / 10} km · 약 {Math.ceil(selected.totalDurationSeconds / 60)}분</span>
        </div>
      </section>
      <div className="shared-grid">
        <section>
          <p className="eyebrow">STOPS</p><h2>경유와 정차</h2>
          <ol className="shared-stops">
            {snapshot.waypoints.map((point) => (
              <li key={point.position}><span>{String(point.position + 1).padStart(2, "0")}</span><div><strong>{point.label}</strong><small>{point.kind} · {point.dwellMinutes ? `${point.dwellMinutes}분 정차` : "통과"}{point.winding ? " · 커스텀 와인딩" : ""}</small></div></li>
            ))}
          </ol>
        </section>
        <section>
          <p className="eyebrow">ROUTE OPTIONS</p><h2>발행된 후보 3개</h2>
          <div className="shared-routes">
            {snapshot.routes.map((route) => (
              <article key={route.candidate.id} className={route.candidate.id === snapshot.trip.selectedProfile ? "selected" : ""}>
                <strong>{route.candidate.label}</strong>
                <span>{Math.round(route.totalDistanceMeters / 100) / 10} km · {Math.ceil(route.totalDurationSeconds / 60)}분</span>
                <small>{route.safety.vehicle === "motorcycle" && route.safety.motorwayExcluded ? "이륜차 · 자동차전용도로 제외" : "안전 조건 확인 필요"}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
      <footer className="shared-footer">
        <strong>날씨 정보</strong>
        <span>{snapshot.weather ? `${formatKoreanTime(snapshot.weather.issuedAt)} 발행 · ${snapshot.weather.segments.length}개 통과 지점` : "이 발행본에는 저장된 날씨가 없습니다."}</span>
      </footer>
    </main>
  );
}
