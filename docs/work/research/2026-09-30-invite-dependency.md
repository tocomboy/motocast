# 초대 관리 서버 선행 파일 복구와 로컬 검증

2026-09-30. 담당: `invite_dependency`. 메인의 고정 구현 범위 안에서 서버의 누락된 초대 회수 RPC와 검증 파일만 가져왔다. 제품 결정 `AUTH-001`, `AUTH-002`, `AUTH-003`을 적용한다. 새 스키마 동작, 웹/Android 화면, 배포, commit/stage/merge는 이 작업에 포함하지 않는다.

## 원본과 Preview 대응

원본 경로는 `C:/Users/User/Desktop/coding/Side_Project/MOTOCAST`이며 기존 untracked 파일을 그대로 보존했다. 가져오는 시점에 `CRLF -> LF`를 명시적으로 정규화했고 다른 공백이나 문장을 정규화하지 않았다.

- `supabase/migrations/20260921155004_invite_management_revoke.sql`: 원본 및 후보 SHA-256 `37148de0c894d1747657a14e151d083791b4ef8bcc9763eeb8156d3679b74938`. 정규화 후 정확한 전체 내용 일치 `PASS`.
- `supabase/tests/database/invite_management.test.sql`: 원본 및 후보 SHA-256 `08772a3a8e54159b72868818b13e0f84cec041bd0fdea36573ec08f15b1fa792`. 정규화 후 정확한 전체 내용 일치 `PASS`.
- `supabase/tests/database/invite_management_concurrency.py`: 정규화한 원본 SHA-256 `2d9a5d799f1af8d7d851835d5345f551e3aec29a0b4337365118ac1b024f312d`; 최종 후보 SHA-256 `d2bd751eca4b0550f92967f9a8990fd2a9740d704accbfad1cc27fa7bc2782a9`. 아래 실행 안전성 변경이 있으므로 원본 전체 동일성은 주장하지 않는다.

기존 readback 자료 `C:/Users/Public/Documents/ESTsoft/CreatorTemp/preview-migrations-readback.json`에서 `name=invite_management_revoke`, `version=20260921160203`인 항목 하나의 statements 전체와 후보 migration을 비교했다. CRLF 정규화 후 정확한 일치 `PASS`. Preview의 적용 버전과 로컬 원본 파일명의 버전은 다르므로 이 대응을 보존한다. 이 작업에서는 hosted migration을 적용하거나 migration registry를 수정하지 않았다.

RPC의 관리자는 현재 인증 주체의 활성 관리자 membership으로 판단한다. 동일 invitation 행에 대한 `FOR UPDATE` 잠금은 기존 `claim_invite`와 공유한다. 회수 재시도는 최초 시각을 보존하며, 만료/사용 완료 결과는 기존 invitation 및 membership을 다시 쓰지 않는다. PUBLIC/anon/service_role 실행은 철회하고 authenticated만 실행할 수 있지만 함수 내부에서도 관리자 여부를 확인한다. 원본의 실패 조건과 grant를 변경하지 않았다.

## 동시성 검증기 변경

원본 검증기는 공유 `postgres` DB를 고정 대상으로 삼고 종료 시 함수를 삭제한다. 승인된 별도 DB 검증을 위해 이 검증기만 다음과 같이 조정했다.

- 필수 `--database` 인자를 받고 `motocast_invite_[0-9]{8}_[0-9a-f]{10}` 이름만 허용한다. 특정 실행 날짜를 코드에 고정하지 않는다.
- 예상 컨테이너 ID는 필수 `--container-id`로 전달하며 정확한 64자리 lowercase hex만 허용한다. 기기별 실제 ID를 코드에 넣지 않는다.
- 필수 `--database-marker`로 기대하는 작업 소유 comment를 전달한다. 논리적 목적/소유자/template0 marker만 허용하며 기존 증거의 날짜 포함 marker도 지원한다.
- 컨테이너 ID, project label, 정확한 이미지, running 상태를 비교하고 실제 current_database, DB owner, 작업 소유 marker가 다르면 명시적으로 실패한다.
- 동시 연결의 application_name을 실행마다 고유하게 만들고 `pg_stat_activity` 조회를 해당 DB와 이름으로 한정한다.
- candidate 설치는 `postgres` 소유자로 실행한다. UTF-8 파일 인코딩을 명시한다.
- 원본의 두 race assertion을 유지한다. DB, 함수, 합성 fixture를 삭제하지 않고 보존한다. 검증기가 시작한 미완료 자식 프로세스만 종료한다.

## 실행과 결과

확인된 컨테이너: `supabase_db_motocast`, ID `40265102dfb2e71ef2077886e9f50489527d8917450f9186503041d32c1395da`, project label `motocast`, 이미지 `public.ecr.aws/supabase/postgres:17.6.1.166`, running `true`.

새 DB `motocast_invite_20260930_b9e8c712de`를 template0/owner postgres로 생성했다. 생성 시각 `2026-09-30T09:33:55.001859+00:00`. 기존 auth 스키마의 pre-data만 복사하고, 기존 검증기와 같은 platform grant/extensions를 설치한 후 정본 migration 18개를 재현했다. 초대 후보 migration은 rollback SQL 및 race setup에서 별도로 실행했다. 기존 DB/컨테이너/볼륨의 reset/drop은 수행하지 않았다. 정본 migration 자체의 기존 `DROP IF EXISTS`/정리 구문은 오직 새 빈 작업 DB에서 재현했다.

