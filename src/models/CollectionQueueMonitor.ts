import assert from 'assert';
import { COLLECTION_SCHEMA_VERSION, ONE_HOUR } from '../constants';
import PQueue from 'p-queue';
import { Readable } from 'stream';
import { collectionService, firebase, logger } from '../container';
import { Collection } from '../types/Collection.interface';
import { CreationFlow } from './Collection';
import CollectionService from './CollectionService';

export class CollectionQueueMonitor {
  private readonly collectionService: CollectionService;

  private readonly collections: AsyncGenerator<Partial<Collection>, void, Partial<Collection>>;

  private isRunning = false;

  private readonly claimQueue: PQueue;

  constructor() {
    this.collectionService = collectionService;
    this.collections = this.collectionGenerator();

    // prevents current process from attempting multiple claims of the same collection
    this.claimQueue = new PQueue({ concurrency: 1 });

    this.collectionService.on('collectionCompleted', () => {
      void this.claimQueue.add(async () => {
        const collection = await this.claimCollection();
        void this.collectionService.createCollection(
          collection.address as string,
          collection.chainId as string,
          collection?.hasBlueCheck ?? false
        );
      });
    });
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    /**
     * attempt to max out the concurrency
     */
    for (let x = 0; x < this.collectionService.concurrency; x += 1) {
      void this.claimQueue.add(async () => {
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

        if (collection?.chainId && collection?.address) {
          logger.log(`Attempting to claim collection ${collection?.address}`);
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
        } else {
          logger.log(`Waiting for collection to be queued...`);
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
        querySnapshot.docs.forEach((collectionDoc) => {
          let collection = collectionDoc.data();
          if ((collection && !collection?.chainId) || !collection?.address) {
            const docId = collectionDoc.ref.id;
            const [chainId, address] = docId.split(':');
            collection = {
              ...collection,
              address,
              chainId
            };
            logger.log(`Received invalid collection. ${collectionDoc.ref.path}`);
            collections.push(collection);
          } else {
            collections.push(collection);
          }
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

  /**
   * queries for errored collections and logs the results
   */
  async logCollectionErrors(): Promise<void> {
    const collections = firebase.db.collection('collections');
    const invalidIfClaimedBefore = Date.now() - ONE_HOUR * 3;

    /**
     * errored collections
     * when a collection errors we should send a discord webhook
     */
    const erroredCollections = {
      name: 'Collections With Errors',
      type: 'error',
      step: 'any',
      query: collections.where('state.create.error.message', '>=', '')
    };

    const getQuery = (step: CreationFlow): FirebaseFirestore.Query<FirebaseFirestore.DocumentData> => {
      return collections.where('state.create.step', '==', step).where('state.queue.claimedAt', '<', invalidIfClaimedBefore).where('state.queue.claimedAt', '>', 0);
    };

    const failedUnknown = {
      type: 'process',
      name: 'Collections that failed on an unknown step',
      step: 'unknown',
      query: collections.where('state.create.step', '==', '').where('state.queue.claimedAt', '<', invalidIfClaimedBefore).where('state.queue.claimedAt', '>', 0)
    };
    const failedToGetCollectionCreator = {
      type: 'process',
      name: 'Collections that failed to get collection creator',
      step: CreationFlow.CollectionCreator,
      query: getQuery(CreationFlow.CollectionCreator)
    };
    const failedToGetCollectionMetadata = {
      type: 'process',
      name: 'Collections that failed to get collection metadata',
      step: CreationFlow.CollectionMetadata,
      query: getQuery(CreationFlow.CollectionMetadata)
    };
    const failedToGetCollectionMints = {
      type: 'process',
      name: 'Collections that failed to get mints',
      step: CreationFlow.CollectionMints,
      query: getQuery(CreationFlow.CollectionMints)
    };
    const failedToGetTokenMetadata = {
      type: 'process',
      name: 'Collections that failed to get token metadata',
      step: CreationFlow.TokenMetadata,
      query: getQuery(CreationFlow.TokenMetadata)
    };
    const failedToAggrgate = {
      type: 'process',
      name: 'Collections that failed to aggregate token data',
      step: CreationFlow.AggregateMetadata,
      query: getQuery(CreationFlow.AggregateMetadata)
    };

    const failedCollectionQueries = [
      erroredCollections,
      failedUnknown,
      failedToGetCollectionCreator,
      failedToGetCollectionMetadata,
      failedToGetCollectionMints,
      failedToGetTokenMetadata,
      failedToAggrgate
    ];

    const results: Record<CreationFlow | 'unknown', { count: number }> = {} as any;
    for (const item of [...Object.values(CreationFlow), 'unknown']) {
      results[item as CreationFlow | 'unknown'] = {
        count: 0
      };
    }

    const errors = new Map<string, string>();

    for (const queryObj of failedCollectionQueries) {
      const result = await queryObj.query.get();

      switch (queryObj.type) {
        case 'error':
          result.forEach((snapshot) => {
            const collection = snapshot.data() as Partial<Collection>;

            if (!errors.has(snapshot.id)) {
              errors.set(
                snapshot.id,
                `[Collection Errored] [${snapshot.id}] [${collection.state?.create?.step}] ${collection?.state?.create.error?.message}`
              );
            }

            const step = collection?.state?.create?.step ?? 'unknown';
            results[step].count += 1;
          });
          break;

        case 'process':
          result.forEach(async (snapshot) => {
            const collection = snapshot.data() as Partial<Collection>;

            if (!errors.has(snapshot.id)) {
              errors.set(
                snapshot.id,
                `[Process Errored] [${snapshot.id}] [${collection.state?.create?.step}] ${collection?.state?.create.error?.message}`
              );
            }

            results[queryObj.step as CreationFlow | 'unknown'].count += 1;

            // const [address, chainId] = snapshot.id.split(':');
            // await this.enqueueCollection(address, chainId);
          });
          break;

        default:
          throw new Error(`Type ${queryObj.type} not yet implemented`);
      }
    }

    for (const [, value] of errors) {
      logger.log(value);
    }
    logger.log(JSON.stringify(results, null, 2));
  }

  /**
   * to enqueue a collection
   * 1. create a collection document with an address and chainId
   * 2. Set the collection document's queue state to not be claimed (claimed at = 0)
   * 3. Set the collection document's queue state to be enqueued (enqueuedAt is some time in the past)
   *    * note enqueued at determines the collections position in the queue. To prioritize a collection
   *      enqueuedAt to something like 0. By default you should use the current time
   */
  async enqueueCollection(address: string, chainId: string, timestamp = Date.now()): Promise<void> {
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
    const errored = !!error;

    async function enqueue(chainId: string, address: string): Promise<void> {
      const collectionDoc = firebase.getCollectionDocRef(chainId, address);
      const initialCollection: Partial<Collection> =  {
        chainId,
        address,
        state: {
          version: COLLECTION_SCHEMA_VERSION,
          create: {
            step: CreationFlow.CollectionCreator,
            updatedAt: timestamp,
          },
          queue: {
            enqueuedAt: timestamp,
            claimedAt: 0
          },
          export: {
            done: false
          }
        }
      }
      await collectionDoc.set(
       initialCollection,
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
}
