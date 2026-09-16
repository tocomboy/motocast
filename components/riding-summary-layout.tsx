import Image from "next/image";
import type { ReactNode } from "react";

export type RidingSummaryMetric = { label: string; value: ReactNode };

export function RidingWeatherCard({ time, place, stopDetail, conditionLabel, condition, temperature, probability, wind, statusNote }: {
  time: ReactNode;
  place: ReactNode;
  stopDetail?: ReactNode;
  conditionLabel: ReactNode;
  condition?: string;
  temperature: ReactNode;
  probability: ReactNode;
  wind: ReactNode;
  statusNote?: ReactNode;
}) {
  const asset = condition === "clear" ? "/figma/sunny.svg" : condition === "cloudy" ? "/figma/partly-cloudy.svg" : null;
  return <article className="riding-weather-card" data-condition={condition ?? "unknown"}>
    <div className="riding-weather-time">{asset ? <Image src={asset} alt="" width={40} height={40} /> : <span aria-hidden="true">{condition === "rain" ? "☔" : condition === "snow" ? "❄️" : "?"}</span>}<strong>{time}</strong>{stopDetail ? <small>{stopDetail}</small> : null}</div>
    <div className="riding-weather-place"><strong>{place}</strong><span>{conditionLabel}</span>{statusNote ? <small>{statusNote}</small> : null}</div>
    <div className="riding-weather-values"><strong>{temperature}</strong><span>강수 {probability}</span><span>바람 {wind}</span></div>
  </article>;
}

export function RidingSummaryLayout({ title, subtitle, metrics, actions, map, mapDetails, weather, notices, management, preview = false }: {
  title: string;
  subtitle?: ReactNode;
  metrics: RidingSummaryMetric[];
  actions?: ReactNode;
  map: ReactNode;
  mapDetails?: ReactNode;
  weather: ReactNode;
  notices?: ReactNode;
  management?: ReactNode;
  preview?: boolean;
}) {
  return <section className={`riding-summary-layout ${preview ? "is-preview" : ""}`} aria-labelledby={`riding-summary-${preview ? "preview" : "result"}`}>
    <header className="riding-summary-header"><div><h1 id={`riding-summary-${preview ? "preview" : "result"}`} data-view-title="summary" tabIndex={-1}>{title}</h1>{subtitle ? <div className="riding-summary-subtitle">{subtitle}</div> : null}</div>{actions ? <div className="riding-summary-actions">{actions}</div> : null}</header>
    <dl className="riding-summary-metrics">{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>
    <div className="riding-summary-content"><section className="riding-summary-map">{map}{mapDetails}</section><section className="riding-summary-weather">{weather}</section></div>
    {notices ? <div className="riding-summary-notices">{notices}</div> : null}
    {management ? <div className="riding-summary-management">{management}</div> : null}
  </section>;
}