SQL suite는 `docker exec -i supabase_db_motocast psql -U supabase_admin -d motocast_invite_20260930_b9e8c712de -X -q -At -v ON_ERROR_STOP=1`에 전달했다. `\ir` 한 줄은 가져온 정확한 migration 내용으로 메모리에서 확장했다. SQL 원본 파일은 수정하지 않았다.

```powershell
python supabase/tests/database/invite_management_concurrency.py `
  --database motocast_invite_20260930_b9e8c712de `
  --container-id 40265102dfb2e71ef2077886e9f50489527d8917450f9186503041d32c1395da `
  --database-marker 'motocast-invite-dependency-20260930;owner=invite_dependency;isolated=template0'
```

| 검증 | 결과 |
| --- | --- |
| 기존 migration 재현 | 18 PASS / 0 FAIL |
| 원본 SQL 권한·상태 검증 | 18 PASS / 0 FAIL / 0 ERROR / 0 SKIP |
| 실제 두 연결 claim/revoke race | 2 PASS / 0 FAIL / 0 ERROR / 0 SKIP |
| 추가 실제 anon/service_role/인증 주체 없음/비회원 호출 거부 | 4 PASS / 0 FAIL |
| 대상 신원 인자 누락·형식 오류·공유 DB·실제 컨테이너/marker 불일치·보존 DB 재사용 거부 | 11 PASS / 0 FAIL / 0 ERROR / 0 SKIP; 모두 의도한 비정상 exit |
| Python 문법 compile | PASS; pycache 생성 없음 |
| 전담 파일 Git diff 검사 및 별도 공백 검사 | PASS |

원본 SQL은 활성 관리자, rider, 회수된 관리자, 익명 및 service-role 함수 권한, invitation 직접 UPDATE 금지, rider 조회 차단, 신규 회수, 재시도 시각 보존, null/없는 ID, 회수 후 가입 거부와 membership 미생성, 만료/사용 완료 invitation 및 기존 membership 보존을 검증했다. 첫 race에서는 회수가 선행하여 가입이 잠금 대기 후 `INVALID_INVITE`로 거부되었다. 두 번째에서는 가입이 선행하여 회수가 잠금 대기 후 `used`를 반환했고 활성 membership 한 개가 남았다.

메인 검수 후 실행 신원 인자를 필수화하고 날짜 namespace를 일반화했다. SQL/schema, 두 race의 본문, DB targeting 이후 실행 동작은 바꾸지 않았다. 앞선 실제 race 증거를 보존하고 신원 인자 검증만 추가로 실행했다. 위 명령은 최종 인터페이스의 재현 형식이며 같은 보존 DB에 재실행하면 fixture/함수 존재 guard가 실패한다.

SQL rollback 후 auth fixture 0개와 후보 함수 없음도 확인했다. 첫 외부 집계 wrapper는 실제 18개 항목을 19개로 잘못 예상해 `ERROR 1`을 냈다. 원본 SQL exit는 0이고 18개 모두 PASS였으며 rollback도 완료되었다. unchanged SQL 로그의 개수 18을 확인해 집계만 바로잡았고 제품 assertion 수정이나 재실행으로 오류를 감추지 않았다.

전체 서버 baseline/CI, 메인 직접 검수, 새 후보의 connected Preview, Production은 이 worker 범위에서 `NOT_RUN`이다. 로컬 20개 제품 검증과 추가 접근 거부 4개는 배포 또는 전체 제품 완료 근거를 대신하지 않는다. 새 도구 설치는 없으며 기존 Python 3.12.5와 컨테이너 psql을 사용했다.

## 보존 자원과 재개

생성 전 C 드라이브 여유 `100482789376 bytes`; 새 DB 예산 `104857600 bytes`. 종료 DB 크기 `18066579 bytes`로 예산 안이다. 정확한 DB OID/owner와 migration별 SHA는 외부 `identity.json`에 기록했다. Auth 합성 사용자 3개, invitation 2개, membership 2개와 postgres 소유 후보 함수가 보존되어 있다. 마지막 검사에서 작업 DB의 다른 활성 연결은 0개였다. 공유 DB와 메인의 weather 검증 자원은 변경하지 않았다.

외부 증거 경로: `C:/Users/Public/Documents/ESTsoft/CreatorTemp/invite-dependency-20260930/`.

- `identity.json`: DB 신원, 생성 목적/시각, migration별 hash, 예산/크기, 보존 상태 및 집계 오류.
- `parity.json`: 정확한 원본/후보/Preview 비교와 Python compile/대상 거부 결과.
- `invite_management-sql.log`, `invite_management-concurrency.log`: 원본 assertion 및 race 출력.
- `supplemental-role-denials.json`: 실제 권한 거부 4개.
- `runner-adaptation.diff`: 정규화 원본 대비 검증기 변경분.
- `target-guards.json`: 최종 필수 인자·형식·실제 컨테이너 mismatch 거부 결과.

현재 상태는 `complete_preserved`이다. 보존 이유는 메인 검수·재현 증거이며 기존 DB에 재실행하면 fixture/함수 존재 guard가 실패한다. 반복이 필요하면 새로운 고유 작업 DB를 신원/예산 확인 후 초기화하고 증거를 새로 남긴다. 종료 48시간 후 처분 검토가 가능하지만 시간 경과를 삭제 권한으로 간주하지 않는다. 이 작업은 삭제를 승인하거나 실행하지 않았다.
