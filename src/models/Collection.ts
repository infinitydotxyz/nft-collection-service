/* eslint-disable @typescript-eslint/consistent-type-assertions */
import Contract, { HistoricalLogsChunk } from './contracts/Contract.interface';
import MetadataClient from '../services/Metadata';
import { ethers } from 'ethers';
import {
  Erc721Token,
  ImageData,
  ImageToken,
  MetadataData,
  MetadataToken,
  MintToken,
  RefreshTokenFlow,
  Token,
  TokenMetadata
} from '../types/Token.interface';
import { CollectionMetadataProvider } from '../types/CollectionMetadataProvider.interface';
import { Collection as CollectionType } from '../types/Collection.interface';
import Emittery from 'emittery';
import { NULL_ADDR, ALCHEMY_CONCURRENCY, COLLECTION_SCHEMA_VERSION } from '../constants';
import { getSearchFriendlyString } from '../utils';
import {
  CollectionAggregateMetadataError,
  CollectionCacheImageError,
  CollectionCreatorError,
  CollectionMetadataError,
  CollectionMintsError,
  CollectionTokenMetadataError,
  CollectionTokenValidationError,
  CreationFlowError,
  UnknownError
} from './errors/CreationFlow';
import Nft from './Nft';
import { alchemy, logger, opensea } from '../container';
import PQueue from 'p-queue';
import {
  RefreshTokenImageError,
  RefreshTokenMetadataError,
  RefreshTokenMintError,
  RefreshTokenUriError
} from './errors/RefreshTokenFlow';


export enum CreationFlow {
  /**
   * get collection deployer info and owner
   */
  CollectionCreator = 'collection-creator',

  /**
   * get the collection level metadata
   * links, name, description, images, symbol
   */
  CollectionMetadata = 'collection-metadata',

  /**
   * get all token ids, timestamp and block minted
   * and minter
   */
  CollectionMints = 'collection-mints',

  /**
   * get metadata for every token
   */
  TokenMetadata = 'token-metadata',

  /**
   * get metadata for every token from opensea
   */
  // TokenMetadataOS = 'token-metadata-os',

  /**
   * get metadata for every token from uri
   */
  TokenMetadataUri = 'token-metadata-uri',

  /**
   * requires that we have every token
   */
  AggregateMetadata = 'aggregate-metadata',

  /**
   * cache image
   */
  CacheImage = 'cache-image',

  /**
   * validate data
   */
  Validate = 'validate',

  /**
   * at this point we have successfully completed all steps above
   */
  Complete = 'complete',

  /**
   * at this point you give up
   */
  Unknown = 'unknown'
}

type CollectionCreatorType = Pick<
  CollectionType,
  | 'chainId'
  | 'address'
  | 'tokenStandard'
  | 'hasBlueCheck'
  | 'deployedAt'
  | 'deployer'
  | 'deployedAtBlock'
  | 'owner'
  | 'state'
  | 'indexInitiator'
>;
type CollectionMetadataType = CollectionCreatorType & Pick<CollectionType, 'metadata' | 'slug'>;
type CollectionMintsType = CollectionMetadataType;
type CollectionTokenMetadataType = CollectionMetadataType & Pick<CollectionType, 'numNfts'>;

type CollectionEmitter = Emittery<{
  token: Token;
  metadata: MetadataData & Partial<Token>;
  image: ImageData & Partial<Token>;
  mint: MintToken;
  tokenError: { error: { reason: string; timestamp: number }; tokenId: string };
  progress: { step: string; progress: number };
}>

export default class Collection {
  private readonly contract: Contract;

  private readonly collectionMetadataProvider: CollectionMetadataProvider;

  private readonly ethersQueue: PQueue;

  constructor(contract: Contract, tokenMetadataClient: MetadataClient, collectionMetadataProvider: CollectionMetadataProvider) {
    this.contract = contract;
    this.collectionMetadataProvider = collectionMetadataProvider;
    this.ethersQueue = new PQueue({ concurrency: ALCHEMY_CONCURRENCY, interval: 1000, intervalCap: ALCHEMY_CONCURRENCY });
  }

