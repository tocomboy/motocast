import type { SVGProps } from "react";

const paths = {
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-up": "M6 15l6-6 6 6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5 9-10",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  sun: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  cloud: "M7 18a5 5 0 1 1 1.2-9.9A6 6 0 0 1 19 11a4 4 0 0 1 0 7z",
  "cloud-rain": "M7 15a5 5 0 1 1 1.2-9.9A6 6 0 0 1 19 8a4 4 0 0 1 0 7zM9 18l-1 3M13 18l-1 3M17 18l-1 3",
  clock: "M12 8v5l3 2",
  search: "M16 16l4.5 4.5",
  info: "M12 11v6M12 7h.01",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  "more-vertical": "M12 5h.01M12 12h.01M12 19h.01",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  pin: "M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8",
  copy: "M9 9h10v10H9zM5 15V5h10",
} as const;

export function LineIcon({ name, className = "", ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg {...props} className={`mc-icon ${className}`} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "sun" ? <circle cx="12" cy="12" r="4" /> : null}
    {name === "clock" || name === "info" ? <circle cx="12" cy="12" r="9" /> : null}
    {name === "search" ? <circle cx="11" cy="11" r="6.5" /> : null}
    <path d={paths[name]} />
  </svg>;
}

/** Frequent-place star: filled yellow with a 1.5 ink outline when starred, outline only otherwise.
 * Decorative; the surrounding control carries the accessible name. */
export function StarMark({ filled, className = "", size = 24 }: { filled: boolean; className?: string; size?: number }) {
  return <svg className={`mc-icon mc-star${filled ? " is-filled" : ""} ${className}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" data-filled={filled}>
    <path d={paths.star} fill={filled ? "var(--mc-star-fill)" : "none"} stroke="var(--mc-text-primary)" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>;
}
