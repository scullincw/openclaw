import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { emitDiagnosticEvent } from "./diagnostic-events.js";

type DiagnosticTraceMetadata = {
  channel?: string;
  messageId?: number | string;
  chatId?: number | string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  provider?: string;
  model?: string;
};

type DiagnosticTraceState = {
  traceKey: string;
  metadata: DiagnosticTraceMetadata;
  sessionKeys: Set<string>;
  runIds: Set<string>;
};

type DiagnosticTraceScope = {
  state: DiagnosticTraceState;
  spanStack: string[];
};

export type DiagnosticSpanHandle = {
  traceKey: string;
  spanKey: string;
  name: string;
};

const traceScopeStorage = new AsyncLocalStorage<DiagnosticTraceScope>();
const traceStateByKey = new Map<string, DiagnosticTraceState>();
const traceKeyBySession = new Map<string, string>();
const traceKeyByRun = new Map<string, string>();

function getCurrentTraceScope(): DiagnosticTraceScope | undefined {
  return traceScopeStorage.getStore();
}

function getCurrentTraceState(): DiagnosticTraceState | undefined {
  return getCurrentTraceScope()?.state;
}

function cleanupTraceState(state: DiagnosticTraceState) {
  traceStateByKey.delete(state.traceKey);
  for (const sessionKey of state.sessionKeys) {
    if (traceKeyBySession.get(sessionKey) === state.traceKey) {
      traceKeyBySession.delete(sessionKey);
    }
  }
  for (const runId of state.runIds) {
    if (traceKeyByRun.get(runId) === state.traceKey) {
      traceKeyByRun.delete(runId);
    }
  }
}

function buildSpanIdentity(
  state: DiagnosticTraceState,
  attributes?: Record<string, string | number | boolean>,
) {
  return {
    ...(state.metadata.channel ? { channel: state.metadata.channel } : {}),
    ...(state.metadata.messageId !== undefined ? { messageId: state.metadata.messageId } : {}),
    ...(state.metadata.chatId !== undefined ? { chatId: state.metadata.chatId } : {}),
    ...(state.metadata.sessionKey ? { sessionKey: state.metadata.sessionKey } : {}),
    ...(state.metadata.sessionId ? { sessionId: state.metadata.sessionId } : {}),
    ...(state.metadata.runId ? { runId: state.metadata.runId } : {}),
    ...(state.metadata.provider ? { provider: state.metadata.provider } : {}),
    ...(state.metadata.model ? { model: state.metadata.model } : {}),
    ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
}

export function createDiagnosticTrace(params: DiagnosticTraceMetadata & { traceKey?: string }) {
  const state: DiagnosticTraceState = {
    traceKey: params.traceKey?.trim() || randomUUID(),
    metadata: {
      ...(params.channel ? { channel: params.channel } : {}),
      ...(params.messageId !== undefined ? { messageId: params.messageId } : {}),
      ...(params.chatId !== undefined ? { chatId: params.chatId } : {}),
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.model ? { model: params.model } : {}),
    },
    sessionKeys: new Set<string>(),
    runIds: new Set<string>(),
  };
  traceStateByKey.set(state.traceKey, state);
  if (state.metadata.sessionKey) {
    state.sessionKeys.add(state.metadata.sessionKey);
    traceKeyBySession.set(state.metadata.sessionKey, state.traceKey);
  }
  if (state.metadata.runId) {
    state.runIds.add(state.metadata.runId);
    traceKeyByRun.set(state.metadata.runId, state.traceKey);
  }
  return state;
}

export async function runWithDiagnosticTrace<T>(
  state: DiagnosticTraceState,
  run: () => Promise<T>,
): Promise<T> {
  return await traceScopeStorage.run(
    {
      state,
      spanStack: [],
    },
    async () => {
      try {
        return await run();
      } finally {
        cleanupTraceState(state);
      }
    },
  );
}

export async function runWithDiagnosticTraceKey<T>(
  traceKey: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const normalized = traceKey?.trim();
  if (!normalized) {
    return await run();
  }
  const currentScope = getCurrentTraceScope();
  if (currentScope?.state.traceKey === normalized) {
    return await run();
  }
  const state = traceStateByKey.get(normalized);
  if (!state) {
    return await run();
  }
  return await traceScopeStorage.run(
    {
      state,
      spanStack: [],
    },
    run,
  );
}

