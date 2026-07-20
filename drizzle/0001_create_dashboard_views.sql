CREATE SCHEMA IF NOT EXISTS "dashboard";
--> statement-breakpoint
CREATE OR REPLACE VIEW "dashboard"."daily_metrics" AS
WITH daily_events AS (
  SELECT
    ("committed_at" AT TIME ZONE 'Asia/Tokyo')::date AS "metric_date",
    'commit'::text AS "metric_type"
  FROM "app"."commits"

  UNION ALL

  SELECT
    ("created_at" AT TIME ZONE 'Asia/Tokyo')::date AS "metric_date",
    'pull_request_created'::text AS "metric_type"
  FROM "app"."pull_requests"

  UNION ALL

  SELECT
    ("merged_at" AT TIME ZONE 'Asia/Tokyo')::date AS "metric_date",
    'pull_request_merged'::text AS "metric_type"
  FROM "app"."pull_requests"
  WHERE "merged_at" IS NOT NULL

  UNION ALL

  SELECT
    ("first_closed_at" AT TIME ZONE 'Asia/Tokyo')::date AS "metric_date",
    'completed_issue'::text AS "metric_type"
  FROM "app"."completed_issues"
)
SELECT
  "metric_date",
  ("metric_date"::timestamp AT TIME ZONE 'Asia/Tokyo') AS "metric_at",
  count(*) FILTER (WHERE "metric_type" = 'commit') AS "commit_count",
  count(*) FILTER (WHERE "metric_type" = 'pull_request_created') AS "pull_request_created_count",
  count(*) FILTER (WHERE "metric_type" = 'pull_request_merged') AS "pull_request_merged_count",
  count(*) FILTER (WHERE "metric_type" = 'completed_issue') AS "completed_issue_count"
FROM daily_events
GROUP BY "metric_date";
--> statement-breakpoint
CREATE OR REPLACE VIEW "dashboard"."completed_issues" AS
SELECT
  "title",
  "first_closed_at",
  ("first_closed_at" AT TIME ZONE 'Asia/Tokyo')::date AS "closed_date"
FROM "app"."completed_issues";
--> statement-breakpoint
CREATE OR REPLACE VIEW "dashboard"."sync_status" AS
SELECT
  "finished_at" AS "last_synced_at",
  "status",
  "trigger_type",
  "sync_mode",
  "repository_total",
  "repository_succeeded",
  "repository_failed",
  "fetched_count",
  "inserted_count",
  "updated_count",
  "notification_status"
FROM "app"."sync_runs"
WHERE "finished_at" IS NOT NULL
ORDER BY "finished_at" DESC, "started_at" DESC
LIMIT 1;
--> statement-breakpoint
DO $$
BEGIN
  CREATE ROLE grafana_reader NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SCHEMA "app" FROM grafana_reader;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "app" FROM grafana_reader;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SCHEMA "dashboard" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "dashboard" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "dashboard" TO grafana_reader;
--> statement-breakpoint
GRANT SELECT ON "dashboard"."daily_metrics" TO grafana_reader;
--> statement-breakpoint
GRANT SELECT ON "dashboard"."completed_issues" TO grafana_reader;
--> statement-breakpoint
GRANT SELECT ON "dashboard"."sync_status" TO grafana_reader;
