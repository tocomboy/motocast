"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { LineIcon } from "@/components/line-icon";
import {
  candidateRows,
  isNextDayMeal,
  recommendationDefaults,
  durationLabel,
  extraDriveLabel,
  extraDriveSpoken,
  isDailyBudgetFailure,
  recommendationFailureMessage,
  recommendationInputError,
  resolveSelection,
  selectionGuidance,
  SERVER_DETOUR_CAP_MINUTES,
  seoulClock,
  seoulDateTime,
  stepTolerance,
  toggleSelection,
  toleranceOptions,
  andParticle,
  type CandidateRowState,
  type MealIndex,
  type RecommendationFailure,
  type RecommendationInput,
  type RecommendationResponse,
  type RecommendationSelection,
} from "@/lib/planner/restaurant-recommendation";
import { MEAL_DWELL_MINUTES, MEAL_DWELL_NOTE } from "@/lib/planner/ordered-waypoints";
import styles from "./restaurant-recommendation-dialog.module.css";

export type RecommendationOutcome =
  | { kind: "ok"; response: RecommendationResponse }
  | { kind: "error"; failure: RecommendationFailure }
  | { kind: "stale" }
  | { kind: "discarded" };

type Phase =
  | { name: "input" }
  | { name: "loading" }
  | { name: "result"; response: RecommendationResponse; selection: RecommendationSelection }
  | { name: "error"; failure: RecommendationFailure }
  | { name: "stale" };

type Props = {
  stale: boolean;
  routeLabel: string;
  departureAt: string;
  returnAt: string;
  waypointCount: number;
  request: (input: RecommendationInput) => Promise<RecommendationOutcome>;
  confirm: (response: RecommendationResponse, selection: RecommendationSelection) => boolean;
  onClose: () => void;
  onEditRoute: () => void;
  onOpenFavorites: () => void;
};

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const minutes = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

function excludedNotice(detourLimitMinutes: number) {
  return `경로에서 ${durationLabel(detourLimitMinutes)} 넘게 돌아가는 식당은 제외해요.`;
}

// "식사 1 12:00 · 식사 2 18:00 · 앞뒤 30분 · 각 60분" and the server cap notice.
function conditionLines(input: Pick<RecommendationInput, "mealCount" | "meals" | "toleranceMinutes">, detourLimitMinutes: number, departureAt: string) {
  const meals = input.meals.slice(0, input.mealCount);
  const times = meals.map((meal, index) => `식사 ${index + 1} ${isNextDayMeal(departureAt, input.toleranceMinutes, meal.desiredTime) ? "다음 날 " : ""}${meal.desiredTime}`).join(" · ");
  const dwell = meals.length === 1 ? `${MEAL_DWELL_MINUTES}분` : `각 ${MEAL_DWELL_MINUTES}분`;
  return [`${times} · 앞뒤 ${input.toleranceMinutes}분 · ${dwell}`, excludedNotice(detourLimitMinutes)] as const;
}

// Same containment as the schedule dialog: Tab wraps inside the modal.
function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !focusable.includes(active as HTMLElement))) {
    event.preventDefault();
    first.focus();
  }
}

function spokenClock(iso: string) {
  const [hour, minute] = seoulClock(iso).split(":");
  return `${Number(hour)}시 ${Number(minute)}분`;
}

