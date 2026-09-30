"use client";

import { useEffect, useId, useRef } from "react";
import { routeFailurePopup, type RouteFailureCode } from "@/lib/planner/route-failure";

export function RouteFailureDialog({ code, onClose, onEdit }: {
  code: RouteFailureCode; onClose: () => void; onEdit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const content = routeFailurePopup(code);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previousFocus?.focus(); };
  }, []);
  if (!content) return null;
  return <dialog ref={dialog} className="map-confirmation-dialog" aria-labelledby={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <h2 id={title}>{content.title}</h2>
    <div className="map-confirmation-body"><p>{content.message}</p><p>기존 코스와 저장된 결과는 유지됩니다.</p></div>
    <div className="map-confirmation-actions"><button type="button" className="primary-button" onClick={onEdit}>{content.action}</button><button type="button" onClick={onClose}>닫기</button></div>
  </dialog>;
}
