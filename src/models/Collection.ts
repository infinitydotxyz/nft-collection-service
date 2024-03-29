/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import {
  BaseCollection,
  ChainId,
  Collection as CollectionType,
  CollectionMetadata,
  CollectionStats,
  CreationFlow,
  Erc721Metadata,
  Erc721Token,
  ImageData,
  ImageToken,
  RefreshTokenFlow,
  SupportedCollection,
  Token,
  TokenStandard
} from '@infinityxyz/lib/types/core';
import {
  firestoreConstants,
  getCollectionDocId,
  getSearchFriendlyString,
  normalizeAddress,
  trimLowerCase
} from '@infinityxyz/lib/utils';
import Emittery from 'emittery';
import Reservoir from 'services/Reservoir';
import { Readable, Transform } from 'stream';
import { filterStream, pageStream } from 'utils/streams';
import { COLLECTION_MAX_SUPPLY, COLLECTION_SCHEMA_VERSION } from '../constants';
import { firebase, logger, zora } from '../container';
import BatchHandler from './BatchHandler';
import AbstractCollection, { CollectionEmitterType } from './Collection.abstract';
import OpenSeaClient from './CollectionMetadataProvider';
import {
  CollectionAggregateMetadataError,
  CollectionCreatorError,
  CollectionIncompleteError,
  CollectionMetadataError,
  CollectionMintsError,
  CollectionTokenMetadataError,
  CollectionTotalSupplyExceededError,
  CreationFlowError,
  UnknownError
} from './errors/CreationFlow';
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

