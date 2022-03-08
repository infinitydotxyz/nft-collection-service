import Firebase from '../database/Firebase';
import { singleton } from 'tsyringe';
import { Collection, CreationFlow } from '@infinityxyz/lib/types/core';
import { NUM_OWNERS_TTS } from '../constants';
import { logger } from '../container';
import { normalizeAddress } from '../utils/ethers';

@singleton()
export default class CollectionDao {
  private readonly firebase: Firebase;

  constructor(firebase: Firebase) {
    this.firebase = firebase;
  }

  async get(chainId: string, address: string): Promise<Collection> {
    const collectionRef = this.firebase.getCollectionDocRef(chainId, normalizeAddress(address));

    const doc = await collectionRef.get();

    return doc.data() as Collection;
  }

  async update(collection: Collection): Promise<void> {
    const chainId = collection.chainId;
    const address = collection.address;
    if (!chainId || !address) {
      throw new Error('invalid collection');
    }
    const collectionRef = this.firebase.getCollectionDocRef(chainId, normalizeAddress(address));

    await collectionRef.set(collection, { merge: true });
  }

  async getStaleCollectionOwners(): Promise<Collection[]> {
    const now = Date.now();
    const staleIfUpdatedBefore = now - NUM_OWNERS_TTS;
    const collectionSnapshots = await this.firebase.db
      .collection('collections')
      .limit(1000)
      .where('numOwnersUpdatedAt', '<', staleIfUpdatedBefore)
      .get();

    const collections: Collection[] = [];
    collectionSnapshots.docs.forEach((doc) => {
      collections.push(doc.data() as Collection);
    });

    return collections;
  }

  async getCollectionsSummary(): Promise<void> {
    const stream = this.firebase.db.collection('collections').stream();

    const collections: Array<Partial<Collection>> = [];
    try {
      for await (const snapshot of stream) {
        const collection: Partial<Collection> = (snapshot as unknown as FirebaseFirestore.QueryDocumentSnapshot).data();
        collections.push(collection);
      }
    } catch (err) {
      logger.error(err);
    }

    let completeCollections = 0;
    const data = collections.map((item) => {
      if (item?.state?.create?.step === CreationFlow.Complete) {
        completeCollections += 1;
      }
      return {
        address: item.address,
        chainId: item.chainId,
        numNfts: item.numNfts,
        state: item?.state?.create?.step ?? 'unknown',
        error: item?.state?.create?.error ?? '',
        exported: item?.state?.export?.done ?? false
      };
    });

    logger.log(JSON.stringify(data, null, 2));

    logger.log(`Found: ${collections.length} collections. Number of complete collections: ${completeCollections}`);
  }
}
