import { ethers } from 'ethers';
import { randomItem, sleep } from './';
import { JSON_RPC_MAINNET_KEYS } from '../constants';

export function getProviderByChainId(chainId: string): ethers.providers.JsonRpcProvider {
  switch (chainId) {
    case '1':
      const JSON_RPC_MAINNET = randomItem(JSON_RPC_MAINNET_KEYS);
      const provider = new ethers.providers.JsonRpcProvider(JSON_RPC_MAINNET);
      return provider;
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

export function ethersErrorHandler<Response>(
  maxAttempts = 5,
  retryDelay = 1000
): (request: EthersJsonRpcRequest<Response>) => Promise<Response> {
  return async (request: EthersJsonRpcRequest<Response>): Promise<Response> => {
    const attempt = async (attempts = 0): Promise<Response> => {
      attempts += 1;
      try {
        const res = await request();
        return res;
      } catch (err: any) {
        if (attempts > maxAttempts) {
          throw err;
        }

        if ('code' in err) {
          switch (err.code) {
            case JsonRpcError.RateLimit:
              await sleep(retryDelay);
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
              await sleep(retryDelay);
              return await attempt(attempts);

            case 'ETIMEDOUT':
              await sleep(retryDelay);
              return await attempt(attempts);

            case 'SERVER_ERROR':
              await sleep(retryDelay);
              return await attempt(attempts);

            default:
              console.log(`Encountered unknown error code ${err.code}`);
              throw err;
          }
        }

        console.log('failed to get code from ethers error');
        console.log(err);

        return await attempt(attempts);
      }
    };

    const response = await attempt();
    return response;
  };
}
