import { ZoraTokensResponse, ZoraAggregateCollectionStatsResponse } from '@infinityxyz/lib/types/services/zora';
import { gql, GraphQLClient } from 'graphql-request';
import { singleton } from 'tsyringe';
import { ZORA_API_KEY } from '../constants';

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
              where: { collectionAddresses: "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d" }
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

  public async getTokenMintInfo(
    chainId: string,
    collectionAddress: string,
    after: string,
    limit: number
  ): Promise<ZoraTokensResponse | undefined> {
    try {
      const query = gql`
        query MyQuery {
          tokens(where: { collectionAddresses: "${collectionAddress}"}, networks: {network: ETHEREUM, chain: MAINNET}, pagination: {after: "${after}", limit: ${limit}}) {
            nodes {
              token {
                tokenId
                tokenUrl
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

      const data = await this.zoraClient.request(query);
      return data as ZoraTokensResponse;
    } catch (e) {
      console.error('failed to get token mint info from zora', chainId, collectionAddress, e);
    }
  }
}