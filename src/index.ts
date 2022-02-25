import { ONE_HOUR } from './constants';
import { Collection } from './types/Collection.interface';
import { firebase } from './container';
import { CreationFlow } from './models/Collection';
import { CollectionQueueMonitor } from './models/CollectionQueueMonitor';

export async function main(): Promise<void> {
  return await new Promise(() => {
    new CollectionQueueMonitor().start();
  });
}

