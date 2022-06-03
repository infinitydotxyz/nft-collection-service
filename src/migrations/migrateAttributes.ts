import { collectionDao } from '../container';
import BatchHandler from '../models/BatchHandler';
import {FieldValue} from 'firebase-admin/firestore';

/**
 * Migrates all collections that don't have a 'attributes' subcollection yet.
 */
export async function migrateAttributes(): Promise<void> {
  const batch = new BatchHandler();
  const iterator = collectionDao.streamCollections();
  
  for await (const { collection, ref: collectionRef } of iterator) {
    // check if collection attributes on the document level are not null, undefined or {}
    if (collection?.attributes != null || Object.entries(collection.attributes || {}).length != 0) {
      for (const attribute in collection.attributes) {
        const attributesDoc = collectionRef.collection('attributes').doc(attribute);
        batch.add(attributesDoc, collection.attributes[attribute], { merge: true });
      }
      batch.add(collectionRef, {attributes: FieldValue.delete()}, {merge: true});
    }
  }

  console.log(`batch size: ${batch.size}`);

  await batch.flush();
}