export function RestaurantRecommendationDialog(props: Props) {
  const { stale, request, confirm, onClose } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stateTitleRef = useRef<HTMLHeadingElement>(null);
  const requestSerial = useRef(0);
  const mounted = useRef(true);
  const titleId = useId();
  // Defaults follow the route this dialog opened for (it remounts per opening);
  // edits within the opening are kept as before.
  const [input, setInput] = useState<RecommendationInput>(() => recommendationDefaults(props.departureAt, props.returnAt));
  const [phase, setPhase] = useState<Phase>({ name: "input" });
  const view: Phase = stale ? { name: "stale" } : phase;

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialogRef.current;
    if (element && !element.open) element.showModal();
    return () => {
      mounted.current = false;
      requestSerial.current += 1;
      if (element?.open) element.close();
      previousFocus?.focus();
    };
  }, []);

  // Lists and the input focus the dialog title; every status (including an
  // empty result or no saved restaurants) focuses its own state title.
  const focusTarget = view.name !== "result"
    ? view.name
    : view.response.status === "NO_SAVED_RESTAURANTS"
      ? "no-saved"
      : view.response.meals.every((meal) => meal.candidates.length === 0) ? "none" : "result";
  useEffect(() => {
    const target = focusTarget === "input" || focusTarget === "result" ? titleRef.current : stateTitleRef.current;
    target?.focus({ preventScroll: true });
  }, [focusTarget]);

  const inputError = recommendationInputError(input, props.departureAt, props.waypointCount);

  async function submit(values: RecommendationInput) {
    if (recommendationInputError(values, props.departureAt, props.waypointCount)) return;
    const serial = ++requestSerial.current;
    setPhase({ name: "loading" });
    const outcome = await request(values);
    if (!mounted.current || serial !== requestSerial.current || outcome.kind === "discarded") return;
    if (outcome.kind === "ok") setPhase({ name: "result", response: outcome.response, selection: {} });
    else if (outcome.kind === "error") setPhase({ name: "error", failure: outcome.failure });
    else setPhase({ name: "stale" });
  }

  function backToInput() {
    requestSerial.current += 1;
    setPhase({ name: "input" });
  }

  // Esc / back: results, empty results and errors return to the (kept) input;
  // input, loading, route-changed and no-saved states close the dialog.
  function back() {
    if (view.name === "error" || (view.name === "result" && view.response.status === "OK")) backToInput();
    else onClose();
  }

  function updateMeal(index: 0 | 1, change: Partial<RecommendationInput["meals"][number]>) {
    setInput((current) => {
      const meals = [...current.meals] as RecommendationInput["meals"];
      meals[index] = { ...meals[index], ...change };
      return { ...current, meals };
    });
  }


  function select(mealIndex: MealIndex, savedPlaceId: string) {
    setPhase((current) => current.name === "result"
      ? { ...current, selection: toggleSelection(current.response, current.selection, mealIndex, savedPlaceId) }
      : current);
  }

  function confirmSelection() {
    if (view.name !== "result") return;
    if (!confirm(view.response, view.selection) && mounted.current) setPhase({ name: "stale" });
  }

  const size = view.name === "input"
    ? "input"
    : view.name === "result" && view.response.status === "OK" && view.response.meals.some((meal) => meal.candidates.length > 0)
      ? view.response.settings.mealCount === 2 ? "result-2" : "result-1"
      : "status";

  return <dialog
    ref={dialogRef}
    className={styles.dialog}
    data-size={size}
    aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); back(); }}
    onKeyDown={containFocus}
  >
    <header className={styles.header}>
      <div>
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>음식점 추천</h2>
        {view.name === "result" && size !== "status" ? <p className={styles.subtitle}>{props.routeLabel} · {seoulDateTime(props.departureAt)} 출발</p> : null}
      </div>
      <button type="button" aria-label="음식점 추천 닫기" onClick={onClose}><LineIcon name="close" /></button>
    </header>
    {view.name === "input" ? <InputView routeLabel={props.routeLabel} departureAt={props.departureAt} returnAt={props.returnAt} idPrefix={titleId} onSubmit={(values) => void submit(values)} input={input} error={inputError} setInput={setInput} updateMeal={updateMeal} />
      : view.name === "loading" ? <StatusView key="loading" stateTitleRef={stateTitleRef} tone="neutral" role="status" icon={<span className={styles.spinner} aria-hidden="true" />} title="추천을 계산하고 있어요" text="저장한 식당 중 경로 근처 식당을 실제 도로 경로로 확인하고 있어요." note="닫으면 이번 추천 결과는 받지 않아요." conditions={conditionLines(input, SERVER_DETOUR_CAP_MINUTES, props.departureAt)} actions={<button type="button" className={styles.textAction} onClick={onClose}>닫기</button>} />
        : view.name === "error" ? <StatusView key="error" stateTitleRef={stateTitleRef} tone="danger" role="alert" icon={<span className={styles.alertMark} aria-hidden="true">!</span>} title="추천을 계산하지 못했습니다" text={recommendationFailureMessage(view.failure)} note={`음식점이 없다는 뜻이 아닙니다.${view.failure.code === "RECOMMENDATION_BUDGET_OR_CONFIG" ? " 이미 시도한 계산도 오늘 사용 한도에 포함돼요." : ""}`} conditions={conditionLines(input, SERVER_DETOUR_CAP_MINUTES, props.departureAt)} actions={isDailyBudgetFailure(view.failure)
          ? <><button type="button" className={styles.textAction} onClick={() => void submit(input)}>다시 시도</button><button type="button" className="primary-button" onClick={onClose}>닫기</button></>
          : <><button type="button" className={styles.textAction} onClick={onClose}>닫기</button><button type="button" className="primary-button" onClick={() => void submit(input)}>다시 시도</button></>} />
          : view.name === "stale" ? <StatusView key="stale" stateTitleRef={stateTitleRef} tone="tint" role="status" icon={<LineIcon name="clock" />} title="경로가 바뀌어 이전 추천을 사용할 수 없습니다" text="선택한 식당은 일정에 추가하지 않았어요." note="경로 편집에서 경로 다시 계산을 누른 뒤 추천을 다시 받아 주세요." actions={<><button type="button" className={styles.textAction} onClick={onClose}>닫기</button><button type="button" className="primary-button" onClick={props.onEditRoute}>경로 편집으로</button></>} />
            : view.response.status === "NO_SAVED_RESTAURANTS" ? <StatusView key="no-saved" stateTitleRef={stateTitleRef} tone="neutral" role="status" icon={<LineIcon name="star" />} title="저장한 식당이 없습니다" text="즐겨찾기에 식당을 저장하면 이 경로에 맞춰 추천해 드려요." note="추천은 저장한 식당 중에서만 해요. 외부 검색으로 새 음식점을 추가하지 않아요." actions={<><button type="button" className={styles.textAction} onClick={onClose}>닫기</button><button type="button" className="primary-button" onClick={props.onOpenFavorites}>즐겨찾기에서 식당 등록</button></>} />
              : view.response.meals.every((meal) => meal.candidates.length === 0) ? <StatusView key="none" stateTitleRef={stateTitleRef} tone="neutral" role="status" icon={<LineIcon name="search" />} title="조건에 맞는 음식점이 없습니다" text={`원하는 식사 시간 앞뒤 ${view.response.settings.toleranceMinutes}분 안에 도착하고 주행이 ${durationLabel(view.response.settings.detourLimitMinutes)} 이내로 늘어나는 식당이 없어요. 시간 범위를 자동으로 넓히지 않아요.`} note={coverageText(view.response)} conditions={conditionLines({ ...input, mealCount: view.response.settings.mealCount, toleranceMinutes: view.response.settings.toleranceMinutes }, view.response.settings.detourLimitMinutes, view.response.basis.departureAt)} actions={<><button type="button" className={styles.textAction} onClick={onClose}>닫기</button><button type="button" className="primary-button" onClick={backToInput}>조건 바꾸기</button></>} />
                : <ResultView response={view.response} selection={view.selection} input={input} onSelect={select} onChangeConditions={backToInput} onConfirm={confirmSelection} />}
  </dialog>;
}

