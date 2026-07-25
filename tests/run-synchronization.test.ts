import { describe, expect, it } from "vitest";

import { createSynchronizationRequest } from "../src/run-synchronization.js";

describe("createSynchronizationRequest", () => {
  it("creates a scheduled range request from GitHub Actions inputs", () => {
    expect(
      createSynchronizationRequest({
        SYNC_FROM: "2026-07-01T00:00:00.000Z",
        SYNC_MODE: "range",
        SYNC_TO: "2026-07-10T00:00:00.000Z",
        SYNC_TRIGGER_TYPE: "scheduled",
      }),
    ).toEqual({
      from: new Date("2026-07-01T00:00:00.000Z"),
      mode: "range",
      to: new Date("2026-07-10T00:00:00.000Z"),
      triggerType: "scheduled",
    });
  });

  it("uses manual incremental synchronization by default", () => {
    expect(createSynchronizationRequest({})).toEqual({
      mode: "incremental",
      triggerType: "manual",
    });
  });

  it("rejects an invalid mode or trigger type", () => {
    expect(() => createSynchronizationRequest({ SYNC_MODE: "invalid" })).toThrow(
      "同期実行設定が不正です",
    );
    expect(() => createSynchronizationRequest({ SYNC_TRIGGER_TYPE: "invalid" })).toThrow(
      "同期実行設定が不正です",
    );
  });
});
