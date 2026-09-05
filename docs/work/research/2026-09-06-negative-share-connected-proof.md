# Preview 날씨 상태별 공유 거절 — 실제 연결 증거

2026-09-06 KST. **CONNECTED_SEEDED_CONTROL / NEGATIVE_SHARE_BOUNDED: 11 PASS.** 사용자 승인 범위에서 임시 Auth 라이더1명과 정확한 시험 소유 자료를 준비하고 실제 Preview RPC를 실행했다. 기존 두 실사용 계정·자료는 보존했다. 전체 Preview와 Production은 미완료다.

## 계약과 고정 실행본

[실행 계약·실패 및 복구 이력](2026-09-06-negative-share-execution-contract.md), [잔여 gate와 결정 목록](2026-09-06-preview-remaining-gates.md)을 따른다. 제품 develop98afe02 / weather-timeline v12는 변경하지 않았다. provider 호출, 예산 변경, 실제 사용자 권한 변경, main/Production 변경은0이다.

- 도구 manifest SHA256: `3983dec19c7485675abc055dcb217c90ee76e7789e876d76de2ee5db558e855f`.
- 실행 래퍼 SHA256: `999f776c2d61a640343dc5cf728109eed85a1577dc4f3dd49a403c53a0d6b5d1`.
- 결과 SHA256: `c29303f4b63aebdb2e0262522a1ff558ffa5430297e340b27d03b4badda62628`.
- 도구·래퍼 독립 APPROVE B0/H0/M0/L0. 작성자 unit26 PASS, 최종 local 전체1 PASS/122.708초; 독립 검토자 unit26 PASS/AST1 PASS, 검토자 DB·네트워크 실행 NOT_RUN.

## 실제 실행 결과

`approved_run_v3.py execute` exit0. **PASS11 / FAIL0 / ERROR0 / SKIP0 / DESELECTED0 / XFAIL0 / SETUP_OR_IMPORT_FAILURE0 / NOT_RUN0**.

별도 `approved_run_v3.py inspect-cleanup`도 exit0, exact_cleanup_readback PASS / protected_data UNCHANGED였다. 실행11개에 중복 합산하지 않는다.

| 사례 | 실제 결과 |
| --- | --- |
| source/schema·Auth·public fixture 준비 | 3 PASS. 실제 임시 Auth password 로그인/JWT, 제품 parser가 수락하는 합성 경로·날씨, 정확한 시험 grant |
| 저장본 없음 preview/publish | 2 PASS. 정확한 weather1행 삭제 후 각각 P0001 + SHARE_WEATHER_NOT_FRESH |
| 오래된 저장본 preview/publish | 2 PASS. 원래 시각과 route-weather 연결을 유지한 완전한 stale 상태에서 각각 동일 거절 |
| 만료된 저장본 preview/publish | 2 PASS. 최초 DB valid_until을 변경하지 않고 자연 만료 대기, 실제 DB clock으로 경과 확인 후 각각 동일 거절 |
| 후속 조건 | 1 PASS. 원래 시험 행 지문 유지, grant 미소비, 새 share/grant 없음 |
| 정확 정리 | 1 PASS. 시험 public/Auth users·identities·sessions·refresh_tokens 부재, 비fixture 보호 지문 일치 |

시험 범위는 임시 rider1명, profile/membership 각1, case별 trip/waypoint/route/weather/grant 각3으로 public 최대17행이다. missing 상태 전환 후16행을 정확히 정리했다. 비fixture 보호 지문 범위는 public16테이블과 auth.users이며 기존 모든 Auth session·설정까지 지문 비교했다고 주장하지 않는다. 성공 preview RPC는 전역 grant 정리를 수행하므로 정상 준비 단계에서 호출하지 않았다.

원시 인증값·preview token은 메모리에서만 사용했다. 소유권 journal과 결과는 `/tmp/motocast-negative-connected-20260906-r3`의0700 디렉터리와0600 파일에 보존하며 원문을 커밋하지 않는다. 플랫폼 감사 로그는 삭제하지 않았다.

## 실패 이력과 한계

최초 실행은 PASS3/FAIL2/NOT_RUN6: 관리 읽기 역할의 private builder 실행 거절과 write 연결의 search_path 차이로 중단됐다. 별도 검토된 exact cleanup 복구·재조회는 PASS이며 최초 실패를 바꾸지 않았다. 2차 실행은 PASS4/FAIL1/NOT_RUN6: PostgreSQL 시간대·가변 소수초를 Python3.10에서 읽는 예외로 중단됐고 자동 정리·재조회는 PASS였다. 최종 수정은 고정 내부 SELECT의 관리 역할, cleanup의 canonical search_path, 동일 시각을 유지하는 DB 시각 parser에 한정됐다. 제품 ACL·KMA 발표시각/선택/만료 조건은 바꾸지 않았다.

이 결과는 **준비한 시험 자료에 대한 실제 DB 공유 거절**을 입증한다. active KMA handler의 공급자 실패·전역 예산 차단, 오래된 날씨의 실제 브라우저 표시, Kakao 최초 초대 가입 또는 Production 검증을 입증하지 않는다. 전체 Goal을 완료 처리하지 않는다.