type CollectionMetadataType = CollectionCreatorType & Pick<CollectionType, 'metadata' | 'slug' | 'searchTags' | 'isSupported'>;
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
    hasBlueCheck: boolean,
    partial: boolean,
    mintData: boolean
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
              collection = await this.getCollectionMetadata(
                collection,
                partial,
                partial ? CreationFlow.Incomplete : CreationFlow.TokenMetadata
              );

              if (!partial) {
                // add collection to supported collections
                const collectionDocId = getCollectionDocId({
                  collectionAddress: collection.address,
                  chainId: collection.chainId
                });
                const supportedCollectionsDocRef = firebase.db
                  .collection(firestoreConstants.SUPPORTED_COLLECTIONS_COLL)
                  .doc(collectionDocId);
                const dataToSave: SupportedCollection = {
                  address: collection.address,
                  slug: (collection as CollectionMetadataType).slug,
                  name: (collection as CollectionMetadataType).metadata.name,
                  chainId: collection.chainId,
                  isSupported: true,
                  metadata: (collection as CollectionMetadataType).metadata
                };
                await supportedCollectionsDocRef.set(dataToSave, { merge: true });
              }

              // fetch all time aggregated stats
              const reservoir = new Reservoir(collection.chainId ?? '1');
              // fetch from reservoir
              const reservoirData = await reservoir.getSingleCollectionInfo(collection.chainId, collection.address);
              const collectionData = reservoirData?.collections[0];
              if (collectionData) {
                const data: Partial<CollectionStats> = {
                  chainId: collection.chainId as ChainId,
                  collectionAddress: collection.address,
                  volume: Number(collectionData.volume.allTime),
                  numSales: Number(collectionData.salesCount?.allTime),
                  numOwners: Number(collectionData.ownerCount),
                  numNfts: Number(collectionData.tokenCount),
                  floorPrice: Number(collectionData.floorAsk?.price?.amount?.native),
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
              const reservoir = new Reservoir(collection.chainId ?? '1');
              // fetch from reservoir
              const data = await reservoir.getSingleCollectionInfo(collection.chainId, collection.address);
              const collectionData = data?.collections[0];
              totalSupply = parseInt(String(collectionData?.tokenCount));
              const nextStep = mintData ? CreationFlow.CollectionMints : CreationFlow.AggregateMetadata;
              collection = await this.getTokensFromReservoir(
                totalSupply,
                collection as CollectionMetadataType,
                emitter,
                nextStep
              );
              yield { collection };
            } catch (err: any) {
              logger.error('Failed to get collection tokens', err);
              // if any token fails we should throw an error
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get all tokens';
              throw new CollectionTokenMetadataError(message);
            }
            break;

          case CreationFlow.CollectionMints:
            try {
              let totalSupply = 1;
              // fetch from reservoir
              const reservoir = new Reservoir(collection.chainId ?? '1');
              const data = await reservoir.getSingleCollectionInfo(collection.chainId, collection.address);
              const collectionData = data?.collections[0];
              totalSupply = parseInt(String(collectionData?.tokenCount));

              collection = await this.getTokensFromZora(
                totalSupply,
                collection as CollectionMetadataType,
                emitter,
                CreationFlow.AggregateMetadata
              );

              yield { collection };
            } catch (err: any) {
              logger.error('Failed to get collection mints', err);
              if (err instanceof CollectionTotalSupplyExceededError) {
                throw err;
              }
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get collection mints';
              throw new CollectionMintsError(message);
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
                      step: CreationFlow.Complete,
                      updatedAt: Date.now()
                    }
                  }
                } as any;
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
                  CreationFlow.Complete
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
              // write invalid tokens to firestore
              this.writeInvalidTokensToFirestore(collection.chainId, collection.address, invalidTokens);
              throw new CollectionIncompleteError(`Received ${invalidTokens.length} invalid tokens`);
            }
            void emitter.emit('progress', { step, progress: 100 });
            return;

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
    partial: boolean,
    nextStep: CreationFlow
  ): Promise<CollectionMetadataType> {
    const chainId = this.contract.chainId;
    let hasBlueCheck = false;
    let collectionMetadata: CollectionMetadata;

    if (chainId === ChainId.Mainnet) {
      const reservoir = new Reservoir('1');
      const data = await reservoir.getCollectionMetadata(chainId, this.contract.address);
      hasBlueCheck = data.hasBlueCheck;
      collectionMetadata = { ...data };
    } else {
      throw new Error(`Unsupported chainId ${chainId}`);
    }

    const slug = getSearchFriendlyString(collectionMetadata.links.slug ?? '');
    if (!slug) {
      throw new Error('Failed to find collection slug');
    }

    const firstThreeLetters = slug.slice(0, 3);
    const firstFourLetters = slug.slice(0, 4);
    const firstFiveLetters = slug.slice(0, 5);
    const firstSixLetters = slug.slice(0, 6);
    const firstSevenLetters = slug.slice(0, 7);
    const searchTags = [trimLowerCase(slug)];

    if (collection?.address) {
      searchTags.push(trimLowerCase(collection.address));
    }
    if (collectionMetadata?.name) {
      searchTags.push(trimLowerCase(collectionMetadata.name));
    }
    if (collectionMetadata?.symbol) {
      searchTags.push(trimLowerCase(collectionMetadata.symbol));
    }
    if (firstThreeLetters) {
      searchTags.push(trimLowerCase(firstThreeLetters));
    }
    if (firstFourLetters) {
      searchTags.push(trimLowerCase(firstFourLetters));
    }
    if (firstFiveLetters) {
      searchTags.push(trimLowerCase(firstFiveLetters));
    }
    if (firstSixLetters) {
      searchTags.push(trimLowerCase(firstSixLetters));
    }
    if (firstSevenLetters) {
      searchTags.push(trimLowerCase(firstSevenLetters));
    }

    const collectionMetadataCollection: CollectionMetadataType = {
      ...collection,
      hasBlueCheck: (hasBlueCheck || collection.hasBlueCheck) ?? false,
      metadata: collectionMetadata,
      slug,
      searchTags,
      isSupported: !partial,
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

  private async getTokensFromReservoir(
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

    const reservoirLimit = 100;
    let hasNextPage = true;
    let numNfts = 0;
    let numPages = 0;
    const reservoir = new Reservoir(collection.chainId ?? '1');
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
            attributes: []
          };
          if (name) {
            metadata.name = name;
            metadata.title = name;
          }
          if (token.image) {
            metadata.image = token.image;
          }
          if (token.description) {
            metadata.description = token.description;
          }

          for (const attr of token.attributes) {
            if (metadata.attributes) {
              const isTraitValueNumeric = !isNaN(Number(attr.value));
              metadata.attributes.push({
                trait_type: attr.key,
                value: isTraitValueNumeric ? Number(attr.value) : attr.value
              });
            }
          }

          const attrMap: any = {};
          metadata.attributes?.forEach?.((attr) => {
            const attrType = getSearchFriendlyString(attr.trait_type);
            const attrValue = getSearchFriendlyString(String(attr.value));
            attrMap[`${attrType}:::${attrValue}`] = true;
          });
          metadata.attributesMap = attrMap;

          let tokenIdNumeric = NaN;
          try {
            tokenIdNumeric = Number(tokenId);
          } catch (err) {
            console.error('tokenId cannot be converted to number', err);
          }

          const isFlagged = token.isFlagged ?? false;
          let lastFlagUpdate = 0;
          try {
            lastFlagUpdate = new Date(String(token.lastFlagUpdate)).getTime();
          } catch (err) {
            console.error('lastFlagUpdate cannot be converted to date', err);
          }
          const lastFlagChange = token.lastFlagChange ?? '';

          const hasBlueCheck = collection.hasBlueCheck ?? false;
          const collectionAddress = collection.address ?? '';
          const collectionSlug = collection.slug ?? '';
          const collectionName = collection.metadata?.name ?? '';

          const tokenWithMetadata: Erc721Token = {
            slug: getSearchFriendlyString(name),
            collectionAddress,
            collectionSlug,
            collectionName,
            hasBlueCheck,
            tokenId,
            tokenIdNumeric,
            chainId: this.contract.chainId,
            numTraitTypes: token.attributes.length ?? 0,
            metadata,
            isFlagged,
            lastFlagUpdate,
            lastFlagChange,
            rarityRank: token.rarityRank ?? 0,
            rarityScore: token.rarity ?? 0,
            lastSalePriceEth: token.lastSale?.price?.amount?.native ?? 0,
            lastSaleTimestamp: (token.lastSale?.timestamp ?? 0) * 1000,
            updatedAt: Date.now(),
            owner: token.owner,
            tokenStandard: TokenStandard.ERC721 // default
          };
          if (token.image) {
            const origUrl = token.image;
            tokenWithMetadata.image = {
              url: origUrl,
              updatedAt: Date.now()
            };
          }

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

  private async getTokensFromZora(
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
      const response = await zora.getTokens(this.contract.chainId, this.contract.address, after, zoraLimit);
      after = response?.tokens?.pageInfo?.endCursor ?? '';
      hasNextPage = response?.tokens?.pageInfo?.hasNextPage ?? false;

      const tokens = response?.tokens?.nodes ?? [];
      for (const tokenInfo of tokens) {
        if (tokenInfo.token && tokenInfo.token.tokenId && tokenInfo.token.attributes) {
          const tokenId = tokenInfo.token.tokenId;
          let tokenIdNumeric = NaN;
          try {
            tokenIdNumeric = Number(tokenId);
          } catch (err) {
            console.error('tokenId cannot be converted to string', err);
          }

          const token: Erc721Token = {
            tokenId,
            tokenIdNumeric,
            updatedAt: Date.now(),
            tokenStandard: TokenStandard.ERC721
          };

          if (tokenInfo.token.mintInfo && tokenInfo.token.mintInfo.mintContext) {
            const minter = tokenInfo.token.mintInfo.originatorAddress;
            const blockTimestamp = tokenInfo.token.mintInfo.mintContext.blockTimestamp;
            const mintedAt = blockTimestamp ? new Date(blockTimestamp).getTime() : 0;
            const txHash = tokenInfo.token.mintInfo.mintContext.transactionHash;
            const mintPrice = tokenInfo.token.mintInfo.price.chainTokenPrice.decimal;
            const mintCurrencyAddress = tokenInfo.token.mintInfo.price.chainTokenPrice.currency.address;
            const mintCurrencyDecimals = tokenInfo.token.mintInfo.price.chainTokenPrice.currency.decimals;
            const mintCurrencyName = tokenInfo.token.mintInfo.price.chainTokenPrice.currency.name;

            token.mintedAt = mintedAt;
            token.minter = normalizeAddress(minter);
            token.mintTxHash = txHash;
            token.mintPrice = mintPrice;
            token.mintCurrencyAddress = normalizeAddress(mintCurrencyAddress);
            token.mintCurrencyDecimals = mintCurrencyDecimals;
            token.mintCurrencyName = mintCurrencyName;

            if (token.image) {
              token.image.updatedAt = Date.now();
            }
          }

          void emitter.emit('token', token);
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

  private async getCollectionTokenMetadataFromOS(
    tokens: AsyncIterable<Partial<Token>>,
    collection: CollectionTokenMetadataType,
    emitter: Emittery<CollectionEmitterType>,
    opensea: OpenSeaClient,
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
        const tokenId = datum.token_id;
        let tokenIdNumeric = NaN;
        try {
          tokenIdNumeric = Number(tokenId);
        } catch (err) {
          console.error('tokenId cannot be converted to string', err);
        }

        const token: Erc721Token = {
          updatedAt: Date.now(),
          tokenId,
          tokenIdNumeric,
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
            attributes: datum.traits.map((trait) => {
              const isTraitValueNumeric = !isNaN(Number(trait.value));
              return { trait_type: trait.trait_type, value: isTraitValueNumeric ? Number(trait.value) : trait.value };
            }),
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

  private getCollectionAggregatedMetadata(
    tokens: Token[],
    collection: CollectionTokenMetadataType,
    emitter: Emittery<CollectionEmitterType>,
    nextStep: CreationFlow
  ): CollectionType {
    const attributes = this.contract.aggregateTraits(tokens) ?? {};
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
    opensea: OpenSeaClient,
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
        step: CreationFlow.CacheImage,
        progress: Math.floor((tokensUpdated / collection.numNfts) * 100 * 100) / 100
      });
    }

    void emitter.emit('progress', {
      step: CreationFlow.CacheImage,
      progress: 100
    });

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

  private writeInvalidTokensToFirestore(chainId: string, collectionAddress: string, invalidNfts: { token: Token; err: Error }[]) {
    const batchHandler = new BatchHandler();
    const collectionDocId = getCollectionDocId({ chainId, collectionAddress });
    console.log('Writing invalid tokens to firestore for', chainId, collectionAddress, 'with collection doc id', collectionDocId);
    const invalidNftsCollectionRef = firebase.db
      .collection(firestoreConstants.COLLECTIONS_COLL)
      .doc(collectionDocId)
      .collection(firestoreConstants.COLLECTION_INVALID_NFTS_COLL);
    for (const invalidNft of invalidNfts) {
      if (invalidNft.token.tokenId) {
        const nftDocRef = invalidNftsCollectionRef.doc(invalidNft.token.tokenId);
        batchHandler.add(nftDocRef, invalidNft.token, { merge: true });
      }
    }

    batchHandler
      .flush()
      .then(() => {
        console.log('Invalid nfts written to firestore for', chainId, collectionAddress);
      })
      .catch((err) => {
        console.error('Error writing invalid nfts to firestore for', chainId, collectionAddress, err);
      });
  }
}
