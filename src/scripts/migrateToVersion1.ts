import { COLLECTION_SCHEMA_VERSION } from '../constants';
import { firebase, logger } from '../container';
import BatchHandler from '../models/BatchHandler';
import { CreationFlow } from '../models/Collection';
import { Collection } from '../types/Collection.interface';

/**
 * added queue properties, updateAt and version
 * 
 * requires we get every collection since this is the first 
 * collection schema with a version
 */
export async function migrateToVersion1(): Promise<void> {
  logger.log(`Starting migration`);
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
          version: COLLECTION_SCHEMA_VERSION,
          create: {
            ...(collection?.state?.create ?? {}),
            step: collection?.state?.create?.step ?? CreationFlow.Complete,
            updatedAt: collection?.state?.create?.updatedAt ?? Date.now(),
          },
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
          version: COLLECTION_SCHEMA_VERSION,
          create: {
            step: collection?.state?.create?.step ?? CreationFlow.CollectionCreator,
            updatedAt: collection?.state?.create?.updatedAt ?? Date.now(),
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
