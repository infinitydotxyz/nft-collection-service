import  {Worker } from 'worker_threads';
import path from 'path';

export async function createCollection(chainId: string, address: string, hasBlueCheck: boolean): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
        console.log('Starting worker thread')
        const workerFile = path.resolve('./dist/workers/collection.js');
        const worker = new Worker(workerFile, { argv: [chainId, address, hasBlueCheck] });
        
        worker.on('message', (msg) => {
            console.log(msg)
        })
        
        worker.on('exit', () => {
            resolve();      
        })

        worker.on('error', (err) => {
            reject(err);
        })
    })
}

