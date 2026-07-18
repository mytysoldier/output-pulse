CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TABLE "app"."commits" (
	"repository_id" bigint NOT NULL,
	"sha" text NOT NULL,
	"author_github_user_id" bigint NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commits_repository_id_sha_pk" PRIMARY KEY("repository_id","sha")
);
--> statement-breakpoint
CREATE TABLE "app"."completed_issues" (
	"github_node_id" text PRIMARY KEY NOT NULL,
	"repository_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"first_closed_at" timestamp with time zone NOT NULL,
	"matched_by_author" boolean NOT NULL,
	"matched_by_closing_pr" boolean NOT NULL,
	"visibility" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."pull_requests" (
	"github_node_id" text PRIMARY KEY NOT NULL,
	"repository_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"author_github_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"state" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."repositories" (
	"github_repository_id" bigint PRIMARY KEY NOT NULL,
	"owner_github_user_id" bigint NOT NULL,
	"visibility" text NOT NULL,
	"default_branch" text NOT NULL,
	"is_fork" boolean NOT NULL,
	"is_archived" boolean NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trigger_type" text NOT NULL,
	"sync_mode" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"requested_from" timestamp with time zone,
	"requested_to" timestamp with time zone,
	"repository_total" integer DEFAULT 0 NOT NULL,
	"repository_succeeded" integer DEFAULT 0 NOT NULL,
	"repository_failed" integer DEFAULT 0 NOT NULL,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"github_rate_limit_remaining" integer,
	"error_summary" text,
	"notification_status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tracked_actors" (
	"github_user_id" bigint PRIMARY KEY NOT NULL,
	"github_login" text NOT NULL,
	"actor_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."commits" ADD CONSTRAINT "commits_repository_id_repositories_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "app"."repositories"("github_repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commits" ADD CONSTRAINT "commits_author_github_user_id_tracked_actors_github_user_id_fk" FOREIGN KEY ("author_github_user_id") REFERENCES "app"."tracked_actors"("github_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."completed_issues" ADD CONSTRAINT "completed_issues_repository_id_repositories_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "app"."repositories"("github_repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_github_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "app"."repositories"("github_repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pull_requests" ADD CONSTRAINT "pull_requests_author_github_user_id_tracked_actors_github_user_id_fk" FOREIGN KEY ("author_github_user_id") REFERENCES "app"."tracked_actors"("github_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commits_committed_at_idx" ON "app"."commits" USING btree ("committed_at");--> statement-breakpoint
CREATE INDEX "commits_author_github_user_id_idx" ON "app"."commits" USING btree ("author_github_user_id");--> statement-breakpoint
CREATE INDEX "completed_issues_first_closed_at_idx" ON "app"."completed_issues" USING btree ("first_closed_at");--> statement-breakpoint
CREATE INDEX "pull_requests_created_at_idx" ON "app"."pull_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pull_requests_merged_at_idx" ON "app"."pull_requests" USING btree ("merged_at");--> statement-breakpoint
CREATE INDEX "pull_requests_author_github_user_id_idx" ON "app"."pull_requests" USING btree ("author_github_user_id");--> statement-breakpoint
CREATE INDEX "sync_runs_started_at_idx" ON "app"."sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_status_idx" ON "app"."sync_runs" USING btree ("status");
