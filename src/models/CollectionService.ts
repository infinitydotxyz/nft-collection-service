import ContractFactory from './contracts/ContractFactory';
import CollectionMetadataProvider from './CollectionMetadataProvider';
import PQueue from 'p-queue';
import { singleton } from 'tsyringe';
import { COLLECTION_TASK_CONCURRENCY } from '../constants';
import { createCollection } from '../workers/collectionRunner';
import { logger } from '../container';

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

    function setTerminalTitle(title: string):void {
      process.stdout.write(String.fromCharCode(27) + ']0;' + title + String.fromCharCode(7));
    }

    setInterval(() => {
      const size = this.taskQueue.size + this.taskQueue.pending;
      setTerminalTitle(`Collection Queue Size: ${this.taskQueue.size} Pending: ${this.taskQueue.pending}  Total: ${size}`);
    }, 3000);
  }

  async createCollection(address: string, chainId: string, hasBlueCheck = false, reset = false): Promise<void> {
    address = address.toLowerCase();

    return await this.taskQueue.add(async( ) => {
      try{
        await createCollection(address, chainId, hasBlueCheck, reset);
      }catch(err) {
        logger.error('Worker errored...', err);
      }
    })
  }
}
