import chalk from 'chalk';
import Emittery from 'emittery';
import { ONE_HOUR } from './constants';
import { collectionDao, firebase } from './container';
import BatchHandler from './models/BatchHandler';
import OpenSeaClient from './services/OpenSea';
import { Collection } from './types/Collection.interface';

type BackgroundTaskEmitter = Emittery<{ update: { message?: string; error?: string } }>;

interface BackgroundTask {
  name: string;
  interval: number;
  fn: (emitter: BackgroundTaskEmitter) => Promise<void>;
}

const tasks: BackgroundTask[] = [
  {
    name: 'Collection numOwners',
    interval: ONE_HOUR,
    fn: updateCollectionNumOwners
  }
];

/**
 * register background tasks
 */
export function main(): void {
  const runTask = (task: BackgroundTask): void => {
    const emitter: BackgroundTaskEmitter = new Emittery();
    const log = (message: string): void => {
      console.log(chalk.blue(`[Background Task][${task.name}][${task.interval / 1000}s interval] ${message}`));
    };

    emitter.on('update', (update) => {
      if (update.message) {
        log(update.message);
      } else if (update.error) {
        log(update.error);
      }
    });

    const run = async (): Promise<void> => {
      log('Starting...');
      try {
        await task.fn(emitter);
        log('Complete');
      } catch (err) {
        log('Failed');
        console.error(err);
      }
    };

    void run();

    setInterval(() => {
      void run();
    }, task.interval);
  };

  for (const task of tasks) {
    runTask(task);
  }
}

export async function updateCollectionNumOwners(emitter: BackgroundTaskEmitter): Promise<void> {
  const openseaClient = new OpenSeaClient();

  const collections = ((await collectionDao.getStaleCollectionOwners()) || []).filter((item) => {
    return !!item?.metadata?.links?.slug;
  });

  const batch = new BatchHandler();

  void emitter.emit('update', { message: `Found: ${collections.length} collections to update` });

  let successful = 0;
  let failed = 0;

  for (const collection of collections) {
    if (collection?.metadata?.links?.slug) {
      try {
        const res = await openseaClient.getCollectionStats(collection.metadata.links.slug);
        const updatedAt = Date.now();
        const numOwners = res.stats.num_owners;

        if (typeof numOwners === 'number') {
          const collectionDocRef = firebase.getCollectionDocRef(collection.chainId, collection.address);
          const update: Pick<Collection, 'numOwners' | 'numOwnersUpdatedAt'> = {
            numOwners,
            numOwnersUpdatedAt: updatedAt
          };
          batch.add(collectionDocRef, update, { merge: true });
        }

        successful += 1;
      } catch (err: any) {
        failed += 1;

        void emitter.emit('update', {
          error: `Failed to get collection stats: ${collection.chainId}:${
            collection.address
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          }. Error: ${err?.toString?.()}`
        });
      }
    }
  }

  try {
    await batch.flush();
  } catch (err: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    void emitter.emit('update', { error: `Failed to write batch. Error: ${err?.toString?.()}` });
  }

  void emitter.emit('update', {
    message: `Successfully updated: ${successful} collections. Failed to updated: ${failed} collections`
  });
}

export async function addNumOwnersUpdatedAtField(): Promise<void> {
  try {
    const batch = new BatchHandler();

    const collections = await firebase.db.collection('collections').get();
    collections.forEach((doc) => {
      const collection = doc.data();
      if (!collection.numOwnersUpdatedAt) {
        batch.add(doc.ref, { numOwnersUpdatedAt: 0 }, { merge: true });
      }
    });

    await batch.flush();
  } catch (err) {
    console.log('Failed to commit batch adding numOwnersUpdatedAt field to collections');
    console.error(err);
  }
}
