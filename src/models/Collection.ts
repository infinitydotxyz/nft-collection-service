/* eslint-disable @typescript-eslint/consistent-type-assertions */
import Contract, { HistoricalLogsChunk } from './contracts/Contract.interface';
import MetadataClient from '../services/Metadata';
import { ethers } from 'ethers';
import { ImageToken, MintToken, RefreshTokenFlow, Token } from '../types/Token.interface';
import { CollectionMetadataProvider } from '../types/CollectionMetadataProvider.interface';
import { Collection as CollectionType } from '../types/Collection.interface';
import Emittery from 'emittery';
import { NULL_ADDR } from '../constants';
import { getSearchFriendlyString } from '../utils';
import {
  CollectionAggregateMetadataError,
  CollectionCreatorError,
  CollectionMetadataError,
  CollectionMintsError,
  CollectionTokenMetadataError,
  CreationFlowError,
  UnknownError
} from './errors/CreationFlow';
import Nft from './Nft';

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
   * requires that we have every token
   */
  AggregateMetadata = 'aggregate-metadata',

  /**
   * at this point we have successfully completed all steps above
   */
  Complete = 'complete'
}

export default class Collection {
  private readonly contract: Contract;

  private readonly tokenMetadataClient: MetadataClient;

  private readonly collectionMetadataProvider: CollectionMetadataProvider;

  constructor(
    contract: Contract,
    tokenMetadataClient: MetadataClient,
    collectionMetadataProvider: CollectionMetadataProvider
  ) {
    this.contract = contract;
    this.tokenMetadataClient = tokenMetadataClient;
    this.collectionMetadataProvider = collectionMetadataProvider;
  }

