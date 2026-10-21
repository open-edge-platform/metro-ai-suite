// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpHermes } from "./http";
import type { RunEvent } from "./types";

const sse = (id: number, data: object) =>
  `id: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

/** A response body that sends `chunks`, then fails like a dropped connection. */
function droppingBody(chunks: string[]) {
  const queue = [...chunks];
  return new ReadableStream<Uint8Array>({
    pull(c) {
      const next = queue.shift();
      if (next) c.enqueue(new TextEncoder().encode(next));
      else c.error(new TypeError("network error"));
    },
  });
}

describe("streamRun", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resumes after a dropped connection without repeating events", async () => {
    const first = [
      sse(1, { event: "message.delta", seq: 1, delta: "Hel" }),
      sse(2, { event: "message.delta", seq: 2, delta: "lo" }),
    ];
    // The server replays from the start; seq filters the repeats.
    const second = first.join("") + sse(3, { event: "run.completed", seq: 3 });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(droppingBody(first)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "running" })),
      )
      .mockResolvedValueOnce(new Response(second));
    vi.stubGlobal("fetch", fetch);

    const events: RunEvent[] = [];
    await createHttpHermes("/h").streamRun("r1", (e) => events.push(e));

    const text = events.map((e) => (e.type === "delta" ? e.text : "")).join("");
    expect(text).toBe("Hello");
    expect(events.at(-1)?.type).toBe("completed");
    const resume = fetch.mock.calls[2][1] as RequestInit;
    expect((resume.headers as Record<string, string>)["Last-Event-ID"]).toBe(
      "2",
    );
  });
});
