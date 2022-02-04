import { ethers } from "ethers";
import { Readable } from "node:stream";

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

    /**
     * returns a promise for the address of the creator of the contract
     */
    getContractCreator: () => Promise<string>;

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
}