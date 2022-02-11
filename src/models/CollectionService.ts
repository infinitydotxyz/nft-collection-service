import ContractFactory from './contracts/ContractFactory';
import CollectionMetadataProvider from './CollectionMetadataProvider';
import Collection from './Collection';
import { firebase, metadataClient, tokenDao } from '../container';
import Emittery from 'emittery';
import { Token } from '../types/Token.interface';
import { Collection as CollectionType } from '../types/Collection.interface';

interface Batch {
  batch: FirebaseFirestore.WriteBatch;
  size: number;
}

export default class CollectionService {
  private readonly contractFactory: ContractFactory;
  private readonly collectionMetadataProvider: CollectionMetadataProvider;

  constructor() {
    this.contractFactory = new ContractFactory();
    this.collectionMetadataProvider = new CollectionMetadataProvider();
  }

  async createCollection(address: string, chainId: string, hasBlueCheck?: boolean): Promise<void> {
    const contract = await this.contractFactory.create(address, chainId);
    const collection = new Collection(contract, metadataClient, this.collectionMetadataProvider);
    const collectionDoc = firebase.db.collection('collections').doc(`${chainId}:${address.toLowerCase()}`);

    const newBatch = (): Batch => {
      return { batch: firebase.db.batch(), size: 0 };
    };

    let currentBatch = newBatch();
    const addToBatch = (
      doc: FirebaseFirestore.DocumentReference,
      object: Partial<FirebaseFirestore.DocumentData>,
      merge: boolean
    ): void => {
      if (currentBatch.size >= 500) {
        currentBatch.batch
          .commit()
          .then(() => {
            console.log('batch committed');
          })
          .catch((err) => {
            console.log('failed to commit batch');
            console.error(err);
          });
        currentBatch = newBatch();
        console.log(`Created new batch. batch`);
      }

      const options = merge ? { merge: true } : {};
      currentBatch.batch.set(doc, object, options);
      currentBatch.size += 1;
    };

    const data = await collectionDoc.get();
    const currentCollection = data.data() ?? {};

    const tokenEmitter = new Emittery<{
      token: Token;
      tokenError: { error: { reason: string; timestamp: number }; tokenId: string };
    }>();

    tokenEmitter.on('token', (token) => {
      const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
      addToBatch(tokenDoc, { ...token, error: {} }, true); // overwrite any errors
    });

    tokenEmitter.on('tokenError', (data) => {
      const error = {
        reason: data.error,
        timestamp: Date.now()
      };
      const tokenDoc = collectionDoc.collection('nfts').doc(data.tokenId);
      addToBatch(tokenDoc, error, true);
    });

    const createCollectionGenerator = collection.createCollection(currentCollection, tokenEmitter);

    let next: IteratorResult<
      { collection: Partial<CollectionType>; action?: 'tokenRequest' },
      { collection: Partial<CollectionType>; action?: 'tokenRequest' }
    >;
    let done = false;
    let valueToInject: Token[] | null = null;
    while (!done) {
      try {
        if (valueToInject !== null) {
          next = await createCollectionGenerator.next(valueToInject);
          valueToInject = null;
        } else {
          next = await createCollectionGenerator.next();
        }
        done = next.done ?? false;
        if(done) {
          console.log(`Collection Completed: ${address}`)
          return;
        }
  
        const { collection: collectionData, action } = next.value;
        await collectionDoc.set(collectionData, { merge: false });
        if (action) {
          switch (action) {
            case 'tokenRequest':
              if(currentBatch.size > 0) {
                await currentBatch.batch.commit();
              }
              currentBatch = newBatch();
              const tokens = await tokenDao.getAllTokens(chainId, address);
              valueToInject = tokens as Token[];
              break;

            default:
              throw new Error(`Requested an invalid action: ${action}`);
          }
        }
      } catch (err: any) {
        done = true;
        const message = typeof err?.message === 'string' ? err?.message as string : 'Unknown';
        const errorMessage = `Collection ${chainId}:${address} failed to complete due to unknown error: ${message}`;
        console.log(errorMessage);
        console.error(err);
        await collectionDoc.set({ state: { create: {step: '', error: { message: errorMessage } } } }, { merge: true }); // force collection to restart next time it is run
      }
    }
  }
}
