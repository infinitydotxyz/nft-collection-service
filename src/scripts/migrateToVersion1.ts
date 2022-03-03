import { COLLECTION_SCHEMA_VERSION, NULL_ADDR } from '../constants';
import { firebase } from '../container';
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
  const batchHandler = new BatchHandler();
  const collections = await firebase.db.collection('collections').get();
  collections.forEach((snapshot) => {
    const collectionRef = snapshot.ref;
    const collection: Partial<Collection> = snapshot.data();
    if (collection?.state?.create?.step === CreationFlow.Complete) {
      const completedCollection: Collection = {
        ...(collection as Collection),
        indexInitiator: collection?.indexInitiator ?? NULL_ADDR,
        state: {
          ...collection.state,
          version: COLLECTION_SCHEMA_VERSION,
          create: {
            ...(collection?.state?.create ?? {}),
            step: collection?.state?.create?.step ?? CreationFlow.Complete,
            updatedAt: collection?.state?.create?.updatedAt ?? Date.now()
          }
        }
      };
      batchHandler.add(collectionRef, completedCollection, { merge: true });
    } else {
      const incompleteCollection: Partial<Collection> = {
        ...collection,
        indexInitiator: collection?.indexInitiator ?? NULL_ADDR,
        state: {
          ...collection?.state,
          version: COLLECTION_SCHEMA_VERSION,
          create: {
            step: collection?.state?.create?.step ?? CreationFlow.CollectionCreator,
            updatedAt: collection?.state?.create?.updatedAt ?? Date.now(),
            ...collection?.state?.create
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
