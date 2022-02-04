import { ethers } from "ethers";
import { JSON_RPC_MAINNET } from "../constants";

export function getProviderByChainId(chainId: string): ethers.providers.JsonRpcProvider {
  switch (chainId) {
    case "1":
      return new ethers.providers.JsonRpcProvider(JSON_RPC_MAINNET);
    default: 
        throw new Error(`Provider not available for chain id: ${chainId}`);
  }
}
