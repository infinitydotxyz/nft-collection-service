import got, { Got } from 'got';
import { MORALIS_API_KEY } from '../constants';

export default class Moralis {
  private readonly client: Got;

  constructor() {
    this.client = got.extend({
      /**
       * requires us to check status code
       */
      throwHttpErrors: false,
      cache: false,
      timeout: 10_000,
      headers: {
        'X-API-KEY': MORALIS_API_KEY
      }
    });
  }

  async getContractMetadata(address: string, chainId?: number): Promise<void> {
    try {
      const res = await this.client.get({
        url: `https://deep-index.moralis.io/api/v2/nft/${address}/metadata?chain=eth`,
        responseType: 'json'
      });

      console.log(res.body);
    } catch (err) {
      console.error(err);
    }
  }

  async getContract(address: string): Promise<void> {
    // eth, 0x1, ropsten, 0x3, rinkeby, 0x4, goerli, 0x5, kovan, 0x2a, polygon, 0x89, mumbai, 0x13881, bsc, 0x38, bsc testnet, 0x61, avalanche, 0xa86a, avalanche testnet, 0xa869, fantom, 0xfa
    try{
      const res = await this.client.get({
        url: `https://deep-index.moralis.io/api/v2/nft/${address}`,
        searchParams: {
          chain: '0x1',
        },
        responseType: 'json'
      });
      console.log(res.body);
    }catch(err) {
      console.error(err);
    }

  }
}
