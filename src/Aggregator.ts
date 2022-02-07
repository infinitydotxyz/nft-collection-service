import { ethers } from 'ethers';
import { Readable } from 'stream';
import Contract from './contracts/Contract.interface';
import Metadata from './services/Metadata';
import OpenSea from './services/OpenSea';
import { Collection } from './types/Collection.interface';
import { Token, TokenMetadata } from './types/Token.interface';
import { writeFile } from 'fs/promises';

export default class Aggregator {
  private readonly contract: Contract;

  private readonly metadataClient: Metadata;

  private readonly openseaClient: OpenSea;

  private readonly collection: Partial<Collection> = {};

  private readonly tokens: Map<string, Token> = new Map();

  constructor(contract: Contract, metadataClient: Metadata, openseaClient: OpenSea) {
    this.contract = contract;
    this.metadataClient = metadataClient;
    this.openseaClient = openseaClient;
  }

  async getInitalData(): Promise<any> {
    try {
      const creation = await this.contract.getContractCreationTx();
      const blockDeployedAt = creation.blockNumber;
      const deployer = this.contract.decodeDeployer(creation);
      const createdAt = (await creation.getBlock()).timestamp * 1000; // convert timestamp to ms
      const collectionMetadata = await this.openseaClient.getCollectionMetadata(this.contract.address);
      const mintsStream = (await this.contract.getMints({
        fromBlock: blockDeployedAt,
        toBlock: 'latest',
        returnType: 'stream'
      })) as Readable;

      let tokenMetadataPromises: Array<Promise<any>> = [];
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
              const response = await this.metadataClient.get(tokenUri);
              const metadata = JSON.parse(response.body as string) as TokenMetadata;
              const image = metadata.image;
              if (image) {
                const imageResponse = await this.metadataClient.get(image);
                const contentType = imageResponse.headers['content-type'];
                const data = imageResponse.rawBody;
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
    } catch (err) {
      console.error(err);
    }
  }
}
