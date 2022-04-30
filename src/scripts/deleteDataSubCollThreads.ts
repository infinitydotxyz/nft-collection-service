import 'reflect-metadata';
import { join } from 'path';
import { isMainThread, Worker, workerData } from 'worker_threads';
import { cpus } from 'os';
import PQueue from 'p-queue';
import EventEmitter from 'events';
import { firebase, logger } from 'container';

export async function start(isEntryPoint = false) {
  if (!isMainThread || isEntryPoint) {
    if(isEntryPoint) {
      for (let x = 0; x < 15; x += 1) {
        await main()
      }
    } else {
      await main();
    }
  }
}

void start();

export async function main() {
  if (isMainThread) {
    const groups = [
      'data',
      'daily',
      'hourly',
      'weekly',
      'monthly',
      'yearly',
      'collectionStats', // overlaps with current structure
      'nftStats', // overlaps with current structure
      'nft',
      'collectionStatsAllTime',
      'collectionStatsHourly',
      'collectionStatsDaily',
      'collectionStatsWeekly',
      'collectionStatsMonthly',
      'collectionStatsYearly',
      'nftStatsAllTime',
      'nftStatsHourly',
      'nftStatsDaily',
      'nftStatsWeekly',
      'nftStatsMonthly',
      'nftStatsYearly'
    ];

    console.log('Main thread');
    const threadFile = join(__dirname, './deleteDataSubCollThreads.js');
    console.log(threadFile);

    const numCPUs = cpus().length;

    const createWorker = (group: string) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: group
        });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
        });
      });
    };

    const queue = new PQueue({
      concurrency: numCPUs
    });

    const promises = [];
    for (const group of groups) {
      promises.push(
        queue.add(async () => {
          await createWorker(group);
        })
      );
    }
    await Promise.all(promises);
  } else {
    console.log(`Worker thread started for ${workerData}`);
    await deleteGroup(workerData as string);
    console.log(`Worker thread finished for ${workerData}`);
  }
}

async function deleteGroup(group: string) {
  const pQueue = new PQueue({
    concurrency: 300
  });

  const emitter = new EventEmitter();
  let lastUpdate = Date.now();
  let deletions = 0;
  emitter.on('delete', (id) => {
    deletions += 1;
    if (Date.now() - lastUpdate > 5000) {
      lastUpdate = Date.now();
      logger.log(`Deleted: ${deletions} docs. Most recent: ${id}`);
    }
  });

  emitter.on('error', (err) => {
    console.log('emitter errored')
    console.error(err);
  })

  const recurseOnDoc = async (docSnap: FirebaseFirestore.QueryDocumentSnapshot) => {
    let batch = firebase.db.batch();
    let size = 0;
    const subCollections = await docSnap.ref.listCollections();
    for (const coll of subCollections) {
      const collStream = coll.stream();
      /**
       * delete all docs from sub collections
       */
      for await (const doc of collStream) {
        const snap = doc as any as FirebaseFirestore.QueryDocumentSnapshot;
        try {
          await recurseOnDoc(snap);
          batch.delete(snap.ref);
          emitter.emit('delete', snap.ref.path);
          size += 1;
          if (size % 300 === 0) {
            await batch.commit();
            batch = firebase.db.batch();
          }
        } catch (err) {
          console.log(`Failed to delete docs`, err);
        }
      }
    }
  };

  logger.log(`Starting deletions for collection group: ${group}`);
  const promises: Promise<void>[] = [];
  const query = firebase.db.collectionGroup(group);
  for await (const docSnap of query.stream()) {
    const docSnapshot = docSnap as any as FirebaseFirestore.QueryDocumentSnapshot;
    const promise = pQueue.add(async () => {
      try {
        await recurseOnDoc(docSnapshot);
        await docSnapshot.ref.delete();
        emitter.emit('delete', docSnapshot.ref.path);
      } catch (err) {
        logger.error('failed to recurse or delete', err);
        throw err;
      }
    });
    promises.push(promise);
  }

  await Promise.all(promises);
  logger.log(`Deleted all docs in group: ${group}`);
}
