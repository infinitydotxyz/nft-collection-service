import Contract from './contracts/Contract.interface';
import MetadataClient from '../services/Metadata';
import { ethers } from 'ethers';
import { Token, TokenMetadata } from '../types/Token.interface';
import { Readable } from 'stream';
import { writeFile } from 'fs/promises';
import { CollectionMetadataProvider } from 'types/CollectionMetadataProvider.interface';

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

  async getDeployer(): Promise<{ createdAt: number; deployer: string; block: number }> {
    const creation = await this.contract.getContractCreationTx();
    const blockDeployedAt = creation.blockNumber;
    const deployer = this.contract.decodeDeployer(creation);
    const createdAt = (await creation.getBlock()).timestamp * 1000; // convert timestamp to ms

    return {
      createdAt,
      deployer,
      block: blockDeployedAt
    };
  }

  async getTokensFromMints(): Promise<unknown> {
    try {
      let tokenMetadataPromises: Array<Promise<any>> = [];
      const mintsStream = (await this.contract.getMints({
        returnType: 'stream'
      })) as Readable;

      /**
       * as we receive mints (transfer events) get the token's metadata
       */
      mintsStream.on('data', (mintEvents: ethers.Event[]) => {
        //
        const promises = mintEvents.map(async (item) => {
          const block = item.blockHash;
          const { to, tokenId } = this.contract.decodeTransfer(item);
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          return await new Promise<TokenMetadata>(async (resolve, reject) => {
            try {
              const tokenUri = await this.contract.getTokenUri(tokenId);
              const response = await this.tokenMetadataClient.get(tokenUri);
              const metadata = JSON.parse(response.body as string) as TokenMetadata;
              const image = metadata.image;
              if (image) {
                // const imageResponse = await this.metadataClient.get(image);
                // const contentType = imageResponse.headers['content-type'];
                // const data = imageResponse.rawBody;
              }
              resolve(metadata);
            } catch (err) {
              reject(err);
            }
          });
        });

        tokenMetadataPromises = [...tokenMetadataPromises, ...promises];
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


      const tokenMetadataPromiseResults = await Promise.allSettled(tokenMetadataPromises);
      const results = tokenMetadataPromiseResults.reduce(
        (acc: { failed: unknown[]; successful: unknown[] }, item) => {
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

      return results.successful;
    } catch (err) {
      console.error(err);
    }
  }

  async getInitalData(): Promise<any> {
    try {
      const deployer = await this.getDeployer();
      const collectionMetadata = await this.collectionMetadataProvider.getCollectionMetadata(this.contract.address);



    } catch (err) {
      console.error(err);
    }
  }
}
