import { describe, expect, it } from "vitest";

import { formatSynchronizationNotification } from "../src/slack/notification.js";

describe("formatSynchronizationNotification", () => {
  it("formats a safe partial-failure message with an Actions URL", () => {
    const message = formatSynchronizationNotification({
      actionUrl: "https://github.com/mytysoldier/output-pulse/actions/runs/123",
      fetchedCount: 12,
      errorSummary: "一部のリポジトリ同期に失敗しました",
      finishedAt: new Date("2026-07-20T01:00:00.000Z"),
      insertedCount: 3,
      period: {
        from: new Date("2026-07-18T00:00:00.000Z"),
        to: new Date("2026-07-20T00:00:00.000Z"),
      },
      rateLimitRemaining: 4980,
      repositoryFailed: 1,
      repositorySucceeded: 2,
      repositoryTotal: 3,
      startedAt: new Date("2026-07-20T00:00:00.000Z"),
      status: "partial_failure",
      syncMode: "incremental",
      triggerType: "manual",
      updatedCount: 4,
    });

    expect(message).toContain("同期結果: 一部失敗");
    expect(message).toContain("実行: 手動 / 差分同期");
    expect(message).toContain("リポジトリ: 対象 3 / 成功 2 / 失敗 1");
    expect(message).toContain("エラー概要: 一部のリポジトリ同期に失敗しました");
    expect(message).toContain("https://github.com/mytysoldier/output-pulse/actions/runs/123");
    expect(message).not.toContain("postgresql://");
    expect(message).not.toContain("xoxb-");
  });

  it.each([
    "https://example.com/?token=secret",
    "https://token@github.com/o/r/actions/runs/123",
    "https://github.com/o/r/actions/runs/123?token=secret",
    "https://github.com/o/r/actions/runs/123#token=secret",
  ])("does not include an unsafe Actions URL: %s", (actionUrl) => {
    const message = formatSynchronizationNotification({
      fetchedCount: 0,
      finishedAt: new Date("2026-07-20T01:00:00.000Z"),
      insertedCount: 0,
      period: {},
      repositoryFailed: 0,
      repositorySucceeded: 0,
      repositoryTotal: 0,
      startedAt: new Date("2026-07-20T00:00:00.000Z"),
      status: "failure",
      syncMode: "full",
      triggerType: "manual",
      updatedCount: 0,
      actionUrl,
    });

    expect(message).toContain("Actions: 利用不可");
    expect(message).not.toContain("secret");
  });
});
