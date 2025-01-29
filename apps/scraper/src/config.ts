import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

import toml from '@iarna/toml';
import { NullIfEmpty, SplitString } from '@tangleai/utils';

const configFileName = 'config.toml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Config {
  GENERAL: {
    HOSTNAME: string | null;
    PORT: number; // 3001
    REDIS_URL: string; // your redis url
    REDIS_SESSION: string | null;
  };
  SEARXNG: {
    SEARXNG_API_ENDPOINT: string;
  }
}

//#region MAIN
type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};

const loadConfig = () =>
  toml.parse(
    fs.readFileSync(path.join(__dirname, `../${configFileName}`), 'utf-8'),
  ) as any as Config;

//#endregion

//#region GENERAL CONFIG
export const getHostname = () => NullIfEmpty(process.env.GENERAL_HOSTNAME || loadConfig().GENERAL.HOSTNAME);
export const getPort = () => Number(process.env.GENERAL_PORT || loadConfig().GENERAL.PORT);

export const getRedisUrl = () => NullIfEmpty(process.env.REDIS_URL || loadConfig().GENERAL.REDIS_URL);

//#endregion

//#region SEARXNG CONFIG
export const getSearxngApiEndpoint = () => NullIfEmpty(process.env.SEARXNG_API_ENDPOINT || loadConfig().SEARXNG.SEARXNG_API_ENDPOINT);
//#endregion
