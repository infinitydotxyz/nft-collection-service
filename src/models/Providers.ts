import { JsonRpcProvider } from '@ethersproject/providers';
import { singleton } from 'tsyringe';
import { JSON_RPC_GOERLI_KEYS, JSON_RPC_MAINNET_KEYS } from '../constants';
import { randomItem } from '../utils';

@singleton()
export default class Providers {
  private readonly providers: Record<string, JsonRpcProvider[]>;

  constructor() {
    const mainnetProviders = JSON_RPC_MAINNET_KEYS.map((item) => {
      return new JsonRpcProvider(item);
    });

    const goerliProviders = JSON_RPC_GOERLI_KEYS.map((item) => {
      return new JsonRpcProvider(item);
    })

    this.providers = {
      '1': mainnetProviders,
      '5': goerliProviders
    };
  }

  getProviderByChainId(chainId: string): JsonRpcProvider {
    const chainIdProviders = this.providers[chainId];
    if (!chainIdProviders || chainIdProviders.length === 0) {
      throw new Error(`Provider not available for chain id: ${chainId}`);
    }
    const provider = randomItem(chainIdProviders);
    return provider;
  }
}
