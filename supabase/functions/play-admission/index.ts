import { authenticatedClient, serviceClient } from "../_shared/auth.ts";
import { createPlayAdmissionRuntime } from "../_shared/play-admission-runtime.ts";

Deno.serve(createPlayAdmissionRuntime({
  env: name => Deno.env.get(name),
  getUser: request => authenticatedClient(request).auth.getUser(),
  rpc: async (name, args) => await serviceClient().rpc(name, args),
}));
