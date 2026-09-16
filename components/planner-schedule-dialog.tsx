"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { minimumDeparture } from "@/lib/planner/departure";

function parseTime(time: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? { hour: match[1], minute: match[2] } : { hour: "", minute: "" };
}

function parseMonth(date: string) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : { year: 2026, month: 0 };
}

function dateString(year: number, month: number, day: number) { return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function scheduleLabel(date: string, time: string) {
  if (!date || !time) return "날짜와 출발 시각 선택";
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return `${new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(value)} · ${time} 출발`;
}

export function PlannerScheduleDialog({ date, time, minimumDate, minimumTime, disabled, onConfirm, triggerRef }: { date: string; time: string; minimumDate: string; minimumTime: string; disabled?: boolean; onConfirm: (date: string, time: string) => void; triggerRef?: RefObject<HTMLButtonElement | null> }) {
  const titleId = useId();
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hourTriggerRef = useRef<HTMLButtonElement>(null);
  const minuteTriggerRef = useRef<HTMLButtonElement>(null);
  const clockGridRef = useRef<HTMLDivElement>(null);
  const [draftDate, setDraftDate] = useState(date);
  const [visibleMonth, setVisibleMonth] = useState(() => parseMonth(date || minimumDate));
  const [hour, setHour] = useState(parseTime(time).hour);
  const [minute, setMinute] = useState(parseTime(time).minute);
  const [panel, setPanel] = useState<"date" | "hour" | "minute">("date");
  const [error, setError] = useState("");
  const actualTriggerRef = triggerRef ?? localTriggerRef;

  function open() {
    setDraftDate(date);
    setVisibleMonth(parseMonth(date || minimumDate));
    setHour(parseTime(time).hour);
    setMinute(parseTime(time).minute);
    setPanel("date");
    setError("");
    dialogRef.current?.showModal();
  }
  function close() { dialogRef.current?.close(); }
  function returnToDate(source = panel) {
    setPanel("date");
    window.setTimeout(() => (source === "hour" ? hourTriggerRef : minuteTriggerRef).current?.focus(), 0);
  }
  function moveMonth(direction: -1 | 1) {
    setVisibleMonth((current) => {
      const value = current.year * 12 + current.month + direction;
      return { year: Math.floor(value / 12), month: ((value % 12) + 12) % 12 };
    });
  }
  function confirm() {
    if (!draftDate) { setError("라이딩 날짜를 선택해 주세요."); return; }
    if (!hour || !minute) { setError("출발 시와 분을 모두 선택해 주세요."); return; }
    const nextTime = `${hour}:${minute}`;
    const freshMinimum = minimumDeparture(new Date());
    if (draftDate < minimumDate || (draftDate === minimumDate && nextTime < minimumTime) || draftDate < freshMinimum.date || (draftDate === freshMinimum.date && nextTime < freshMinimum.time)) { setError("현재 이후의 날짜와 출발 시각을 선택해 주세요."); return; }
    onConfirm(draftDate, nextTime);
    close();
  }
  function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const leading = new Date(Date.UTC(visibleMonth.year, visibleMonth.month, 1)).getUTCDay();
  const count = new Date(Date.UTC(visibleMonth.year, visibleMonth.month + 1, 0)).getUTCDate();
  const calendar = [...Array.from({ length: leading }, () => null), ...Array.from({ length: count }, (_, index) => index + 1)];
  const timeValues = panel === "hour" ? Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0")) : Array.from({ length: 60 }, (_, value) => String(value).padStart(2, "0"));

  useEffect(() => {
    if (panel === "date") return;
    const chosen = clockGridRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    (chosen ?? clockGridRef.current?.querySelector<HTMLElement>("button"))?.focus();
  }, [panel]);

  return <div className="planner-schedule-field">
    <span>라이딩 일정</span>
    <button ref={actualTriggerRef} className="schedule-trigger" type="button" disabled={disabled} onClick={open}>{scheduleLabel(date, time)}</button>
    <dialog ref={dialogRef} className="schedule-dialog" aria-labelledby={titleId} onKeyDown={containFocus} onClose={() => actualTriggerRef.current?.focus()} onCancel={(event) => { if (panel !== "date") { event.preventDefault(); returnToDate(); } }}>
      <div className="schedule-dialog-shell">
        <header>{panel !== "date" ? <button type="button" onClick={() => returnToDate()} aria-label="일정 선택으로 돌아가기">←</button> : null}<div><p className="eyebrow">RIDE SCHEDULE</p><h2 id={titleId}>{panel === "hour" ? "출발 시 선택" : panel === "minute" ? "출발 분 선택" : "새 일정 선택"}</h2></div><button type="button" onClick={close} aria-label="일정 선택 닫기">×</button></header>
        {panel === "date" ? <div className="schedule-picker-layout">
          <section className="calendar-picker" aria-label="라이딩 날짜">
            <div className="calendar-heading"><button type="button" onClick={() => moveMonth(-1)} aria-label="이전 달">‹</button><strong>{visibleMonth.year}년 {visibleMonth.month + 1}월</strong><button type="button" onClick={() => moveMonth(1)} aria-label="다음 달">›</button></div>
            <div className="calendar-weekdays" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">{calendar.map((day, index) => day === null ? <span key={`blank-${index}`} /> : (() => { const value = dateString(visibleMonth.year, visibleMonth.month, day); return <button key={value} type="button" disabled={value < minimumDate} aria-pressed={draftDate === value} onClick={() => { setDraftDate(value); setError(""); }}>{day}</button>; })())}</div>
          </section>
          <section className="schedule-time-rows" aria-label="출발 시각"><button ref={hourTriggerRef} type="button" onClick={() => setPanel("hour")}><span>시</span><strong>{hour || "선택"}</strong><span>›</span></button><button ref={minuteTriggerRef} type="button" onClick={() => setPanel("minute")}><span>분</span><strong>{minute || "선택"}</strong><span>›</span></button></section>
        </div> : <section className="clock-popup" aria-label={panel === "hour" ? "출발 시" : "출발 분"}><div ref={clockGridRef} className={`clock-grid ${panel}-grid`}>{timeValues.map((value) => <button type="button" key={value} aria-pressed={(panel === "hour" ? hour : minute) === value} onClick={() => { const source = panel; if (panel === "hour") setHour(value); else setMinute(value); setError(""); returnToDate(source); }}>{value}</button>)}</div></section>}
        <p className="schedule-selection" role="status">{draftDate || "날짜 미선택"} · {hour || "시"}:{minute || "분"}</p>
        {error ? <p className="schedule-error" role="alert">{error}</p> : null}
        <div className="schedule-dialog-actions">{panel === "date" ? <><button type="button" onClick={close}>취소</button><button className="primary-button" type="button" onClick={confirm}>일정 적용</button></> : <button type="button" onClick={() => returnToDate()}>취소</button>}</div>
      </div>
    </dialog>
  </div>;
}
