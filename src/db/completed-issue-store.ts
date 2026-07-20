import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { completedIssues } from "./schema/index.js";

export interface PersistedCompletedIssue {
  firstClosedAt: Date;
  githubNodeId: string;
  lastSeenAt: Date;
  matchedByAuthor: boolean;
  matchedByClosingPr: boolean;
  number: number;
  repositoryId: number;
  title: string;
  visibility: string;
}

export interface CompletedIssueStore {
  upsertCompletedIssues(issues: PersistedCompletedIssue[]): Promise<void>;
}

export function createCompletedIssueStore(database: NodePgDatabase): CompletedIssueStore {
  return {
    async upsertCompletedIssues(synchronizedIssues) {
      if (synchronizedIssues.length === 0) {
        return;
      }

      await database
        .insert(completedIssues)
        .values(synchronizedIssues)
        .onConflictDoUpdate({
          target: completedIssues.githubNodeId,
          set: {
            repositoryId: sql`excluded.${sql.identifier(completedIssues.repositoryId.name)}`,
            number: sql`excluded.${sql.identifier(completedIssues.number.name)}`,
            title: sql`excluded.${sql.identifier(completedIssues.title.name)}`,
            matchedByAuthor: sql`${completedIssues.matchedByAuthor} OR excluded.${sql.identifier(completedIssues.matchedByAuthor.name)}`,
            matchedByClosingPr: sql`${completedIssues.matchedByClosingPr} OR excluded.${sql.identifier(completedIssues.matchedByClosingPr.name)}`,
            visibility: sql`excluded.${sql.identifier(completedIssues.visibility.name)}`,
            lastSeenAt: sql`excluded.${sql.identifier(completedIssues.lastSeenAt.name)}`,
          },
        });
    },
  };
}
