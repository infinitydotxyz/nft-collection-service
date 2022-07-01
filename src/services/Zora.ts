import { ZoraAggregateCollectionStatsResponse, ZoraTokensResponse } from '@infinityxyz/lib/types/services/zora';
import { sleep } from '@infinityxyz/lib/utils';
import { Response } from 'got/dist/source';
import { gql, GraphQLClient } from 'graphql-request';
import { singleton } from 'tsyringe';
import { ZORA_API_KEY } from '../constants';
import { gotErrorHandler } from '../utils/got';

@singleton()
export default class Zora {
  private readonly zoraClient: GraphQLClient;

  constructor() {
    const ZORA_API_ENDPOINT = 'https://api.zora.co/graphql';
    this.zoraClient = new GraphQLClient(ZORA_API_ENDPOINT, {
      headers: {
        'X-API-KEY': ZORA_API_KEY
      }
    });
  }

  public async getAggregatedCollectionStats(
    chainId: string,
    collectionAddress: string,
    topOwnersLimit: number
  ): Promise<ZoraAggregateCollectionStatsResponse | undefined> {
    try {
      const query = gql`
        query MyQuery {
          aggregateStat {
            ownerCount(where: { collectionAddresses: "${collectionAddress}" })
            ownersByCount(
              where: { collectionAddresses: "${collectionAddress}" }
              pagination: { limit: ${topOwnersLimit} }
            ) {
              nodes {
                count
                owner
              }
            }
            salesVolume(where: { collectionAddresses: "${collectionAddress}" }) {
              chainTokenPrice
              totalCount
              usdcPrice
            }
            nftCount(where: { collectionAddresses: "${collectionAddress}" })
          }
        }
      `;

      const data = await this.zoraClient.request(query);
      return data as ZoraAggregateCollectionStatsResponse;
    } catch (e) {
      console.error('failed to get aggregated collection stats info from zora', chainId, collectionAddress, e);
    }
  }

  // default sorting by tokenId ascending
  public async getTokens(
    chainId: string,
    collectionAddress: string,
    after: string,
    limit: number
  ): Promise<ZoraTokensResponse | undefined> {
    try {
      const query = gql`
        query MyQuery {
          tokens(where: { collectionAddresses: "${collectionAddress}"}, networks: {network: ETHEREUM, chain: MAINNET}, pagination: {after: "${after}", limit: ${limit}}, sort: {sortKey: TOKEN_ID, sortDirection: ASC}) {
            nodes {
              token {
                tokenId
                tokenUrl
                attributes {
                  displayType
                  traitType
                  value
                }
                image {
                  url
                }
                mintInfo {
                  toAddress
                  originatorAddress
                  price {
                    chainTokenPrice {
                      decimal
                      currency {
                        address
                        decimals
                        name
                      }
                    }
                  }
                  mintContext {
                    blockNumber
                    transactionHash
                    blockTimestamp
                  }
                }
              }
            }
            pageInfo {
              endCursor
              hasNextPage
              limit
            }
          }
        }
      `;

      const res: Response<ZoraTokensResponse> = await this.errorHandler(() => {
        return this.zoraClient.request(query, {
          responseType: 'json'
        });
      });

      return res.body;
    } catch (e) {
      console.error('failed to get token mint info from zora', chainId, collectionAddress, e);
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
            console.log('Zora Rate limit exceeded, sleeping 1 second');
            await sleep(1000);
            throw new Error('Zora Rate limited');

          case 500:
            throw new Error('Internal server error');

          case 504:
            await sleep(5000);
            throw new Error('Zora down');

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
