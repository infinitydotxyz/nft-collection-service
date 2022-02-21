import { Worker } from 'worker_threads';
import path from 'path';
import { logger } from '../container';

export async function createCollection(chainId: string, address: string, hasBlueCheck: boolean): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    logger.log('Starting worker thread');
    const workerFile = path.resolve('./dist/workers/collection.js');
    const worker = new Worker(workerFile, { argv: [chainId, address, hasBlueCheck] });

    worker.on('message', (msg) => {
      logger.log(msg);
    });

    worker.on('exit', () => {
      resolve();
    });

    worker.on('error', (err) => {
      logger.error(err);
      reject(err);
    });
  });
}
