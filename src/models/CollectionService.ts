import ContractFactory from './contracts/ContractFactory';
import CollectionMetadataProvider from './CollectionMetadataProvider';
import PQueue from 'p-queue';
import { singleton } from 'tsyringe';
import { COLLECTION_TASK_CONCURRENCY } from '../constants';
import { createCollection } from '../workers/collectionRunner';
import { logger } from '../container';
import { EventEmitter } from 'stream';

@singleton()
export default class CollectionService extends EventEmitter {
  private readonly contractFactory: ContractFactory;
  private readonly collectionMetadataProvider: CollectionMetadataProvider;

  private readonly taskQueue: PQueue;

  readonly concurrency: number;

  constructor() {
    super();
    this.contractFactory = new ContractFactory();
    this.collectionMetadataProvider = new CollectionMetadataProvider();
    this.concurrency = COLLECTION_TASK_CONCURRENCY;
    this.taskQueue = new PQueue({
      concurrency: this.concurrency // number of collections to run at once
    });


    this.taskQueue.on('add', () => {
      this.emit('sizeChange', {
        size: this.taskQueue.size,
        pending: this.taskQueue.pending
      });
    });

    this.taskQueue.on('next', () => {
      this.emit('sizeChange', {
        size: this.taskQueue.size,
        pending: this.taskQueue.pending
      });

      this.emit('collectionCompleted', () => {
        this.emit('collectionCompleted');
      })
    });
  }

  async createCollection(address: string, chainId: string, hasBlueCheck = false, reset = false): Promise<void> {
    address = address.toLowerCase();

    return await this.taskQueue.add(async () => {
      try {
        await createCollection(address, chainId, hasBlueCheck, reset);
      } catch (err) {
        logger.error('Worker errored...', err);
      }
    });
  }
}
