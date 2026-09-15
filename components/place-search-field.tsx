"use client";

import { useId, useState } from "react";

import { parsePlaceSearchResponse, type PlaceSearchResult } from "@/lib/places/search";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type Props = {
  label: string;
  placeholder: string;
  required?: boolean;
  autoFocus?: boolean;
  selected: PlaceSearchResult | null;
  onSelect: (place: PlaceSearchResult | null) => void;
};

export function PlaceSearchField({ label, placeholder, required = false, autoFocus = false, selected, onSelect }: Props) {
  const inputId = useId();
  const statusId = useId();
  const [query, setQuery] = useState(selected?.name ?? "");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [status, setStatus] = useState(selected ? "장소가 선택되었습니다." : "검색어를 입력해 주세요.");
  const [searching, setSearching] = useState(false);
  function changeQuery(value: string) {
    setQuery(value);
    setResults([]);
    if (selected && value.trim() !== selected.name) onSelect(null);
    setStatus(value.trim().length >= 2 ? "검색 버튼을 눌러 장소를 확인하세요." : "두 글자 이상 입력해 주세요.");
  }

  async function search() {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (normalized.length < 2 || normalized.length > 100) {
      setStatus("장소 이름을 2자 이상 100자 이하로 입력해 주세요.");
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus("장소 검색 연결이 설정되지 않았습니다.");
      return;
    }

    setSearching(true);
    setResults([]);
    setStatus("카카오 장소를 검색하고 있습니다.");
    const { data, error } = await supabase.functions.invoke("search-places", {
      body: { query: normalized, page: 1, size: 10 },
    });
    setSearching(false);
    if (error) {
      setStatus("장소를 검색하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    try {
      const parsed = parsePlaceSearchResponse(data);
      setResults(parsed.places);
      setStatus(parsed.places.length ? `${parsed.places.length}개 장소를 찾았습니다.` : "검색 결과가 없습니다.");
    } catch {
      setStatus("장소 검색 응답을 확인할 수 없습니다.");
    }
  }

  function choose(place: PlaceSearchResult) {
    onSelect(place);
    setQuery(place.name);
    setResults([]);
    setStatus(`${place.name}을(를) 선택했습니다.`);
  }

  return (
    <div className="place-field">
      <label htmlFor={inputId}>
        <span>{label}{required ? " · 필수" : ""}</span>
      </label>
      <div className={`place-search-row ${selected ? "is-selected" : ""}`}>
        <input
          id={inputId}
          value={query}
          placeholder={placeholder}
          maxLength={100}
          autoFocus={autoFocus}
          aria-describedby={statusId}
          aria-invalid={required && !selected}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
        />
        <button type="button" className="place-search-button" onClick={() => void search()} disabled={searching}>
          {searching ? "검색 중" : "검색"}
        </button>
      </div>
      {selected ? (
        <div className="selected-place">
          <span aria-hidden="true">✓</span>
          <div><strong>{selected.name}</strong><small>{selected.roadAddress ?? selected.address}</small></div>
          <button type="button" onClick={() => { onSelect(null); setQuery(""); setStatus("선택을 해제했습니다."); }} aria-label={`${selected.name} 선택 해제`}>×</button>
        </div>
      ) : null}
      {results.length ? (
        <ul className="place-results" aria-label={`${label} 검색 결과`}>
          {results.map((place) => (
            <li key={place.kakaoPlaceId}>
              <button type="button" onClick={() => choose(place)}>
                <strong>{place.name}</strong>
                <span>{place.roadAddress ?? place.address}</span>
                {place.category ? <small>{place.category}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="place-status" id={statusId} role="status" aria-live="polite">{status}</p>
    </div>
  );
}
