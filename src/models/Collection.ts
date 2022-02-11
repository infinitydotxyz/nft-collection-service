/* eslint-disable @typescript-eslint/consistent-type-assertions */
import Contract from './contracts/Contract.interface';
import MetadataClient from '../services/Metadata';
import { ethers } from 'ethers';
import { Token, TokenMetadata } from '../types/Token.interface';
import { Readable } from 'stream';
import { CollectionMetadataProvider } from '../types/CollectionMetadataProvider.interface';
import { firebase } from '../container';
import crypto from 'crypto';
import { Collection as CollectionType } from '../types/Collection.interface';
import { Optional } from '../types/Utility';
import PQueue from 'p-queue';
import Emittery from 'emittery';
import { NULL_ADDR } from '../constants';
import { getSearchFriendlyString } from 'utils';
import {
  CollectionAggregateMetadataError,
  CollectionCreatorError,
  CollectionMetadataError,
  CollectionTokenMetadataError,
  CollectionTokenMetadataErrorType,
  CreationFlowError,
  TokenMetadataError,
  UnknownError
} from './errors/CreationFlowError';

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
   * get tokens for the collection
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

  // async createCollection(collection?: Partial<CollectionType>) {
  //   if (!collection) {
  //     // default collection state
  //     collection = {
  //       state: {
  //         create: {
  //           step: CreationFlow.CollectionCreator,
  //           errors: []
  //         }
  //       }
  //     };
  //   }

  //   // try {
  //   //   await this.createCollectionFlow(collection);
  //   // }
  // }

  async *createCollectionFlow(initialCollection: Partial<CollectionType>, tokenEmitter: Emittery<{'token': Token}>, hasBlueCheck?: boolean): AsyncGenerator<Partial<CollectionType>> {
    const step = initialCollection?.state?.create?.step ?? CreationFlow.CollectionCreator;
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
    type CollectionTokenMetadataType = CollectionMetadataType & Pick<CollectionType, 'numNfts'>;
    let collection: CollectionCreatorType | CollectionMetadataType | CollectionTokenMetadataType | CollectionType =
      initialCollection as any;

    try {
      while (true) {
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
              yield collection;
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
                    step: CreationFlow.TokenMetadata // update step
                  }
                }
              };
              collection = collectionMetadataCollection; // update collection
              yield collection;
            } catch (err: any) {
              const message =
                typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection metadata';
              throw new CollectionMetadataError(message);
            }
            break;

          case CreationFlow.TokenMetadata:
            try {
              // we would like to pass control to another flow for each token
              // update any failed tokens if there were errors. Otherwise create all tokens
              const error = collection.state?.create?.error as unknown as CollectionTokenMetadataErrorType | undefined;
              const numNfts = 10000; // TODO

              switch (error?.type) {
                case TokenMetadataError.KnownTokenErrors: // update tokens with errors
                // todo

                // eslint-disable-next-line no-fallthrough
                case TokenMetadataError.UnknownTokenErrors: // update all tokens
                default:
                // todo
              }
              const tokenMetadataCollection: CollectionTokenMetadataType = {
                ...(collection as CollectionMetadataType),
                numNfts: numNfts,
                state: {
                  ...collection.state,
                  create: {
                    step: CreationFlow.AggregateMetadata // update step
                  }
                }
              };
              collection = tokenMetadataCollection; // update collection
              // TODO throw specific type errors

              yield collection;
            } catch (err: any) {
              if (err instanceof CollectionTokenMetadataError) {
                throw err;
              } else {
                const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get tokens';
                throw new CollectionTokenMetadataError(TokenMetadataError.UnknownTokenErrors, message);
              }
            }
            break;

          case CreationFlow.AggregateMetadata:
            // TODO get tokens
            try {
              const tokens: Token[] = [];
              const attributes = this.contract.aggregateTraits(tokens) ?? {};
              const tokensWithRarity = this.contract.calculateRarity(tokens, attributes); // TODO update tokens
              const aggregatedCollection: CollectionType = {
                ...(collection as CollectionTokenMetadataType),
                attributes,
                numTraitTypes: 2, // TODO
                state: {
                  ...collection.state,
                  create: {
                    step: CreationFlow.Complete
                  }
                }
              };
              collection = aggregatedCollection;

              yield collection;
            } catch (err: any) {
              const message =
                typeof err?.message === 'string' ? (err.message as string) : 'Failed to aggregate metadata';
              throw new CollectionAggregateMetadataError(message);
            }
            break;
          case CreationFlow.Complete:
            return;
        }
      }
    } catch (err: CreationFlowError | any) {
      let error;
      if (err instanceof CreationFlowError) {
        error = err;
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
            step: step,
            error
          }
        }
      };
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

  private async getTokenMetadata(tokenId: string): Promise<{ metadata: TokenMetadata; tokenUri: string }> {
    const tokenUri = await this.contract.getTokenUri(tokenId);
    const response = await this.tokenMetadataClient.get(tokenUri);
    const metadata = JSON.parse(response.body as string) as TokenMetadata;
    return {
      metadata,
      tokenUri
    };
  }

  async uploadTokenImage(imageUrl: string): Promise<{ url: string; contentType: string; updatedAt: number }> {
    if (!imageUrl) {
      throw new Error('invalid image url');
    }

    const imageResponse = await this.tokenMetadataClient.get(imageUrl);
    const contentType = imageResponse.headers['content-type'];
    const imageBuffer = imageResponse.rawBody;
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const path = `collections/${this.contract.chainId}:${this.contract.address}/${hash}`;
    let publicUrl;

    if (imageBuffer && contentType) {
      const remoteFile = await firebase.uploadBuffer(imageBuffer, path, contentType);
      publicUrl = remoteFile.publicUrl();
    } else if (!imageBuffer) {
      throw new Error(`Failed to get image for collection: ${this.contract.address} imageUrl: ${imageUrl}`);
    } else if (!contentType) {
      throw new Error(
        `Failed to get content type for image. Collection: ${this.contract.address} imageUrl: ${imageUrl}`
      );
    } else if (!publicUrl) {
      throw new Error(`Failed to get image public url for collection: ${this.contract.address} imageUrl: ${imageUrl}`);
    }

    const now = Date.now();
    return {
      url: publicUrl,
      contentType,
      updatedAt: now
    };
  }

  async getToken(tokenId: string, mintedAt?: number): Promise<Optional<Token, 'mintedAt' | 'owner'>> {
    const { metadata, tokenUri } = await this.getTokenMetadata(tokenId);

    const { url, contentType, updatedAt } = await this.uploadTokenImage(metadata.image);
    const mintedAtProperty = typeof mintedAt === 'number' ? { mintedAt } : {};

    const token: Optional<Token, 'mintedAt' | 'owner'> = {
      tokenId,
      ...mintedAtProperty,
      metadata,
      numTraitTypes: metadata.attributes.length,
      updatedAt,
      tokenUri,
      image: {
        url,
        contentType,
        updatedAt
      }
    };
    return token;
  }

  async getTokensFromMints(
    fromBlock?: number,
    toBlock?: number,
    emitter?: Emittery<{ token: Token }>
  ): Promise<{
    tokens: Token[];
    numTokens: number;
    tokensWithErrors: Array<{ error: any; tokenId: string }>;
    unknownErrors: number;
  }> {
    let tokenPromises: Array<Promise<Token | { error: any; event: ethers.Event }>> = [];
    const mintsStream = (await this.contract.getMints({
      fromBlock,
      toBlock,
      returnType: 'stream'
    })) as Readable;

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
    const getTokenFromTransfer = async (event: ethers.Event): Promise<Optional<Token, 'mintedAt'>> => {
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
      const token: Optional<Token, 'mintedAt' | 'owner'> = await this.getToken(tokenId, mintedAt);
      token.owner = transfer.to.toLowerCase();
      return token as Optional<Token, 'mintedAt'>;
    };

    const queue = new PQueue({
      concurrency: Infinity // requests will be limited in the client
    });

    const enqueue = async (
      event: ethers.Event,
      attempts = 0
    ): Promise<Optional<Token, 'mintedAt'> | { error: any; event: ethers.Event }> => {
      attempts += 1;
      try {
        const token = await new Promise<Optional<Token, 'mintedAt'>>(
          async (resolve, reject) =>
            await queue.add(() => {
              getTokenFromTransfer(event)
                .then((token) => {
                  resolve(token as Token);
                })
                .catch((err) => {
                  reject(err);
                });
            })
        );
        if (emitter) {
          emitter.emit('token', token as Token).catch(() => {
            // safe to ignore
          });
        }
        return token;
      } catch (err) {
        if (attempts > 3) {
          return { error: err, event };
        }
        return await enqueue(event, attempts);
      }
    };

    /**
     * as we receive mints (transfer events) get the token's metadata
     */
    for await (const chunk of mintsStream) {
      const mintEvents: ethers.Event[] = chunk;

      const chunkPromises = mintEvents.map(async (event) => {
        const token = await enqueue(event);

        return token as Token;
      });
      tokenPromises = [...tokenPromises, ...chunkPromises];
    }

    const results = await Promise.allSettled(tokenPromises);

    const tokens: Token[] = [];
    const failed: Array<{ error: any; tokenId: string }> = [];
    let unknownErrors = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && !('error' in result.value)) {
        tokens.push(result.value);
      } else if (result.status === 'fulfilled' && 'event' in result.value) {
        const { tokenId } = this.contract.decodeTransfer(result.value.event);
        failed.push({ error: result.value.error, tokenId });
      } else {
        unknownErrors += 1;
        console.error('unknown error occurred while getting token');
        if (result.status === 'rejected') {
          console.error(result.reason);
        }
      }
    }

    console.log(`Failed to get token metadata for: ${failed.length + unknownErrors} tokens`);
    console.log(`Successfully got token metadata for: ${tokens.length} tokens`);

    const totalNumTokens = tokens.length + failed.length + unknownErrors;

    return { tokens, numTokens: totalNumTokens, tokensWithErrors: failed, unknownErrors };
  }

  // /**
  //  * getInitialData gets all necessary data to create the collection + nfts
  //  *
  //  * Note token rarity cannot be calculate until we have metadata for every token. Therefore
  //  * the emitter will not emit tokens with rarityScore/rarityRankings. This data is added
  //  * to tokens returned in the promise
  //  */
  // getInitialData(hasBlueCheck = false): {
  //   emitter: Emittery<{ token: Token }>;
  //   promise: Promise<{
  //     collection: CollectionType;
  //     tokens: Token[];
  //     tokensWithErrors: Array<{ error: any; tokenId: string }>;
  //     error?: any;
  //   }>;
  // } {
  //   const emitter: Emittery<{ token: Token }> = new Emittery();
  //   const promise = new Promise<{
  //     collection: CollectionType;
  //     tokens: Token[];
  //     tokensWithErrors: Array<{ error: any; tokenId: string }>;
  //   }>(async (resolve, reject) => {
  //     let deployer: {
  //       createdAt: number;
  //       address: string;
  //       block: number;
  //     };

  //     let collection: Partial<CollectionType>;
  //     let tokens: Token[] = [];

  //     try {
  //       const collectionMetadata = await this.collectionMetadataProvider.getCollectionMetadata(this.contract.address);

  //       const slug = getSearchFriendlyString(collectionMetadata.links.slug ?? '');
  //       if (!slug) {
  //         throw new Error('Failed to find collection slug');
  //       }

  //       const {
  //         tokens: mints,
  //         numTokens,
  //         tokensWithErrors
  //       } = await this.getTokensFromMints(deployer.block, undefined, emitter);
  //       tokens = mints;

  //       const attributes = this.contract.aggregateTraits(tokens) ?? {};

  //       const collection: CollectionType = {
  //         slug: slug,
  //         hasBlueCheck: hasBlueCheck,
  //         chainId: this.contract.chainId,
  //         address: this.contract.address.toLowerCase(),
  //         tokenStandard: this.contract.standard,
  //         deployer: deployer.address.toLowerCase(),
  //         deployedAt: deployer.createdAt,
  //         owner: owner.toLowerCase(),
  //         metadata: collectionMetadata,
  //         numNfts: numTokens, // note - this may not be the current number of nfts
  //         attributes: attributes,
  //         numTraitTypes: Object.keys(attributes).length
  //       };

  //       const tokensWithRarity = this.contract.calculateRarity(tokens, attributes);

  //       resolve({ collection, tokens: tokensWithRarity, tokensWithErrors });
  //     } catch (err) {
  //       reject(err);
  //     }
  //   });

  //   return { promise, emitter };
  // }
}
