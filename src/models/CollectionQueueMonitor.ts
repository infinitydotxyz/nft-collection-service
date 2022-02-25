import assert from 'assert';
import PQueue from 'p-queue';
import { Readable } from 'stream';
import { collectionService, firebase, logger } from '../container';
import { Collection } from '../types/Collection.interface';
import CollectionService from './CollectionService';

export class CollectionQueueMonitor {
  private readonly collectionService: CollectionService;

  private readonly collections: AsyncGenerator<Partial<Collection>, void, Partial<Collection>>;

  constructor() {
    this.collectionService = collectionService;
    this.collections = this.collectionGenerator();

    // prevents current process from attempting multiple claims of the same collection
    const claimQueue = new PQueue({ concurrency: 1 });

    this.collectionService.on('collectionCompleted', () => {
      void claimQueue.add(async () => {
        const collection = await this.claimCollection();
        void this.collectionService.createCollection(
          collection.address as string,
          collection.chainId as string,
          collection?.hasBlueCheck ?? false
        );
      });
    });

    /**
     * attempt to max out the concurrency
     */
    for (let x = 0; x < this.collectionService.concurrency; x += 1) {
      void claimQueue.add(async () => {
        const collection = await this.claimCollection();
        void this.collectionService.createCollection(
          collection.address as string,
          collection.chainId as string,
          collection?.hasBlueCheck ?? false
        );
      });
    }
  }

  /**
   * waits for a collection to become available and attempts
   * to claim the collection. Returns a collection once it one
   * has been claimed
   */
  private async claimCollection(): Promise<Partial<Collection>> {
    while (true) {
      try {
        const collection = await this.nextCollection();
        logger.log(`Attempting to claim collection ${collection?.address}`);
        if (collection?.chainId && collection?.address) {
          /**
           * we use a transaction to make sure multiple processes don't claim the 
           * same collection
           */
          await firebase.db.runTransaction(async (t) => {
            const collectionRef = firebase.getCollectionDocRef(collection.chainId as string, collection.address as string);
            const doc = await t.get(collectionRef);
            const data = doc.data() as Partial<Collection>;

            if (data.state?.queue?.claimedAt === 0) { 
              const claimedCollection: Partial<Collection> = {
                ...data,
                state: {
                  ...data?.state,
                  queue: {
                    ...data.state.queue,
                    claimedAt: Date.now()
                  }
                }
              };
              t.set(collectionRef, claimedCollection);
            } else {
              throw new Error(`collection already claimed. Claimed at: ${data?.state?.queue?.claimedAt}`);
            }
          });
          logger.log(`claimed collection ${collection?.address}`);
          return collection;
        }
      } catch (err) {
        logger.error('Failed to get next collection'); 
        logger.error(err);
      }
    }
  }

  private async nextCollection(): Promise<Partial<Collection>> {
    const result = await this.collections.next();
    assert(result.done === false, 'Unexpected result. Generator should not end');
    return result.value;
  }


  private async *collectionGenerator(): AsyncGenerator<Partial<Collection>, void, Partial<Collection>> {
    const collections = this.subscribeToCollections();
    for await (const chunk of collections) {
      for (const collection of chunk) {
        yield collection as Partial<Collection>;
      }
    }
  }

  /**
   * subscribe to collections returns a lazy stream of collections
   * (i.e. if we receive multiple snapshots from the db between reads
   * of the stream, then only the most recent snapshot will be 
   * pushed to the stream once the read occurs)
   */
  private subscribeToCollections(): Readable {
    const collectionStream = new Readable({ objectMode: true });
    const query = firebase.db
      .collection('collections')
      .orderBy('state.queue.enqueuedAt', 'asc') // oldest first
      .where('state.queue.claimedAt', '==', 0) // have not been claimed
      .limit(1);

    const chunk: { data: Array<Partial<Collection>>; shouldPush: boolean } = { data: [], shouldPush: false };

    const updateChunk = (data: Array<Partial<Collection>>): void => {
      chunk.data = data;
      if (chunk.shouldPush) {
        collectionStream.push(chunk.data);
        chunk.data = [];
        chunk.shouldPush = false;
      }
    };

    const readChunk = (): void => {
      chunk.shouldPush = true;
      if (chunk.data.length > 0) {
        collectionStream.push(chunk.data);
        chunk.data = [];
        chunk.shouldPush = false;
      }
    };

    query.onSnapshot(
      (querySnapshot) => {
        const collections: Array<Partial<Collection>> = [];

        querySnapshot.docs.forEach((collection) => {
          collections.push(collection.data());
        });

        updateChunk(collections);
      },
      (err) => {
        logger.error(err);
      }
    );

    collectionStream._read = readChunk;

    return collectionStream;
  }
}
