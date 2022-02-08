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

export default class Collection {
  private readonly contract: Contract;

  private readonly tokenMetadataClient: MetadataClient;

  private readonly collectionMetadataProvider: CollectionMetadataProvider;

  private readonly collection: Partial<Collection> = {};

  private readonly tokens: Map<string, Token> = new Map();

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

  async uploadTokenImage(imageUrl: string): Promise<{url: string, contentType: string, updatedAt: number}> {
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
      throw new Error(`Failed to get content type for image. Collection: ${this.contract.address} imageUrl: ${imageUrl}`);
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

  /**
   *
   * @returns
   */
  async getTokensFromMints(fromBlock?: number, toBlock?: number): Promise<{tokens: Token[], numTokens: number}> {
      let tokenPromises: Array<Promise<Token>> = [];
      const mintsStream = (await this.contract.getMints({
        fromBlock,
        toBlock,
        returnType: 'stream'
      })) as Readable;

      /**
       * cache of block timestamps
       */
      const blockTimestamps: {[blockNumber: number]: Promise<number>} = {};

      /**
       * as we receive mints (transfer events) get the token's metadata
       */
      mintsStream.on('data', (mintEvents: ethers.Event[]) => {
        const chunkPromises = mintEvents.map(async (item) => {

          const blockNumber = item.blockNumber

          if(blockTimestamps[blockNumber] === undefined){
            blockTimestamps[blockNumber] = new Promise<number>((resolve, reject) => {
              item.getBlock().then((block) => {
                resolve(block.timestamp * 1000) // convert to ms
              }).catch((err) => {
               reject(err)
              })
            })
          }
          const blockMinedAt = await blockTimestamps[blockNumber];

          const { to, tokenId } = this.contract.decodeTransfer(item);

          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          return await new Promise<Token>(async (resolve, reject) => {
            try {
              const { metadata, tokenUri } = await this.getTokenMetadata(tokenId);
              const { url, contentType, updatedAt } = await this.uploadTokenImage(metadata.image);
              const token: Token = {
                owner: to,
                tokenId,
                mintedAt: blockMinedAt,
                metadata: {
                  data: metadata,
                  updatedAt,
                  tokenUri
                },
                image: {
                  url, 
                  contentType, 
                  updatedAt
                }
              }
              resolve(token);
            } catch (err) {
              reject(err);
            }
          });
        });

        tokenPromises = [...tokenPromises, ...chunkPromises];
      });

      /**
       * wait for the stream to end
       */
      await new Promise<void>((resolve, reject) => {
        mintsStream.on('end', () => {
          resolve();
        });
        mintsStream.on('error', (err) => { 
          reject(err);
        });
      });


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
      await writeFile('./failed.json', JSON.stringify(results.failed));

      console.log(`Successfully got token metadata for: ${results.successful.length} tokens`);
      await writeFile('./successful.json', JSON.stringify(results.successful));

      return { tokens: results.successful, numTokens: tokenPromises.length };
  }

  async getInitialData(): Promise<{collection: CollectionType, tokens: Token[]}> {
    try {
      const deployer = await this.getDeployer();
      const collectionMetadata = await this.collectionMetadataProvider.getCollectionMetadata(this.contract.address);
      const {tokens, numTokens} = await this.getTokensFromMints(deployer.block);

      const collection: CollectionType = {
        chainId: this.contract.chainId,
        address: this.contract.address,
        tokenStandard: this.contract.standard,
        deployer: deployer.address,
        deployedAt: deployer.createdAt,
        owner: deployer.address, // TODO not the current owner
        metadata: collectionMetadata,
        tokens:  numTokens, // TODO not the current number of tokens
        traits: this.contract.aggregateTraits(tokens)
      }

      return { collection, tokens };

    } catch (err) {
      console.error(err);
      throw err;
    }
  }
}
