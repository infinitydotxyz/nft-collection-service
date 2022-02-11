import ContractFactory from './contracts/ContractFactory';
import CollectionMetadataProvider from './CollectionMetadataProvider';
import Collection from './Collection';
import { firebase, metadataClient } from '../container';

interface Batch {
  batch: FirebaseFirestore.WriteBatch;
  size: number;
}

export default class CollectionService {
  private readonly contractFactory: ContractFactory;
  private readonly collectionMetadatProvider: CollectionMetadataProvider;
  
  constructor() {
    this.contractFactory = new ContractFactory();
    this.collectionMetadatProvider = new CollectionMetadataProvider();
  }

  async createCollection(address: string, chainId: string): Promise<void> {
    const contract = await this.contractFactory.create(address, chainId);
    const collection = new Collection(contract, metadataClient, this.collectionMetadatProvider);
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

    const { promise, emitter: tokenEmitter } = collection.getInitialData();
    tokenEmitter.on('token', (token) => {
      const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
      addToBatch(tokenDoc, token, false);
    });

    const { collection: collectionData, tokens, tokensWithErrors } = await promise;

    if (currentBatch.size > 0) {
      await currentBatch.batch.commit();
    }

    await collectionDoc.set(collectionData, { merge: true });
    console.log('Updated collection doc');

    /**
     * update tokens with data that cannot be calculate
     * until all we have metadata for all tokens
     * (i.e. rarity, may be more in the future)
     */
    for (const token of tokens) {
      const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
      addToBatch(tokenDoc, token, true);
    }

    for (const token of tokensWithErrors) {
      const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId);
      addToBatch(tokenDoc, token, true); // only updates the error field
    }

    if (currentBatch.size > 0) {
      await currentBatch.batch.commit();
    }
  }
}
