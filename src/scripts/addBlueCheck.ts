import { Collection } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import BatchHandler from 'models/BatchHandler';
import PQueue from 'p-queue';
import OpenSeaClient from 'services/OpenSea';
import { sleep } from 'utils';

export async function addBlueCheck() {
  const queue = new PQueue({ concurrency: 1 });
  console.log(`Adding blue check to collections`);
  const collectionStream = firebase.db.collection(firestoreConstants.COLLECTIONS_COLL).stream() as AsyncIterable<
    FirebaseFirestore.DocumentSnapshot<Partial<Collection>>
  >;
  const batchHandler = new BatchHandler();

  const updateBlueCheck = async (collection: Partial<Collection>, ref: FirebaseFirestore.DocumentReference) => {
    if (collection?.address) {
      console.log(
        `[${collection.chainId}:${collection?.address}] Getting blue check for collection: ${
          collection?.metadata?.name ?? collection.address
        }`
      );
      try {
        const opensea = new OpenSeaClient(collection.chainId ?? '1');
        const { hasBlueCheck } = await opensea.getCollectionMetadata(collection.address);
        if (typeof hasBlueCheck === 'boolean' && hasBlueCheck) {
          const update: Partial<Collection> = {
            hasBlueCheck
          };
          console.log(`Updating collection: ${collection?.metadata?.name ?? collection.address} hasBlueCheck: ${hasBlueCheck}`);
          batchHandler.add(ref, update, { merge: true });
        }
      } catch (err) {
        console.error(err);
      }
      await sleep(1000);
    }
  };

  setInterval(() => {
    console.log(`Queue: ${queue.size} Pending: ${queue.pending}`);
  }, 5_000);

  for await (const collectionSnap of collectionStream) {
    const collection = collectionSnap.data() as Collection;
    queue
      .add(async () => {
        return updateBlueCheck(collection, collectionSnap.ref);
      })
      .catch(console.error);
  }

  await batchHandler.flush();
}