export async function runWithDiagnosticTraceForSession<T>(
  sessionKey: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const normalized = sessionKey?.trim();
  if (!normalized) {
    return await run();
  }
  const traceKey = traceKeyBySession.get(normalized);
  return await runWithDiagnosticTraceKey(traceKey, run);
}

export function updateCurrentDiagnosticTraceMetadata(metadata: Partial<DiagnosticTraceMetadata>) {
  const state = getCurrentTraceState();
  if (!state) {
    return;
  }
  const sessionKey = metadata.sessionKey?.trim();
  const runId = metadata.runId?.trim();
  if (metadata.channel) {
    state.metadata.channel = metadata.channel;
  }
  if (metadata.messageId !== undefined) {
    state.metadata.messageId = metadata.messageId;
  }
  if (metadata.chatId !== undefined) {
    state.metadata.chatId = metadata.chatId;
  }
  if (metadata.sessionId) {
    state.metadata.sessionId = metadata.sessionId;
  }
  if (metadata.provider) {
    state.metadata.provider = metadata.provider;
  }
  if (metadata.model) {
    state.metadata.model = metadata.model;
  }
  if (sessionKey) {
    state.metadata.sessionKey = sessionKey;
    state.sessionKeys.add(sessionKey);
    traceKeyBySession.set(sessionKey, state.traceKey);
  }
  if (runId) {
    state.metadata.runId = runId;
    state.runIds.add(runId);
    traceKeyByRun.set(runId, state.traceKey);
  }
}

export function getCurrentDiagnosticTraceKey(): string | undefined {
  return getCurrentTraceState()?.traceKey;
}

export function getCurrentDiagnosticTraceContext():
  | {
      traceKey: string;
      parentSpanKey?: string;
    }
  | undefined {
  const scope = getCurrentTraceScope();
  if (!scope) {
    return undefined;
  }
  const parentSpanKey = scope.spanStack[scope.spanStack.length - 1];
  return {
    traceKey: scope.state.traceKey,
    ...(parentSpanKey ? { parentSpanKey } : {}),
  };
}

export function startDiagnosticSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
  options?: {
    startTimeMs?: number;
    parentSpanKey?: string;
  },
): DiagnosticSpanHandle | null {
  const scope = getCurrentTraceScope();
  if (!scope) {
    return null;
  }
  const spanKey = randomUUID();
  const parentSpanKey =
    options?.parentSpanKey?.trim() || scope.spanStack[scope.spanStack.length - 1];
  emitDiagnosticEvent({
    type: "trace.span.start",
    traceKey: scope.state.traceKey,
    spanKey,
    ...(parentSpanKey ? { parentSpanKey } : {}),
    name,
    startTimeMs: options?.startTimeMs ?? Date.now(),
    ...buildSpanIdentity(scope.state, attributes),
  });
  return {
    traceKey: scope.state.traceKey,
    spanKey,
    name,
  };
}

export function endDiagnosticSpan(
  handle: DiagnosticSpanHandle | null | undefined,
  options?: {
    endTimeMs?: number;
    status?: "ok" | "error";
    error?: string;
    attributes?: Record<string, string | number | boolean>;
  },
) {
  if (!handle) {
    return;
  }
  emitDiagnosticEvent({
    type: "trace.span.end",
    traceKey: handle.traceKey,
    spanKey: handle.spanKey,
    name: handle.name,
    endTimeMs: options?.endTimeMs ?? Date.now(),
    ...(options?.status ? { status: options.status } : {}),
    ...(options?.error ? { error: options.error } : {}),
    ...(options?.attributes && Object.keys(options.attributes).length > 0
      ? { attributes: options.attributes }
      : {}),
  });
}

export async function withDiagnosticSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> | undefined,
  run: () => Promise<T>,
  options?: {
    startTimeMs?: number;
  },
): Promise<T> {
  const scope = getCurrentTraceScope();
  if (!scope) {
    return await run();
  }
  const handle = startDiagnosticSpan(name, attributes, options);
  if (!handle) {
    return await run();
  }
  return await traceScopeStorage.run(
    {
      state: scope.state,
      spanStack: [...scope.spanStack, handle.spanKey],
    },
    async () => {
      try {
        const result = await run();
        endDiagnosticSpan(handle, { status: "ok" });
        return result;
      } catch (error) {
        endDiagnosticSpan(handle, {
          status: "error",
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
        throw error;
      }
    },
  );
}
