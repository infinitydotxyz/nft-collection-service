import { ONE_HOUR } from './constants';
import { Collection } from './types/Collection.interface';
import { collectionQueue, firebase } from './container';
import { CreationFlow } from './models/Collection';

export async function main(): Promise<void> {
  return await new Promise(() => {
    collectionQueue.start();
  });
}