  /**
   * createCollection defines a flow to get the initial data for a collection
   * 
   * each step in the flow has a structure like 
   * 1. (optional) request tokens from a client
   * 2. perform some validation or add some data to the collection
   * 3. update the collection (including setting the next step) and yield it to the client
   * 
   * 
   */
  async *createCollection(
    initialCollection: Partial<CollectionType>,
    emitter: CollectionEmitter,
    indexInitiator: string,
    hasBlueCheck?: boolean
  ): AsyncGenerator<{ collection: Partial<CollectionType>; action?: 'tokenRequest' }, any, Array<Partial<Token>> | undefined> {
    let collection: CollectionCreatorType | CollectionMetadataType | CollectionTokenMetadataType | CollectionType =
      initialCollection as any;
    let step: CreationFlow = collection?.state?.create?.step || CreationFlow.CollectionCreator;
    try {
      while (true) {
        step = collection?.state?.create?.step || CreationFlow.CollectionCreator;
        switch (step) {
          case CreationFlow.CollectionCreator: // resets the collection
            try {
              collection = await this.getInitialCollection(collection, indexInitiator, hasBlueCheck ?? false, CreationFlow.CollectionMetadata);
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to get collection creator', err);
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection creator';
              throw new CollectionCreatorError(message);
            }
            break;

          case CreationFlow.CollectionMetadata:
            try {
              collection = await this.getCollectionMetadata(collection, CreationFlow.CollectionMints);
              yield { collection };
            } catch (err: any) {
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection metadata';
              throw new CollectionMetadataError(message);
            }
            break;

          case CreationFlow.CollectionMints:
            try {
              collection = await this.getCollectionMints(collection as CollectionMetadataType, emitter, CreationFlow.TokenMetadata);

              yield { collection }; // update collection
            } catch (err: any) {
              logger.error('Failed to get collection mints', err);
              if (err instanceof CollectionMintsError) {
                throw err;
              }
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection mints';
              throw new CollectionMintsError(message);
            }
            break;

          case CreationFlow.TokenMetadata:
            try {
              const mintTokens: Array<Partial<Token>> | undefined = yield {
                collection: collection,
                action: 'tokenRequest'
              };
              if (!mintTokens) {
                throw new CollectionMintsError('Token metadata received undefined tokens');
              }

              collection = await this.getCollectionTokenMetadata(mintTokens, collection as CollectionMetadataType, emitter, CreationFlow.TokenMetadataUri);
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to get collection tokens', err);
              if (err instanceof CollectionMintsError) {
                throw err;
              }
              // if any token fails we should throw an error
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get all tokens';
              throw new CollectionTokenMetadataError(message);
            }
            break;

          // leave this code commented; might use in the future
          // case CreationFlow.TokenMetadataOS:
          //   try {
          //     let tokens: Token[] = [];
          //     const injectedTokens = yield { collection: collection, action: 'tokenRequest' };
          //     if (!injectedTokens) {
          //       throw new CollectionCacheImageError('Client failed to inject tokens');
          //     }
          //     tokens = injectedTokens as Token[];
          //     collection = await this.getCollectionTokenMetadataFromOS(tokens, collection as CollectionTokenMetadataType, emitter,  CreationFlow.TokenMetadataUri);

          //     yield { collection };
          //   } catch (err: any) {
          //     logger.error('Failed to get token metadata from OS', err);
          //     if (err instanceof CollectionMintsError) {
          //       throw err;
          //     }
          //     // if any token fails we should throw an error
          //     const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get all tokens';
          //     throw new CollectionTokenMetadataError(message);
          //   }
          //   break;

          case CreationFlow.TokenMetadataUri:
            try {
              let tokens: Token[] = [];
              const injectedTokens = yield { collection: collection, action: 'tokenRequest' };
              if (!injectedTokens) {
                throw new CollectionTokenMetadataError('Client failed to inject tokens');
              }
              tokens = injectedTokens as Token[];
              
              collection = await this.getCollectionTokenMetadataUri(tokens, collection as CollectionMetadataType, emitter, CreationFlow.AggregateMetadata);
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to get token metadata from uri', err);
              throw err;
            }
            break;

          case CreationFlow.AggregateMetadata:
            try {
              let tokens: Token[] = [];
              const injectedTokens = yield { collection: collection, action: 'tokenRequest' };
              if (!injectedTokens) {
                throw new CollectionAggregateMetadataError('Client failed to inject tokens');
              }
              tokens = injectedTokens as Token[];

              const expectedNumNfts = (collection as CollectionTokenMetadataType).numNfts;
              const numNfts = tokens.length;
              const invalidTokens = [];
              for (const token of tokens) {
                try {
                  Nft.validateToken(token, RefreshTokenFlow.Metadata);
                } catch (err) {
                  invalidTokens.push(token);
                }
              }

              if (expectedNumNfts !== numNfts || invalidTokens.length > 0) {
                throw new CollectionTokenMetadataError(
                  `Received invalid tokens. Expected: ${expectedNumNfts} Received: ${numNfts}. Invalid tokens: ${invalidTokens.length}`
                );
              }

              collection = this.getCollectionAggregatedMetadata(tokens, collection as CollectionTokenMetadataType, emitter, CreationFlow.CacheImage);

              yield { collection };
            } catch (err: any) {
              logger.error('Failed to aggregate collection metadata', err);
              if (err instanceof CollectionTokenMetadataError) {
                throw err;
              }
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to aggregate metadata';
              throw new CollectionAggregateMetadataError(message);
            }
            break;

          case CreationFlow.CacheImage:
            try {
              let tokens: Token[] = [];
              const injectedTokens = yield { collection: collection, action: 'tokenRequest' };
              if (!injectedTokens) {
                throw new CollectionCacheImageError('Client failed to inject tokens');
              }
              tokens = injectedTokens as Token[];

              collection = await this.getCollectionCachedImages(tokens, collection as CollectionType, emitter, CreationFlow.Validate);
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to cache images', err);
              if (err instanceof CollectionMintsError) {
                throw err;
              }
              // if any token fails we should throw an error
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get all tokens';
              throw new CollectionCacheImageError(message);
            }
            break;

          case CreationFlow.Validate:
            try {
              /**
               * validate tokens
               */
              const tokens: Array<Partial<Token>> | undefined = yield {
                collection: collection,
                action: 'tokenRequest'
              };

              if (!tokens) {
                throw new CollectionMintsError('Token metadata received undefined tokens');
              }

              collection = await this.validateCollection(tokens, collection as CollectionTokenMetadataType, emitter, CreationFlow.Complete);
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to validate tokens', err);
              if (err instanceof CollectionTokenMetadataError || err instanceof CollectionCacheImageError) {
                throw err;
              }
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to aggregate metadata';
              throw new CollectionTokenValidationError(message);
            }
            break;

          case CreationFlow.Complete:
            /**
             * validate tokens
             */
            const finalTokens: Array<Partial<Token>> | undefined = yield {
              collection: collection,
              action: 'tokenRequest'
            };

            if (!finalTokens) {
              throw new CollectionMintsError('Token metadata received undefined tokens');
            }

            const invalidTokens = [];
            for (const token of finalTokens) {
              try {
                Nft.validateToken(token, RefreshTokenFlow.Complete);
              } catch (err) {
                invalidTokens.push({ token, err });
              }
            }

            if (invalidTokens.length > 0) {
              logger.error('Final invalid tokens', JSON.stringify(invalidTokens));
              if (invalidTokens[0].err instanceof RefreshTokenMintError) {
                throw new CollectionMintsError(`Received ${invalidTokens.length} invalid tokens`);
              } else if (invalidTokens[0].err instanceof RefreshTokenUriError) {
                throw new CollectionTokenMetadataError(`Received ${invalidTokens.length} invalid tokens`);
              } else if (invalidTokens[0].err instanceof RefreshTokenMetadataError) {
                throw new CollectionTokenMetadataError(`Received ${invalidTokens.length} invalid tokens`);
              } else if (invalidTokens[0].err instanceof RefreshTokenImageError) {
                throw new CollectionCacheImageError(`Received ${invalidTokens.length} invalid tokens`);
              } else {
                throw new CollectionMintsError(`Received ${invalidTokens.length} invalid tokens`);
              }
            }
            void emitter.emit('progress', { step, progress: 100 });
            return;
        }
        void emitter.emit('progress', { step, progress: 100 });
      }
    } catch (err: CreationFlowError | any) {
      logger.error(err);
      let error;
      let stepToSave: CreationFlow = step;
      if (err instanceof CreationFlowError) {
        error = err;
        if (err.discriminator === 'unknown') {
          stepToSave = CreationFlow.CollectionCreator;
        } else {
          stepToSave = err.discriminator;
        }
      } else {
        const message =
          typeof err?.message === 'string'
            ? (err.message as string)
            : "Failed to create collection. It's likely errors are not being handled correctly.";
        error = new UnknownError(message);
        stepToSave = CreationFlow.Unknown;
      }
      collection = {
        ...collection,
        state: {
          ...collection.state,
          create: {
            ...collection.state?.create,
            step: stepToSave,
            updatedAt: Date.now(),
            error: error.toJSON()
          },
          export: {
            done: false
          }
        }
      };
      yield { collection };
    }
  }

