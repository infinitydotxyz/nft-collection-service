import { ethers } from 'ethers';
import { filterDuplicates } from '../utils';
import { getProviderByChainId } from '../utils/ethers';
import IContract, { TokenStandard } from './Contract.interface';

export interface LogRequestOptions {
  fromBlock?: number;
  toBlock?: number;
}

export type LogRequest = (address: string, chainId: string, options?: LogRequestOptions) => ethers.Event[];

export type ThunkedLogRequest = (fromBlock: number, toBlock: number) => Promise<ethers.Event[]>;

export interface PaginateLogsOptions {
  fromBlock: number;
  toBlock?: number | 'latest';
  maxAttempts?: number;
  removeDuplicates?: boolean;
  duplicateSelector?: (event: ethers.Event) => string;
}

export default abstract class Contract implements IContract {
  address: string;

  chainId: string;

  abstract standard: TokenStandard;

  protected contract: ethers.Contract;

  protected provider: ethers.providers.JsonRpcProvider;

  abstract getContractCreator(): Promise<string>;

  abstract getContractCreationTx(): Promise<ethers.Event>;

  abstract getMints(): Promise<ethers.Event[]>;

  abstract getTokenIds(): Promise<string[]>;

    /**
   * throws an error if the chainId is invalid
   */
  constructor(address: string, chainId: string, abi: ethers.utils.Fragment[]) {
    this.address = address;
    this.chainId = chainId;
    this.provider = getProviderByChainId(this.chainId);
    this.contract = new ethers.Contract(this.address, abi, this.provider);
  }

  /**
   * paginateLogs handles paginating a log request over any number of blocks
   *
   * note: we are limited to requesting 2k blocks at a time
   *
   * toBlock will default to latest if not specified
   */
  protected async paginateLogs(
    thunkedLogRequest: ThunkedLogRequest,
    provider: ethers.providers.JsonRpcProvider,
    options: PaginateLogsOptions
  ) {
    let {
      fromBlock,
      toBlock = 'latest',
      maxAttempts = 3,
      removeDuplicates = true,
      duplicateSelector = (event: ethers.Event) => event.transactionHash
    } = options;

    toBlock = toBlock ?? 'latest';

    const getMaxBlock = async (provider: ethers.providers.JsonRpcProvider, toBlock: number | 'latest') => {
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
    };

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
        const size = maxBlock - fromBlock;
        const progress = Math.floor(((from - fromBlock) / size) * 100 * 100) / 100;
        console.log(`[${progress}%] Got blocks: ${from} - ${to} found: ${events.length} tokens`); // TODO
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

    if (removeDuplicates) {
      events = filterDuplicates(events, duplicateSelector);
    }

    return events;
  }
}
