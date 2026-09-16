import packageMetadata from "@/package.json";

export type ReleaseNote = {
  version: string;
  date: string;
  title: string;
  summary: string;
  bullets: readonly string[];
};

export const currentVersion = packageMetadata.version;

export const releaseNotes = [
  {
    version: "0.2.2",
    date: "2026-09-16",
    title: "경로 오류 진단 개선",
    summary: "경로 계획 실패 원인을 더 정확히 확인할 수 있도록 진단을 보완했습니다.",
    bullets: [
      "일부 경로 계획 오류는 원인을 확인 중이에요.",
      "실패 원인을 구분하는 서버 진단을 보완했어요.",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-09-16",
    title: "모바일 초대 기능 개선",
    summary: "작은 화면에서도 초대 링크를 만들고 복사할 수 있습니다.",
    bullets: [
      "모바일에서 초대 관리와 링크 복사 버튼이 보이도록 고쳤어요.",
      "작은 화면에서도 초대 버튼을 누르기 편하도록 배치를 다듬었어요.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-16",
    title: "업데이트 소식을 한눈에",
    summary: "달라진 점과 현재 버전을 한곳에서 확인할 수 있습니다.",
    bullets: [
      "새 버전의 주요 소식을 처음 접속할 때 한 번만 알려드려요.",
      "업데이트 소식에서 달라진 점과 현재 버전을 언제든 다시 확인해요.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-15",
    title: "함께 달릴 코스를 준비해요",
    summary: "초대받은 라이더를 위한 MOTOCAST의 시작입니다.",
    bullets: [
      "들를 곳을 순서대로 정하고 라이딩 경로와 예상 복귀 시각을 확인해요.",
      "구간별 예상 통과 시각에 맞는 날씨를 함께 살펴봐요.",
      "코스를 저장해 다시 불러오고, 준비한 라이딩 정보를 링크로 공유해요.",
    ],
  },
] as const satisfies readonly ReleaseNote[];
