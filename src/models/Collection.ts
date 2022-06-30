/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import {
  BaseCollection,
  ChainId,
  Collection as CollectionType,
  CollectionStats,
  CreationFlow,
  Erc721Metadata,
  Erc721Token,
  ImageData,
  ImageToken,
  MintToken,
  RefreshTokenFlow,
  Token,
  TokenStandard
} from '@infinityxyz/lib/types/core';
import { firestoreConstants, getCollectionDocId, getSearchFriendlyString, normalizeAddress } from '@infinityxyz/lib/utils';
import Emittery from 'emittery';
import { Readable, Transform } from 'stream';
import { filterStream, pageStream } from 'utils/streams';
import { COLLECTION_MAX_SUPPLY, COLLECTION_SCHEMA_VERSION } from '../constants';
import { firebase, logger, opensea, reservoir, zora } from '../container';
import BatchHandler from './BatchHandler';
import AbstractCollection, { CollectionEmitterType } from './Collection.abstract';
import {
  CollectionAggregateMetadataError,
  CollectionCacheImageError,
  CollectionCreatorError,
  CollectionImageValidationError,
  CollectionIndexingError,
  CollectionMetadataError,
  CollectionMintsError,
  CollectionTokenMetadataError,
  CollectionTotalSupplyExceededError,
  CreationFlowError,
  UnknownError
} from './errors/CreationFlow';
import { RefreshTokenImageError, RefreshTokenMetadataError, RefreshTokenMintError } from './errors/RefreshTokenFlow';
import Nft from './Nft';

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

