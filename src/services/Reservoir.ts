import { ReservoirDetailedTokensResponse, ReservoirSingleCollectionResponse } from '@infinityxyz/lib/types/services/reservoir';
import got, { Got, Response } from 'got/dist/source';
import { singleton } from 'tsyringe';
import { RESERVOIR_API_KEY } from '../constants';
import { sleep } from '../utils';
import { gotErrorHandler } from '../utils/got';

@singleton()
export default class Reservoir {
  private readonly client: Got;
  constructor() {
    this.client = got.extend({
      prefixUrl: 'https://api.reservoir.tools/',
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
          limit
        };
        if (continuation) {
          searchParams.continuation = continuation;
        }
        return this.client.get(`tokens/details/v4`, {
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

  public async getSingleCollectionInfo(
    chainId: string,
    collectionAddress: string
  ): Promise<ReservoirSingleCollectionResponse | undefined> {
    try {
      const res: Response<ReservoirSingleCollectionResponse> = await this.errorHandler(() => {
        const searchParams: any = {
          id: collectionAddress
        };
        return this.client.get(`collection/v2`, {
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
            await sleep(2000);
            throw new Error('Rate limited');

          case 500:
            throw new Error('Internal server error');

          case 504:
            await sleep(5000);
            throw new Error('OpenSea down');

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
