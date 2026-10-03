import { LineIcon } from "@/components/line-icon";
import type { ReactNode } from "react";

export type RidingSummaryMetric = { label: string; value: ReactNode };

export function RidingWeatherCard({ time, place, stopDetail, conditionLabel, condition, temperature, probability, statusNote, wind }: {
  time: ReactNode;
  place: ReactNode;
  stopDetail?: ReactNode;
  conditionLabel: ReactNode;
  condition?: string;
  temperature: ReactNode;
  probability: ReactNode;
  statusNote?: ReactNode;
  wind?: ReactNode;
}) {
  const percentage = typeof probability === "string" ? Number.parseFloat(probability) : NaN;
  const rain = condition === "rain" || condition === "snow" || percentage >= 40;
  const probabilityUnknown = !Number.isFinite(percentage);
  const tone = rain ? "high" : probabilityUnknown ? "unknown" : "low";
  return <article className="riding-weather-card" data-condition={condition ?? "unknown"} data-rain={tone}>
    <div className={`riding-weather-time ${typeof time === "string" && !/[가-힣]/.test(time) ? "mc-number" : ""}`}><strong>{time}</strong></div>
    <LineIcon className="riding-weather-icon" name={condition === "clear" ? "sun" : rain ? "cloud-rain" : condition === "cloudy" ? "cloud" : "clock"} />
    <div className="riding-weather-place"><strong>{place}</strong><span>{stopDetail ? <>{stopDetail} · </> : null}{conditionLabel}{wind ? <> · {wind}</> : null}</span>{statusNote ? <small>{statusNote}</small> : null}</div>
    <div className="riding-weather-values"><strong className="mc-number">{temperature}</strong><span><i className="rain-bar" aria-hidden="true" /><span className="sr-only">강수확률 </span>{probability}</span></div>
  </article>;
}

export function RidingSummaryLayout({ title, subtitle, backAction, metrics, distance, actions, map, mapDetails, weather, notices, management, preview = false }: {
  title: ReactNode;
  subtitle?: ReactNode;
  backAction?: ReactNode;
  metrics: RidingSummaryMetric[];
  distance?: ReactNode;
  actions?: ReactNode;
  map: ReactNode;
  mapDetails?: ReactNode;
  weather: ReactNode;
  notices?: ReactNode;
  management?: ReactNode;
  preview?: boolean;
}) {
  return <section className={`riding-summary-layout ${preview ? "is-preview" : ""}`} aria-labelledby={`riding-summary-${preview ? "preview" : "result"}`}>
    <header className="riding-summary-header">{backAction ? <div className="riding-summary-back">{backAction}</div> : null}<div><h1 id={`riding-summary-${preview ? "preview" : "result"}`} data-view-title="summary" tabIndex={-1}>{title}</h1>{subtitle ? <div className="riding-summary-subtitle">{subtitle}</div> : null}</div>{actions ? <div className="riding-summary-actions">{actions}</div> : null}</header>
    <dl className="riding-summary-metrics">{metrics.map((metric, index) => <div key={metric.label} data-metric-index={index}><dt>{metric.label}</dt><dd className={typeof metric.value === "string" && !/[가-힣]/.test(metric.value) ? "mc-number" : undefined}>{metric.value}</dd>{index === metrics.length - 1 && distance ? <small className="summary-arrival-distance">도착 · <span className="mc-number">{distance}</span></small> : null}</div>)}</dl>
    <section className="riding-summary-map">{map}{mapDetails}</section>
    <section className="riding-summary-weather">{weather}</section>
    {notices ? <div className="riding-summary-notices">{notices}</div> : null}
    {management ? <div className="riding-summary-management">{management}</div> : null}
  </section>;
}
