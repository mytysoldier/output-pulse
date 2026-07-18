import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const app = pgSchema("app");

const timestampColumn = (name: string) =>
  timestamp(name, {
    mode: "date",
    withTimezone: true,
  });

export const trackedActors = app.table("tracked_actors", {
  githubUserId: bigint("github_user_id", { mode: "number" }).primaryKey(),
  githubLogin: text("github_login").notNull(),
  actorType: text("actor_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestampColumn("created_at").notNull().defaultNow(),
  updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
});

export const repositories = app.table("repositories", {
  githubRepositoryId: bigint("github_repository_id", { mode: "number" }).primaryKey(),
  ownerGithubUserId: bigint("owner_github_user_id", { mode: "number" }).notNull(),
  visibility: text("visibility").notNull(),
  defaultBranch: text("default_branch").notNull(),
  isFork: boolean("is_fork").notNull(),
  isArchived: boolean("is_archived").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastSyncedAt: timestampColumn("last_synced_at"),
});

export const commits = app.table(
  "commits",
  {
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.githubRepositoryId),
    sha: text("sha").notNull(),
    authorGithubUserId: bigint("author_github_user_id", { mode: "number" })
      .notNull()
      .references(() => trackedActors.githubUserId),
    committedAt: timestampColumn("committed_at").notNull(),
    firstSeenAt: timestampColumn("first_seen_at").notNull(),
    lastSeenAt: timestampColumn("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repositoryId, table.sha] }),
    index("commits_committed_at_idx").on(table.committedAt),
    index("commits_author_github_user_id_idx").on(table.authorGithubUserId),
  ],
);

export const pullRequests = app.table(
  "pull_requests",
  {
    githubNodeId: text("github_node_id").primaryKey(),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.githubRepositoryId),
    number: integer("number").notNull(),
    authorGithubUserId: bigint("author_github_user_id", { mode: "number" })
      .notNull()
      .references(() => trackedActors.githubUserId),
    createdAt: timestampColumn("created_at").notNull(),
    mergedAt: timestampColumn("merged_at"),
    state: text("state").notNull(),
    firstSeenAt: timestampColumn("first_seen_at").notNull(),
    lastSeenAt: timestampColumn("last_seen_at").notNull(),
  },
  (table) => [
    index("pull_requests_created_at_idx").on(table.createdAt),
    index("pull_requests_merged_at_idx").on(table.mergedAt),
    index("pull_requests_author_github_user_id_idx").on(table.authorGithubUserId),
  ],
);

export const completedIssues = app.table(
  "completed_issues",
  {
    githubNodeId: text("github_node_id").primaryKey(),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.githubRepositoryId),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    firstClosedAt: timestampColumn("first_closed_at").notNull(),
    matchedByAuthor: boolean("matched_by_author").notNull(),
    matchedByClosingPr: boolean("matched_by_closing_pr").notNull(),
    visibility: text("visibility").notNull(),
    lastSeenAt: timestampColumn("last_seen_at").notNull(),
  },
  (table) => [index("completed_issues_first_closed_at_idx").on(table.firstClosedAt)],
);

export const syncRuns = app.table(
  "sync_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    triggerType: text("trigger_type").notNull(),
    syncMode: text("sync_mode").notNull(),
    status: text("status").notNull(),
    startedAt: timestampColumn("started_at").notNull().defaultNow(),
    finishedAt: timestampColumn("finished_at"),
    requestedFrom: timestampColumn("requested_from"),
    requestedTo: timestampColumn("requested_to"),
    repositoryTotal: integer("repository_total").notNull().default(0),
    repositorySucceeded: integer("repository_succeeded").notNull().default(0),
    repositoryFailed: integer("repository_failed").notNull().default(0),
    fetchedCount: integer("fetched_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    githubRateLimitRemaining: integer("github_rate_limit_remaining"),
    errorSummary: text("error_summary"),
    notificationStatus: text("notification_status").notNull().default("pending"),
  },
  (table) => [
    index("sync_runs_started_at_idx").on(table.startedAt),
    index("sync_runs_status_idx").on(table.status),
  ],
);
