import { BaseCollection, Collection as CollectionType, CollectionAttributes, CreationFlow, Token } from '@infinityxyz/lib/types/core';
import { firestoreConstants, getAttributeDocId, getSearchFriendlyString } from '@infinityxyz/lib/utils';
import Emittery from 'emittery';
import { CollectionEmitterType } from 'models/Collection.abstract';
import Contract from 'models/contracts/Contract.interface';
import path from 'path';
import { Worker } from 'worker_threads';
import { COLLECTION_SCHEMA_VERSION, NULL_ADDR, ONE_HOUR } from '../constants';
import { firebase, logger, tokenDao } from '../container';
import BatchHandler from '../models/BatchHandler';
import Collection from '../models/Collection';
import CollectionMetadataProvider from '../models/CollectionMetadataProvider';
import ContractFactory from '../models/contracts/ContractFactory';

export async function createCollection(
  address: string,
  chainId: string,
  hasBlueCheck: boolean,
  reset = false,
  indexInitiator = NULL_ADDR,
  useWorker = true
): Promise<void> {
  if (useWorker) {
    return await new Promise<void>((resolve, reject) => {
      logger.log('Starting worker thread');
      const workerFile = path.resolve(__dirname, './collection.js');
      const worker = new Worker(workerFile, { argv: [chainId, address, hasBlueCheck, reset, indexInitiator] });

      worker.on('message', (msg) => {
        logger.log(msg);
      });

      worker.on('exit', () => {
        resolve();
      });

      worker.on('error', (err) => {
        logger.error(`Collection worker errored. Collection ${chainId}:${address}.`, err);
        reject(err);
      });
    });
  }

  /**
   * run in main process
   */
  return await create(address, chainId, hasBlueCheck, reset, indexInitiator);
}