function InputView(viewProps: {
  routeLabel: string;
  departureAt: string;
  returnAt: string;
  idPrefix: string;
  onSubmit: (input: RecommendationInput) => void;
  input: RecommendationInput;
  error: string | null;
  setInput: (update: (current: RecommendationInput) => RecommendationInput) => void;
  updateMeal: (index: 0 | 1, change: Partial<RecommendationInput["meals"][number]>) => void;
}) {
  const { input: values, error } = viewProps;
  return <>
    <div className={styles.body}>
      <section className={styles.routeCard} aria-label="이 경로 기준">
        <span>이 경로 기준</span>
        <strong>{viewProps.routeLabel}</strong>
        <small>출발 {seoulDateTime(viewProps.departureAt)} · 예상 도착 {seoulClock(viewProps.returnAt)}</small>
      </section>
      <p className={styles.infoBanner}><LineIcon name="star" />즐겨찾기에 저장한 식당 중에서만 추천해요.</p>
      <fieldset className={styles.countField}>
        <legend>방문할 식당 수</legend>
        <div className={styles.segmented}>
          {([1, 2] as const).map((count) => <button key={count} type="button" aria-pressed={values.mealCount === count} onClick={() => viewProps.setInput((current) => ({ ...current, mealCount: count }))}>{values.mealCount === count ? <LineIcon name="check" /> : null}{count}곳</button>)}
        </div>
        <p className={styles.hint}>추천 후보 수가 아니라 실제로 들를 식당 수예요.</p>
      </fieldset>
      <div className={styles.mealGrid} data-count={values.mealCount}>
        {values.meals.slice(0, values.mealCount).map((meal, index) => {
          const [hour, minute] = meal.desiredTime.split(":");
          const label = `식사 ${index + 1}`;
          const nextDay = isNextDayMeal(viewProps.departureAt, values.toleranceMinutes, meal.desiredTime);
          const hintId = `${viewProps.idPrefix}-next-day-${index}`;
          return <fieldset key={index} className={styles.mealCard}>
            <legend>{label}</legend>
            <div className={styles.fieldRow}>
              <span id={`${viewProps.idPrefix}-time-${index}`}>원하는 식사 시간</span>
              <span className={styles.timeSelect} role="group" aria-labelledby={`${viewProps.idPrefix}-time-${index}`} aria-describedby={nextDay ? hintId : undefined}>
                <select aria-label={`${label} 원하는 식사 시간 시`} value={hour} onChange={(event) => viewProps.updateMeal(index as 0 | 1, { desiredTime: `${event.target.value}:${minute}` })}>{hours.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                <span aria-hidden="true">:</span>
                <select aria-label={`${label} 원하는 식사 시간 분`} value={minute} onChange={(event) => viewProps.updateMeal(index as 0 | 1, { desiredTime: `${hour}:${event.target.value}` })}>{(minutes.includes(minute) ? minutes : [...minutes, minute].sort()).map((value) => <option key={value} value={value}>{value}</option>)}</select>
              </span>
            </div>
            {nextDay ? <p id={hintId} className={styles.nextDayNote}>다음 날 {meal.desiredTime}으로 계산돼요.</p> : null}
            <p className={styles.mealNote}>{MEAL_DWELL_NOTE}</p>
          </fieldset>;
        })}
      </div>
      <fieldset className={styles.toleranceCard}>
        <legend>원하는 식사 시간 허용 범위</legend>
        <div className={styles.toleranceRow}>
          <span className={styles.stepper}>
            <button type="button" aria-label="허용 범위 30분 줄이기" disabled={values.toleranceMinutes === toleranceOptions[0]} onClick={() => viewProps.setInput((current) => ({ ...current, toleranceMinutes: stepTolerance(current.toleranceMinutes, -1) }))}><LineIcon name="minus" /></button>
            <span className={styles.stepperValue} aria-live="polite"><strong>±{values.toleranceMinutes}</strong><small>분</small></span>
            <button type="button" aria-label="허용 범위 30분 늘리기" disabled={values.toleranceMinutes === toleranceOptions.at(-1)} onClick={() => viewProps.setInput((current) => ({ ...current, toleranceMinutes: stepTolerance(current.toleranceMinutes, 1) }))}><LineIcon name="plus" /></button>
          </span>
          <small className={styles.toleranceScale}>30분 단위 · 최대 ±{toleranceOptions.at(-1)}분</small>
        </div>
        <p className={styles.hint}>{excludedNotice(SERVER_DETOUR_CAP_MINUTES)}</p>
      </fieldset>
      {error ? <p className={styles.inputError} role="alert">{error}</p> : null}
    </div>
    <footer className={styles.footer}>
      <span />
      <button type="button" className="primary-button" disabled={Boolean(error)} onClick={() => viewProps.onSubmit(values)}>추천 받기</button>
    </footer>
  </>;
}

function coverageText(response: RecommendationResponse) {
  const { savedRestaurants, nearRoute, evaluated } = response.coverage;
  return evaluated === nearRoute
    ? `저장한 식당 ${savedRestaurants}곳 중 경로 근처 ${nearRoute}곳을 실제 도로 경로로 확인했어요.`
    : `저장한 식당 ${savedRestaurants}곳 중 경로 근처 ${nearRoute}곳, 그중 ${evaluated}곳을 실제 도로 경로로 확인했어요.`;
}

function StatusView({ stateTitleRef, tone, role, icon, title, text, note, conditions, actions }: {
  stateTitleRef: RefObject<HTMLHeadingElement | null>;
  tone: "neutral" | "danger" | "tint";
  role: "status" | "alert";
  icon: ReactNode;
  title: string;
  text: string;
  note: string;
  conditions?: readonly [string, string];
  actions: ReactNode;
}) {
  return <>
    <div className={styles.body}>
      <section className={styles.stateCard} data-tone={tone} role={role}>
        <span className={styles.stateIcon}>{icon}</span>
        <h3 ref={stateTitleRef} tabIndex={-1}>{title}</h3>
        <p>{text}</p>
        <small>{note}</small>
      </section>
      {conditions ? <p className={styles.conditionSummary}><span>{conditions[0]}</span><small>{conditions[1]}</small></p> : null}
    </div>
    <footer className={styles.footer} data-align="end">{actions}</footer>
  </>;
}

function ResultView({ response, selection, input, onSelect, onChangeConditions, onConfirm }: {
  response: RecommendationResponse;
  selection: RecommendationSelection;
  input: RecommendationInput;
  onSelect: (mealIndex: MealIndex, savedPlaceId: string) => void;
  onChangeConditions: () => void;
  onConfirm: () => void;
}) {
  const twoMeals = response.settings.mealCount === 2;
  const resolved = resolveSelection(response, selection);
  const conditions = conditionLines({ ...input, mealCount: response.settings.mealCount, toleranceMinutes: response.settings.toleranceMinutes }, response.settings.detourLimitMinutes, response.basis.departureAt);
  const noPairs = twoMeals && response.meals.every((meal) => meal.candidates.length > 0) && response.pairs.length === 0;
  const selectedName = (mealIndex: MealIndex) => response.meals[mealIndex - 1]?.candidates.find((candidate) => candidate.savedPlaceId === selection[mealIndex])?.displayName;
  const chosenCount = Object.values(selection).filter(Boolean).length;
  return <>
    <div className={styles.body}>
      {noPairs ? <p className={styles.infoBanner} role="status"><LineIcon name="info" />두 곳을 함께 가는 조합은 조건을 벗어나요. 한 곳만 선택해 추가할 수 있어요.</p> : null}
      <section className={styles.conditionPanel} aria-label="추천 조건">
        <div><span>추천 조건</span><button type="button" className={styles.linkAction} onClick={onChangeConditions}>조건 바꾸기<LineIcon name="chevron-right" /></button></div>
        <p>{conditions[0]}</p>
        <small>{conditions[1]}</small>
      </section>
      <div className={styles.columns} data-count={response.settings.mealCount}>
        {response.meals.map((meal) => {
          const otherIndex: MealIndex = meal.index === 1 ? 2 : 1;
          const otherName = twoMeals ? selectedName(otherIndex) : undefined;
          const rows = candidateRows(response, selection, meal.index);
          return <section key={meal.index} className={styles.mealColumn} aria-labelledby={`meal-heading-${meal.index}`}>
            <div className={styles.mealHeading}>
              <h3 id={`meal-heading-${meal.index}`}>식사 {meal.index}</h3>
              <span>{seoulClock(meal.targetAt)} ±{response.settings.toleranceMinutes}분 · {meal.candidates.length}곳</span>
            </div>
            {meal.candidates.length === 0
              ? <p className={styles.emptyMeal}>식사 {meal.index} 시간에는 조건에 맞는 음식점이 없습니다.</p>
              : <>
                <p className={styles.hint}>{otherName ? `식사 ${otherIndex} '${otherName}'${andParticle(otherName)} 함께 가는 기준이에요. 도착 시각과 두 곳 합계가 바뀌었어요.` : rows.some((row) => row.pairOnly) ? "늘어나는 주행이 짧은 순서예요. 함께 갈 때만 가능한 곳은 뒤에 두었어요." : "늘어나는 주행이 짧은 순서예요."}</p>
                <ul className={styles.rows}>{rows.map((row) => <li key={row.candidate.savedPlaceId}><CandidateRow row={row} onSelect={() => onSelect(meal.index, row.candidate.savedPlaceId)} /></li>)}</ul>
              </>}
          </section>;
        })}
      </div>
      <p className={styles.footnote}>{coverageText(response)}<br />도착 시각과 늘어나는 주행 시간은 추정값이에요. 일정에 추가한 뒤 경로 다시 계산으로 확인해 주세요.</p>
    </div>
    <footer className={styles.footer}>
      <div className={styles.selectionSummary} aria-live="polite">
        {resolved ? <>
          <strong>{resolved.items.map((item) => `식사 ${item.mealIndex} · ${item.candidate.displayName}`).join(" / ")}</strong>
          <span>{extraDriveLabel(resolved.extraDriveSeconds, resolved.items.length === 2)} · 예상 복귀 {seoulClock(resolved.returnAt)}</span>
        </> : <span>{selectionGuidance(response, selection) ?? (chosenCount ? "선택한 식당은 함께 추가할 수 없어요. 선택을 바꿔 주세요." : "일정에 추가할 식당을 골라 주세요.")}</span>}
      </div>
      <button type="button" className="primary-button" disabled={!resolved} onClick={onConfirm}>{resolved ? `선택한 식당 ${resolved.items.length}곳 일정에 추가` : "선택한 식당 일정에 추가"}</button>
    </footer>
  </>;
}

function CandidateRow({ row, onSelect }: { row: CandidateRowState; onSelect: () => void }) {
  const { candidate } = row;
  const blocked = !row.selectable && !row.selected;
  const extra = extraDriveLabel(row.extraDriveSeconds, row.combined);
  const extraSpoken = extraDriveSpoken(row.extraDriveSeconds, row.combined);
  const spoken = [
    candidate.displayName,
    candidate.address,
    `${spokenClock(row.arrivalAt)} 도착`,
    extraSpoken,
    "영업정보 없음",
    row.pairOnly ? row.reason : null,
    row.selected ? "선택됨" : blocked ? `선택 불가, ${row.reason}` : null,
  ].filter(Boolean).join(", ");
  return <button
    type="button"
    className={styles.candidate}
    aria-pressed={row.selected}
    aria-disabled={blocked || undefined}
    data-pair-only={row.pairOnly || undefined}
    aria-label={spoken}
    onClick={() => { if (!blocked) onSelect(); }}
  >
    <span className={styles.radio} data-state={row.selected ? "selected" : blocked ? "blocked" : "open"} aria-hidden="true">{row.selected ? <LineIcon name="check" /> : null}</span>
    <span className={styles.candidateText}>
      <strong>{candidate.displayName}</strong>
      <span>{candidate.address}</span>
      <span className={styles.candidateFacts}>{seoulClock(row.arrivalAt)} 도착 · {extra}</span>
      <small>영업정보 없음 · 방문 전 확인</small>
      {row.pairOnly ? <em>{row.reason}</em> : row.reason && (blocked || row.selected) ? <em>선택 불가 · {row.reason}</em> : null}
    </span>
  </button>;
}
