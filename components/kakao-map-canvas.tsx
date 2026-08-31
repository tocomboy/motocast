"use client";

import { useEffect, useRef, useState } from "react";

export type MapMarkerRole = "origin" | "destination" | "lunch" | "dinner" | "rest" | "winding" | "waypoint";
export type MapPoint = { label: string; latitude: number; longitude: number; role?: MapMarkerRole; nonTraversed?: boolean };
type PathPoint = { latitude: number; longitude: number };
const KAKAO_MAP_LOAD_TIMEOUT_MS = 10_000;
const markerAppearance: Record<MapMarkerRole, { label: string; symbol: string; color: string }> = {
  origin: { label: "출발", symbol: "출", color: "#18372b" },
  destination: { label: "복귀", symbol: "복", color: "#3e5873" },
  lunch: { label: "점심", symbol: "점", color: "#cc5d32" },
  dinner: { label: "저녁", symbol: "저", color: "#764a78" },
  rest: { label: "휴식", symbol: "휴", color: "#277b74" },
  winding: { label: "와인딩", symbol: "와", color: "#9a6427" },
  waypoint: { label: "경유", symbol: "경", color: "#5f6d63" },
};

function markerImage(maps: KakaoMapsNamespace, points: MapPoint[]) {
  const markerKinds = Array.from(new Map(points.map((point) => {
    const role = point.role ?? "waypoint";
    return [`${role}:${Boolean(point.nonTraversed)}`, { role, nonTraversed: Boolean(point.nonTraversed) }] as const;
  })).values());
  if (markerKinds.length > 1 || markerKinds[0].nonTraversed) {
    const width = 12 + markerKinds.length * 26;
    const center = width / 2;
    const badges = markerKinds.map(({ role, nonTraversed }, index) => {
      const appearance = markerAppearance[role];
      const cx = 19 + index * 26;
      const symbol = `${appearance.symbol}${nonTraversed ? "×" : ""}`;
      return `<circle cx="${cx}" cy="18" r="11" fill="${appearance.color}"/><text x="${cx}" y="21.5" text-anchor="middle" font-family="sans-serif" font-size="${nonTraversed ? 8 : 10}" font-weight="800" fill="#fffdf8">${symbol}</text>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="44" viewBox="0 0 ${width} 44"><path d="M${center - 6} 33 L${center} 43 L${center + 6} 33Z" fill="#fffdf8" stroke="#18372b" stroke-width="1.5"/><rect x="1" y="1" width="${width - 2}" height="34" rx="17" fill="#fffdf8" stroke="#18372b" stroke-width="1.5"/>${badges}</svg>`;
    return new maps.MarkerImage(
      `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      new maps.Size(width, 44),
      { offset: new maps.Point(center, 43) },
    );
  }
  const appearance = markerAppearance[markerKinds[0].role];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path d="M18 1C8.6 1 1 8.6 1 18c0 12.2 17 25 17 25s17-12.8 17-25C35 8.6 27.4 1 18 1Z" fill="${appearance.color}" stroke="#fffdf8" stroke-width="2"/><circle cx="18" cy="18" r="11" fill="#fffdf8"/><text x="18" y="22" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="800" fill="${appearance.color}">${appearance.symbol}</text></svg>`;
  return new maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    new maps.Size(36, 44),
    { offset: new maps.Point(18, 43) },
  );
}

function markerGroups(points: MapPoint[]) {
  const groups = new Map<string, { latitude: number; longitude: number; points: MapPoint[] }>();
  points.forEach((point) => {
    const key = `${point.latitude}:${point.longitude}`;
    const group = groups.get(key);
    if (group) group.points.push(point);
    else groups.set(key, { latitude: point.latitude, longitude: point.longitude, points: [point] });
  });
  return Array.from(groups.values());
}

export function KakaoMapCanvas({ points, path }: { points: MapPoint[]; path?: PathPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
  const geometryKey = JSON.stringify({ points, path: path ?? [] });
  const [mapState, setMapState] = useState<{ status: "loading" | "ready" | "error"; geometryKey: string }>({
    status: "loading",
    geometryKey,
  });
  const state = appKey
    ? mapState.geometryKey === geometryKey ? mapState.status : "loading"
    : "demo";
  const isReady = state === "ready";

  useEffect(() => {
    if (!appKey) return;
    const geometry = JSON.parse(geometryKey) as { points: MapPoint[]; path: PathPoint[] };

    let active = true;
    let script: HTMLScriptElement | null = null;
    let onLoad: (() => void) | null = null;
    let onError: (() => void) | null = null;
    const timeout = window.setTimeout(() => {
      if (active) setMapState({ status: "error", geometryKey });
    }, KAKAO_MAP_LOAD_TIMEOUT_MS);

    const fail = () => {
      if (!active) return;
      window.clearTimeout(timeout);
      setMapState({ status: "error", geometryKey });
    };

    const renderMap = () => {
      if (!containerRef.current) return;
      const maps = window.kakao?.maps;
      if (!maps) {
        fail();
        return;
      }
      if (typeof maps.load !== "function") {
        fail();
        return;
      }
      try {
        maps.load(() => {
          if (!active || !containerRef.current) return;
          const loadedMaps = window.kakao?.maps;
          if (!loadedMaps) {
            fail();
            return;
          }
          try {
            const groupedMarkers = markerGroups(geometry.points);
            const markerPath = groupedMarkers.map((group) => new loadedMaps.LatLng(group.latitude, group.longitude));
            const routePath = geometry.path.map((point) => new loadedMaps.LatLng(point.latitude, point.longitude));
            const map = new loadedMaps.Map(containerRef.current, { center: markerPath[0], level: 8 });
            const bounds = new loadedMaps.LatLngBounds();
            routePath.forEach((position) => bounds.extend(position));
            markerPath.forEach((position, index) => {
              bounds.extend(position);
              const group = groupedMarkers[index];
              new loadedMaps.Marker({
                map,
                position,
                title: group.points.map((point) => `${markerAppearance[point.role ?? "waypoint"].label} · ${point.label}`).join(" / "),
                image: markerImage(loadedMaps, group.points),
              });
            });
            if (routePath.length) {
              new loadedMaps.Polyline({
                map,
                path: routePath,
                strokeWeight: 5,
                strokeColor: "#ef6a3a",
                strokeOpacity: 0.9,
                strokeStyle: "solid",
              });
            }
            map.setBounds(bounds);
            window.clearTimeout(timeout);
            setMapState({ status: "ready", geometryKey });
          } catch {
            fail();
          }
        });
      } catch {
        fail();
      }
    };

    if (window.kakao?.maps) {
      renderMap();
    } else {
      try {
        script = document.querySelector<HTMLScriptElement>("script[data-motocast-kakao-map]");
        if (!script) {
          script = document.createElement("script");
          script.dataset.motocastKakaoMap = "true";
          script.dataset.motocastKakaoMapStatus = "loading";
          script.async = true;
          script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
          document.head.appendChild(script);
        }

        onLoad = () => {
          if (!script) return;
          if (!window.kakao?.maps) {
            script.dataset.motocastKakaoMapStatus = "error";
            fail();
            return;
          }
          script.dataset.motocastKakaoMapStatus = "ready";
          renderMap();
        };
        onError = () => {
          if (script) script.dataset.motocastKakaoMapStatus = "error";
          fail();
        };

        if (script.dataset.motocastKakaoMapStatus === "ready") onLoad();
        else if (script.dataset.motocastKakaoMapStatus === "error") onError();
        else {
          script.addEventListener("load", onLoad, { once: true });
          script.addEventListener("error", onError, { once: true });
        }
      } catch {
        fail();
      }
    }

    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (script && onLoad) script.removeEventListener("load", onLoad);
      if (script && onError) script.removeEventListener("error", onError);
    };
  }, [appKey, geometryKey]);

  return (
    <div className="map-shell" aria-label="선택한 라이딩 경로 지도">
      <div ref={containerRef} className={`map-canvas ${isReady ? "is-ready" : ""}`} aria-hidden={!isReady} inert={!isReady} />
      <MapStatus state={state} actualRoute={Boolean(path?.length)} />
      {isReady ? <MarkerLegend points={points} /> : null}
      {!isReady ? <SchematicRoute state={state} points={points} actualRoute={Boolean(path?.length)} /> : null}
    </div>
  );
}

function MarkerLegend({ points }: { points: MapPoint[] }) {
  const roles = Array.from(new Set(points.map((point) => point.role ?? "waypoint")));
  return (
    <ul className="map-marker-legend" aria-label="지도 지점 표시 안내">
      {roles.map((role) => (
        <li key={role}>
          <span className="map-marker-symbol" style={{ backgroundColor: markerAppearance[role].color }} aria-hidden="true">
            {markerAppearance[role].symbol}
          </span>
          {markerAppearance[role].label}
        </li>
      ))}
    </ul>
  );
}

export function MapOmissionList({ points }: { points: MapPoint[] }) {
  const omittedPoints = points.filter((point) => point.nonTraversed);
  if (!omittedPoints.length) return null;

  return (
    <section className="map-omissions" aria-labelledby="map-omissions-heading">
      <div>
        <p className="eyebrow">ROUTE NOTICE</p>
        <h2 id="map-omissions-heading">선택 경로에서 지나지 않는 지점</h2>
      </div>
      <ul>
        {omittedPoints.map((point, index) => {
          const role = point.role ?? "waypoint";
          return (
            <li key={`${point.latitude}:${point.longitude}:${role}:${index}`}>
              <span className="map-marker-symbol is-omitted" style={{ backgroundColor: markerAppearance[role].color }} aria-hidden="true">
                {markerAppearance[role].symbol}×
              </span>
              <span>{markerAppearance[role].label} · {point.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SchematicRoute({ state, points, actualRoute }: { state: "loading" | "demo" | "error"; points: MapPoint[]; actualRoute: boolean }) {
  return (
    <div className="schematic-map">
      <div className="map-grid" aria-hidden="true" />
      {state === "demo" && !actualRoute ? <svg className="route-sketch" viewBox="0 0 720 430" role="img" aria-label="데모 경로 개요">
        <path className="route-shadow" d="M62 332 C148 270 131 170 245 194 S365 90 455 129 S546 305 662 213" />
        <path className="route-line" d="M62 332 C148 270 131 170 245 194 S365 90 455 129 S546 305 662 213" />
        {["62,332", "245,194", "455,129", "662,213"].map((coordinates, index) => {
          const [cx, cy] = coordinates.split(",");
          return (
            <g key={coordinates}>
              <circle cx={cx} cy={cy} r="12" className={index === 0 ? "route-dot start" : "route-dot"} />
              <text x={Number(cx) + 17} y={Number(cy) - 14} className="route-label">
                {points[index]?.label ?? `지점 ${index + 1}`}
              </text>
            </g>
          );
        })}
      </svg> : null}
    </div>
  );
}

function MapStatus({ state, actualRoute }: { state: "loading" | "ready" | "demo" | "error"; actualRoute: boolean }) {
  return (
    <div className={`map-status ${state === "ready" ? "is-visually-hidden" : ""}`} role="status" aria-live="polite">
      <span className={`status-dot ${state}`} />
      {state === "loading" ? actualRoute ? "실제 경로 지도를 불러오는 중" : "카카오 지도를 불러오는 중" : null}
      {state === "ready" ? actualRoute ? "실제 경로 지도 준비 완료" : "카카오 지도 준비 완료" : null}
      {state === "demo" ? actualRoute ? "카카오 지도 키 미설정 · 실제 경로 선을 표시할 수 없습니다" : "카카오 지도 키 미설정 · 예시 경로 개요 표시 중" : null}
      {state === "error" ? actualRoute ? "카카오 지도 로드 실패 · 실제 경로 선을 표시할 수 없습니다" : "카카오 지도 로드 실패 · 설정 확인 후 새로고침해 주세요" : null}
    </div>
  );
}
