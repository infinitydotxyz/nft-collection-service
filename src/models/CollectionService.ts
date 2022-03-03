import ContractFactory from './contracts/ContractFactory';
import CollectionMetadataProvider from './CollectionMetadataProvider';
import PQueue from 'p-queue';
import { singleton } from 'tsyringe';
import { COLLECTION_TASK_CONCURRENCY, NULL_ADDR } from '../constants';
import { createCollection } from '../workers/collectionRunner';
import { logger } from '../container';
import { EventEmitter } from 'stream';
import { normalizeAddress, validateAddress, validateChainId } from '../utils/ethers';

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
      });
    });
  }

  async createCollection(
    address: string,
    chainId: string,
    hasBlueCheck = false,
    reset = false,
    indexInitiator = NULL_ADDR
  ): Promise<void> {
    /**
     * verify that the collection has not been successfully indexed yet
     *
     * don't update indexInitiator
     *
     * validate address and chain id
     */
    address = validateAddress(normalizeAddress(address));
    indexInitiator = validateAddress(normalizeAddress(indexInitiator));
    chainId = validateChainId(chainId);

    return await this.taskQueue.add(async () => {
      try {
        await createCollection(address, chainId, hasBlueCheck, reset, indexInitiator, false);
      } catch (err) {
        logger.error('Collection errored...', err);
      }
    });
  }
}
