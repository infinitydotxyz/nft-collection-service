import Contract, { HistoricalLogsChunk } from './contracts/Contract.interface';
import { CollectionMetadataProvider } from '../types/CollectionMetadataProvider.interface';
import PQueue from 'p-queue';
import { ALCHEMY_CONCURRENCY, NULL_ADDR } from '../constants';
import {
  ImageData,
  MetadataData,
  MintToken,
  RefreshTokenFlow,
  Token,
  Collection as CollectionType,
  CollectionAttributes,
  CreationFlow
} from '@infinityxyz/lib/types/core';
import Emittery from 'emittery';
import { ethers } from 'ethers';
import Nft from './Nft';
import { logger } from '../container';
import { normalizeAddress } from '../utils/ethers';
import BatchHandler from './BatchHandler';

export type CollectionEmitterType = {
  token: Token;
  metadata: MetadataData & Partial<Token>;
  image: ImageData & Partial<Token>;
  mint: MintToken;
  attributes: CollectionAttributes;
  tokenError: { error: { reason: string; timestamp: number }; tokenId: string };
  progress: { step: CreationFlow; progress: number; message?: string; zoraCursor?: string; reservoirCursor?: string };
};

export default abstract class Collection {
  protected readonly contract: Contract;

  protected readonly collectionMetadataProvider: CollectionMetadataProvider;

  protected readonly ethersQueue: PQueue;

  constructor(contract: Contract, collectionMetadataProvider: CollectionMetadataProvider) {
    this.contract = contract;
    this.collectionMetadataProvider = collectionMetadataProvider;
    this.ethersQueue = new PQueue({ concurrency: ALCHEMY_CONCURRENCY, interval: 1000, intervalCap: ALCHEMY_CONCURRENCY });
  }

  abstract createCollection(
    initialCollection: Partial<CollectionType>,
    emitter: Emittery<CollectionEmitterType>,
    indexInitiator: string,
    batch: BatchHandler,
    hasBlueCheck?: boolean
  ): AsyncGenerator<{ collection: Partial<CollectionType>; action?: 'tokenRequest' }, any, AsyncIterable<Partial<Token>> | undefined>;

  protected async getCreator(): Promise<{
    deployedAt: number;
    deployer: string;
    owner: string;
    deployedAtBlock: number;
  }> {
    const deployer = await this.getDeployer();
    let owner;
    try {
      owner = await this.contract.getOwner();
      // eslint-disable-next-line no-empty
    } catch {}

    if (!owner || owner === NULL_ADDR) {
      owner = deployer.address;
    }

    return {
      deployedAt: deployer.createdAt,
      deployer: normalizeAddress(deployer.address),
      deployedAtBlock: deployer.block,
      owner: normalizeAddress(owner)
    };
  }

  protected async getDeployer(attempts = 0): Promise<{ createdAt: number; address: string; block: number }> {
    attempts += 1;
    const maxAttempts = 3;
    try {
      const creation = await this.contract.getContractCreationTx();
      const blockDeployedAt = creation.blockNumber;
      const deployer = normalizeAddress(this.contract.decodeDeployer(creation) ?? '');
      const createdAt = (await creation.getBlock()).timestamp * 1000; // convert timestamp to ms
      return {
        createdAt,
        address: deployer,
        block: blockDeployedAt
      };
    } catch (err) {
      if (attempts > maxAttempts) {
        throw err;
      }
      return await this.getDeployer(attempts);
    }
  }