  private async getCreator(): Promise<{
    deployedAt: number;
    deployer: string;
    owner: string;
    deployedAtBlock: number;
  }> {
    const deployer = await this.getDeployer();
    let owner;

    try {
      owner = await this.contract.getOwner();
    } catch {}

    if (!owner) {
      owner = deployer.address;
    }

    return {
      deployedAt: deployer.createdAt,
      deployer: deployer.address.toLowerCase(),
      deployedAtBlock: deployer.block,
      owner: owner.toLowerCase()
    };
  }

  private async getDeployer(attempts = 0): Promise<{ createdAt: number; address: string; block: number }> {
    attempts += 1;
    const maxAttempts = 3;
    try {
      const creation = await this.contract.getContractCreationTx();
      const blockDeployedAt = creation.blockNumber;
      const deployer = (this.contract.decodeDeployer(creation) ?? '').toLowerCase();
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

  async getMints<T extends { mint: MintToken; progress: { progress: number } }>(
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
        minter: transfer.to.toLowerCase(),
        mintTxHash: event.transactionHash,
        mintPrice
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

        const chunkPromises = mintEvents.map(async (event) => {
          const token = await getTokenFromTransfer(event);
          void emitter.emit('mint', token);
          return token;
        });

        /**
         * wrap each chunk to prevent uncaught rejections
         */
        const chunkPromise = Promise.allSettled(chunkPromises);
        tokenPromises = [...tokenPromises, chunkPromise];
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
      if (result.status === 'fulfilled' && result.value?.state?.metadata && 'error' in result.value?.state?.metadata) {
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

  private async getInitialCollection(
    collection: Partial<CollectionType>,
    indexInitiator: string,
    hasBlueCheck: boolean,
    nextStep: CreationFlow,
  ): Promise<CollectionCreatorType> {
    const creator = await this.getCreator();
    const initialCollection: CollectionCreatorType = {
      indexInitiator: indexInitiator,
      chainId: this.contract.chainId,
      address: this.contract.address,
      tokenStandard: this.contract.standard,
      hasBlueCheck: hasBlueCheck ?? false,
      ...creator,
      state: {
        ...(collection?.state ?? {}),
        create: {
          progress: 0,
          step: nextStep,
          updatedAt: Date.now()
        },
        version: COLLECTION_SCHEMA_VERSION,
        export: {
          done: collection?.state?.export?.done ?? false
        }
      }
    };
    return initialCollection;
  }

  private async getCollectionMetadata(collection: CollectionCreatorType,     nextStep: CreationFlow): Promise<CollectionMetadataType> {
    const collectionMetadata = await this.collectionMetadataProvider.getCollectionMetadata(this.contract.address);

    const slug = getSearchFriendlyString(collectionMetadata.links.slug ?? '');
    if (!slug) {
      throw new Error('Failed to find collection slug');
    }

    const collectionMetadataCollection: CollectionMetadataType = {
      ...collection,
      metadata: collectionMetadata,
      slug: slug,
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep,
          updatedAt: Date.now()
        },
        export: {
          done: false
        }
      }
    };

    return collectionMetadataCollection;
  }

  private async getCollectionMints(collection: CollectionMetadataType, emitter: CollectionEmitter,     nextStep: CreationFlow): Promise<CollectionMintsType> {
    let resumeFromBlock: number | undefined;
    if (collection.state.create.error?.discriminator === CreationFlow.CollectionMints) {
      resumeFromBlock = collection.state.create.error?.lastSuccessfulBlock;
    }

    const mintEmitter = new Emittery<{ mint: MintToken; progress: { progress: number } }>();

    mintEmitter.on('mint', (mintToken) => {
      void emitter.emit('mint', mintToken);
    });

    mintEmitter.on('progress', ({ progress }) => {
      void emitter.emit('progress', { progress, step: CreationFlow.CollectionMints });
    });

    const { failedWithUnknownErrors, gotAllBlocks, lastSuccessfulBlock } = await this.getMints(
      mintEmitter,
      resumeFromBlock ?? collection.deployedAtBlock
    );

    if (failedWithUnknownErrors > 0) {
      throw new CollectionMintsError(`Failed to get mints for ${failedWithUnknownErrors} tokens with unknown errors`); // get all blocks again
    } else if (!gotAllBlocks) {
      throw new CollectionMintsError(`Failed to get mints for all blocks`, lastSuccessfulBlock);
    }

    const collectionMintsCollection: CollectionMintsType = {
      ...(collection ),
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep,
          updatedAt: Date.now()
        }
      }
    };

    return collectionMintsCollection;
  }


