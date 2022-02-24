import { sleep } from './';
import { logger, providers } from '../container';
import { JsonRpcProvider } from '@ethersproject/providers';

export function getProviderByChainId(chainId: string): JsonRpcProvider {
  return providers.getProviderByChainId(chainId);
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
        logger.error('Failed ethers request', err);
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

            case 'TIMEOUT':
              await sleep(retryDelay);
              return await attempt(attempts);

            default:
              logger.log(`Encountered unknown error code ${err.code}`);
              throw err;
          }
        }

        logger.log('failed to get code from ethers error');
        logger.log(err);

        return await attempt(attempts);
      }
    };

    const response = await attempt();
    return response;
  };
}
