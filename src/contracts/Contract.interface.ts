import { ethers } from "ethers";

export enum TokenStandard {
    ERC721 = 'ERC721',
    ERC1155 = 'ERC1155'
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
     * returns a promise for all of the mint events
     */
    getMints: (options?: { fromBlock?: number; toBlock?: number | 'latest' }) => Promise<ethers.Event[]>;

    /**
     * returns a promise for all token ids in the collection
     */
    getTokenIds: () => Promise<string[]>;
}