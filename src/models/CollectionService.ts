import ContractFactory from './contracts/ContractFactory';
import CollectionMetadataProvider from './CollectionMetadataProvider';
import Collection, { CreationFlow } from './Collection';
import { firebase, metadataClient, tokenDao } from '../container';
import Emittery from 'emittery';
import { MintToken, Token } from '../types/Token.interface';
import { Collection as CollectionType } from '../types/Collection.interface';
import PQueue from 'p-queue';
import { singleton } from 'tsyringe';
import BatchHandler from './BatchHandler';
import chalk from 'chalk';
import { COLLECTION_TASK_CONCURRENCY } from '../constants';

@singleton()
export default class CollectionService {
  private readonly contractFactory: ContractFactory;
  private readonly collectionMetadataProvider: CollectionMetadataProvider;

  private readonly taskQueue: PQueue;

  constructor() {
    this.contractFactory = new ContractFactory();
    this.collectionMetadataProvider = new CollectionMetadataProvider();
    this.taskQueue = new PQueue({
      concurrency: COLLECTION_TASK_CONCURRENCY // number of collections to run at once
    });
  }

  async createCollection(address: string, chainId: string, hasBlueCheck?: boolean): Promise<void> {
    return await this.taskQueue.add(async () => {
      const hex = address.split('0x')[1].substring(0, 6);
      const color = chalk.hex(`#${hex}`);
      const log = (args: any | any[]): void => console.log(color(args));
      log(`Starting Collection: ${chainId}:${address}`);

      const contract = await this.contractFactory.create(address, chainId);
      const collection = new Collection(contract, metadataClient, this.collectionMetadataProvider);
      const collectionDoc = firebase.db.collection('collections').doc(`${chainId}:${address.toLowerCase()}`);

      const batch = new BatchHandler();

      const data = await collectionDoc.get();
      const currentCollection = data.data() ?? {};

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
        batch.add(tokenDoc, { ...token, error: {} }, { merge: true }); // overwrite any errors
      });

      emitter.on('mint', (token) => {
        const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
        batch.add(tokenDoc, { ...token, error: {} }, { merge: false });
      });

      emitter.on('tokenError', (data) => {
        const error = {
          reason: data.error,
          timestamp: Date.now()
        };
        const tokenDoc = collectionDoc.collection('nfts').doc(data.tokenId);
        batch.add(tokenDoc, error, { merge: true });
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
                console.error(collectionData.state?.create.error);
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
          console.error(err);
          batch.add(
            collectionDoc,
            { state: { create: { step: '', error: { message: errorMessage } } } },
            { merge: true }
          );
          await batch.flush();
        }
      }
    });
  }
}
