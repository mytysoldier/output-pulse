import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../drizzle/0002_cynical_blockbuster.sql", import.meta.url);

async function readMigration() {
  return readFile(migrationUrl, "utf8");
}

describe("Pull Request event migration", () => {
  it("creates an idempotent event table and backfills existing pull requests", async () => {
    const migration = await readMigration();

    expect(migration).toContain('CREATE TABLE "app"."pull_request_events"');
    expect(migration).toContain('PRIMARY KEY("github_node_id","event_type")');
    expect(migration).toContain('SELECT "github_node_id", \'created\', "created_at"');
    expect(migration).toContain('SELECT "github_node_id", \'merged\', "merged_at"');
    expect(
      migration.match(/ON CONFLICT \("github_node_id", "event_type"\) DO NOTHING/g),
    ).toHaveLength(2);
  });

  it("keeps the public metric columns and reads PR metrics from independent events", async () => {
    const migration = await readMigration();

    expect(migration).toContain('CREATE OR REPLACE VIEW "dashboard"."daily_metrics" AS');
    expect(migration).toContain('FROM "app"."pull_request_events"');
    expect(migration).toContain("'pull_request_created'");
    expect(migration).toContain("'pull_request_merged'");
    expect(migration).toContain('"pull_request_created_count"');
    expect(migration).toContain('"pull_request_merged_count"');
    expect(migration).not.toContain('FROM "app"."pull_requests"\n  WHERE "merged_at" IS NOT NULL');
  });
});
