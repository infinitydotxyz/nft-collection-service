import Contract from './contracts/Contract.interface';
import MetadataClient from '../services/Metadata';
import { ethers } from 'ethers';
import { Token, TokenMetadata } from '../types/Token.interface';
import { Readable } from 'stream';
import { writeFile } from 'fs/promises';
import { CollectionMetadataProvider } from '../types/CollectionMetadataProvider.interface';
import { firebase } from '../container';
import crypto from 'crypto';
import { Collection as CollectionType } from '../types/Collection.interface';
import { Optional } from '../types/Utility';

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
    const deployer = this.contract.decodeDeployer(creation);
    const createdAt = (await creation.getBlock()).timestamp * 1000; // convert timestamp to ms

    return {
      createdAt,
      address: deployer,
      block: blockDeployedAt
    };
  }

  /**
   * gets the metadata for a token
   */
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
    const maxAttempts = 5;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
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
      } catch (err) {
        console.log(`Failed to get token: ${tokenId}`);
        console.error(err);
      }
    }
    throw new Error(`Failed to get contract: ${this.contract.address} token: ${tokenId}`);
  }

  async getTokensFromMints(fromBlock?: number, toBlock?: number): Promise<{ tokens: Token[]; numTokens: number }> {
    let tokenPromises: Array<Promise<{ token: Token } | { error: unknown; event: ethers.Event }>> = [];
    const mintsStream = (await this.contract.getMints({
      fromBlock,
      toBlock,
      returnType: 'stream'
    })) as Readable;

    /**
     * cache of block timestamps
     */
    const blockTimestamps = new Map<number, Promise<{ error: any } | { value: number }>>();
    const getBlockTimestamp = async (item: ethers.Event): Promise<{ error: any } | { value: number }> => {
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
    const getTokenFromTransfer = async (
      event: ethers.Event
    ): Promise<{ token: Token } | { error: unknown; event: ethers.Event }> => {
      let tokenId;
      let blockMinedAt = 0;
      try {
        const blockTimestampResult = await getBlockTimestamp(event); // doesn't throw
        if ('value' in blockTimestampResult) {
          blockMinedAt = blockTimestampResult.value;
        }
        const transfer = this.contract.decodeTransfer(event);
        tokenId = transfer.tokenId;
        const token: Optional<Token, 'mintedAt' | 'owner'> = await this.getToken(tokenId, blockMinedAt);
        token.owner = transfer.to;
        return { token: token as Token };
      } catch (err) {
        return { error: err, event: event };
      }
    };

    /**
     * as we receive mints (transfer events) get the token's metadata
     */
    for await (const chunk of mintsStream) {
      const mintEvents: ethers.Event[] = chunk;
      const chunkPromises = mintEvents.map(async (event) => {
        return await getTokenFromTransfer(event);
      });
      tokenPromises = [...tokenPromises, ...chunkPromises];
    }

    const tokenPromiseResults = await Promise.allSettled(tokenPromises);

    const tokens: Token[] = [];
    const failedTokenIds: string[] = [];
    const unknownErrors = [];

    for (const item of tokenPromiseResults) {
      if (item.status === 'fulfilled' && 'token' in item.value) {
        tokens.push(item.value.token);

      } else if (item.status === 'fulfilled' && 'event' in item.value) { // failed to get these tokens
        try {
          // retry to get the token
          const result = await getTokenFromTransfer(item.value.event);

          if('token' in result) {
            tokens.push(result.token);
          } else {
            throw result.error ?? new Error('Failed to get token');
          }

        } catch (err) {
          const {tokenId} = this.contract.decodeTransfer(item.value.event);
          failedTokenIds.push(tokenId); // save these to make that they failed
        }

      } else if (item.status === 'fulfilled') {  // unknown error  
        unknownErrors.push(new Error("Unknown error"));

      } else { // unknown error  
        unknownErrors.push(item.reason);

      }
    }

    console.log(`Failed to get token metadata for: ${failedTokenIds.length} tokens`);
    console.log(`Successfully got token metadata for: ${tokens.length} tokens`);
    
    const totalNumTokens =  tokens.length + failedTokenIds.length + unknownErrors.length;

    return { tokens, numTokens: totalNumTokens };
  }

  async getInitialData(): Promise<{ collection: CollectionType; tokens: Token[] }> {
    try {
      const deployer = await this.getDeployer();
      const collectionMetadata = await this.collectionMetadataProvider.getCollectionMetadata(this.contract.address);
      const { tokens, numTokens } = await this.getTokensFromMints(deployer.block);
      const attributes = this.contract.aggregateTraits(tokens) ?? {};
      const collection: CollectionType = {
        chainId: this.contract.chainId,
        address: this.contract.address,
        tokenStandard: this.contract.standard,
        deployer: deployer.address,
        deployedAt: deployer.createdAt,
        owner: deployer.address, // note - this is may not be the current owner
        metadata: collectionMetadata,
        numNfts: numTokens, // note - this may not be the current number of nfts
        attributes: attributes,
        numTraitTypes: Object.keys(attributes).length
      };

      return { collection, tokens };
    } catch (err) {
      console.error(err);
      throw err;
    }
  }
}
