"use client";

import { useEffect, useRef, useState } from "react";

type MapPoint = { label: string; latitude: number; longitude: number };
type PathPoint = { latitude: number; longitude: number };
const KAKAO_MAP_LOAD_TIMEOUT_MS = 10_000;

export function KakaoMapCanvas({ points, path }: { points: MapPoint[]; path?: PathPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
  const [state, setState] = useState<"loading" | "ready" | "demo" | "error">(
    appKey ? "loading" : "demo",
  );

  useEffect(() => {
    if (!appKey) return;

    let active = true;
    let script: HTMLScriptElement | null = null;
    let onLoad: (() => void) | null = null;
    let onError: (() => void) | null = null;
    const timeout = window.setTimeout(() => {
      if (active) setState("error");
    }, KAKAO_MAP_LOAD_TIMEOUT_MS);

    const fail = () => {
      if (!active) return;
      window.clearTimeout(timeout);
      setState("error");
    };

    const renderMap = () => {
      if (!containerRef.current) return;
      const maps = window.kakao?.maps;
      if (!maps) {
        fail();
        return;
      }
      maps.load(() => {
        if (!active || !containerRef.current) return;
        const loadedMaps = window.kakao?.maps;
        if (!loadedMaps) {
          fail();
          return;
        }
        try {
          const markerPath = points.map((point) => new loadedMaps.LatLng(point.latitude, point.longitude));
          const routePath = (path?.length ? path : points).map((point) => new loadedMaps.LatLng(point.latitude, point.longitude));
          const map = new loadedMaps.Map(containerRef.current, { center: markerPath[0], level: 8 });
          const bounds = new loadedMaps.LatLngBounds();
          routePath.forEach((position) => bounds.extend(position));
          markerPath.forEach((position, index) => {
            bounds.extend(position);
            new loadedMaps.Marker({ map, position, title: points[index].label });
          });
          new loadedMaps.Polyline({
            map,
            path: routePath,
            strokeWeight: 5,
            strokeColor: "#ef6a3a",
            strokeOpacity: 0.9,
            strokeStyle: "solid",
          });
          map.setBounds(bounds);
          window.clearTimeout(timeout);
          setState("ready");
        } catch {
          fail();
        }
      });
    };

    if (window.kakao?.maps) {
      renderMap();
    } else {
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
    }

    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (script && onLoad) script.removeEventListener("load", onLoad);
      if (script && onError) script.removeEventListener("error", onError);
    };
  }, [appKey, path, points]);

  return (
    <div className="map-shell" aria-label="선택한 라이딩 경로 지도">
      <div ref={containerRef} className={`map-canvas ${state === "ready" ? "is-ready" : ""}`} />
      {state !== "ready" ? <SchematicRoute state={state} points={points} actualRoute={Boolean(path?.length)} /> : null}
    </div>
  );
}

function SchematicRoute({ state, points, actualRoute }: { state: "loading" | "demo" | "error"; points: MapPoint[]; actualRoute: boolean }) {
  return (
    <div className="schematic-map">
      <div className="map-grid" aria-hidden="true" />
      {!actualRoute ? <svg className="route-sketch" viewBox="0 0 720 430" role="img" aria-label="데모 경로 개요">
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
      <div className="map-status" role="status" aria-live="polite">
        <span className={`status-dot ${state}`} />
        {state === "loading" ? actualRoute ? "실제 경로 지도를 불러오는 중" : "카카오 지도를 불러오는 중" : null}
        {state === "demo" ? actualRoute ? "카카오 지도 키 미설정 · 실제 경로 선을 표시할 수 없습니다" : "카카오 지도 키 미설정 · 예시 경로 개요 표시 중" : null}
        {state === "error" ? actualRoute ? "카카오 지도 로드 실패 · 실제 경로 선을 표시할 수 없습니다" : "카카오 지도 로드 실패 · 설정 확인 후 새로고침해 주세요" : null}
      </div>
    </div>
  );
}
