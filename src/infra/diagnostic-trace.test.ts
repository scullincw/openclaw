import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onDiagnosticEvent, resetDiagnosticEventsForTest } from "./diagnostic-events.js";
import {
  createDiagnosticTrace,
  getCurrentDiagnosticTraceContext,
  runWithDiagnosticTrace,
  runWithDiagnosticTraceKey,
  updateCurrentDiagnosticTraceMetadata,
  withDiagnosticSpan,
} from "./diagnostic-trace.js";

describe("diagnostic-trace", () => {
  beforeEach(() => {
    resetDiagnosticEventsForTest();
  });

  afterEach(() => {
    resetDiagnosticEventsForTest();
  });

  it("emits nested span lifecycle events with inherited trace metadata", async () => {
    const events: Array<Record<string, unknown>> = [];
    const stop = onDiagnosticEvent((event) => {
      if (event.type === "trace.span.start" || event.type === "trace.span.end") {
        events.push(event as unknown as Record<string, unknown>);
      }
    });

    const trace = createDiagnosticTrace({
      traceKey: "trace-1",
      channel: "feishu",
      messageId: "msg-1",
    });

    await runWithDiagnosticTrace(trace, async () => {
      await withDiagnosticSpan("feishu.end_to_end", undefined, async () => {
        updateCurrentDiagnosticTraceMetadata({
          sessionKey: "session-1",
          provider: "openai-codex",
          model: "gpt-5.4",
        });
        await withDiagnosticSpan("openclaw.model.attempt", { attempt: 1 }, async () => {
          return;
        });
      });
    });

    stop();

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.type)).toEqual([
      "trace.span.start",
      "trace.span.start",
      "trace.span.end",
      "trace.span.end",
    ]);

    const rootStart = events[0] as {
      type: "trace.span.start";
      traceKey: string;
      spanKey: string;
      name: string;
      channel?: string;
      messageId?: string;
    };
    const childStart = events[1] as {
      type: "trace.span.start";
      traceKey: string;
      spanKey: string;
      parentSpanKey?: string;
      sessionKey?: string;
      provider?: string;
      model?: string;
      attributes?: Record<string, unknown>;
    };
    const childEnd = events[2] as {
      type: "trace.span.end";
      spanKey: string;
      status?: string;
    };
    const rootEnd = events[3] as {
      type: "trace.span.end";
      spanKey: string;
      status?: string;
    };

    expect(rootStart.traceKey).toBe("trace-1");
    expect(rootStart.name).toBe("feishu.end_to_end");
    expect(rootStart.channel).toBe("feishu");
    expect(rootStart.messageId).toBe("msg-1");

    expect(childStart.traceKey).toBe("trace-1");
    expect(childStart.parentSpanKey).toBe(rootStart.spanKey);
    expect(childStart.sessionKey).toBe("session-1");
    expect(childStart.provider).toBe("openai-codex");
    expect(childStart.model).toBe("gpt-5.4");
    expect(childStart.attributes).toEqual({ attempt: 1 });

    expect(childEnd.spanKey).toBe(childStart.spanKey);
    expect(childEnd.status).toBe("ok");
    expect(rootEnd.spanKey).toBe(rootStart.spanKey);
    expect(rootEnd.status).toBe("ok");
  });

  it("preserves the active parent span when re-entering the current trace key", async () => {
    const events: Array<Record<string, unknown>> = [];
    const stop = onDiagnosticEvent((event) => {
      if (event.type === "trace.span.start" || event.type === "trace.span.end") {
        events.push(event as unknown as Record<string, unknown>);
      }
    });

    const trace = createDiagnosticTrace({
      traceKey: "trace-2",
      channel: "feishu",
      messageId: "msg-2",
    });

    await runWithDiagnosticTrace(trace, async () => {
      await withDiagnosticSpan("feishu.inbound.receive", undefined, async () => {
        await runWithDiagnosticTraceKey("trace-2", async () => {
          await withDiagnosticSpan("openclaw.run", undefined, async () => {});
        });
      });
    });

    stop();

    const starts = events.filter((event) => event.type === "trace.span.start") as Array<{
      spanKey: string;
      parentSpanKey?: string;
      name: string;
    }>;

    expect(starts.map((event) => event.name)).toEqual(["feishu.inbound.receive", "openclaw.run"]);
    expect(starts[1]?.parentSpanKey).toBe(starts[0]?.spanKey);
  });

  it("exposes the active trace and parent span context", async () => {
    const trace = createDiagnosticTrace({
      traceKey: "trace-3",
      channel: "feishu",
      messageId: "msg-3",
    });

    expect(getCurrentDiagnosticTraceContext()).toBeUndefined();

    await runWithDiagnosticTrace(trace, async () => {
      expect(getCurrentDiagnosticTraceContext()).toEqual({ traceKey: "trace-3" });

      await withDiagnosticSpan("feishu.inbound.receive", undefined, async () => {
        const context = getCurrentDiagnosticTraceContext();
        expect(context?.traceKey).toBe("trace-3");
        expect(context?.parentSpanKey).toBeTruthy();
      });
    });
  });
});
