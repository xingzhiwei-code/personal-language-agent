import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.LLA_DB_PATH ?? './data/app.db',
  },
  strict: true,
  verbose: false,
});
