import {
  isApiErrorCode,
  isRecord,
  isRewriteResponse,
  MAX_REWRITE_CHARACTERS,
  MAX_REWRITTEN_CHARACTERS,
  parseRewriteRequest,
  type ApiErrorCode,
  type RewriteRequest,
  type RewriteResponse,
} from "@smartassistance/contracts";

export const SNAPSHOT_TTL_MS = 10 * 60_000;
export const PRIVACY_NOTICE_VERSION = "2026-10-03.4";
export const READING_PORT_NAME = "active-reading";
export const READING_READY_MESSAGE = "READING_READY";
export const TRANSLATION_LANGUAGE_KEY = "translationLanguage";
export const LOCAL_READING_CONSENT_KEY = "localReadingConsent";
export const LOCAL_READING_NOTICE_VERSION = "2026-10-04.1";
export const PRIVACY_CONSENT_KEY = "privacyConsent";
export const ACTIVE_DRAFT_STORAGE_KEY = "activeDraftState";
export const AUTH_TOKEN_STORAGE_KEY = "applicationAccessToken";
export const EXPIRY_ALARM = "expire-private-draft";

export interface EditorDraft {
  richText: boolean;
  snapshotId: string;
  text: string;
  expiresAt: number;
}
export type InteractionPhase = "captured" | "generating" | "preview" | "applied";
export interface ReadyDraftState {
  status: "ready";
  source?: "selection";
  autoTranslate?: true;
  draft: EditorDraft;
  tabId: number;
  documentId: string;
  phase: InteractionPhase;
  generationId?: string;
}
export type ActiveDraftState =
  | { status: "capturing" }
  | { status: "error"; message: string }
  | ReadyDraftState;

export type ContentScriptRequest =
  | { type: "CAPTURE_FOCUSED_EDITOR" }
  | { type: "CAPTURE_SELECTION" }
  | { type: "CAPTURE_SETTLED_SELECTION" }
  | { type: "CLEAR_SNAPSHOT"; snapshotId: string }
  | { type: "APPLY_REWRITE"; snapshotId: string; text: string }
  | { type: "UNDO_REWRITE"; snapshotId: string };
export type ContentScriptResponse =
  | { ok: true; draft: EditorDraft }
  | { ok: true; empty: true }
  | { ok: true; applied: true }
  | { ok: true; undone: true }
  | { ok: true; cleared: true }
  | { ok: false; code: "CONFLICT" | "INVALID_REQUEST"; message: string };

export type ExtensionRequest =
  | { type: "CAPTURE_ACTIVE_EDITOR" }
  | { type: "CAPTURE_ACTIVE_TEXT" }
  | { type: "CAPTURE_ACTIVE_SELECTION" }
  | { type: "READ_SELECTION" }
  | { type: "ACCEPT_PRIVACY_NOTICE" }
  | { type: "ACCEPT_LOCAL_READING_NOTICE" }
  | {
      type: "BEGIN_LOCAL_TRANSLATION" | "COMPLETE_LOCAL_TRANSLATION";
      snapshotId: string;
      generationId: string;
      targetLanguage: string;
    }
  | { type: "CLEAR_PRIVATE_DATA" }
  | { type: "CANCEL_REWRITE"; snapshotId: string; generationId: string }
  | {
      type: "RUN_REWRITE";
      snapshotId: string;
      generationId: string;
      settings: Omit<RewriteRequest, "text">;
    }
  | { type: "APPLY_ACTIVE_REWRITE"; snapshotId: string; generationId: string; text: string }
  | { type: "UNDO_ACTIVE_REWRITE"; snapshotId: string; generationId: string };
