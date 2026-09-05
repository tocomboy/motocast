# 기상청 초단기예보의 시간·operation 식별 조사

조사일: 2026-09-05 (KST)
상태: **공식 공개자료만 확인. 요청·응답 정확 일치를 바꿀 근거 없음.**

## 결론

2026-09-05T10:47 UTC 전후 한 고정 격자에서 실행한 단일 probe는 모델·요청·반환 발표시각을 기록했다. 초단기 두 정규 발표는 각각 19:30→19:00 및 18:30→18:00으로 strict parser가 거절했고, 단기 17:00→17:00은 파서를 통과했다. 초단기 두 응답은 서로 다른 요청 발표에 대한 관측이며, 알려진 항목 그룹은 각각 하나의 반환 발표시각과 일치 격자를 공유했다. 다만 전체 URL과 원문 payload는 기록하지 않았으므로, 이 단일 격자·단일 실행만으로 원인이나 공급자 일반 허용 범위를 확정할 수 없다.

Exa의 이번 좁은 공식 원문 검색과 APIhub 원문은 typ02 `getUltraSrtFcst`의 `base_time`을 `HH30` 발표시각으로, 출력 `baseTime`도 발표시각으로 정의한다. `:30` 요청에 이전 `:00`을 반환해도 된다는 규칙·예시·최대 차이·2026년 typ02 라우팅 변경은 찾지 못했다. 반대로 두 값이 항상 같다는 명시도 찾지 못했다. 따라서 **이 공개 근거만으로 요청·반환 발표시각을 다르게 수용할 수 없으며, 현재 정확 일치 guard와 요청 선택을 유지한다.**

## 확인한 공식 계약과 적용 한계

- [APIhub 예특보 API 목록 4.2](https://apihub.kma.go.kr/apiList.do?seqApi=10)는 typ02 `getUltraSrtFcst`의 `base_time`을 “06시30분 발표(30분 단위)”로, 응답 `baseTime`을 발표시각으로 적는다. 이는 현재 `HH30` 요청 선택을 지지하지만, 반환값 fallback 규칙은 적지 않는다.
- 같은 공식 목록의 별도 typ01 `2.2 초단기예보 API`는 `tmfc`를 “연월일시분(KST) - 10분 간격 발표”로 정의한다. typ01의 10분 계약은 typ02 `base_date`/`base_time` 조회의 반환 선택 규칙이 아니다.
- APIhub의 [공지 목록](https://apihub.kma.go.kr/noticeList.do)를 2026-09-05에 확인했다. 표시된 2026 공지와 목록 페이지에서 typ02 `getUltraSrtFcst`의 `:30`→`:00` 반환, fallback 또는 operation 재경로를 설명하는 공지는 발견하지 못했다. 목록에 없다는 결과는 공개 목록 범위의 빈 결과일 뿐, 비공개·미게시 운영 변경의 부재 증명은 아니다.

## 동일 공식 가이드 안의 경로 표기 불일치

APIhub가 배포한 [단기예보조회서비스 API 활용 가이드 260623](https://apihub.kma.go.kr/getAttachFile.do?fileName=%EB%8B%A8%EA%B8%B0%EC%98%88%EB%B3%B4%EC%A1%B0%ED%9A%8C%EC%84%9C%EB%B9%84%EC%8A%A4_API%ED%99%9C%EC%9A%A9%EA%B0%80%EC%9D%B4%EB%93%9C_260623.docx)의 로컬 원문 XML을 읽어 문서 내부를 대조했다. 이 문서의 `Call Back URL`은 API 목록과 같은 다음 canonical 경로를 적는다.

`https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtFcst`

그런데 같은 표의 요청 예시만 `VilageFcstInfoService_2.0/`가 빠진 다음 경로를 적고 `base_time=0630`을 사용한다.

`https://apihub.kma.go.kr/api/typ02/openApi/getUltraSrtFcst?...&base_time=0630&...`

APIhub live 목록은 callback 경로와 일치하는 operation을 제시하며, 짧은 예시 경로가 canonical·별칭·리다이렉트라고 설명하지 않는다. 실제 provider 요청은 금지된 범위이므로 그 짧은 경로의 동작을 검사하지 않았다. 따라서 이 불일치는 **가이드 내부의 표기 충돌(예시 경로의 누락 가능성)**까지만 말할 수 있고, local canonical path를 바꾸거나 typ02의 반환 발표시각 차이를 설명하는 근거가 되지 않는다.

## Exa 실행·선별

| 검색 각도 | 호출 수 × `numResults` | 선별 결과 |
| --- | ---: | --- |
| typ02 `getUltraSrtFcst`의 `base_time`·`baseTime`·`:30` 계약 | 2 × 6 | APIhub 목록 원문을 확인했다. 제3자 코드·블로그는 계약 근거에서 제외했다. |
| 2026 안내·10분 갱신·발표시각 변경 | 2 × 6 | APIhub 목록과 공지 목록을 확인했다. typ02 반환 fallback/route 변경 원문은 없었다. |

`sources_reviewed: 24`는 모든 Exa 검색 호출의 `numResults` 합이다. URL 중복을 제거하면 이 판정에 사용한 공식 원문은 API 목록과 공지 목록 두 개이며, 가이드 DOCX는 APIhub의 공식 직접 URL을 Exa fetch했으나 다운로드 MIME 때문에 본문 추출이 실패해 위의 로컬 원문 대조로만 보완했다. 실제 KMA API 호출, 인증, 외부 문의, 배포 및 제품 코드는 변경하지 않았다.

## 판정

공식 문서가 정의한 `:30` 요청 발표시각 선택은 유지할 수 있다. 다만 그 선택이 실제 응답의 `baseTime` 정확 일치를 보장한다는 근거는 없다. 공급자가 응답 `baseTime`을 요청 발표시각과 다르게 고를 수 있는지의 **명시적 공식 규칙도 아직 없다**. `:00`을 허용하려면 그 선택 규칙을 직접 정한 공식 원문 또는 별도 제품 계약이 필요하다.

## 직접 원문

- [기상청 APIhub — 예특보 API 목록](https://apihub.kma.go.kr/apiList.do?seqApi=10) (2026-09-05 Exa search/fetch 확인)
- [기상청 APIhub — 공지 목록](https://apihub.kma.go.kr/noticeList.do) (2026-09-05 Exa fetch 확인)
- [기상청 APIhub — 단기예보조회서비스 API 활용 가이드 260623](https://apihub.kma.go.kr/getAttachFile.do?fileName=%EB%8B%A8%EA%B8%B0%EC%98%88%EB%B3%B4%EC%A1%B0%ED%9A%8C%EC%84%9C%EB%B9%84%EC%8A%A4_API%ED%99%9C%EC%9A%A9%EA%B0%80%EC%9D%B4%EB%93%9C_260623.docx) (로컬 공식 사본의 XML 대조; Exa 본문 추출은 `CRAWL_UNEXPECTED_CONTENT_TYPE`)
