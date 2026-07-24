CREATE TABLE "app"."pull_request_events" (
	"github_node_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pull_request_events_github_node_id_event_type_pk" PRIMARY KEY("github_node_id","event_type")
);
--> statement-breakpoint
ALTER TABLE "app"."pull_request_events" ADD CONSTRAINT "pull_request_events_github_node_id_pull_requests_github_node_id_fk" FOREIGN KEY ("github_node_id") REFERENCES "app"."pull_requests"("github_node_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_events_occurred_at_idx" ON "app"."pull_request_events" USING btree ("occurred_at");--> statement-breakpoint
INSERT INTO "app"."pull_request_events" ("github_node_id", "event_type", "occurred_at")
SELECT "github_node_id", 'created', "created_at"
FROM "app"."pull_requests"
ON CONFLICT ("github_node_id", "event_type") DO NOTHING;--> statement-breakpoint
INSERT INTO "app"."pull_request_events" ("github_node_id", "event_type", "occurred_at")
SELECT "github_node_id", 'merged', "merged_at"
FROM "app"."pull_requests"
WHERE "merged_at" IS NOT NULL
ON CONFLICT ("github_node_id", "event_type") DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE VIEW "dashboard"."daily_metrics" AS
WITH daily_events AS (
  SELECT
    ("committed_at" AT TIME ZONE 'Asia/Tokyo')::date AS "metric_date",
    'commit'::text AS "metric_type"
  FROM "app"."commits"

  UNION ALL

  SELECT
    ("occurred_at" AT TIME ZONE 'Asia/Tokyo')::date AS "metric_date",
    CASE "event_type"
      WHEN 'created' THEN 'pull_request_created'
      WHEN 'merged' THEN 'pull_request_merged'
    END AS "metric_type"
  FROM "app"."pull_request_events"
  WHERE "event_type" IN ('created', 'merged')

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
