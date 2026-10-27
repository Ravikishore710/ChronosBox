import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { logger, formatErrorMessage } from './src/server/logger.ts';
import {
  securityHeadersMiddleware,
  createRateLimiter,
  errorHandlerMiddleware,
} from './src/server/middleware.ts';
import {
  initNeonPostgresAndSync,
  refreshKaggleKernelsList,
  resolvePostgresUrl,
  resolveKaggleSlug,
} from './src/server/db.ts';
import { computeRfc6902Patch } from './src/server/patch.ts';
import { executeRealEngineBenchmark } from './src/server/benchmark.ts';
import { stateRouter } from './src/server/routes/stateRoutes.ts';
import { kaggleRouter } from './src/server/routes/kaggleRoutes.ts';
import { sandboxRouter } from './src/server/routes/sandboxRoutes.ts';
import { checkpointRouter } from './src/server/routes/checkpointRoutes.ts';
import { runRouter } from './src/server/routes/runRoutes.ts';

dotenv.config({ quiet: true });

const PORT = Number(process.env.PORT) || 3000;

export { resolvePostgresUrl, resolveKaggleSlug, computeRfc6902Patch };

export function createChronosExpressApp(): express.Express {
  const app = express();
  app.use(securityHeadersMiddleware);
  app.use('/api', createRateLimiter(180, 60_000));
  app.use(express.json({ limit: '5mb' }));
  app.use(stateRouter);
  app.use(kaggleRouter);
  app.use(sandboxRouter);
  app.use(checkpointRouter);
  app.use(runRouter);
  app.use(errorHandlerMiddleware);
  return app;
}

async function startServer() {
  executeRealEngineBenchmark(5000);

  initNeonPostgresAndSync().catch((err: unknown) =>
    logger.warn({ err: formatErrorMessage(err) }, 'Background Neon PostgreSQL init warning')
  );
  refreshKaggleKernelsList().catch((err: unknown) =>
    logger.warn({ err: formatErrorMessage(err) }, 'Background Kaggle kernel discovery warning')
  );

  const app = createChronosExpressApp();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(
      { port: PORT, env: process.env.NODE_ENV || 'development' },
      'ChronosBox Durable Execution Engine listening'
    );
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}
