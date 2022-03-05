import 'reflect-metadata';
import { isMainThread, parentPort } from 'worker_threads';
import chalk from 'chalk';
import Collection from '../models/Collection';
import { Collection as CollectionType, CreationFlow } from 'infinity-types/types/Collection';
import { firebase, metadataClient, tokenDao, logger } from '../container';
import BatchHandler from '../models/BatchHandler';
import Emittery from 'emittery';
import { ImageData, MetadataData, MintToken, Token } from 'infinity-types/types/Token';
import ContractFactory from '../models/contracts/ContractFactory';
import CollectionMetadataProvider from '../models/CollectionMetadataProvider';

export async function createCollection(address: string, chainId: string, hasBlueCheck: boolean, reset: boolean): Promise<void> {
  const hex = address.split('0x')[1].substring(0, 6);
  const color = chalk.hex(`#${hex}`);
  let log: { (arg0: string): void; (args: any): void; (args: any): void };
  if (isMainThread) {
    logger.log('main thread');
    log = (args: any | any[]): void => logger.log(color(args));
  } else {
    const [, , addressArg, chainIdArg, hasBlueCheckArg, resetArg] = process.argv;
    address = addressArg;
    chainId = chainIdArg;
    hasBlueCheck = hasBlueCheckArg === 'true';
    reset = resetArg === 'true';
    if (parentPort === null) {
      throw new Error('invalid parent port');
    }
    log = (args: any | any[]): void => parentPort?.postMessage(color(args));
  }

  log(`Starting Collection: ${chainId}:${address} Has Blue Check: ${hasBlueCheck} Reset: ${reset}`);
  const provider = new CollectionMetadataProvider();
  const contractFactory = new ContractFactory();
  const contract = await contractFactory.create(address, chainId);
  const collection = new Collection(contract, metadataClient, provider);
  const collectionDoc = firebase.getCollectionDocRef(chainId, address);

  const batch = new BatchHandler();

  const data = await collectionDoc.get();
  const currentCollection = reset ? {} : data.data() ?? {};

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
    metadata: MetadataData & Partial<Token>;
    image: ImageData & Partial<Token>;
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

  emitter.on('metadata', (token) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    batch.add(tokenDoc, { ...token, error: {} }, { merge: true });
  });

  emitter.on('image', (token) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
        const indexerRan = collectionData?.state?.create?.step === CreationFlow.Incomplete;
        const unknownError = collectionData?.state?.create?.step === CreationFlow.Unknown;
        if (successful) {
          log(`Collection Completed: ${chainId}:${address}`);
          return;
        } else if (indexerRan) {
          log(`Ran indexer for collection: ${chainId}:${address} previously. Skipping for now`);
          return;
        } else if (unknownError) {
          log(`Unknown error occured for collection: ${chainId}:${address} previously. Skipping for now`);
          return;
        } else {
          attempt += 1;
          if (attempt >= 3) {
            log(`Failed to complete collection: ${chainId}:${address}`);
            logger.error(collectionData.state?.create.error);
            return;
          }

          log(`Failed to complete collection: ${chainId}:${address}. Retrying...`);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
