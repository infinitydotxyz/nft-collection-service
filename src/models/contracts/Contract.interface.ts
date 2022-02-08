import { ethers } from "ethers";
import { Readable } from "node:stream";
import { CollectionTraits } from "types/Collection.interface";
import { Token } from "types/Token.interface";

export enum TokenStandard {
    ERC721 = 'ERC721',
    ERC1155 = 'ERC1155'
}

export type HistoricalLogs = Readable | ethers.Event[] | Generator<Promise<ethers.Event[]>, void, unknown>;

export interface HistoricalLogsOptions {
    fromBlock?: number;
    toBlock?: number | 'latest';
    returnType?: "stream" | 'promise' | 'generator';
  }

export default interface Contract {
    address: string;

    chainId: string;

    standard: TokenStandard;

    aggregateTraits: (tokens: Token[]) => CollectionTraits;

    /**
     * takes the event that created the contract
     * returns the address that deployed the contract
     */
    decodeDeployer: (event: ethers.Event) => string;

    
    decodeTransfer: (event: ethers.Event) => {to: string, from: string, tokenId: string};

    /**
     * returns a promise for the address of the deployer of the contract
     */
    getContractDeployer: () => Promise<string>;

    /**
     * returns a promise for the event where the contract was created
     */
    getContractCreationTx: () => Promise<ethers.Event>;

    /**
     * returns a promise of a readable stream of mint events
     */
    getMints: (options?: HistoricalLogsOptions) => Promise<HistoricalLogs>;

    /**
     * returns a promise for all token ids in the collection
     */
    getTokenIds: () => Promise<string[]>;

    /**
     * returns a promise for the uri of the token's metadata
     */
    getTokenUri: (tokenId: string) => Promise<string>;
}