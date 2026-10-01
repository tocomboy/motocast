import { NextResponse } from "next/server";

import { isTrustedSameOriginJsonRequest } from "@/lib/auth/request-policy";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

function invalidRequest() {
  return NextResponse.json({ error: "초대 요청을 확인할 수 없습니다." }, {
    status: 400,
    headers: noStoreHeaders,
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginJsonRequest(request)) return invalidRequest();
  const response = NextResponse.json({ error: "초대 코드 가입은 종료됐습니다. Play 스토어의 MOTOCAST 앱에서 가입해 주세요." }, {
    status: 410,
    headers: noStoreHeaders,
  });
  response.cookies.delete("motocast_invite");
  return response;
}
