/* eslint-disable @typescript-eslint/no-unused-vars */
import BatchHandler from './models/BatchHandler';
import { CreationFlow } from './models/Collection';
import { Collection } from 'types/Collection.interface';
import { collectionDao, firebase, logger } from './container';

import { buildCollections } from './scripts/buildCollections';

// eslint-disable-next-line @typescript-eslint/require-await
export async function main(): Promise<void> {
  try {
    /**
     * must be run to add numOwnersUpdatedAtAndDataExported fields to existing collections
     * that don't yet have these fields
     */
    // await addNumOwnersUpdatedAtAndDataExportedFields();
    // await buildCollections();
    await collectionDao.getCollectionsSummary();
    
    async function addQueuePropertiesToCollections(): Promise<void> {
      logger.log(`Starting migration`)
      const batchHandler = new BatchHandler();
      const collections = await firebase.db.collection('collections').get();
      logger.log(`Migrating: ${collections.docs.length} collections`);
      collections.forEach((snapshot) => {
        const collectionRef = snapshot.ref;
        const collection: Partial<Collection> = snapshot.data();
        if (collection?.state?.create?.step === CreationFlow.Complete) {
          const completedCollection: Collection = {
            ...(collection as Collection),
            state: {
              ...collection.state,
              queue: {
                enqueuedAt: Date.now(),
                claimedAt: Date.now()
              }
            }
          };
          batchHandler.add(collectionRef, completedCollection, { merge: true });
        } else {
          const incompleteCollection: Partial<Collection> = {
            ...collection,
            state: {
              ...collection?.state,
              create: {
                step: collection?.state?.create?.step ?? CreationFlow.CollectionCreator,
                ...collection?.state?.create
              },
              queue: {
                enqueuedAt: Date.now(),
                claimedAt: 0,
                ...collection?.state?.queue
              },
              export: {
                done: collection?.state?.export?.done ?? false
              }
            }
          };
          batchHandler.add(collectionRef, incompleteCollection, { merge: true });
        }
      });
      await batchHandler.flush();
    }



    // await addQueuePropertiesToCollections();

  } catch (err) {
    logger.error(err);
  }
}
