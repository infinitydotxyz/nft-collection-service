import { CollectionMetadata } from '@infinityxyz/lib/types/core';
import { ethers } from 'ethers';
import got, { Got, Response } from 'got/dist/source';
import { singleton } from 'tsyringe';
import { ReservoirCollectionAttributes, ReservoirCollectionsV6, ReservoirDetailedTokensResponse } from 'types/Reservoir';
import { RESERVOIR_API_KEY } from '../constants';
import { sleep } from '../utils';
import { gotErrorHandler } from '../utils/got';
import OpenSeaClient from './OpenSea';

@singleton()
export default class Reservoir {
  private readonly client: Got;
  constructor(chainId: string) {
    let prefixUrl;
    switch (chainId) {
      case '1':
        prefixUrl = 'https://api.reservoir.tools/';
        break;
      case '5':
        prefixUrl = 'https://api-goerli.reservoir.tools/';
        break;

      default:
        throw new Error(`Invalid chainId: ${chainId}`);
    }
    this.client = got.extend({
      prefixUrl,
      hooks: {
        beforeRequest: [
          (options) => {
            if (!options?.headers?.['x-api-key']) {
              if (!options.headers) {
                options.headers = {};
              }
              options.headers['x-api-key'] = RESERVOIR_API_KEY;
            }
          }
        ]
      },
      /**
       * requires us to check status code
       */
      throwHttpErrors: false,
      cache: false,
      timeout: 20_000
    });
  }

  public async getCollectionMetadata(chainId: string, address: string): Promise<CollectionMetadata & { hasBlueCheck: boolean }> {
    if (!ethers.utils.isAddress(address)) {
      throw new Error('Invalid address');
    }

    const data = await this.getSingleCollectionInfo(chainId, address);
    const collection = data?.collections?.[0];

    const opensea = new OpenSeaClient(chainId);
    const openseaData = await opensea.getCollectionMetadata(address);

    if (!collection) {
      throw new Error('Collection metadata not found');
    }

    const name = collection.name;
    const hasBlueCheck = collection.openseaVerificationStatus === 'verified';
    const dataInInfinityFormat: CollectionMetadata = {
      name,
      description: collection.description || openseaData.description || '',
      symbol: openseaData.symbol,
      profileImage: collection.image || openseaData.profileImage || '',
      bannerImage: collection.banner || openseaData.bannerImage || '',
      displayType: openseaData.displayType ?? 'contain',
      mintedTimestamp: (collection.mintedTimestamp ?? 0) * 1000,
      links: {
        timestamp: new Date().getTime(),
        discord: collection.discordUrl || openseaData.links.discord || '',
        external: collection.externalUrl || openseaData.links.external || '',
        medium: openseaData.links.medium || '',
        slug: collection?.slug || openseaData.links.slug || '',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        telegram: openseaData.links.telegram || '',
        twitter:
          typeof collection?.twitterUsername === 'string'
            ? // eslint-disable-next-line @typescript-eslint/no-unsafe-call
              `https://twitter.com/${collection.twitterUsername.toLowerCase()}`
            : openseaData.links.twitter || '',
        instagram: openseaData.links.instagram || '',
        wiki: openseaData.links.wiki || '',
      }
    };

    return { ...dataInInfinityFormat, hasBlueCheck };
  }

  public async getCollectionAttributes(
    chainId: string,
    collectionAddress: string
  ): Promise<ReservoirCollectionAttributes | undefined> {
    try {
      const res: Response<ReservoirCollectionAttributes> = await this.errorHandler(() => {
        return this.client.get(`collections/${collectionAddress}/attributes/all/v2`, {
          responseType: 'json'
        });
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return res.body;
    } catch (e) {
      console.error('failed to get coll attrs from reservoir', chainId, collectionAddress, e);
    }
  }

  public async getDetailedTokensInfo(
    chainId: string,
    collectionAddress: string,
    continuation: string,
    limit: number
  ): Promise<ReservoirDetailedTokensResponse | undefined> {
    try {
      const res: Response<ReservoirDetailedTokensResponse> = await this.errorHandler(() => {
        const searchParams: any = {
          contract: collectionAddress,
          limit,
          includeAttributes: true,
          sortBy: 'tokenId',
          sortDirection: 'asc',
          includeLastSale: true
        };
        if (continuation) {
          searchParams.continuation = continuation;
        }
        return this.client.get(`tokens/v6`, {
          searchParams,
          responseType: 'json'
        });
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return res.body;
    } catch (e) {
      console.error('failed to get detailed tokens info from reservoir', chainId, collectionAddress, e);
    }
  }

  public async getSingleCollectionInfo(chainId: string, collectionAddress: string): Promise<ReservoirCollectionsV6 | undefined> {
    try {
      const res: Response<ReservoirCollectionsV6> = await this.errorHandler(() => {
        const searchParams: any = {
          id: collectionAddress,
          includeSalesCount: true
        };
        return this.client.get(`collections/v6`, {
          searchParams,
          responseType: 'json'
        });
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return res.body;
    } catch (e) {
      console.error('failed to get single contract info from reservoir', chainId, collectionAddress, e);
    }
  }

  private async errorHandler<T>(request: () => Promise<Response<T>>, maxAttempts = 3): Promise<Response<T>> {
    let attempt = 0;

    for (;;) {
      attempt += 1;

      try {
        const res: Response<T> = await request();

        switch (res.statusCode) {
          case 200:
            return res;

          case 400:
            throw new Error(res.statusMessage);

          case 404:
            throw new Error('Not found');

          case 429:
            console.log('Reservoir Rate limit exceeded, sleeping 1 second');
            await sleep(1000);
            throw new Error('Reservoir Rate limited');

          case 500:
            throw new Error('Internal server error');

          case 504:
            await sleep(5000);
            throw new Error('Reservoir down');

          default:
            await sleep(2000);
            throw new Error(`Unknown status code: ${res.statusCode}`);
        }
      } catch (err) {
        const handlerRes = gotErrorHandler(err);
        if ('retry' in handlerRes) {
          await sleep(handlerRes.delay);
        } else if (!handlerRes.fatal) {
          // unknown error
          if (attempt >= maxAttempts) {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }
  }
}
