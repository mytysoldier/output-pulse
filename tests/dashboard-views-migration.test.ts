import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../drizzle/0001_create_dashboard_views.sql", import.meta.url);

async function readMigration() {
  return readFile(migrationUrl, "utf8");
}

function viewDefinition(migration: string, viewName: string) {
  const viewStart = `CREATE OR REPLACE VIEW "dashboard"."${viewName}" AS`;
  const start = migration.indexOf(viewStart);
  const end = migration.indexOf("--> statement-breakpoint", start);

  return migration.slice(start, end);
}

describe("Grafana dashboard migration", () => {
  it("defines daily metrics with JST dates and all dashboard counters", async () => {
    const dailyMetrics = viewDefinition(await readMigration(), "daily_metrics");

    expect(dailyMetrics).toContain("AT TIME ZONE 'Asia/Tokyo'");
    expect(dailyMetrics).toContain('"metric_date"');
    expect(dailyMetrics).toContain('"metric_at"');
    expect(dailyMetrics).toContain('"commit_count"');
    expect(dailyMetrics).toContain('"pull_request_created_count"');
    expect(dailyMetrics).toContain('"pull_request_merged_count"');
    expect(dailyMetrics).toContain('"completed_issue_count"');
  });

  it("exposes only safe fields from public views", async () => {
    const migration = await readMigration();
    const dailyMetrics = viewDefinition(migration, "daily_metrics");
    const completedIssues = viewDefinition(migration, "completed_issues");
    const syncStatus = viewDefinition(migration, "sync_status");

    expect(dailyMetrics).not.toMatch(/repository(_id)?|github_node_id|url|secret/i);
    expect(completedIssues).not.toMatch(/repository(_id)?|github_node_id|url|secret/i);
    expect(syncStatus).not.toMatch(/(^|\W)(id|error_summary|url|secret)(\W|$)/i);
  });

  it("grants Grafana only SELECT access to the dashboard views", async () => {
    const migration = await readMigration();

    expect(migration).toContain("CREATE ROLE grafana_reader NOLOGIN;");
    expect(migration).not.toMatch(/ALTER ROLE\s+grafana_reader\b/i);
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON SCHEMA "app" FROM grafana_reader;');
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "app" FROM grafana_reader;',
    );
    expect(migration).toContain('GRANT USAGE ON SCHEMA "dashboard" TO grafana_reader;');
    expect(migration).toContain('GRANT SELECT ON "dashboard"."daily_metrics" TO grafana_reader;');
    expect(migration).toContain(
      'GRANT SELECT ON "dashboard"."completed_issues" TO grafana_reader;',
    );
    expect(migration).toContain('GRANT SELECT ON "dashboard"."sync_status" TO grafana_reader;');
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)\b[^;]*grafana_reader/i);
  });
});
