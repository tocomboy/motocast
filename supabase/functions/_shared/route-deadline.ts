import { parseStrictRfc3339 } from "./strict-time.ts";

export function assertWithinHardReturn(returnAt: string, hardReturnAt: string) {
  const returned = parseStrictRfc3339(returnAt);
  const hardReturn = parseStrictRfc3339(hardReturnAt);
  if (!returned || !hardReturn || returned.getTime() > hardReturn.getTime()) {
    throw new Error("ROUTE_EXCEEDS_HARD_RETURN");
  }
}
