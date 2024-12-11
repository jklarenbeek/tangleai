import { defineConfig } from 'drizzle-kit';
import { logger } from '@tangleai/utils';

const url = process.env.DATABASE_URL!;
logger.info(`jipinx/tangleai-backend:env:DATABASE_URL:${url}`);

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: url,
  },
});
