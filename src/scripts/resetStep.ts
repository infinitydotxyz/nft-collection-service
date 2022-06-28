// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { CreationFlow } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import BatchHandler from 'models/BatchHandler';

export async function resetStep() {
  const batch = new BatchHandler();
  const collectionsSnap = await firebase.db
    .collection(firestoreConstants.COLLECTIONS_COLL)
    .where('state.create.step', '!=', CreationFlow.Complete)
    .get();
  const collectionIds = [...new Set(collectionsSnap.docs.map((doc) => doc.ref.id))];
  const collections = collectionIds.map((item) => {
    const [chainId, address] = item.split(':');
    return {
      chainId,
      address
    };
  });
  console.log(`Found: ${collections.length} collections to reset step`);

  for (const collection of collections) {
    try {
      const docRef = firebase.db
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .doc(`${collection.chainId}:${collection.address}`);
      batch.add(
        docRef,
        {
          state: {
            create: {
              step: CreationFlow.CollectionCreator
            }
          }
        },
        { merge: true }
      );
    } catch (err) {
      console.error(err);
    }
  }

  await batch.flush();
}