export async function create(
  address: string,
  chainId: string,
  hasBlueCheck = false,
  reset = false,
  indexInitiator: string,
  log = logger.log.bind(logger)
): Promise<void> {
  log(`Starting Collection: ${chainId}:${address} Has Blue Check: ${hasBlueCheck} Reset: ${reset}`);
  const provider = new CollectionMetadataProvider();
  const contractFactory = new ContractFactory();
  const collectionDoc = firebase.getCollectionDocRef(chainId, address);
  let contract: Contract;
  try {
    contract = await contractFactory.create(address, chainId);
  } catch (err: any) {
    const message = typeof err?.message === 'string' ? (err?.message as string) : 'Unknown';
    await collectionDoc.set({ state: { create: { step: '', error: { message } } } }, { merge: true });
    throw err;
  }

  const collection = new Collection(contract, provider);
  const batch = new BatchHandler();

  const data = await collectionDoc.get();
  const currentCollection = (reset ? {} : data.data() ?? {}) as Partial<CollectionType>;

  // const oneHourAgo = Date.now() - ONE_HOUR;
  // if (!reset && currentCollection?.state?.create?.updatedAt && currentCollection?.state?.create?.updatedAt > oneHourAgo) {
  //   log(`Collection ${chainId}:${address} has been updated in the last hour. Skipping...`);
  //   return;
  // }

  if (!currentCollection?.indexInitiator) {
    const now = Date.now();
    const collection: Partial<CollectionType> = {
      ...currentCollection,
      indexInitiator,
      state: {
        export: { done: false },
        ...currentCollection?.state,
        create: {
          ...currentCollection?.state?.create,
          updatedAt: now
        } as any,
        version: COLLECTION_SCHEMA_VERSION
      }
    };

    await collectionDoc.set(collection);
  }

  const formatLog = (step: string, progress: number, message?: string): string => {
    const now = new Date();
    const formatNum = (num: number, padWith: string, minLength: number): string => {
      let numStr = `${num}`;
      const len = numStr.length;
      const padLength = minLength - len;
      if (padLength > 0) {
        numStr = `${padWith.repeat(padLength)}${numStr}`;
      }
      return numStr;
    };
    const date = [now.getHours(), now.getMinutes(), now.getSeconds()];
    const dateStr = date.map((item) => formatNum(item, '0', 2)).join(':');

    return `[${dateStr}][${chainId}:${address}][ ${formatNum(progress, ' ', 5)}% ][${step}]${message ? ' ' + message : ''}`;
  };

  const emitter = new Emittery<CollectionEmitterType>();

  let lastLogAt = 0;
  let lastProgressUpdateAt = 0;
  emitter.on('progress', ({ step, progress, message, zoraCursor, reservoirCursor }) => {
    const now = Date.now();
    if (progress === 100 || now > lastLogAt + 1000) {
      lastLogAt = now;
      log(formatLog(step, progress, message));
    }
    if (progress === 100 || now > lastProgressUpdateAt + 10_000) {
      lastProgressUpdateAt = now;
      const data: Partial<BaseCollection> = {
        state: {
          version: 1,
          export: {
            done: false
          },
          create: {
            progress,
            step,
            updatedAt: now
          }
        }
      };
      if (zoraCursor && data.state) {
        data.state.create.zoraCursor = zoraCursor;
      }
      if (reservoirCursor && data.state) {
        data.state.create.reservoirCursor = reservoirCursor;
      }
      collectionDoc.set(data, { merge: true }).catch((err) => {
        logger.error('Failed to update collection progress');
        logger.error(err);
      });
    }
  });
  let collectionData: Partial<CollectionType> = currentCollection;

  const getCollectionData = () => {
    const token: Partial<Token> = {
      collectionSlug: collectionData?.slug ?? '',
      collectionName: collectionData?.metadata?.name ?? '',
      hasBlueCheck: collectionData?.hasBlueCheck ?? false,
      collectionAddress: collectionData?.address ?? ''
    };
    return token;
  };

  emitter.on('token', (token) => {
    const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
    batch.add(tokenDoc, { ...token, ...getCollectionData(), error: {} }, { merge: true });
  });

  emitter.on('image', (token) => {
    const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
    batch.add(tokenDoc, { ...token, ...getCollectionData(), error: {} }, { merge: true });
  });

  emitter.on('mint', (token) => {
    const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
    batch.add(tokenDoc, { ...token, ...getCollectionData(), error: {} }, { merge: true });
  });

  emitter.on('attributes', (attributes: CollectionAttributes) => {
    for (const attribute in attributes) {
      // write attributes to subcollection (collection > attributes)
      const docId = getAttributeDocId(attribute);
      if (docId) {
        const attributeDoc = collectionDoc.collection(firestoreConstants.COLLECTION_ATTRIBUTES).doc(docId);
        const attributeData = {
          attributeType: attribute,
          attributeTypeSlug: getSearchFriendlyString(attribute),
          count: attributes[attribute].count,
          percent: attributes[attribute].percent,
          displayType: attributes[attribute].displayType
        };
        batch.add(attributeDoc, attributeData, { merge: true });

        // write attribute values to another subcollection within the attributes subcollection (collection > attributes > values)
        const values = attributes[attribute].values;
        for (const value in values) {
          const docId = getAttributeDocId(value);
          if (docId) {
            const valueDoc = attributeDoc.collection(firestoreConstants.COLLECTION_ATTRIBUTES_VALUES).doc(docId);
            const valueData = {
              ...values[value],
              attributeType: attribute,
              attributeTypeSlug: getSearchFriendlyString(attribute),
              attributeValue: value,
              attributeValueSlug: getSearchFriendlyString(value)
            };
            batch.add(valueDoc, valueData, { merge: true });
          }
        }
      }
    }
  });

  emitter.on('tokenError', (data) => {
    const error = {
      reason: data.error,
      timestamp: Date.now()
    };
    if (data?.tokenId) {
      const tokenDoc = collectionDoc.collection('nfts').doc(data.tokenId);
      batch.add(tokenDoc, error, { merge: true });
    }
  });

  let iterator = collection.createCollection(currentCollection, emitter, indexInitiator, batch, hasBlueCheck);

  let next: IteratorResult<
    { collection: Partial<CollectionType>; action?: 'tokenRequest' },
    { collection: Partial<CollectionType>; action?: 'tokenRequest' }
  >;
  let done = false;
  let valueToInject: Token[] | null = null;

  let attempt = 0;
  while (!done) {
    try {
      if (valueToInject !== null) {
        next = await iterator.next(valueToInject);
        valueToInject = null;
      } else {
        next = await iterator.next();
      }
      done = next.done ?? false;

      if (done) {
        const successful = collectionData?.state?.create?.step === CreationFlow.Complete;
        const indexerRan = collectionData?.state?.create?.step === CreationFlow.Incomplete;
        const unknownError = collectionData?.state?.create?.step === CreationFlow.Unknown;
        const invalid = collectionData?.state?.create?.step === CreationFlow.Invalid;
        if (successful) {
          log(`Collection Completed: ${chainId}:${address}`);
          return;
        // } else if (indexerRan) {
        //   log(`Ran indexer for collection: ${chainId}:${address} previously. Skipping for now`);
        //   return;
        // } else if (unknownError) {
        //   log(`Unknown error occurred for collection: ${chainId}:${address} previously. Skipping for now`);
        //   return;
        // } else if (invalid) {
        //   log(
        //     `Received invalid collection: ${chainId}:${address} due to ${collectionData?.state?.create?.error?.message}. Skipping for now`
        //   );
        //   return;
        } else {
          attempt += 1;
          if (attempt >= 3) {
            log(`Failed to complete collection: ${chainId}:${address}`);
            logger.error(collectionData.state?.create.error);
            return;
          }

          log(`Failed to complete collection: ${chainId}:${address}. Retrying...`);
          iterator = collection.createCollection(collectionData, emitter, indexInitiator, batch, hasBlueCheck);
          done = false;
        }
      } else {
        const { collection: updatedCollection, action } = next.value;
        collectionData = updatedCollection;

        batch.add(collectionDoc, collectionData, { merge: false });
        await batch.flush();

        if (action) {
          switch (action) {
            case 'tokenRequest':
              await batch.flush();
              valueToInject = (await tokenDao.getAllTokens(chainId, address)) as Token[];
              break;

            default:
              throw new Error(`Requested an invalid action: ${action}`);
          }
        }
      }
    } catch (err: any) {
      done = true;
      const message = typeof err?.message === 'string' ? (err?.message as string) : 'Unknown';
      const errorMessage = `Collection ${chainId}:${address} failed to complete due to unknown error: ${message}`;
      log(errorMessage);
      logger.error(err);
      batch.add(collectionDoc, { state: { create: { step: '', error: { message: errorMessage } } } }, { merge: true });
      await batch.flush();
    }
  }
}
