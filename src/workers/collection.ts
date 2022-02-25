import 'reflect-metadata';
import { isMainThread, parentPort } from 'worker_threads';
import chalk from 'chalk';
import Collection, { CreationFlow } from '../models/Collection';
import { firebase, metadataClient, tokenDao, logger } from '../container';
import BatchHandler from '../models/BatchHandler';
import Emittery from 'emittery';
import { MintToken, Token } from '../types/Token.interface';
import { Collection as CollectionType } from '../types/Collection.interface';
import ContractFactory from '../models/contracts/ContractFactory';
import CollectionMetadataProvider from '../models/CollectionMetadataProvider';

async function createCollection(): Promise<void> {
  if (isMainThread) {
    logger.log('main thread');
  } else {
    const [, , address, chainId, hasBlueCheckArg, resetArg] = process.argv;
    const hasBlueCheck = hasBlueCheckArg === 'true';
    const reset = resetArg === 'true';

    const hex = address.split('0x')[1].substring(0, 6);

    const color = chalk.hex(`#${hex}`);

    if (parentPort === null) {
      throw new Error('invalid parent port');
    }

    const log = (args: any | any[]): void => parentPort?.postMessage(color(args));

    log(`Starting Collection: ${chainId}:${address} Has Blue Check: ${hasBlueCheck} Reset: ${reset}`);
    const provider = new CollectionMetadataProvider();
    const contractFactory = new ContractFactory();
    const contract = await contractFactory.create(address, chainId);
    const collection = new Collection(contract, metadataClient, provider);
    const collectionDoc = firebase.getCollectionDocRef(chainId, address);

    const batch = new BatchHandler();

    const data = await collectionDoc.get();
    const currentCollection = reset ? {} : data.data() ?? {};

    if(!currentCollection?.state?.queue?.claimedAt || !currentCollection?.state?.queue?.enqueuedAt) {
      const now = Date.now();
      await collectionDoc.set({
        ...currentCollection,
        state: {
          ...currentCollection?.state,
          queue: {
            claimedAt: currentCollection?.state?.queue?.claimedAt || now,
            enqueuedAt: currentCollection?.state?.queue?.enqueuedAt || now,
          }
        }
      })
    }

    const formatLog = (step: string, progress: number): string => {
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

      return `[${dateStr}][${chainId}:${address}][ ${formatNum(progress, ' ', 5)}% ][${step}]`;
    };

    const emitter = new Emittery<{
      token: Token;
      mint: MintToken;
      tokenError: { error: { reason: string; timestamp: number }; tokenId: string };
      progress: { step: string; progress: number };
    }>();

    let lastLogAt = 0;
    emitter.on('progress', ({ step, progress }) => {
      const now = Date.now();
      if (progress === 100 || now > lastLogAt + 1000) {
        lastLogAt = now;
        log(formatLog(step, progress));
      }
    });

    emitter.on('token', (token) => {
      const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
      batch.add(tokenDoc, { ...token, error: {} }, { merge: true });
    });

    emitter.on('mint', (token) => {
      const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
      batch.add(tokenDoc, { ...token, error: {} }, { merge: !reset });
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

    let iterator = collection.createCollection(currentCollection, emitter, hasBlueCheck);

    let next: IteratorResult<
      { collection: Partial<CollectionType>; action?: 'tokenRequest' },
      { collection: Partial<CollectionType>; action?: 'tokenRequest' }
    >;
    let done = false;
    let valueToInject: Token[] | null = null;
    let collectionData: Partial<CollectionType> = currentCollection;
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
          if (successful) {
            log(`Collection Completed: ${chainId}:${address}`);
            return;
          } else {
            attempt += 1;
            if (attempt >= 3) {
              log(`Failed to complete collection: ${chainId}:${address}`);
              logger.error(collectionData.state?.create.error);
              return;
            }

            log(`Failed to complete collection: ${chainId}:${address}. Retrying...`);
            iterator = collection.createCollection(collectionData, emitter, hasBlueCheck);
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
                const tokens = await tokenDao.getAllTokens(chainId, address);
                valueToInject = tokens as Token[];
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
}

void createCollection();
