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

  async getDeployer(): Promise<{ createdAt: number; address: string; block: number }> {
    const creation = await this.contract.getContractCreationTx();
    const blockDeployedAt = creation.blockNumber;
    const deployer = (this.contract.decodeDeployer(creation) ?? '').toLowerCase();
    const createdAt = (await creation.getBlock()).timestamp * 1000; // convert timestamp to ms

    return {
      createdAt,
      address: deployer,
      block: blockDeployedAt
    };
  }

  async getTokenMetadata(tokenId: string): Promise<{ metadata: TokenMetadata; tokenUri: string }> {
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
    const path = `images/collections/${this.contract.chainId}:${this.contract.address}/${hash}`;
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
  ): Promise<{ tokens: Token[]; numTokens: number; tokensWithErrors: Array<{ error: any; tokenId: string }> }> {
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
          emitter.emit('token', token as Token).catch((err) => {
            console.log(`failed to emit token: ${token.tokenId}`);
            console.error(err);
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

    return { tokens, numTokens: totalNumTokens, tokensWithErrors: failed };
  }

  /**
   * getInitialData gets all necessary data to create the collection + nfts
   *
   * Note token rarity cannot be calculate until we have metadata for every token. Therefore
   * the emitter will not emit tokens with rarityScore/rarityRankings. This data is added
   * to tokens returned in the promise
   */
  getInitialData(): {
    emitter: Emittery<{ token: Token }>;
    promise: Promise<{
      collection: CollectionType;
      tokens: Token[];
      tokensWithErrors: Array<{ error: any; tokenId: string }>;
    }>;
  } {
    const emitter: Emittery<{ token: Token }> = new Emittery();
    const promise = new Promise<{
      collection: CollectionType;
      tokens: Token[];
      tokensWithErrors: Array<{ error: any; tokenId: string }>;
    }>(async (resolve, reject) => {
      try {
        const deployer = await this.getDeployer();

        let owner;
        try {
          owner = await this.contract.getOwner();
        } catch {}

        if(!owner) {
          owner = deployer.address;
        }

        const collectionMetadata = await this.collectionMetadataProvider.getCollectionMetadata(this.contract.address);
        const { tokens, numTokens, tokensWithErrors } = await this.getTokensFromMints(
          deployer.block,
          undefined,
          emitter
        );
        const attributes = this.contract.aggregateTraits(tokens) ?? {};
        const collection: CollectionType = {
          hasBlueCheck: false,
          chainId: this.contract.chainId,
          address: this.contract.address.toLowerCase(),
          tokenStandard: this.contract.standard,
          deployer: deployer.address.toLowerCase(),
          deployedAt: deployer.createdAt,
          owner: owner.toLowerCase(),
          metadata: collectionMetadata,
          numNfts: numTokens, // note - this may not be the current number of nfts
          attributes: attributes,
          numTraitTypes: Object.keys(attributes).length
        };

        const tokensWithRarity = this.contract.calculateRarity(tokens, attributes);

        resolve({ collection, tokens: tokensWithRarity, tokensWithErrors });
      } catch (err) {
        reject(err);
      }
    });

    return { promise, emitter };
  }
}
