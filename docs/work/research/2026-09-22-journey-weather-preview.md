# Android 주행 날씨 Preview 연결

승인: 2026-09-22 사용자가 새 서버 함수·DB 변경을 Preview에 적용하고 Android Studio 에뮬레이터로 실제 연결을 시험하도록 승인했다. Production과 웹 키를 변경하거나 develop/main을 게시하는 승인은 아니다. 저장소 Preview gate에 따라 CI-only review branch에서 고정 후보를 검증하고 PR은 미병합으로 유지한다.

1. 진행: 고정 서버 후보, 기존 Preview 함수/DB/양 환경 예산과 복구 상태 확인.
2. 대기: CI 통과·무배포 확인 후 Preview additive migration과 weather-timeline/journey-route/journey-weather 적용. 기존 JWT 인증 유지.
3. 대기: 실제 앱 조회·복구·10분 실패 재시도·이탈 시 ETA만 수정·중복/권한/예산 경계와 기존 웹 날씨 검증.
4. 대기: exact deployment/code hash·DB 역할·작업 자료 정리·잔여 제한 기록.

확정 주행 규칙: 최초 위치·경로 준비 후 조회; 복구는 기존 다음 조회 시각 유지; 이미 지났으면 준비 후1회; 실패는 다음 정기10분 시점; 이탈은 ETA만 즉시 수정하며 날씨 추가 조회 금지. 새 소리/진동 강수 단계 알림은 후속이다.

기존 로컬 후보는 Android 단위276, UI57, 실제 GPS서비스19 PASS; 전체 작업 폴더 웹719 PASS, 실제 PostgreSQL320+12 PASS, loopback10요청/130표본/1자료/HTTP1·차감1, 실제8초 body timeout 차감 보존과 재호출 차단 PASS다. 이 격리 PR은 서버 변경만 포함하므로 실행된 테스트 수를 따로 기록하며 Hosted 통과로 확대하지 않는다.

신규 정책은 아직 없다. 오늘 Preview KMA7회가 있어 알려진 호출 수와 보수적인 용량 상한을 원장에 보존한 후 정책을 활성화해야 한다. 기존 2개 회원과 자료를 보존한다. 롤백은 새 기능 flag를 끄되 호출/용량 차감 및 기존 웹의 통합 예산 보호를 유지한다. 정책/원장을 삭제하거나 quota를 되돌리지 않는다. cache expiry는10분이며 물리 정리/보존과 storage headroom을 활성화 전에 검토한다.

격리 후보 검증: npm ci PASS(취약점0, 로컬 Node24/프로젝트20 engine warning), 단위685 PASS/실패0/생략0, lint/typecheck/Deno7 PASS, fresh build·로컬 Chromium49 PASS/기존 연결2 SKIP. 원래 작업 폴더719와의 차이는 이 PR에서 제외한 별도 장소 검색 계약 시험34개다. 로컬 Windows 기본3100은 기존 EACCES이므로 임시loopback43100만 사용했고 정본/CI 설정은 보존했다. 원격 CI는 프로젝트의 Node20·기본3100으로 재검증한다.