  private async getCollectionTokenMetadata(mintTokens: Array<Partial<Token>>, collection: CollectionMintsType, emitter: CollectionEmitter,     nextStep: CreationFlow): Promise<CollectionTokenMetadataType> {
    let tokensValid = true;
    for (const token of mintTokens) {
      try {
        Nft.validateToken(token, RefreshTokenFlow.Mint);
      } catch (err) {
        tokensValid = false;
      }
    }
    if (!tokensValid) {
      throw new CollectionMintsError('Received invalid tokens');
    }
    const alchemyLimit = 100;
    const numIters = Math.ceil(mintTokens.length / alchemyLimit);
    let startToken = '';
    for (let i = 0; i < numIters; i++) {
      const data = await alchemy.getNFTsOfCollection(this.contract.address, startToken);
      startToken = data.nextToken;
      for (const datum of data.nfts) {
        const metadata = (JSON.parse(JSON.stringify(datum.metadata)) ?? {}) as TokenMetadata;
        metadata.description = datum.description ?? '';
        metadata.image = datum.metadata?.image ?? datum.tokenUri?.gateway;
        const tokenIdStr = datum?.id?.tokenId;
        let tokenId;
        if (tokenIdStr?.startsWith('0x')) {
          tokenId = String(parseInt(tokenIdStr, 16));
        }
        if (tokenId) {
          const tokenWithMetadata: MetadataData & Partial<Token> = {
            slug: getSearchFriendlyString(datum.title ?? metadata.name ?? metadata.title ?? ''),
            tokenId,
            tokenUri: datum.tokenUri?.raw,
            numTraitTypes: metadata?.attributes?.length,
            metadata,
            updatedAt: Date.now()
          };
          void emitter.emit('metadata', tokenWithMetadata);
        }
      }
      void emitter.emit('progress', {
        step: CreationFlow.TokenMetadata,
        progress: Math.floor(((i * alchemyLimit) / mintTokens.length) * 100 * 100) / 100
      });
    }

    const collectionMetadataCollection: CollectionTokenMetadataType = {
      ...(collection ),
      numNfts: mintTokens.length,
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep,
          updatedAt: Date.now()
        }
      }
    };

    return collectionMetadataCollection;
  }

  private async getCollectionTokenMetadataUri(tokens: Token[], collection: CollectionMintsType, emitter: CollectionEmitter, nextStep: CreationFlow): Promise<CollectionTokenMetadataType> {
    const metadataLessTokens = [];
    for (const token of tokens) {
      try {
        Nft.validateToken(token, RefreshTokenFlow.Metadata);
      } catch (err) {
        metadataLessTokens.push(token);
      }
    }

    const tokenPromises: Array<Promise<MetadataToken>> = [];
    for (const token of metadataLessTokens) {
      const nft = new Nft(token as MintToken, this.contract, this.ethersQueue);
      const iterator = nft.refreshToken();
      let progress = 0;
      const tokenWithMetadataPromise = new Promise<MetadataToken>(async (resolve, reject) => {
        let tokenWithMetadata = token as Partial<Erc721Token>;
        try {
          let prevTokenProgress = 0;
          for await (const { token: intermediateToken, failed, progress: tokenProgress } of iterator) {
            progress = progress - prevTokenProgress + tokenProgress;
            prevTokenProgress = tokenProgress;

            void emitter.emit('progress', {
              step: CreationFlow.TokenMetadataUri,
              progress: Math.floor((progress / metadataLessTokens.length) * 100 * 100) / 100
            });
            if (failed) {
              reject(new Error(intermediateToken.state?.metadata.error?.message));
            } else {
              tokenWithMetadata = intermediateToken;
            }
          }
          if (!tokenWithMetadata) {
            throw new Error('Failed to refresh token');
          }

          progress = progress - prevTokenProgress + 1;
          void emitter.emit('progress', {
            step: nextStep,
            progress: Math.floor((progress / metadataLessTokens.length) * 100 * 100) / 100
          });

          void emitter.emit('token', tokenWithMetadata as Token);
          resolve(tokenWithMetadata as MetadataToken);
        } catch (err) {
          logger.error(err);
          if (err instanceof RefreshTokenMintError) {
            reject(new Error('Invalid mint data'));
          }
          reject(err);
        }
      });

      tokenPromises.push(tokenWithMetadataPromise);
    }

    const results = await Promise.allSettled(tokenPromises);
    let res = { reason: '', failed: false };
    for (const result of results) {
      if (result.status === 'rejected') {
        const message = typeof result?.reason === 'string' ? result.reason : 'Failed to refresh token';
        res = { reason: message, failed: true };
        if (result.reason === 'Invalid mint data') {
          throw new CollectionMintsError('Tokens contained invalid mint data');
        }
      }
    }

    if (res.failed) {
      throw new Error(res.reason);
    }

    const collectionMetadataCollection: CollectionTokenMetadataType = {
      ...(collection ),
      numNfts: tokens.length,
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep, // update step
          updatedAt: Date.now()
        }
      }
    };
    return collectionMetadataCollection; // update collection

  }

  private getCollectionAggregatedMetadata(tokens: Token[], collection: CollectionTokenMetadataType, emitter: CollectionEmitter, nextStep: CreationFlow): CollectionType {
    const attributes = this.contract.aggregateTraits(tokens) ?? {};
    const tokensWithRarity = this.contract.calculateRarity(tokens, attributes);
    for (const token of tokensWithRarity) {
      void emitter.emit('token', token).catch((err) => {
        logger.log('error while emitting token');
        logger.error(err);
        // safely ignore
      });
    }

    const aggregatedCollection: CollectionType = {
      ...(collection ),
      attributes,
      numTraitTypes: Object.keys(attributes).length,
      numOwnersUpdatedAt: 0,
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep,
          updatedAt: Date.now()
        }
      }
    };

    return aggregatedCollection;
  }

  private async getCollectionCachedImages(tokens: Token[], collection: CollectionType, emitter: CollectionEmitter, nextStep: CreationFlow): Promise<CollectionTokenMetadataType> {
    const openseaLimit = 50;
    const openseaTokenIdsLimit = 20;

    // fetch tokens that don't have images
    const imageLessTokens = [];
    for (const token of tokens) {
      if (!token.image || !token.image.originalUrl || !token.image.url || !token.image.updatedAt) {
        imageLessTokens.push(token);
      }
    }
    const numImagelessTokens = imageLessTokens.length;
    const numTokens = tokens.length;
    const percentFailed = Math.floor((numImagelessTokens / numTokens) * 100);
    if (percentFailed < 40) {
      const numIters = Math.ceil(numImagelessTokens / openseaTokenIdsLimit);
      for (let i = 0; i < numIters; i++) {
        const tokenSlice = tokens.slice(i * openseaTokenIdsLimit, (i + 1) * openseaTokenIdsLimit);
        let tokenIdsConcat = '';
        for (const token of tokenSlice) {
          tokenIdsConcat += `token_ids=${token.tokenId}&`;
        }
        const data = await opensea.getTokenIdsOfContract(this.contract.address, tokenIdsConcat);
        for (const datum of data.assets) {
          const imageToken: ImageData & Partial<Token> = {
            tokenId: datum.token_id,
            image: { url: datum.image_url, originalUrl: datum.image_original_url, updatedAt: Date.now() }
          } as ImageToken;
          void emitter.emit('image', imageToken);
        }
        void emitter.emit('progress', {
          step: CreationFlow.AggregateMetadata,
          progress: Math.floor(((i * openseaTokenIdsLimit) / numImagelessTokens) * 100 * 100) / 100
        });
      }
    } else {
      const numIters = Math.ceil(numTokens / openseaLimit);
      let cursor = '';
      for (let i = 0; i < numIters; i++) {
        const data = await opensea.getNFTsOfContract(this.contract.address, openseaLimit, cursor);
        // update cursor
        cursor = data.next;
        for (const datum of data.assets) {
          const imageToken: ImageData & Partial<Token> = {
            tokenId: datum.token_id,
            image: { url: datum.image_url, originalUrl: datum.image_original_url, updatedAt: Date.now() }
          } as ImageToken;
          void emitter.emit('image', imageToken);
        }
        void emitter.emit('progress', {
          step: CreationFlow.AggregateMetadata,
          progress: Math.floor(((i * openseaLimit) / numTokens) * 100 * 100) / 100
        });
      }
    }

    const collectionMetadataCollection: CollectionTokenMetadataType = {
      ...(collection as CollectionTokenMetadataType),
      numNfts: tokens.length,
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep, // update step
          updatedAt: Date.now()
        }
      }
    };
    return collectionMetadataCollection;
  }


  private async validateCollection(tokens: Array<Partial<Token>>, collection: CollectionTokenMetadataType, emitter: CollectionEmitter, nextStep: CreationFlow): Promise<CollectionTokenMetadataType> { 
    const invalidImageTokens = [];
    for (const token of tokens) {
      try {
        Nft.validateToken(token, RefreshTokenFlow.Complete);
      } catch (err) {
        if (err instanceof RefreshTokenImageError) {
          invalidImageTokens.push(token);
        }
      }
    }

    // try invalid image tokens
    let j = 0;
    for (const token of invalidImageTokens) {
      j++;
      const metadata = await opensea.getNFTMetadata(this.contract.address, token.tokenId ?? '');

      const imageToken: ImageData & Partial<Token> = {
        tokenId: token.tokenId,
        image: { url: metadata.image, originalUrl: token.metadata?.image, updatedAt: Date.now() }
      } as ImageToken;
      void emitter.emit('image', imageToken);
      void emitter.emit('progress', {
        step: CreationFlow.CacheImage,
        progress: Math.floor((j / invalidImageTokens.length) * 100 * 100) / 100
      });
    }

    const collectionMetadataCollection: CollectionTokenMetadataType = {
      ...(collection ),
      numNfts: tokens.length,
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep,
          updatedAt: Date.now()
        }
      }
    };
    return collectionMetadataCollection;
  }

  // private async getCollectionTokenMetadataFromOS(tokens: Array<Partial<Token>>, collection: CollectionTokenMetadataType, emitter: CollectionEmitter, nextStep: CreationFlow): Promise<CollectionTokenMetadataType> {
  //   // metadata less tokens
  //   const metadataLessTokens = [];
  //   for (const token of tokens) {
  //     try {
  //       Nft.validateToken(token, RefreshTokenFlow.Metadata);
  //     } catch (err) {
  //       metadataLessTokens.push(token);
  //     }
  //   }
  //   const numTokens = metadataLessTokens.length;
  //   const openseaLimit = 20;
  //   const numIters = Math.ceil(numTokens / openseaLimit);
  //   for (let i = 0; i < numIters; i++) {
  //     const tokenIds = tokens.slice(i * openseaLimit, (i + 1) * openseaLimit);
  //     let tokenIdsConcat = '';
  //     for (const tokenId of tokenIds) {
  //       tokenIdsConcat += `token_ids=${tokenId.tokenId}&`;
  //     }
  //     const data = await opensea.getTokenIdsOfContract(this.contract.address, tokenIdsConcat);
  //     for (const datum of data.assets) {
  //       const metaToken: MetadataData & Partial<Token> = {
  //         updatedAt: Date.now(),
  //         tokenId: datum.token_id,
  //         slug: getSearchFriendlyString(datum.name),
  //         numTraitTypes: datum.traits?.length,
  //         metadata: {
  //           name: datum.name ?? null,
  //           title: datum.name ?? null,
  //           image: datum.image_url ?? '',
  //           image_data: '',
  //           external_url: datum?.external_link ?? '',
  //           description: datum.description ?? '',
  //           attributes: datum.traits,
  //           background_color: datum.background_color ?? '',
  //           animation_url: datum?.animation_url ?? '',
  //           youtube_url: ''
  //         },
  //         image: { url: datum.image_url, originalUrl: datum.image_original_url, updatedAt: Date.now() }
  //       };
  //       void emitter.emit('metadata', metaToken);
  //     }
  //     void emitter.emit('progress', {
  //       step: CreationFlow.TokenMetadataOS,
  //       progress: Math.floor(((i * openseaLimit) / numTokens) * 100 * 100) / 100
  //     });
  //   }

  //   const collectionMetadataCollection: CollectionTokenMetadataType = {
  //     ...(collection ),
  //     numNfts: tokens.length,
  //     state: {
  //       ...collection.state,
  //       create: {
  //         updatedAt: Date.now(),
  //         progress: 100,
  //         step: nextStep // update step
  //       }
  //     }
  //   };

  //   return collectionMetadataCollection;
  // }
} 