  protected async getMints<T extends { mint: MintToken; progress: { progress: number; message?: string } }>(
    emitter: Emittery<T>,
    resumeFromBlock?: number
  ): Promise<{
    tokens: MintToken[];
    failedWithUnknownErrors: number;
    gotAllBlocks: boolean;
    startBlock?: number;
    lastSuccessfulBlock?: number;
  }> {
    /**
     * cache of block timestamps
     */
    const blockTimestamps = new Map<number, Promise<{ error: any } | { value: number }>>();
    const getBlockTimestampInMS = async (item: ethers.Event): Promise<{ error: any } | { value: number }> => {
      const result = blockTimestamps.get(item.blockNumber);
      if (!result) {
        // eslint-disable-next-line no-async-promise-executor
        const promise = new Promise<{ error: any } | { value: number }>(async (resolve) => {
          let attempts = 0;
          while (attempts < 3) {
            attempts += 1;
            try {
              const block = await this.ethersQueue.add(async () => {
                return await item.getBlock();
              });
              resolve({ value: block.timestamp * 1000 });
              break;
            } catch (err) {
              if (attempts > 3) {
                resolve({ error: err });
              }
            }
          }
        });
        blockTimestamps.set(item.blockNumber, promise);
        return await promise;
      }
      return await result;
    };

    const transactions = new Map<string, Promise<{ error: any } | { value: number }>>();
    const getPricePerMint = async (item: ethers.Event): Promise<{ error: any } | { value: number }> => {
      const result = transactions.get(item.transactionHash);
      if (!result) {
        // eslint-disable-next-line no-async-promise-executor
        const promise = new Promise<{ error: any } | { value: number }>(async (resolve) => {
          let attempts = 0;
          while (attempts < 3) {
            attempts += 1;
            try {
              const tx = await this.ethersQueue.add(async () => {
                return await item.getTransaction();
              });
              const value = tx.value;
              const ethValue = parseFloat(ethers.utils.formatEther(value));
              const receipt = await this.ethersQueue.add(async () => {
                return await item.getTransactionReceipt();
              });
              const transferLogs = (receipt?.logs ?? []).filter((log) => {
                return this.contract.isTransfer(log.topics[0]);
              });
              const pricePerMint = Math.round(10000 * (ethValue / transferLogs.length)) / 10000;
              resolve({ value: pricePerMint });
              break;
            } catch (err) {
              if (attempts > 3) {
                resolve({ error: err });
              }
            }
          }
        });
        transactions.set(item.transactionHash, promise);

        return await promise;
      }
      return await result;
    };

    /**
     * attempts to get a token from a transfer event
     */
    const getTokenFromTransfer = async (event: ethers.Event): Promise<MintToken> => {
      let mintedAt = 0;
      let mintPrice = 0;
      const transfer = this.contract.decodeTransfer(event);
      const isMint = transfer.from === NULL_ADDR;
      if (isMint) {
        const blockTimestampResult = await getBlockTimestampInMS(event); // doesn't throw
        if ('value' in blockTimestampResult) {
          mintedAt = blockTimestampResult.value;
        }
        const mintPriceResult = await getPricePerMint(event);
        if ('value' in mintPriceResult) {
          mintPrice = mintPriceResult.value;
        }
      }

      const tokenId = transfer.tokenId;
      const token: MintToken = {
        chainId: this.contract.chainId,
        tokenId,
        mintedAt,
        minter: normalizeAddress(transfer.to),
        mintTxHash: event.transactionHash,
        mintPrice,
        image: {
          updatedAt: 0
        },
        tokenUri: ''
      };

      return Nft.validateToken(token, RefreshTokenFlow.Mint);
    };

    const mintsStream = await this.contract.getMints({ fromBlock: resumeFromBlock, returnType: 'stream' });

    let tokenPromises: Array<Promise<Array<PromiseSettledResult<MintToken>>>> = [];

    let gotAllBlocks = true;
    let startBlock: number | undefined;
    let lastSuccessfulBlock: number | undefined;
    try {
      /**
       * as we receive mints (transfer events) get the token's metadata
       */
      for await (const chunk of mintsStream) {
        const { events: mintEvents, fromBlock, toBlock, progress }: HistoricalLogsChunk = chunk;
        startBlock = fromBlock;
        lastSuccessfulBlock = toBlock;
        void emitter.emit('progress', { progress });

        const queue = new PQueue({ concurrency: 100 });
        const chunkPromises = mintEvents.map(async (event) => {
          return await queue.add(async () => {
            const token = await getTokenFromTransfer(event);
            void emitter.emit('mint', token);
            return token;
          });
        });

        let lastUpdate = Date.now();
        queue.on('next', () => {
          if (Date.now() - lastUpdate > 5000) {
            void emitter.emit('progress', { progress, message: `Waiting for chunk. Size: ${queue.size + queue.pending}` });
            lastUpdate = Date.now();
          }
        });

        /**
         * wrap each chunk to prevent uncaught rejections
         */
        const chunkPromise = Promise.allSettled(chunkPromises);
        tokenPromises = [...tokenPromises, chunkPromise];
        await chunkPromise;
      }
    } catch (err) {
      logger.log('failed to get all mints for a collection');
      logger.error(err);
      gotAllBlocks = false; // failed to get all mints
    }

    const result = await Promise.all(tokenPromises);

    const promiseSettledResults = result.reduce((acc, item) => {
      return [...acc, ...item];
    }, []);

    const tokens: MintToken[] = [];
    let unknownErrors = 0;
    for (const result of promiseSettledResults) {
      if (result.status === 'fulfilled' && result.value?.state?.metadata && 'error' in result.value.state.metadata) {
        logger.log(result.value.state?.metadata.error);
      } else if (result.status === 'fulfilled') {
        tokens.push(result.value);
      } else {
        unknownErrors += 1;
        logger.error('unknown error occurred while getting token');
        logger.error(result.reason);
      }
    }

    return {
      tokens,
      failedWithUnknownErrors: unknownErrors,
      gotAllBlocks,
      startBlock: startBlock,
      lastSuccessfulBlock
    };
  }
}
