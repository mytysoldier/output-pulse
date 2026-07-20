import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { commits } from "./schema/index.js";

export interface PersistedCommit {
  repositoryId: number;
  sha: string;
  authorGithubUserId: number;
  committedAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface CommitStore {
  upsertCommits(commits: PersistedCommit[]): Promise<void>;
}

/**
 * Creates a store that persists synchronized commits while retaining their first-seen timestamp.
 */
export function createCommitStore(database: NodePgDatabase): CommitStore {
  return {
    /**
     * Inserts commits or refreshes their mutable fields when the repository ID and SHA already exist.
     */
    async upsertCommits(persistedCommits) {
      if (persistedCommits.length === 0) {
        return;
      }

      await database
        .insert(commits)
        .values(persistedCommits)
        .onConflictDoUpdate({
          target: [commits.repositoryId, commits.sha],
          set: {
            authorGithubUserId: sql`excluded.${sql.identifier(commits.authorGithubUserId.name)}`,
            committedAt: sql`excluded.${sql.identifier(commits.committedAt.name)}`,
            lastSeenAt: sql`excluded.${sql.identifier(commits.lastSeenAt.name)}`,
          },
        });
    },
  };
}
