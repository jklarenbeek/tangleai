import express from 'express';
import cors from 'cors';
import http from 'http';

import routes from './routes';

import { isEmpty, logger } from '@tangleai/utils'

import { BrowserContext, chromium as browserExec } from 'playwright-chromium';

// import dotenv from 'dotenv'; 
// dotenv.config();  // Load environment variables from .env file 

const scraperPort = process.env.PORT || 1975; // let explicitly set another port if env is not available
const remoteBrowserUrl = process.env.REMOTE_BROWSER_URL;
const browserOptions = isEmpty(process.env.CHROME_BIN)
  ? { headless: true }
  : { headless: true, executablePath: process.env.CHROME_BIN }

if (process.platform === "win32")
  logger.info("@tangleai/scraper:platform:${process.platform}");
else
  logger.info(`@tangleai/scraper:env:CHROME_BIN:${process.env.CHROME_BIN}`);

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: '*',
};

app.use(cors(corsOptions));
app.use(express.json());

// create a playwrite instance and pass it to the request
const browser = isEmpty(remoteBrowserUrl)
  ? await browserExec.launch(browserOptions)
  : await browserExec.connectOverCDP(remoteBrowserUrl);

const context = await browser.newContext(/*{ acceptDownloads:false} */);

app.use((req, res, next) => {
  res.locals.browserContext = context;
  //res.setHeader("Content-Type", "text/markdown; charset=UTF-8");
  next();
})

app.use('/api', routes);
app.get('/api', (_, res) => {
  // healthcheck
  res.status(200).json({ status: 'ok' });
});

server.listen(scraperPort, () => {
  logger.info(`@tangleai/scraper:Server is running on port ${scraperPort}`);
});

const shutdownProcess = (name: string) => async (reason, origin) => {
  logger.info(`@tangleai/scraper:${name} signal received at: ${origin}, reason: ${reason}.`);

  server.close(() => {
    logger.info("HTTP server closed");
  });

  await context.close({reason: name });
  await browser.close({reason: name });

  process.exit(isNaN(+reason) ? 1 : reason);
}

// process.on('uncaughtException', shutdownProcess("uncaughtException"));
// process.on('unhandledRejection', shutdownProcess("unhandledRejection"));
process.on("SIGINT", shutdownProcess("SIGINT"));
process.on("SIGTERM", shutdownProcess("SIGTERM"));
