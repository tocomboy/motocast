import { journeyHandler } from "../_shared/journey-handler.ts";
Deno.serve(request => journeyHandler(request, true));
