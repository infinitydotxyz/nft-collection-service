import Firebase from '../database/Firebase';
import { singleton } from 'tsyringe';
import { Collection } from '../types/Collection.interface';
import { NUM_OWNERS_TTS } from '../constants';

@singleton()
export default class CollectionDao {
  private readonly firebase: Firebase;

  constructor(firebase: Firebase) {
    this.firebase = firebase;
  }

  async get(chainId: string, address: string): Promise<Collection> {
      const collectionRef = this.firebase.getCollectionDocRef(chainId, address);

      const doc = await collectionRef.get();
      
      return doc.data() as Collection;
  }

  async update(collection: Collection): Promise<void> {
      const chainId = collection.chainId;
      const address = collection.address;
      if(!chainId || !address) {
          throw new Error('invalid collection');
      }
    const collectionRef = this.firebase.getCollectionDocRef(chainId, address);

    await collectionRef.set(collection, { merge: true});
  }

  async getStaleCollectionOwners(): Promise<Collection[]> {
    const now = Date.now();
    const staleIfUpdatedBefore = now - NUM_OWNERS_TTS;
    const collectionSnapshots = await this.firebase.db.collection('collections').where('numOwnersUpdatedAt', '<', staleIfUpdatedBefore).get();


    const collections: Collection[] = [];
    collectionSnapshots.docs.forEach((doc) => {
      collections.push(doc.data() as Collection);
    })

    return collections;
   }
}