export type ExtensionResponse =
  | { ok: true; unchanged: true }
  | { ok: true; captured: true }
  | { ok: true; consented: true }
  | { ok: true; cleared: true }
  | { ok: true; cancelled: true }
  | { ok: true; localStarted: true }
  | { ok: true; localCompleted: true }
  | { ok: true; rewrite: RewriteResponse; snapshotId: string; generationId: string }
  | { ok: true; applied: true }
  | { ok: true; undone: true }
  | { ok: false; code: ApiErrorCode; message: string };

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
function isText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
export function isEditorDraft(value: unknown): value is EditorDraft {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["richText", "snapshotId", "text", "expiresAt"]) &&
    typeof value.richText === "boolean" &&
    isIdentifier(value.snapshotId) &&
    isText(value.text, MAX_REWRITE_CHARACTERS) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  );
}
export function isActiveDraftState(value: unknown): value is ActiveDraftState {
  if (!isRecord(value)) return false;
  if (value.status === "capturing") return hasOnlyKeys(value, ["status"]);
  if (value.status === "error")
    return hasOnlyKeys(value, ["status", "message"]) && isText(value.message, 2000);
  const captured = value.phase === "captured";
  return (
    value.status === "ready" &&
    hasOnlyKeys(
      value,
      captured
        ? [
            "status",
            "draft",
            "tabId",
            "documentId",
            "phase",
            ...(value.source === "selection" ? ["source"] : []),
            ...(value.autoTranslate === true ? ["autoTranslate"] : []),
          ]
        : [
            "status",
            "draft",
            "tabId",
            "documentId",
            "phase",
            "generationId",
            ...(value.source === "selection" ? ["source"] : []),
          ],
    ) &&
    isEditorDraft(value.draft) &&
    Number.isInteger(value.tabId) &&
    (value.tabId as number) >= 0 &&
    isIdentifier(value.documentId) &&
    ["captured", "generating", "preview", "applied"].includes(value.phase as string) &&
    !(value.source === "selection" && value.phase === "applied") &&
    (value.autoTranslate === undefined ||
      (value.autoTranslate === true && value.source === "selection" && captured)) &&
    (captured ? value.generationId === undefined : isIdentifier(value.generationId))
  );
}
export function isContentScriptRequest(value: unknown): value is ContentScriptRequest {
  if (!isRecord(value)) return false;
  if (
    ["CAPTURE_FOCUSED_EDITOR", "CAPTURE_SELECTION", "CAPTURE_SETTLED_SELECTION"].includes(
      value.type as string,
    )
  )
    return hasOnlyKeys(value, ["type"]);
  if (!isIdentifier(value.snapshotId)) return false;
  return (
    ((value.type === "CLEAR_SNAPSHOT" || value.type === "UNDO_REWRITE") &&
      hasOnlyKeys(value, ["type", "snapshotId"])) ||
    (value.type === "APPLY_REWRITE" &&
      hasOnlyKeys(value, ["type", "snapshotId", "text"]) &&
      isText(value.text, MAX_REWRITTEN_CHARACTERS))
  );
}
export function isContentScriptResponse(value: unknown): value is ContentScriptResponse {
  if (!isRecord(value)) return false;
  if (value.ok === false)
    return (
      hasOnlyKeys(value, ["ok", "code", "message"]) &&
      (value.code === "CONFLICT" || value.code === "INVALID_REQUEST") &&
      isText(value.message, 2000)
    );
  if (value.ok !== true || Object.keys(value).length !== 2) return false;
  return (
    isEditorDraft(value.draft) ||
    value.applied === true ||
    value.empty === true ||
    value.undone === true ||
    value.cleared === true
  );
}
export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!isRecord(value)) return false;
  if (
    [
      "CAPTURE_ACTIVE_EDITOR",
      "CAPTURE_ACTIVE_TEXT",
      "CAPTURE_ACTIVE_SELECTION",
      "READ_SELECTION",
      "ACCEPT_PRIVACY_NOTICE",
      "ACCEPT_LOCAL_READING_NOTICE",
      "CLEAR_PRIVATE_DATA",
    ].includes(value.type as string)
  )
    return hasOnlyKeys(value, ["type"]);
  if (!isIdentifier(value.snapshotId) || !isIdentifier(value.generationId)) return false;
  if (value.type === "BEGIN_LOCAL_TRANSLATION" || value.type === "COMPLETE_LOCAL_TRANSLATION")
    return (
      hasOnlyKeys(value, ["type", "snapshotId", "generationId", "targetLanguage"]) &&
      parseRewriteRequest({
        text: "validation",
        operation: "translate",
        targetLanguage: value.targetLanguage,
      }).success
    );
  if (value.type === "CANCEL_REWRITE" || value.type === "UNDO_ACTIVE_REWRITE")
    return hasOnlyKeys(value, ["type", "snapshotId", "generationId"]);
  if (value.type === "APPLY_ACTIVE_REWRITE")
    return (
      hasOnlyKeys(value, ["type", "snapshotId", "generationId", "text"]) &&
      isText(value.text, MAX_REWRITTEN_CHARACTERS)
    );
  return (
    value.type === "RUN_REWRITE" &&
    hasOnlyKeys(value, ["type", "snapshotId", "generationId", "settings"]) &&
    isRecord(value.settings) &&
    !("text" in value.settings) &&
    parseRewriteRequest({ ...value.settings, text: "validation" }).success
  );
}
export function isExtensionResponse(value: unknown): value is ExtensionResponse {
  if (!isRecord(value)) return false;
  if (value.ok === false)
    return (
      hasOnlyKeys(value, ["ok", "code", "message"]) &&
      isApiErrorCode(value.code) &&
      isText(value.message, 2000)
    );
  if (value.ok !== true) return false;
  if ("rewrite" in value)
    return (
      hasOnlyKeys(value, ["ok", "rewrite", "snapshotId", "generationId"]) &&
      isRewriteResponse(value.rewrite) &&
      isIdentifier(value.snapshotId) &&
      isIdentifier(value.generationId)
    );
  return [
    "captured",
    "consented",
    "cleared",
    "cancelled",
    "applied",
    "undone",
    "unchanged",
    "localStarted",
    "localCompleted",
  ].some((key) => value[key] === true && hasOnlyKeys(value, ["ok", key]));
}
export function consentScope(apiUrl: string): string {
  return `${PRIVACY_NOTICE_VERSION}:${apiUrl}`;
}
