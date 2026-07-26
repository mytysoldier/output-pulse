import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const dashboardUrl = new URL("../grafana/dashboards/output-pulse.json", import.meta.url);

async function readDashboard() {
  return JSON.parse(await readFile(dashboardUrl, "utf8")) as {
    panels: Array<{ targets?: Array<{ rawSql?: string }>; title: string; type: string }>;
    time: { from: string; to: string };
    timezone: string;
    uid: string;
  };
}

describe("Output Pulse Grafana dashboard", () => {
  it("uses the 30-day JST dashboard defaults and required visualizations", async () => {
    const dashboard = await readDashboard();

    expect(dashboard.uid).toBe("output-pulse");
    expect(dashboard.time).toEqual({ from: "now-30d", to: "now" });
    expect(dashboard.timezone).toBe("Asia/Tokyo");
    expect(dashboard.panels.map((panel) => panel.title)).toEqual(
      expect.arrayContaining([
        "コミット",
        "作成PR",
        "マージPR",
        "完了Issue",
        "日別実績",
        "週別推移",
        "最終同期状態",
      ]),
    );
  });

  it("queries only dashboard views and never includes repository identifiers", async () => {
    const dashboard = await readDashboard();
    const queries = dashboard.panels
      .flatMap((panel) => panel.targets ?? [])
      .map((target) => target.rawSql ?? "");
    const queryText = queries.join("\n").toLowerCase();

    expect(queryText).toContain("dashboard.daily_metrics");
    expect(queryText).toContain("dashboard.completed_issues");
    expect(queryText).toContain("dashboard.sync_status");
    expect(queryText).not.toMatch(/\bapp\./);
    expect(queryText).not.toMatch(/\b(repository_id|github_url|github_repository_id)\b/);
  });
});
