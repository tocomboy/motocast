# MOTOCAST repository guidance

Follow the active Codex home's global `AGENTS.md` and its personal routing source.

- Product, security, cost, and operations decisions: `docs/product/MOTOCAST_SOT.md`
- Verification, lead-owned review, findings, and deployment gates: `docs/rules/verification-and-review.md`
- When implementation or live service state conflicts with a confirmed decision, record the conflict and interview the user before changing the affected slice.
- Work on `develop`; promote to `main` only through a same-repository `develop -> main` pull request.
- Never read `CLAUDE.md` or `.claude/` unless the user explicitly requests a Claude configuration audit or migration.

## Design before screen implementation

- 웹·Android의 새 화면·시트·팝업과 기존 화면의 큰 구성 변경은 항상 기존 MOTOCAST Figma에서 필요한 상태를 먼저 디자인하고 렌더 검수한 뒤 구현한다.
- 기존 컴포넌트·색상·서체를 재사용하고 Figma 노드와 구현 상태를 작업 기록에 연결한다. 디자인 완료와 앱 적용·기기 검증 완료를 구분한다.
- Android 대표 시안은 Galaxy S23+ 논리 화면 384×832이며 작은 화면과 큰 글자도 검증한다. 상세 절차: [디자인 선행 규칙](docs/rules/design-before-implementation.md).

## Version and release management

- 웹과 Android의 사용자 기능·수정은 하나의 출시 단위로 설계·구현·검증한다. 공통 서비스 버전과 해당 업데이트 소식을 양쪽에 함께 반영하며, 한쪽만 배포된 상태를 출시 완료로 보고하지 않는다. 플랫폼 고유 차이·순차 배포 중간 상태는 명시하고 필요한 예외는 사용자 결정으로 기록한다. 정본: `docs/product/MOTOCAST_SOT.md`의 `SCOPE-003`.
- 출시 기록 하나에 양쪽 PR·고정 SHA·버전·웹 배포 ID·Android versionCode/AAB/Play 트랙과 항목별 검증 상태를 연결한다. 서버 호환성 → 웹 운영 확인 → Android 내부 배포 순서와 실기기·정식 공개 조건을 유지한다. 문서만 바뀌면 바이너리를 다시 배포하지 않는다.
- For each product release, choose and record the next `MAJOR.MINOR.PATCH` version before final candidate verification: patch for compatible fixes, minor for compatible features, and major for breaking changes. Do not bump the product version for every commit or for documentation-only changes.
- Use `package.json` as the current-version source of truth. Update its version, the root package versions in `package-lock.json`, and the matching entry in `lib/releases.ts` together. Preserve published release history and write concise, user-facing Korean update notes.
- Before promotion, verify that the package version, latest release note, footer version, `/updates`, and per-account/per-version announcement agree. Apply the verification and deployment gates in `docs/rules/verification-and-review.md` to the fixed release candidate.
- After verifying the Production deployment of the approved `develop -> main` promotion, publish the matching `vMAJOR.MINOR.PATCH` Git tag and GitHub Release against the exact deployed `main` commit. Never move or reuse a published version tag.
- Record the version, PR, verified commit, CI result, Preview and Production deployment identifiers, and remaining verification limits in the release evidence. These rules do not independently authorize publication or deployment; use the current user authorization and repository gates.
