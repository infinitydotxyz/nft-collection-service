import { ethers } from 'ethers';
import { Readable } from 'node:stream';
import { getProviderByChainId } from '../utils/ethers';
import IContract, { HistoricalLogs, TokenStandard } from './Contract.interface';

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

  abstract getContractCreator(): Promise<string>;

  abstract getContractCreationTx(): Promise<ethers.Event>;

  abstract getMints(): Promise<HistoricalLogs>;

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
    options: PaginateLogsOptions,
  ): Promise<HistoricalLogs> {
    let {
      fromBlock,
      toBlock = 'latest',
      maxAttempts = 3,
      returnType = 'stream'
    } = options;

    toBlock = toBlock ?? 'latest';

    const getMaxBlock = async (
      provider: ethers.providers.JsonRpcProvider,
      toBlock: number | 'latest'
    ): Promise<number> => {
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
    const generator = this.paginateLogsHelper(thunkedLogRequest, fromBlock, maxBlock, maxAttempts)
    switch(returnType) {
      case 'stream': 
      const readable = Readable.from(generator);
      return readable;
      case 'generator': 
        return generator;
      case 'promise': 
        return await new Promise<ethers.Event[]>((resolve,reject) => {
          const readable = Readable.from(generator);
          let events: ethers.Event[] = [];
          readable.on('data', (chunk: ethers.Event[]) => {
            events = [...events, ...chunk];
          })
          
          readable.on('end', () => {
            resolve(events);
          })

          readable.on('error', (err)=> {
            reject(err);
          })

        })      
    }
  }


  private *paginateLogsHelper(
    thunkedLogRequest: ThunkedLogRequest,
    minBlock: number,
    maxBlock: number,
    maxAttempts: number
  ): Generator<Promise<ethers.Event[]>, void, unknown> {
    let from = minBlock;

    let attempts = 0;
    while (from < maxBlock) {
      // we can get a max of 2k blocks at once
      let to = from + 2000; 
      
      if (to > maxBlock) {
        to = maxBlock;
      }

      try {
        yield thunkedLogRequest(from, to);
        attempts = 0;
        from = to + 1;
      } catch (err) {
        attempts += 1;
        if (attempts > maxAttempts) {
          throw err;
        }
      }

      const size = maxBlock - minBlock;
      const progress = Math.floor(((from - minBlock) / size) * 100 * 100) / 100;
      console.log(`[${progress}%] Got blocks: ${from} - ${to}`); // TODO
    }
  }
}
