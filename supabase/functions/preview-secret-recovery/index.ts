import { createRecoveryHandler } from "./handler.ts";
import { RECOVERY_PIN } from "./pin.ts";

const handler = createRecoveryHandler(RECOVERY_PIN, {
  getEnv: (name) => Deno.env.get(name),
});

Deno.serve(handler);
