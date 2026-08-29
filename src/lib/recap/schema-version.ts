import type { RecapSchemaVersion } from "@/lib/recap/types";

/**
 * The payload shape this build writes and can read (S-11 `types.ts:22-26`).
 *
 * It lives HERE rather than in `types.ts` because that module is deliberately
 * type-only — `src/db/schema.ts` applies `.$type<RecapPayload>()` to the JSONB
 * columns, and a single value export there would make the schema module load the
 * recap module at runtime. A one-line module is the cheap way to have the
 * constant without giving that up.
 *
 * S-12 reads it: a stored recap whose `schemaVersion` is not this one is still
 * shown — its frozen bytes are bytes, not a shape — but nothing is read out of
 * its payload, because a later shape's fields would render as `undefined`.
 */
export const RECAP_SCHEMA_VERSION: RecapSchemaVersion = 1;
