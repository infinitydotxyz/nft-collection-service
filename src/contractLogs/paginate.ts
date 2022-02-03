import { JsonRpcProvider } from '@ethersproject/providers';
import { ethers } from 'ethers';

export interface LogRequestOptions {
  fromBlock?: number;
  toBlock?: number;
}

export type LogRequest = (address: string, chainId: string, options?: LogRequestOptions) => ethers.Event[];

export type ThunkedLogRequest = (fromBlock: number, toBlock: number) => Promise<ethers.Event[]>;

/**
 * paginateLogs handles paginating a log request over any number of blocks
 *
 * note: we are limited to requesting 2k blocks at a time
 *
 * toBlock will default to latest if not specified
 */
export async function paginateLogs(
  thunkedLogRequest: ThunkedLogRequest,
  provider: JsonRpcProvider,
  fromBlock: number,
  toBlock?: number | 'latest',
  maxAttempts = 3
) {
  toBlock = toBlock ?? 'latest';
  const maxBlock = await getMaxBlock(provider, toBlock);

  let from = fromBlock;
  let events: ethers.Event[] = [];
  let attempts = 0;

  while (from < maxBlock) {
    let to = from + 1999;

    if (to > maxBlock) {
      to = maxBlock;
    }

    try {
      const pageEvents = await thunkedLogRequest(from, to);
      events = [...events, ...pageEvents];
      console.log(`Got logs for blocks: ${from} - ${to} Max: ${maxBlock}`)
      from = to;
      attempts = 0; // resets each time we successfully get a block
    } catch (err) {
      attempts += 1;
      if (attempts > maxAttempts) {
        throw err;
      }
      console.error(err);
    }
  }

  return events;
}

async function getMaxBlock(provider: JsonRpcProvider, toBlock: number | 'latest') {
  let maxBlock: number;

  if (typeof toBlock === 'string') {
    try {
      maxBlock = await provider.getBlockNumber();
    } catch (err) {
      throw new Error('failed to get current block number');
    }
  } else {
    maxBlock = toBlock;
  }
  return maxBlock;
}
