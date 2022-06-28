import { ZoraTokensResponse } from '@infinityxyz/lib/types/services/zora/tokens';
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

  public async fetchTokensInfoFromZora(
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
      console.error('failed to get nfts from zora', chainId, collectionAddress, e);
    }
  }
}
