import { firestoreConstants, getAttributeDocId, getCollectionDocId } from '@infinityxyz/lib/utils';
import { firebase, reservoir } from 'container';
import { ReservoirCollectionAttribute } from 'types/Reservoir';

const db = firebase.db;

export async function cleanAttrs(chainId: string, collection: string) {
  const MAX_RETRY_ATTEMPTS = 5;
  const bulkWriter = db.bulkWriter();
  bulkWriter.onWriteError((error) => {
    if (error.failedAttempts < MAX_RETRY_ATTEMPTS) {
      return true;
    } else {
      console.log('Failed to delete document: ', error.documentRef.path);
      return false;
    }
  });

  const collectionDocId = getCollectionDocId({ chainId, collectionAddress: collection });
  const attrsCollRef = db
    .collection(firestoreConstants.COLLECTIONS_COLL)
    .doc(collectionDocId)
    .collection(firestoreConstants.COLLECTION_ATTRIBUTES);

  // get attrs from reservoir
  const reservoirAttrs = await reservoir.getCollectionAttributes(chainId, collection);
  const attrsSet = new Set(reservoirAttrs?.attributes.map((a: ReservoirCollectionAttribute) => getAttributeDocId(a.key)));

  const attrs = await attrsCollRef.get();
  for (const doc of attrs.docs) {
    const attr = doc.id;
    if (!attrsSet.has(attr)) {
      db.recursiveDelete(doc.ref, bulkWriter).catch(console.error);
    }
  }
}
