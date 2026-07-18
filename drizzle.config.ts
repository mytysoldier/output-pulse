import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  ...(connectionString === undefined ? {} : { dbCredentials: { url: connectionString } }),
});
