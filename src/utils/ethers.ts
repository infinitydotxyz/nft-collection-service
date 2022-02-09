import { ethers } from 'ethers';
import { sleep } from './';
import { JSON_RPC_MAINNET } from '../constants';

export function getProviderByChainId(chainId: string): ethers.providers.JsonRpcProvider {
  switch (chainId) {
    case '1':
      return new ethers.providers.JsonRpcProvider(JSON_RPC_MAINNET);
    default:
      throw new Error(`Provider not available for chain id: ${chainId}`);
  }
}

enum JsonRpcError {
  RateLimit = 429,
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000
}

type EthersJsonRpcRequest<Response> = () => Promise<Response>;

export async function ethersErrorHandler<Response>(request: EthersJsonRpcRequest<Response>): Promise<Response> {
  const MAX_ATTEMPTS = 5;

  const attempt = async (attempts = 0): Promise<Response> => {
    attempts += 1;
    try {
      const res = await request();
      return res;
    } catch (err: any) {
      if (attempts > MAX_ATTEMPTS) {
        throw err;
      }

      if ('code' in err) {
        switch (err.code) {
          case JsonRpcError.RateLimit:
            await sleep(1000);
            return await attempt(attempts);

          case JsonRpcError.ParseError:
            return await attempt(attempts);

          case JsonRpcError.InvalidRequest:
            throw err;

          case JsonRpcError.MethodNotFound:
            throw err;

          case JsonRpcError.InvalidParams:
            throw err;

          case JsonRpcError.InternalError:
            return await attempt(attempts);

          case JsonRpcError.ServerError:
            await sleep(1000);
            return await attempt(attempts);

          case 'ETIMEDOUT':
            await sleep(1000);
            return await attempt(attempts);

          default:
            throw err;
        }
      }

      return await attempt(attempts);
    }
  };

  const response = await attempt();
  return response;
}
