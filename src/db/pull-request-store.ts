import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { pullRequests } from "./schema/index.js";

export interface PersistedPullRequest {
  githubNodeId: string;
  repositoryId: number;
  number: number;
  authorGithubUserId: number;
  createdAt: Date;
  mergedAt: Date | null;
  state: "closed" | "merged" | "open";
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface PullRequestStore {
  upsertPullRequests(pullRequests: PersistedPullRequest[]): Promise<void>;
}

export function createPullRequestStore(database: NodePgDatabase): PullRequestStore {
  return {
    async upsertPullRequests(synchronizedPullRequests) {
      if (synchronizedPullRequests.length === 0) {
        return;
      }

      await database
        .insert(pullRequests)
        .values(synchronizedPullRequests)
        .onConflictDoUpdate({
          target: pullRequests.githubNodeId,
          set: {
            repositoryId: sql`excluded.${sql.identifier(pullRequests.repositoryId.name)}`,
            number: sql`excluded.${sql.identifier(pullRequests.number.name)}`,
            authorGithubUserId: sql`excluded.${sql.identifier(
              pullRequests.authorGithubUserId.name,
            )}`,
            createdAt: sql`excluded.${sql.identifier(pullRequests.createdAt.name)}`,
            mergedAt: sql`excluded.${sql.identifier(pullRequests.mergedAt.name)}`,
            state: sql`excluded.${sql.identifier(pullRequests.state.name)}`,
            lastSeenAt: sql`excluded.${sql.identifier(pullRequests.lastSeenAt.name)}`,
          },
        });
    },
  };
}