  async *createCollection(
    initialCollection: Partial<CollectionType>,
    emitter: Emittery<{
      token: Token;
      mint: MintToken;
      tokenError: { error: { reason: string; timestamp: number }; tokenId: string };
      progress: { step: string; progress: number };
    }>,
    hasBlueCheck?: boolean
  ): AsyncGenerator<
    { collection: Partial<CollectionType>; action?: 'tokenRequest' },
    any,
    Array<Partial<Token>> | undefined
  > {
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
    >;
    type CollectionMetadataType = CollectionCreatorType & Pick<CollectionType, 'metadata' | 'slug'>;
    type CollectionMintsType = CollectionMetadataType;
    type CollectionTokenMetadataType = CollectionMetadataType & Pick<CollectionType, 'numNfts'>;
    let collection: CollectionCreatorType | CollectionMetadataType | CollectionTokenMetadataType | CollectionType =
      initialCollection as any;
    const allTokens: Token[] = [];

    let step = collection?.state?.create?.step || CreationFlow.CollectionCreator;

    try {
      while (true) {
        step = collection?.state?.create?.step || CreationFlow.CollectionCreator;
        switch (step) {
          case CreationFlow.CollectionCreator: // resets the collection
            try {
              const creator = await this.getCreator();
              const initialCollection: CollectionCreatorType = {
                chainId: this.contract.chainId,
                address: this.contract.address,
                tokenStandard: this.contract.standard,
                hasBlueCheck: hasBlueCheck ?? false,
                ...creator,
                state: {
                  ...collection.state,
                  create: {
                    step: CreationFlow.CollectionMetadata // update step
                  }
                }
              };
              collection = initialCollection; // update collection
              yield { collection };
            } catch (err: any) {
              const message =
                typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection creator';
              throw new CollectionCreatorError(message);
            }
            break;
          case CreationFlow.CollectionMetadata:
            try {
              const collectionMetadata = await this.collectionMetadataProvider.getCollectionMetadata(
                this.contract.address
              );
              const slug = getSearchFriendlyString(collectionMetadata.links.slug ?? '');
              if (!slug) {
                throw new Error('Failed to find collection slug');
              }
              const collectionMetadataCollection: CollectionMetadataType = {
                ...(collection as CollectionCreatorType),
                metadata: collectionMetadata,
                slug: slug,
                state: {
                  ...collection.state,
                  create: {
                    step: CreationFlow.CollectionMints // update step
                  }
                }
              };
              collection = collectionMetadataCollection; // update collection
              yield { collection };
            } catch (err: any) {
              const message =
                typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection metadata';
              throw new CollectionMetadataError(message);
            }
            break;

          case CreationFlow.CollectionMints:
            try {
              let resumeFromBlock: number | undefined;
              if (collection.state.create.error?.discriminator === CreationFlow.CollectionMints) {
                resumeFromBlock = collection.state.create.error?.lastSuccessfulBlock;
              }

              const mintEmitter = new Emittery<{ mint: MintToken; progress: { progress: number } }>();

              mintEmitter.on('mint', (mintToken) => {
                void emitter.emit('mint', mintToken);
              });

              mintEmitter.on('progress', ({ progress }) => {
                void emitter.emit('progress', { progress, step });
              });

              const { failed, gotAllBlocks, lastSuccessfulBlock } = await this.getMints(
                mintEmitter,
                resumeFromBlock ?? collection.deployedAtBlock
              );

              if (failed > 0) {
                throw new CollectionMintsError(`Failed to get mints for ${failed} tokens`); // get all blocks again
              } else if (!gotAllBlocks) {
                throw new CollectionMintsError(`Failed to get mints for all blocks`, lastSuccessfulBlock);
              }

              const collectionMintsCollection: CollectionMintsType = {
                ...(collection as CollectionMetadataType),
                state: {
                  ...collection.state,
                  create: {
                    step: CreationFlow.TokenMetadata
                  }
                }
              };

              collection = collectionMintsCollection;
              yield { collection }; // update collection
            } catch (err: any) {
              if (err instanceof CollectionMintsError) {
                throw err;
              }
              const message =
                typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection mints';
              throw new CollectionMintsError(message);
            }
            break;

          case CreationFlow.TokenMetadata:
            try {
              const tokens: Array<Partial<Token>> | undefined = yield {
                collection: collection,
                action: 'tokenRequest'
              };
              if (!tokens) {
                throw new CollectionMintsError('Token metadata received undefined tokens');
              }

              const numTokens = tokens.length;
              let progress = 0;

              const tokenPromises: Array<Promise<ImageToken>> = [];

              for (const token of tokens) {
                const nft = new Nft(token as MintToken, this.contract);
                const generator = nft.refreshToken();

                const tokenWithMetadataPromise = new Promise<Token>(async (resolve, reject) => {
                  let tokenWithMetadata = token;
                  try {
                    let prevProgress = 0;
                    for await (const { token: intermediateToken, failed, progress: newProgress } of generator) {
                      progress = progress - prevProgress + newProgress;
                      prevProgress = newProgress

                      void emitter.emit('progress', {
                        step: step,
                        progress: Math.floor((progress / numTokens) * 100 * 100) / 100
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

                    progress = progress - prevProgress + 1;
                    void emitter.emit('progress', {
                      step: step,
                      progress: Math.floor((progress / numTokens) * 100 * 100) / 100
                    });
                    void emitter.emit('token', tokenWithMetadata as Token);
                    resolve(tokenWithMetadata as Token);
                  } catch (err) {
                    console.error(err);
                    resolve(tokenWithMetadata as Token)
                  }
                });

                tokenPromises.push(tokenWithMetadataPromise);
              }

              await Promise.all(tokenPromises);

              const collectionMetadataCollection: CollectionTokenMetadataType = {
                ...(collection as CollectionMintsType),
                numNfts: numTokens,
                state: {
                  ...collection.state,
                  create: {
                    step: CreationFlow.AggregateMetadata // update step
                  }
                }
              };
              collection = collectionMetadataCollection; // update collection
              yield { collection };

            } catch (err: any) {
              // if any token fails we should throw an error
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get all tokens';
              throw new CollectionTokenMetadataError(message);
            }
            break;

          case CreationFlow.AggregateMetadata:
            try {
              let tokens: Token[] = allTokens;
              if (tokens.length === 0) {
                const injectedTokens = yield { collection: collection, action: 'tokenRequest' };
                if (!injectedTokens) {
                  throw new CollectionAggregateMetadataError('Client failed to inject tokens');
                }
                tokens = injectedTokens as Token[];
              }

              const expectedNumNfts = (collection as CollectionTokenMetadataType).numNfts;
              const numNfts = tokens.length;
              const invalidTokens = tokens.filter((item) => item.state?.metadata.error !== undefined || item.state?.metadata.step !== RefreshTokenFlow.Complete);
              

              if (expectedNumNfts !== numNfts || invalidTokens.length > 0) {
                throw new CollectionTokenMetadataError(
                  `Recevied invalid tokens. Expected: ${expectedNumNfts} Received: ${numNfts}. Invalid tokens: ${invalidTokens.length}`
                ); 
              }

              const attributes = this.contract.aggregateTraits(tokens) ?? {};
              const tokensWithRarity = this.contract.calculateRarity(tokens, attributes);
              for (const token of tokensWithRarity) {
                void emitter.emit('token', token).catch((err) => {
                  console.log('error while emitting token');
                  console.error(err);
                  // safely ignore
                });
              }

              const aggregatedCollection: CollectionType = {
                ...(collection as CollectionTokenMetadataType),
                attributes,
                numTraitTypes: Object.keys(attributes).length,
                state: {
                  ...collection.state,
                  create: {
                    step: CreationFlow.Complete
                  }
                }
              };

              collection = aggregatedCollection;

              yield { collection };
            } catch (err: any) {
              if (err instanceof CollectionTokenMetadataError) {
                throw err;
              }
              const message =
                typeof err?.message === 'string' ? (err.message as string) : 'Failed to aggregate metadata';
              throw new CollectionAggregateMetadataError(message);
            }
            break;
          case CreationFlow.Complete:
            return;
        }
        void emitter.emit('progress', { step, progress: 100 });
      }
    } catch (err: CreationFlowError | any) {
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
      }
      collection = {
        ...collection,
        state: {
          create: {
            step: stepToSave,
            error: error.toJSON()
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
    failed: number;
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
        const promise = new Promise<{ error: any } | { value: number }>((resolve) => {
          item
            .getBlock()
            .then((block) => {
              resolve({ value: block.timestamp * 1000 });
            })
            .catch((err) => {
              resolve({ error: err });
            });
        });
        blockTimestamps.set(item.blockNumber, promise);
        return await promise;
      }
      return await result;
    };

    /**
     * attempts to get a token from a transfer event
     */
    const getTokenFromTransfer = async (event: ethers.Event): Promise<MintToken> => {
      let mintedAt = 0;
      const transfer = this.contract.decodeTransfer(event);
      const isMint = transfer.from === NULL_ADDR;
      if (isMint) {
        const blockTimestampResult = await getBlockTimestampInMS(event); // doesn't throw
        if ('value' in blockTimestampResult) {
          mintedAt = blockTimestampResult.value;
        }
      }

      const tokenId = transfer.tokenId;
      const token = {
        tokenId,
        mintedAt,
        minter: transfer.to.toLowerCase()
      };
      token.minter = transfer.to.toLowerCase();

      return token;
    };

    const mintsStream = await this.contract.getMints({ fromBlock: resumeFromBlock, returnType: 'stream' });

    let tokenPromises: Array<Promise<MintToken>> = [];

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

        tokenPromises = [...tokenPromises, ...chunkPromises];
      }
    } catch (err) {
      console.log('failed to get all mints for a collection');
      console.error(err);
      gotAllBlocks = false; // failed to get all mints
    }

    const results = await Promise.allSettled(tokenPromises);

    const tokens: MintToken[] = [];
    let unknownErrors = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && !('error' in result.value)) {
        tokens.push(result.value);
      } else {
        unknownErrors += 1; 

        if(result.status === 'fulfilled' && ('error' in result.value)) {
          console.log((result.value as any).error)
        }
        console.error('unknown error occurred while getting token');
        console.log(result)
        if (result.status === 'rejected') {
          console.error(result.reason);
        }
      }
    }

    return {
      tokens,
      failed: unknownErrors,
      gotAllBlocks,
      startBlock: startBlock,
      lastSuccessfulBlock
    };
  }
}
