import { MAX_UNCLE_ABLE_BLOCKS } from '../../constants';
import { ethers } from 'ethers';
import { Readable } from 'node:stream';
import { CollectionAttributes } from 'types/Collection.interface';
import { Token } from 'types/Token.interface';
import { sleep } from '../../utils';
import { ethersErrorHandler, getProviderByChainId } from '../../utils/ethers';
import IContract, { HistoricalLogs, HistoricalLogsOptions, TokenStandard } from './Contract.interface';

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

  /**
   * stream return type should be used for getting events as fast as
   * possible and handling events as they are available
   *
   * generator should be used to lazily request events
   *
   * promise should be used to get all events at once
   */
  returnType?: 'stream' | 'generator' | 'promise';
}

export default abstract class Contract implements IContract {
  address: string;

  chainId: string;

  abstract standard: TokenStandard;

  protected contract: ethers.Contract;

  protected provider: ethers.providers.JsonRpcProvider;

  abstract aggregateTraits(tokens: Token[]): CollectionAttributes;

  abstract decodeDeployer(event: ethers.Event): string;

  abstract decodeTransfer(event: ethers.Event): { to: string; from: string; tokenId: string };

  abstract getContractDeployer(): Promise<string>;

  abstract getContractCreationTx(): Promise<ethers.Event>;

  abstract getMints(options?: HistoricalLogsOptions): Promise<HistoricalLogs>;

  abstract getTokenIds(): Promise<string[]>;

  abstract getTokenUri(tokenId: string): Promise<string>;

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
  ): Promise<HistoricalLogs> {
    let { fromBlock, toBlock = 'latest', maxAttempts = 5, returnType = 'stream' } = options;

    toBlock = toBlock ?? 'latest';

    const getMaxBlock = async (
      provider: ethers.providers.JsonRpcProvider,
      toBlock: number | 'latest'
    ): Promise<number> => {
      let maxBlock: number;
      if (typeof toBlock === 'string') {
        try {
          maxBlock =(await provider.getBlockNumber()) - MAX_UNCLE_ABLE_BLOCKS; 
        } catch (err) {
          throw new Error('failed to get current block number');
        }
      } else {
        maxBlock = toBlock;
      }
      return maxBlock;
    };

    const maxBlock = await getMaxBlock(provider, toBlock);
    const generator = this.paginateLogsHelper(thunkedLogRequest, fromBlock, maxBlock, maxAttempts);
    let readable: Readable;
    switch (returnType) {
      case 'stream':
        readable = Readable.from(generator);
        return readable;
      case 'generator':
        return generator;
      case 'promise':
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        readable = Readable.from(generator);
        let events: ethers.Event[] = [];
        for await (const data of readable) {
          events = [...events, ...data];
        }
        return events;
    }
  }

  private *paginateLogsHelper(
    thunkedLogRequest: ThunkedLogRequest,
    minBlock: number,
    maxBlock: number,
    maxAttempts: number
  ): Generator<Promise<ethers.Event[]>, void, unknown> {
    let from = minBlock;

    const errorHandler = ethersErrorHandler<ethers.Event[]>(maxAttempts, 1000);

    while (from < maxBlock) {
      // we can get a max of 2k blocks at once
      let to = from + 2000;

      if (to > maxBlock) {
        to = maxBlock;
      }
        yield errorHandler(async () => await thunkedLogRequest(from, to));

        const size = maxBlock - minBlock; // TODO
        const progress = Math.floor(((from - minBlock) / size) * 100 * 100) / 100;
        console.log(`[${progress}%] Got blocks: ${from} - ${to}`); // TODO

        from = to + 1;
    }
  }
}