export default class Collection extends AbstractCollection {
  /**
   * createCollection defines a flow to get the initial data for a collection
   *
   * each step in the flow has a structure like
   * 1. (optional) request tokens from the client
   * 2. perform some validation and/or add some data to the collection
   * 3. update the collection object, set the next step, and yield the collection
   */
  async *createCollection(
    initialCollection: Partial<CollectionType>,
    emitter: Emittery<CollectionEmitterType>,
    indexInitiator: string,
    batch: BatchHandler,
    hasBlueCheck?: boolean
  ): AsyncGenerator<
    { collection: Partial<CollectionType>; action?: 'tokenRequest' },
    any,
    AsyncIterable<Partial<Token>> | undefined
  > {
    let collection: CollectionCreatorType | CollectionMetadataType | CollectionTokenMetadataType | CollectionType =
      initialCollection as any;
    let step: CreationFlow = collection?.state?.create?.step || CreationFlow.CollectionCreator;

    try {
      while (true) {
        step = collection?.state?.create?.step || CreationFlow.CollectionCreator;
        switch (step) {
          case CreationFlow.CollectionCreator: // resets the collection
            try {
              collection = await this.getInitialCollection(
                collection,
                indexInitiator,
                hasBlueCheck ?? false,
                CreationFlow.CollectionMetadata
              );
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to get collection creator', err);
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection creator';
              throw new CollectionCreatorError(message);
            }
            break;

          case CreationFlow.CollectionMetadata:
            try {
              collection = await this.getCollectionMetadata(collection, CreationFlow.TokenMetadata);

              // fetch all time aggregated stats
              const stats = await zora.getAggregatedCollectionStats(collection.chainId, collection.address, 10);
              if (stats) {
                const data: Partial<CollectionStats> = {
                  chainId: collection.chainId as ChainId,
                  collectionAddress: collection.address,
                  volume: stats.aggregateStat?.salesVolume?.chainTokenPrice,
                  numSales: stats.aggregateStat?.salesVolume?.totalCount,
                  volumeUSDC: stats.aggregateStat?.salesVolume?.usdcPrice,
                  numOwners: stats.aggregateStat?.ownerCount,
                  numNfts: stats.aggregateStat?.nftCount,
                  topOwnersByOwnedNftsCount: stats.aggregateStat?.ownersByCount?.nodes,
                  updatedAt: Date.now()
                };
                const collectionDocId = getCollectionDocId({
                  chainId: collection.chainId,
                  collectionAddress: collection.address
                });
                const allTimeCollStatsDocRef = firebase.db
                  .collection(firestoreConstants.COLLECTIONS_COLL)
                  .doc(collectionDocId)
                  .collection(firestoreConstants.COLLECTION_STATS_COLL)
                  .doc('all');
                batch.add(allTimeCollStatsDocRef, data, { merge: true });
              }

              yield { collection };
            } catch (err: any) {
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection metadata';
              throw new CollectionMetadataError(message);
            }
            break;

          case CreationFlow.TokenMetadata:
            try {
              let totalSupply = 1;
              const data = await zora.getAggregatedCollectionStats(collection.chainId, collection.address, 1);
              if (data) {
                totalSupply = data.aggregateStat?.nftCount;
              } else {
                // fetch from reservoir
                const data = await reservoir.getSingleCollectionInfo(collection.chainId, collection.address);
                totalSupply = parseInt(String(data?.collection.tokenCount));
              }
              collection = await this.getCollectionTokenMetadataFromReservoir(
                totalSupply,
                collection as CollectionMetadataType,
                emitter,
                CreationFlow.TokenMetadataOS
              );
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to get collection tokens', err);
              // if any token fails we should throw an error
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get all tokens';
              throw new CollectionTokenMetadataError(message);
            }
            break;

          case CreationFlow.TokenMetadataOS:
            try {
              console.log('Yielding tokens at step:', step);
              const injectedTokens = yield { collection: collection, action: 'tokenRequest' };
              if (!injectedTokens) {
                throw new CollectionTokenMetadataError('Client failed to inject tokens');
              }

              collection = await this.getCollectionTokenMetadataFromOS(
                injectedTokens,
                collection as CollectionTokenMetadataType,
                emitter,
                CreationFlow.AggregateMetadata
              );

              yield { collection };
            } catch (err: any) {
              logger.error('Failed to get token metadata from OS', err);
              // if any token fails we should throw an error
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get all tokens';
              throw new CollectionTokenMetadataError(message);
            }
            break;

          case CreationFlow.AggregateMetadata:
            try {
              const numNfts = (collection as CollectionTokenMetadataType).numNfts;
              if (numNfts > COLLECTION_MAX_SUPPLY) {
                console.log('Collection has too many tokens to aggregate metadata', collection.address);
                collection = {
                  ...collection,
                  numTraitTypes: 0,
                  numOwnersUpdatedAt: 0,
                  state: {
                    ...collection.state,
                    create: {
                      progress: 0,
                      step: CreationFlow.CacheImage,
                      updatedAt: Date.now()
                    }
                  }
                };
              } else {
                const tokens: Token[] = [];
                console.log('Yielding tokens at step:', step);
                const injectedTokens = yield { collection: collection, action: 'tokenRequest' };
                if (!injectedTokens) {
                  throw new CollectionAggregateMetadataError('Client failed to inject tokens');
                }
                for await (const token of injectedTokens) {
                  tokens.push(token as Token);
                }

                collection = this.getCollectionAggregatedMetadata(
                  tokens,
                  collection as CollectionTokenMetadataType,
                  emitter,
                  CreationFlow.CacheImage
                );
              }

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
              console.log('Yielding tokens at step:', step);
              const injectedTokens = yield { collection: collection, action: 'tokenRequest' };
              if (!injectedTokens) {
                throw new CollectionCacheImageError('Client failed to inject tokens');
              }

              collection = await this.getCollectionCachedImages(
                injectedTokens,
                collection as CollectionType,
                emitter,
                CreationFlow.CollectionMints // skipping validate image
              );
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to cache images', err);
              // if any token fails we should throw an error
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get all tokens';
              throw new CollectionCacheImageError(message);
            }
            break;

          case CreationFlow.CollectionMints:
            try {
              let totalSupply = 1;
              const data = await zora.getAggregatedCollectionStats(collection.chainId, collection.address, 1);
              if (data) {
                totalSupply = data.aggregateStat?.nftCount;
              } else {
                // fetch from reservoir
                const data = await reservoir.getSingleCollectionInfo(collection.chainId, collection.address);
                totalSupply = parseInt(String(data?.collection.tokenCount));
              }

              // if (totalSupply > COLLECTION_MAX_SUPPLY) {
              //   throw new CollectionTotalSupplyExceededError(
              //     `Collection total supply is ${totalSupply}. Max supply to index is ${COLLECTION_MAX_SUPPLY}`
              //   );
              // }

              collection = await this.getCollectionMintsFromZora(
                totalSupply,
                collection as CollectionMetadataType,
                emitter,
                CreationFlow.Complete // skipping token metadata uri step
              );

              yield { collection }; // update collection
            } catch (err: any) {
              logger.error('Failed to get collection mints', err);
              if (err instanceof CollectionTotalSupplyExceededError) {
                throw err;
              }
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection mints';
              throw new CollectionMintsError(message);
            }
            break;

          case CreationFlow.Complete:
            /**
             * validate tokens
             */
            await batch.flush();
            console.log('Yielding tokens at step:', step);
            const finalTokens: AsyncIterable<Partial<Token>> | undefined = yield {
              collection: collection,
              action: 'tokenRequest'
            };
            if (!finalTokens) {
              throw new CollectionTokenMetadataError('Token metadata received undefined tokens');
            }

            const transformToTokensWithErrors = new Transform({
              transform(token: Token, encoding: string, callback) {
                try {
                  Nft.validateToken(token, RefreshTokenFlow.Complete);
                } catch (err) {
                  console.log(token, err);
                  this.push({ token, err });
                }
                callback();
              },
              objectMode: true
            });

            const invalidTokensReadable = Readable.from(finalTokens, { objectMode: true }).pipe(transformToTokensWithErrors);

            const invalidTokens: { token: Token; err: Error }[] = [];
            for await (const invalidToken of invalidTokensReadable) {
              invalidTokens.push(invalidToken as { token: Token; err: Error });
            }

            if (invalidTokens.length > 0) {
              logger.error('Final invalid tokens', JSON.stringify(invalidTokens.map((token) => token.token.tokenId)));
              if (invalidTokens[0].err instanceof RefreshTokenMintError) {
                throw new CollectionMintsError(`Received ${invalidTokens.length} invalid tokens`);
              } else if (invalidTokens[0].err instanceof RefreshTokenMetadataError) {
                throw new CollectionTokenMetadataError(`Received ${invalidTokens.length} invalid tokens`);
              } else if (invalidTokens[0].err instanceof RefreshTokenImageError) {
                throw new CollectionImageValidationError(`Received ${invalidTokens.length} invalid tokens`);
              } else {
                throw new CollectionIndexingError(`Received ${invalidTokens.length} invalid tokens`);
              }
            }
            void emitter.emit('progress', { step, progress: 100 });
            return;

          // todo: needs impl
          case CreationFlow.Incomplete:
          case CreationFlow.Unknown:
          case CreationFlow.Invalid:
          default:
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

  private async getInitialCollection(
    collection: Partial<CollectionType>,
    indexInitiator: string,
    hasBlueCheck: boolean,
    nextStep: CreationFlow
  ): Promise<CollectionCreatorType> {
    let creator = {
      deployedAt: Number.NaN,
      deployer: '',
      owner: '',
      deployedAtBlock: Number.NaN
    };
    try {
      creator = await this.getCreator();
    } catch (err) {
      console.error(`Failed to get creator`, err);
    }
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

  private async getCollectionMetadata(
    collection: CollectionCreatorType,
    nextStep: CreationFlow
  ): Promise<CollectionMetadataType> {
    const { hasBlueCheck, ...collectionMetadata } = await this.collectionMetadataProvider.getCollectionMetadata(
      this.contract.address
    );

    const slug = getSearchFriendlyString(collectionMetadata.links.slug ?? '');
    if (!slug) {
      throw new Error('Failed to find collection slug');
    }

    const collectionMetadataCollection: CollectionMetadataType = {
      ...collection,
      hasBlueCheck: (hasBlueCheck || collection.hasBlueCheck) ?? false,
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

  private async getCollectionMintsFromZora(
    totalSupply: number,
    collection: CollectionMetadataType,
    emitter: Emittery<CollectionEmitterType>,
    nextStep: CreationFlow
  ): Promise<CollectionMintsType> {
    // fetch saved cursor
    const collectionDocId = getCollectionDocId({ chainId: collection.chainId, collectionAddress: collection.address });
    const data = (
      await firebase.db.collection(firestoreConstants.COLLECTIONS_COLL).doc(collectionDocId).get()
    ).data() as BaseCollection;
    let after = data?.state?.create?.zoraCursor ?? '';

    const zoraLimit = 500;
    let hasNextPage = true;
    let numPages = 0;
    while (hasNextPage) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const response = await zora.getTokenMintInfo(this.contract.chainId, this.contract.address, after, zoraLimit);
      after = response?.tokens?.pageInfo?.endCursor ?? '';
      hasNextPage = response?.tokens?.pageInfo?.hasNextPage ?? false;

      const tokens = response?.tokens?.nodes ?? [];
      for (const mintToken of tokens) {
        if (mintToken.token && mintToken.token.tokenId && mintToken.token.mintInfo && mintToken.token.mintInfo.mintContext) {
          const minter = mintToken.token.mintInfo.originatorAddress;
          const blockTimestamp = mintToken.token.mintInfo.mintContext.blockTimestamp;
          const mintedAt = blockTimestamp ? new Date(blockTimestamp).getTime() : 0;
          const txHash = mintToken.token.mintInfo.mintContext.transactionHash;
          const mintPrice = mintToken.token.mintInfo.price.chainTokenPrice.decimal;
          const mintCurrencyAddress = mintToken.token.mintInfo.price.chainTokenPrice.currency.address;
          const mintCurrencyDecimals = mintToken.token.mintInfo.price.chainTokenPrice.currency.decimals;
          const mintCurrencyName = mintToken.token.mintInfo.price.chainTokenPrice.currency.name;

          const token: MintToken = {
            chainId: this.contract.chainId,
            tokenId: mintToken.token.tokenId,
            tokenUri: mintToken.token.tokenUrl,
            mintedAt,
            minter: normalizeAddress(minter),
            mintTxHash: txHash,
            mintPrice,
            mintCurrencyAddress,
            mintCurrencyDecimals,
            mintCurrencyName
          };

          if (mintToken?.token?.image?.url && token.image) {
            token.image.originalUrl = mintToken?.token?.image?.url;
            token.image.updatedAt = Date.now();
          }

          void emitter.emit('mint', token);
        }
      }

      ++numPages;
      
      void emitter.emit('progress', {
        step: CreationFlow.CollectionMints,
        progress: Math.floor(((numPages * zoraLimit) / totalSupply) * 100 * 100) / 100,
        zoraCursor: after,
        message: after
      });
    }

    const collectionMintsCollection: CollectionMintsType = {
      ...collection,
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

  private async getCollectionTokenMetadataFromReservoir(
    totalSupply: number,
    collection: CollectionMintsType,
    emitter: Emittery<CollectionEmitterType>,
    nextStep: CreationFlow
  ): Promise<CollectionTokenMetadataType> {
    // fetch saved cursor
    const collectionDocId = getCollectionDocId({ chainId: collection.chainId, collectionAddress: collection.address });
    const data = (
      await firebase.db.collection(firestoreConstants.COLLECTIONS_COLL).doc(collectionDocId).get()
    ).data() as BaseCollection;
    let continuation = data?.state?.create?.reservoirCursor ?? '';

    const reservoirLimit = 50;
    let hasNextPage = true;
    let numNfts = 0;
    let numPages = 0;
    while (hasNextPage) {
      const data = await reservoir.getDetailedTokensInfo(
        this.contract.chainId,
        this.contract.address,
        continuation,
        reservoirLimit
      );
      if (data?.continuation) {
        continuation = data.continuation;
      } else {
        hasNextPage = false;
      }
      const tokens = data?.tokens ?? [];
      numNfts += tokens.length;
      for (const reservoirToken of tokens) {
        const token = reservoirToken.token;
        const tokenId = token.tokenId;
        if (tokenId) {
          const name = token.name;
          const metadata: Erc721Metadata = {
            attributes: [],
            name,
            title: name,
            image: token.image,
            image_data: '',
            description: token.description,
            external_url: '',
            background_color: '',
            youtube_url: '',
            animation_url: ''
          };

          for (const attr of token.attributes) {
            metadata.attributes.push({
              trait_type: attr.key,
              value: attr.value
            });
          }

          const tokenWithMetadata: Erc721Token = {
            slug: getSearchFriendlyString(name),
            tokenId,
            chainId: this.contract.chainId,
            numTraitTypes: token.attributes.length ?? 0,
            metadata,
            updatedAt: Date.now(),
            owner: token.owner,
            image: {
              url: token.image,
              updatedAt: Date.now()
            },
            tokenStandard: TokenStandard.ERC721 // default
          };
          void emitter.emit('token', tokenWithMetadata);
        }
      }

      ++numPages;
      void emitter.emit('progress', {
        step: CreationFlow.TokenMetadata,
        progress: Math.floor(((numPages * reservoirLimit) / totalSupply) * 100 * 100) / 100,
        reservoirCursor: continuation,
        message: continuation
      });
    }

    const collectionTokenMetadataCollection: CollectionTokenMetadataType = {
      ...collection,
      numNfts,
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep,
          updatedAt: Date.now()
        }
      }
    };

    return collectionTokenMetadataCollection;
  }

  private getCollectionAggregatedMetadata(
    tokens: Token[],
    collection: CollectionTokenMetadataType,
    emitter: Emittery<CollectionEmitterType>,
    nextStep: CreationFlow
  ): CollectionType {
    const attributes = this.contract.aggregateTraits(tokens) ?? {};
    const tokensWithRarity = this.contract.calculateRarity(tokens, attributes);
    for (const token of tokensWithRarity) {
      void emitter.emit('token', token).catch((err) => {
        logger.log('error while emitting token');
        logger.error(err);
        // safely ignore
      });
    }
    void emitter.emit('attributes', attributes);

    const aggregatedCollection: CollectionType = {
      ...collection,
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

  private async getCollectionCachedImages(
    tokens: AsyncIterable<Partial<Token>>,
    collection: CollectionType,
    emitter: Emittery<CollectionEmitterType>,
    nextStep: CreationFlow
  ): Promise<CollectionTokenMetadataType> {
    const noImage = (token: Token) => {
      return !token?.image?.url;
    };
    const openseaTokenIdsLimit = 20;

    const imageLessTokenPages = Readable.from(tokens, { objectMode: true })
      .pipe(filterStream(noImage))
      .pipe(pageStream(openseaTokenIdsLimit));

    // fetch tokens that don't have images
    const updateImageViaOpenseaTokenIds = async (tokens: Token[]) => {
      let tokenIdsConcat = '';
      for (const token of tokens) {
        tokenIdsConcat += `token_ids=${token.tokenId}&`;
      }

      const tokensMap: { [key: string]: Token } = tokens.reduce((acc, item) => {
        if (item?.tokenId) {
          return {
            ...acc,
            [item.tokenId]: item
          };
        }
        return acc;
      }, {});

      const data = await opensea.getTokenIdsOfContract(this.contract.address, tokenIdsConcat);
      for (const datum of data.assets) {
        const token = tokensMap[datum?.token_id];
        const metadata = token?.metadata;
        const imageToken: ImageData & Partial<Token> = {
          tokenId: datum.token_id,
          image: { url: datum.image_url, originalUrl: datum.image_original_url ?? metadata?.image, updatedAt: Date.now() }
        } as ImageToken;
        void emitter.emit('image', imageToken);
      }
    };

    let tokensUpdated = 0;
    for await (const tokens of imageLessTokenPages) {
      await updateImageViaOpenseaTokenIds(tokens as Token[]);
      tokensUpdated += tokens.length;
      void emitter.emit('progress', {
        step: CreationFlow.TokenMetadataOS,
        progress: Math.floor((tokensUpdated / collection.numNfts) * 100 * 100) / 100
      });
    }

    void emitter.emit('progress', {
      step: CreationFlow.TokenMetadataOS,
      progress: 100
    });

    // const updateImageViaOpenseaContract = async () => {
    //   let hasNext = true;
    //   let cursor = '';

    //   const data = await opensea.getNFTsOfContract(this.contract.address, openseaLimit, cursor);
    //   // update cursor
    //   hasNext = data.assets.length > 0;
    //   cursor = data.next;
    //   for (const datum of data.assets) {
    //     const token = tokensMap[datum?.token_id];
    //     const metadata = token?.metadata;
    //     const imageToken: ImageData & Partial<Token> = {
    //       tokenId: datum.token_id,
    //       image: { url: datum.image_url, originalUrl: datum.image_original_url ?? metadata?.image, updatedAt: Date.now() }
    //     } as ImageToken;
    //     void emitter.emit('image', imageToken);
    //   }
    //   void emitter.emit('progress', {
    //     step: CreationFlow.CacheImage,
    //     progress: Math.floor(((i * openseaLimit) / numTokens) * 100 * 100) / 100
    //   });
    // };

    // const numImagelessTokens = imageLessTokens.length;
    // const numTokens = tokens.length;
    // const percentFailed = Math.floor((numImagelessTokens / numTokens) * 100);
    // fetch images from OS
    // if (percentFailed < 40) {
    //   const numIters = Math.ceil(numImagelessTokens / openseaTokenIdsLimit);
    //   for (let i = 0; i < numIters; i++) {
    //     const tokenSlice = tokens.slice(i * openseaTokenIdsLimit, (i + 1) * openseaTokenIdsLimit);
    //     let tokenIdsConcat = '';
    //     for (const token of tokenSlice) {
    //       tokenIdsConcat += `token_ids=${token.tokenId}&`;
    //     }
    //     const data = await opensea.getTokenIdsOfContract(this.contract.address, tokenIdsConcat);
    //     for (const datum of data.assets) {
    //       const token = tokensMap[datum?.token_id];
    //       const metadata = token?.metadata;
    //       const imageToken: ImageData & Partial<Token> = {
    //         tokenId: datum.token_id,
    //         image: { url: datum.image_url, originalUrl: datum.image_original_url ?? metadata?.image, updatedAt: Date.now() }
    //       } as ImageToken;
    //       void emitter.emit('image', imageToken);
    //     }
    //     void emitter.emit('progress', {
    //       step: CreationFlow.CacheImage,
    //       progress: Math.floor(((i * openseaTokenIdsLimit) / numImagelessTokens) * 100 * 100) / 100
    //     });
    //   }
    // } else {
    //   const numIters = Math.ceil(numTokens / openseaLimit);
    //   let cursor = '';
    //   for (let i = 0; i < numIters; i++) {
    //     const data = await opensea.getNFTsOfContract(this.contract.address, openseaLimit, cursor);
    //     // update cursor
    //     cursor = data.next;
    //     for (const datum of data.assets) {
    //       const token = tokensMap[datum?.token_id];
    //       const metadata = token?.metadata;
    //       const imageToken: ImageData & Partial<Token> = {
    //         tokenId: datum.token_id,
    //         image: { url: datum.image_url, originalUrl: datum.image_original_url ?? metadata?.image, updatedAt: Date.now() }
    //       } as ImageToken;
    //       void emitter.emit('image', imageToken);
    //     }
    //     void emitter.emit('progress', {
    //       step: CreationFlow.CacheImage,
    //       progress: Math.floor(((i * openseaLimit) / numTokens) * 100 * 100) / 100
    //     });
    //   }
    // }

    const cachedImageCollection: CollectionTokenMetadataType = {
      ...(collection as CollectionTokenMetadataType),
      state: {
        ...collection.state,
        create: {
          progress: 0,
          step: nextStep, // update step
          updatedAt: Date.now()
        }
      }
    };
    return cachedImageCollection;
  }

  private async getCollectionTokenMetadataFromOS(
    tokens: AsyncIterable<Partial<Token>>,
    collection: CollectionTokenMetadataType,
    emitter: Emittery<CollectionEmitterType>,
    nextStep: CreationFlow
  ): Promise<CollectionTokenMetadataType> {
    const hasMetadata = (token: Partial<Token>) => {
      try {
        Nft.validateToken(token, RefreshTokenFlow.Metadata);
        return true;
      } catch (err) {
        return false;
      }
    };
    const openseaLimit = 20;

    const updateTokens = async (tokens: Partial<Token>[]) => {
      let tokenIdsConcat = '';
      for (const token of tokens) {
        tokenIdsConcat += `token_ids=${token.tokenId}&`;
      }
      const data = await opensea.getTokenIdsOfContract(this.contract.address, tokenIdsConcat);
      for (const datum of data.assets) {
        const token: Erc721Token = {
          updatedAt: Date.now(),
          tokenId: datum.token_id,
          slug: getSearchFriendlyString(datum.name),
          numTraitTypes: datum.traits?.length,
          tokenStandard: TokenStandard.ERC721, // default
          metadata: {
            name: datum.name ?? null,
            title: datum.name ?? null,
            image: datum.image_url ?? '',
            image_data: '',
            external_url: datum?.external_link ?? '',
            description: datum.description ?? '',
            attributes: datum.traits,
            background_color: datum.background_color ?? '',
            animation_url: datum?.animation_url ?? '',
            youtube_url: ''
          },
          image: { originalUrl: datum.image_original_url, updatedAt: Date.now() }
        };

        if (datum.image_url && token.image) {
          token.image.url = datum.image_url;
        }

        void emitter.emit('token', token);
      }
    };

    const metadataLessTokenPages = Readable.from(tokens, { objectMode: true })
      .pipe(filterStream(hasMetadata))
      .pipe(pageStream(openseaLimit));

    let tokensUpdated = 0;
    for await (const tokens of metadataLessTokenPages) {
      tokensUpdated += tokens.length;
      await updateTokens(tokens as Partial<Token>[]);
      void emitter.emit('progress', {
        step: CreationFlow.TokenMetadataOS,
        progress: Math.floor((tokensUpdated / collection.numNfts) * 100 * 100) / 100
      });
    }

    void emitter.emit('progress', {
      step: CreationFlow.TokenMetadataOS,
      progress: 100
    });

    const collectionMetadataCollection: CollectionTokenMetadataType = {
      ...collection,
      state: {
        ...collection.state,
        create: {
          updatedAt: Date.now(),
          progress: 100,
          step: nextStep // update step
        }
      }
    };

    return collectionMetadataCollection;
  }
}
