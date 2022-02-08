import { BigNumber, ethers } from 'ethers';
import { HistoricalLogs, HistoricalLogsOptions, TokenStandard } from './Contract.interface';
import Erc721Abi from '../../abi/Erc721';
import { NULL_ADDR } from '../../constants';
import AbstractContract, { ThunkedLogRequest } from './Contract.abstract';
import { CollectionTraits } from 'types/Collection.interface';
import { Erc721Token } from 'types/Token.interface';
import { DisplayType } from 'types/Metadata.interface';

export default class Erc721Contract extends AbstractContract {
  readonly standard = TokenStandard.ERC721;

  private baseUriAvailable?: boolean;
  private baseUri?: string;

  constructor(address: string, chainId: string) {
    super(address, chainId, Erc721Abi);
  }

  decodeDeployer(event: ethers.Event): string {
    const deployer: string = (event?.args?.[1] as string)?.toLowerCase?.() ?? '';
    return deployer;
  }

  decodeTransfer(event: ethers.Event): {from: string, to: string, tokenId: string} {
    const args = event?.args;
    const from = args?.[0];
    const to = args?.[1];
    const tokenId = (args?.[2] as BigNumber)?.toString?.();

    if(!to || !from || !tokenId) {
      throw new Error("failed to get token id from event");
    }

    return {
      from,
      to,
      tokenId
    }
  }

  aggregateTraits(tokens: Erc721Token[]): CollectionTraits {
    const tokenMetadata = tokens.map((item) => item.metadata);
    const collectionTraits: CollectionTraits = {};

    const incrementTrait = (value: string | number, traitType?: string, displayType?: DisplayType ): void => {
      const displayTypeField = displayType ? {displayType} : {};
      if(!traitType) {
        traitType = `${value}`
      }

      /**
       * initialize traitType if it doesn't exist
       */
      if(!collectionTraits[traitType]) {
        collectionTraits[traitType] = { 
          ...displayTypeField, 
          values: {}
        };
      }

      /**
       * initialize value if it doesn't exist
       */
      if(!collectionTraits[traitType].values[value]) {
        const prevValues = collectionTraits[traitType].values ?? {};
        collectionTraits[traitType].values = {
          ...prevValues,
          [value]: {count: 0 }
        }
      }

      // increment count
      collectionTraits[traitType].values[value].count += 1;

    }

    for(const metadata of tokenMetadata) {
      const attributes = metadata.data.attributes;

      for(const attribute of attributes) {
        if('display_type' in attribute) {
          incrementTrait(attribute.value, attribute.trait_type, attribute.display_type);
        } else {
          incrementTrait(attribute.value, attribute.trait_type);
        }
      }
    }

    return collectionTraits;
  }

  async getContractDeployer(): Promise<string> {
    const event = await this.getContractCreationTx();
    const deployer = this.decodeDeployer(event);
    return deployer;
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

  /**
   * get all transfers from 0x0
   * 
   * use options to specify a block range and how to receive the events
   */
  async getMints(options?: HistoricalLogsOptions): Promise<HistoricalLogs> {
    const mintsFilter = this.contract.filters.Transfer(NULL_ADDR);
    try {
      const thunkedLogRequest: ThunkedLogRequest = async (fromBlock: number, toBlock: number | 'latest') => {
        return await this.contract.queryFilter(mintsFilter, fromBlock, toBlock);
      };

      let fromBlock = options?.fromBlock;
      if (typeof fromBlock !== 'number') {
        /**
         * the first transaction for this contract
         */
        const firstTransaction = await this.getContractCreationTx();
        fromBlock = firstTransaction.blockNumber;
      }

      const mintsReadable = await this.paginateLogs(thunkedLogRequest, this.provider, {
        fromBlock,
        toBlock: options?.toBlock,
        returnType: options?.returnType
      })

      return mintsReadable;
    } catch (err) {
      console.error(err);
      throw new Error('failed to get mints'); // TODO improve error handling
    }
  }

  async getTokenIds(): Promise<string[]> {
    const mints = (await this.getMints({returnType: 'promise'})) as ethers.Event[];

    return mints.map((mint) => {
      const tokenId = this.decodeTransfer(mint).tokenId;
      return tokenId;
    });
  }

  /**
   * there are ways to get the token uri
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
