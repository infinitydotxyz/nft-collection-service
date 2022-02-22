import { Worker } from 'worker_threads';
import path from 'path';
import { logger } from '../container';

export async function createCollection(chainId: string, address: string, hasBlueCheck: boolean, reset = false): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    logger.log('Starting worker thread');
    const workerFile = path.resolve('./dist/workers/collection.js');
    const worker = new Worker(workerFile, { argv: [chainId, address, hasBlueCheck, reset] });

    worker.on('message', (msg) => {
      logger.log(msg);
    });

    worker.on('exit', () => {
      resolve();
    });

    worker.on('error', (err) => {
      logger.error(`Collection worker errored. Collection ${chainId}:${address}.`, err);
      reject(err);
    });
  });
}
