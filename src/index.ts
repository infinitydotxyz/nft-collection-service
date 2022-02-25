import { ONE_HOUR } from './constants';
import { Collection } from './types/Collection.interface';
import { firebase } from './container';
import { CreationFlow } from './models/Collection';
import { CollectionQueueMonitor } from './models/CollectionQueueMonitor';

export async function main(): Promise<void> {
  return await new Promise(() => {
    const collectionQueueMonitor = new CollectionQueueMonitor();
  });
}

 // TODO need a background process to find errored collections and collections that have been claimed but haven't made progress

/**
 * to enqueue a collection
 * 1. create a collection document with an address and chainId
 * 2. Set the collection document's queue state to not be claimed (claimed at = 0)
 * 3. Set the collection document's queue state to be enqueued (enqueuedAt is some time in the past) 
 *    * note enqueued at determines the collections position in the queue. To prioritize a collection
 *      enqueuedAt to something like 0. By default you should use the current time
 */
async function enqueueCollection(address: string, chainId: string): Promise<void> {
  address = address.trim().toLowerCase();
  const validateChainId = (chainId: string): void => {
    if (chainId !== '1') {
      throw new Error(`Invalid chain id: ${chainId}`);
    }
  };

  validateChainId(chainId);

  const collectionDoc = firebase.getCollectionDocRef(chainId, address);

  const collection: Partial<Collection> = (await collectionDoc.get()).data() ?? {};

  const step = collection?.state?.create?.step;
  const error = collection?.state?.create?.error;

  const queuedAt = collection?.state?.queue?.enqueuedAt;

  const claimedAt = collection?.state?.queue?.claimedAt;

  const isQueued = typeof queuedAt === 'number';

  const considerInvalidAfter = 2 * ONE_HOUR;
  const hasBeenClaimed = typeof claimedAt === 'number' && claimedAt + considerInvalidAfter < Date.now();
  const hasHadTimeToMakeProgress = typeof claimedAt === 'number' && claimedAt + 60_0000 < Date.now();
  const hasMadeProgress = !!step || !hasHadTimeToMakeProgress;
  const errored = !!error; // TODO a claim should reset the error

  async function enqueue(chainId: string, address: string): Promise<void> {
    const collectionDoc = firebase.getCollectionDocRef(chainId, address);
    await collectionDoc.set(
      {
        chainId,
        address,
        state: {
          create: {
            step: '',
            error: ''
          },
          queue: {
            enqueuedAt: Date.now(),
            claimedAt: 0
          },
          export: {
            done: false
          }
        }
      },
      { merge: false }
    );
  }

  if (step === CreationFlow.Complete) {
    // collection complete
  } else if (hasBeenClaimed && hasMadeProgress && !errored) {
    // collection is being created
  } else if (hasBeenClaimed && (!hasMadeProgress || errored)) {
    // collection failed to be created

    // re-enqueue
    await enqueue(chainId, address);
  } else if (isQueued) {
    // queued
  } else {
    // enqueue collection
    await enqueue(chainId, address);
  }
}
