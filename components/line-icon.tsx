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
} as const;

export function LineIcon({ name, className = "", ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg {...props} className={`mc-icon ${className}`} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "sun" ? <circle cx="12" cy="12" r="4" /> : null}
    {name === "clock" || name === "info" ? <circle cx="12" cy="12" r="9" /> : null}
    {name === "search" ? <circle cx="11" cy="11" r="6.5" /> : null}
    <path d={paths[name]} />
  </svg>;
}
