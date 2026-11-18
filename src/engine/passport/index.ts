/** Digital material passports (C1) — public API. */
export * from "./types";
export { applyMeta, clearMeta, isIsoDate, validatePatch, type MetaEdit } from "./meta";
export { buildPassport, fieldOf, type PassportInput } from "./build";
export { CSV_HEADER, passportFileName, passportToCsv, passportToJson, SCHEMA } from "./export";
export { parseMeta, serializeMeta, PERSIST_VERSION } from "./persist";
