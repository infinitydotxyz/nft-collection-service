import { CollectionMetadata } from '@infinityxyz/lib/types/core';
import {
  ReservoirCollectionsV5,
  ReservoirDetailedTokensResponse
} from '@infinityxyz/lib/types/services/reservoir';
import { ethers } from 'ethers';
import got, { Got, Response } from 'got/dist/source';
import { singleton } from 'tsyringe';
import { ReservoirCollectionAttributes } from 'types/Reservoir';
import { RESERVOIR_API_KEY } from '../constants';
import { sleep } from '../utils';
import { gotErrorHandler } from '../utils/got';

@singleton()
export default class Reservoir {
  private readonly client: Got;
  constructor(chainId: string) {
    let prefixUrl;
    switch (chainId) {
      case '1':
        prefixUrl = 'https://api.reservoir.tools/v1';
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

    if (!collection) {
      throw new Error('Collection metadata not found');
    }

    const name = collection.name;
    const hasBlueCheck = collection.openseaVerificationStatus === 'verified';
    const dataInInfinityFormat: CollectionMetadata = {
      name,
      description: collection.description || '',
      symbol: '',
      profileImage: '',
      bannerImage: collection.banner ?? '',
      displayType: 'contain',
      links: {
        timestamp: new Date().getTime(),
        discord: collection.discordUrl ?? '',
        external: collection.externalUrl ?? '',
        medium: '',
        slug: collection?.slug ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        telegram: '',
        twitter:
          typeof collection?.twitterUsername === 'string'
            ? `https://twitter.com/${collection.twitterUsername.toLowerCase()}`
            : '',
        instagram: '',
        wiki: ''
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
          includeAttributes: true
        };
        if (continuation) {
          searchParams.continuation = continuation;
        }
        return this.client.get(`tokens/v5`, {
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

  public async getSingleCollectionInfo(chainId: string, collectionAddress: string): Promise<ReservoirCollectionsV5 | undefined> {
    try {
      const res: Response<ReservoirCollectionsV5> = await this.errorHandler(() => {
        const searchParams: any = {
          id: collectionAddress
        };
        return this.client.get(`collections/v5`, {
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
