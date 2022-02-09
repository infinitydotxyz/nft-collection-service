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
    throw new Error(`Failed to get contract: ${this.contract.address} token: ${tokenId}`)
  }

  async getTokensFromMints(fromBlock?: number, toBlock?: number): Promise<{ tokens: Token[]; numTokens: number }> {
    let tokenPromises: Array<Promise<Token>> = [];
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
     * as we receive mints (transfer events) get the token's metadata
     */
    // mintsStream.on('data', (mintEvents: ethers.Event[]) => {
    for await (const chunk of mintsStream) {
      const mintEvents: ethers.Event[] = chunk;

      const chunkPromises = mintEvents.map(async (item) => {
        let blockMinedAt = 0;
        const blockTimestampResult = await getBlockTimestamp(item);
        if ('value' in blockTimestampResult) {
          blockMinedAt = blockTimestampResult.value;
        }

        const { to, tokenId } = this.contract.decodeTransfer(item);
        const token = await this.getToken(tokenId, blockMinedAt);

        return token as Token;
      });

      tokenPromises = [...tokenPromises, ...chunkPromises];
    }

    const tokenPromiseResults = await Promise.allSettled(tokenPromises);
    const results = tokenPromiseResults.reduce(
      (acc: { failed: unknown[]; successful: Token[] }, item) => {
        if (item.status === 'fulfilled') {
          acc.successful.push(item.value);
          return acc;
        }
        acc.failed.push(item.reason);
        return acc;
      },
      { failed: [], successful: [] }
    );

    console.log(`Failed to get token metadata for: ${results.failed.length} tokens`);
    console.log(`Successfully got token metadata for: ${results.successful.length} tokens`);

    return { tokens: results.successful, numTokens: tokenPromises.length };
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
