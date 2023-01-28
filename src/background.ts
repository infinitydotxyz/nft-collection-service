import { CollectionStats } from '@infinityxyz/lib/types/core';
import { firestoreConstants, getCollectionDocId } from '@infinityxyz/lib/utils';
import chalk from 'chalk';
import Emittery from 'emittery';
import { ONE_MIN } from './constants';
import { collectionDao, firebase, logger, zora } from './container';
import BatchHandler from './models/BatchHandler';

type BackgroundTaskEmitter = Emittery<{ update: { message?: string; error?: string } }>;

interface BackgroundTask {
  name: string;
  interval: number | 'ONCE';
  fn: (emitter: BackgroundTaskEmitter) => Promise<void> | void;
}

const tasks: BackgroundTask[] = [
  {
    name: 'Aggregated collection stats',
    interval: 15 * ONE_MIN,
    fn: updateAggregatedCollectionStats
  }
];

/**
 * register background tasks
 */
export function main(): void {
  const runTask = (task: BackgroundTask): void => {
    const emitter: BackgroundTaskEmitter = new Emittery();
    const log = (message: string): void => {
      const interval = task.interval === 'ONCE' ? 'ONCE' : `${task.interval / 1000}s`;
      logger.log(chalk.blue(`[Background Task][${task.name}][${interval} interval] ${message}`));
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
        logger.error(chalk.red(err));
      }
    };

    void run();

    if (typeof task.interval === 'number') {
      setInterval(() => {
        void run();
      }, task.interval);
    }
  };

  for (const task of tasks) {
    runTask(task);
  }
}

export async function updateAggregatedCollectionStats(emitter: BackgroundTaskEmitter): Promise<void> {
  const collections = (await collectionDao.getCollectionsWithStaleAggregatedStats()) || ([] as CollectionStats[]);
  const batch = new BatchHandler();
  void emitter.emit('update', { message: `Found: ${collections.length} collections to update` });

  let successful = 0;
  let failed = 0;

  for (const collection of collections) {
    if (!collection.collectionAddress || !collection.chainId) {
      continue;
    }
    try {
      const stats = await zora.getAggregatedCollectionStats(collection.chainId, collection.collectionAddress, 10);
      if (stats) {
        const data: Partial<CollectionStats> = {
          volume: stats.aggregateStat?.salesVolume?.chainTokenPrice,
          numSales: stats.aggregateStat?.salesVolume?.totalCount,
          volumeUSDC: stats.aggregateStat?.salesVolume?.usdcPrice,
          numOwners: stats.aggregateStat?.ownerCount,
          numNfts: stats.aggregateStat?.nftCount,
          topOwnersByOwnedNftsCount: stats.aggregateStat?.ownersByCount?.nodes,
          updatedAt: Date.now()
        };
        const collectionDocId = getCollectionDocId({
          chainId: collection.chainId,
          collectionAddress: collection.collectionAddress
        });
        const allTimeCollStatsDocRef = firebase.db
          .collection(firestoreConstants.COLLECTIONS_COLL)
          .doc(collectionDocId)
          .collection(firestoreConstants.COLLECTION_STATS_COLL)
          .doc('all');
        batch.add(allTimeCollStatsDocRef, data, { merge: true });
      }
      successful += 1;
    } catch (err: any) {
      failed += 1;

      void emitter.emit('update', {
        error: `Failed to get collection stats: ${collection.chainId}:${
          collection.collectionAddress
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        }. Error: ${err?.toString?.()}`
      });
    }
  }

  try {
    await batch.flush();
  } catch (err: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    void emitter.emit('update', { error: `Failed to write batch. Error: ${err?.toString?.()}` });
  }

  void emitter.emit('update', {
    message: `Successfully updated: ${successful} collections. Failed to update: ${failed} collections`
  });
}

// not used anymore
export async function addNumOwnersUpdatedAtAndDataExportedFields(): Promise<void> {
  try {
    const batch = new BatchHandler();

    const collections = await firebase.db.collection('collections').limit(1000).get();
    collections.forEach((doc) => {
      const collection = doc.data();
      if (!collection.numOwnersUpdatedAt) {
        batch.add(doc.ref, { numOwnersUpdatedAt: 0 }, { merge: true });
      }
      if (!collection.state.export) {
        batch.add(doc.ref, { state: { export: { done: false } } }, { merge: true });
      }
    });

    await batch.flush();
  } catch (err) {
    logger.log('Failed to commit batch adding numOwnersUpdatedAt field to collections');
    logger.error(err);
  }
}
