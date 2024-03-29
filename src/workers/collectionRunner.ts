import {
  BaseCollection,
  CollectionAttributes,
  Collection as CollectionType,
  Token
} from '@infinityxyz/lib/types/core';
import { firestoreConstants, getAttributeDocId, getSearchFriendlyString } from '@infinityxyz/lib/utils';
import deepmerge from 'deepmerge';
import Emittery from 'emittery';
import { CollectionEmitterType } from 'models/Collection.abstract';
import Contract from 'models/contracts/Contract.interface';
import path from 'path';
import { Worker } from 'worker_threads';
import { COLLECTION_MAX_SUPPLY, COLLECTION_SCHEMA_VERSION, NULL_ADDR } from '../constants';
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
  partial = true,
  mintData = false,
  useWorker = true
): Promise<void> {
  if (useWorker) {
    return await new Promise<void>((resolve, reject) => {
      logger.log('Starting worker thread');
      const workerFile = path.resolve(__dirname, './collection.js');
      const worker = new Worker(workerFile, { argv: [chainId, address, hasBlueCheck, reset, indexInitiator, partial, mintData] });

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
  return await create(address, chainId, hasBlueCheck, reset, indexInitiator, partial, mintData);
}

export async function create(
  address: string,
  chainId: string,
  hasBlueCheck = false,
  reset = false,
  indexInitiator: string,
  partial = true,
  mintData = false,
  log = logger.log.bind(logger)
): Promise<void> {
  log(`Starting Collection: ${chainId}:${address} Has Blue Check: ${hasBlueCheck} Reset: ${reset} Partial: ${partial} MintData: ${mintData}`);
  const provider = new CollectionMetadataProvider(chainId);
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

  // check if this is a collection that is currently being minted
  // one way to check is if there is a large diversion in totalSupply from the last time
  const prevTotalSupply = currentCollection?.numNfts ?? 0;

  if (prevTotalSupply >= COLLECTION_MAX_SUPPLY) {
    log(`Collection ${chainId}:${address} has too many tokens to index`);
    return;
  }

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

  const tokens: Map<string, Partial<Token>> = new Map();
  const updateToken = (token: Partial<Token>) => {
    if (token.tokenId) {
      const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
      const path = tokenDoc.path;

      const data = { ...token, ...getCollectionData(), error: {} };

      batch.add(tokenDoc, data, { merge: true });

      const cachedToken = tokens.get(path) ?? {};
      const res = deepmerge(cachedToken, data);
      tokens.set(path, res);
    }
  };

  const getTokens = (): AsyncIterable<Partial<Token>> => {
    const tokenValues = Array.from(tokens.values());
    const numNfts = collectionData.numNfts;

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* asyncify() {
      for (const token of tokenValues) {
        yield token;
      }
    }
    if (numNfts && tokenValues.length >= numNfts) {
      console.log('using cached tokens');
      const iterator = asyncify();
      return iterator;
    }
    return tokenDao.streamTokens(chainId, address);
  };

  emitter.on('token', (token) => {
    updateToken(token);
  });

  emitter.on('image', (token) => {
    updateToken(token);
  });

  emitter.on('mint', (token) => {
    updateToken(token);
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

  let iterator = collection.createCollection(currentCollection, emitter, indexInitiator, batch, hasBlueCheck, partial, mintData);

  let next: IteratorResult<
    { collection: Partial<CollectionType>; action?: 'tokenRequest' },
    { collection: Partial<CollectionType>; action?: 'tokenRequest' }
  >;
  let done = false;
  let valueToInject: AsyncIterable<Partial<Token>> | null = null;

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
        attempt += 1;
        if (attempt >= 2) {
          log(`Failed to complete collection: ${chainId}:${address}`);
          logger.error(collectionData.state?.create.error);
          return;
        }

        log(`Failed to complete collection: ${chainId}:${address}. Retrying...`);
        iterator = collection.createCollection(collectionData, emitter, indexInitiator, batch, hasBlueCheck, partial, mintData);
        done = false;
      } else {
        const { collection: updatedCollection, action } = next.value;
        collectionData = updatedCollection;

        batch.add(collectionDoc, collectionData, { merge: false });
        await batch.flush();

        if (action) {
          switch (action) {
            case 'tokenRequest':
              await batch.flush();
              valueToInject = getTokens();
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
