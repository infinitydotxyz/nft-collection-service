import { BigNumber, Contract, ethers } from 'ethers';
import { getProviderByChainId } from '../utils/ethers';
import IContract, { TokenStandard } from './Contract.interface';
import Erc721Abi from '../abi/Erc721';
import { NULL_ADDR } from '../constants';
import AbstractContract, { ThunkedLogRequest } from './Contract.abstract';

export default class Erc721Contract extends AbstractContract {
  readonly standard = TokenStandard.ERC721;

  private baseUriAvailable?: boolean;
  private baseUri?: string;

  constructor(address: string, chainId: string) {
    super(address, chainId, Erc721Abi);
  }

  async getContractCreator(): Promise<string> {
    const tx = await this.getContractCreationTx();
    const creator: string = (tx?.args?.[1] as string)?.toLowerCase?.() ?? '';
    return creator;
  }

  async getContractCreationTx(): Promise<ethers.Event> {
    const filter = this.contract.filters.OwnershipTransferred(NULL_ADDR);
    // eslint-disable-next-line no-useless-catch
    try {
      const contractCreationTx = await this.contract.queryFilter(filter);
      const tx = contractCreationTx?.[0];
      if (tx) {
        return tx;
      }

      throw new Error(`failed to get contract creator tx for: ${this.address} on chain: ${this.chainId}`);
    } catch (err) {
      throw err;
    }
  }

  async getMints(options?: { fromBlock?: number; toBlock?: number | 'latest' }): Promise<ethers.Event[]> {
    const mintsFilter = this.contract.filters.Transfer(NULL_ADDR);

    console.time('start');
    try {
      const thunkedLogRequest: ThunkedLogRequest = async (fromBlock: number, toBlock: number | 'latest') => {
        return await this.contract.queryFilter(mintsFilter, fromBlock, toBlock);
      };

      let fromBlock = options?.fromBlock;
      if (typeof fromBlock !== 'number') {
        const firstTransaction = await this.getContractCreationTx();
        fromBlock = firstTransaction.blockNumber;
      }

      const mints = await this.paginateLogs(thunkedLogRequest, this.provider, {
        fromBlock,
        toBlock: options?.toBlock,
        removeDuplicates: true,
        duplicateSelector: (event) => (event?.args?.[2] as BigNumber)?.toString?.() // remove duplicates by token id
      });

      console.log(`Found: ${mints.length} mints`);
      console.timeEnd('start');
      return mints;
    } catch (err) {
      console.error(err);
      throw new Error('failed to get mints'); // TODO improve error handling
    }
  }

  async getTokenIds(): Promise<string[]> {
    const mints = (await this.getMints()) ?? [];
    return mints.map((mint) => {
      const args = mint?.args;
      const tokenId = (args?.[2] as BigNumber)?.toString?.();
      return tokenId;
    });
  }

  /**
   * there are two ways to get the token uri
   * 1. call tokenUri on the contract
   * 2. call baseUri on the contract and append the tokenId to the response
   */
  async getTokenUri(tokenId: string): Promise<string> {
    let tokenUri;
    let baseUri;
    try {
      baseUri = await this.getBaseUri();
      if (baseUri) {
        tokenUri = `${baseUri}${tokenId}`;
        return tokenUri;
      }
    } catch {
      // base uri is not supported
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const response: string[] = await this.contract.functions.tokenURI(tokenId);
      const tokenUri = response[0];
      if (typeof tokenUri === 'string' && tokenUri) {
        return tokenUri;
      }
      throw new Error('failed to get token uri');
    } catch (err) {
      throw new Error('failed to get token uri');
    }
  }

  private async getBaseUri(refresh = false): Promise<string> {
    if (this.baseUriAvailable && this.baseUri && !refresh) {
      return this.baseUri;
    }

    if (this.baseUriAvailable === false && !refresh) {
      throw new Error('contract does not support base uri');
    }

    try {
      const response: string[] = await this.contract.functions.baseURI();

      if (typeof response[0] === 'string' && response[0]) {
        this.baseUri = response[0];
        this.baseUriAvailable = true;
        return this.baseUri;
      }
    } catch (err: any) {
      if ('code' in err && err.code === 'CALL_EXCEPTION') {
        this.baseUriAvailable = false;
        this.baseUri = undefined;
        throw new Error('contract does not support base uri');
      }
    }
    return '';
  }
}
