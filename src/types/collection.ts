import { TokenStandard } from "contracts/Contract.interface";

export interface CollectionMetadata {
    name: string;
    description: string;
    symbol: string;
    profileImage: string;
    bannerImage: string;
    links: Links;
}

export interface Links {
    timestamp: number;
    twitter?: string;
    discord?: string;
    external?: string;
    medium?: string;
    slug?: string;
    telegram?: string;
    instagram?: string;
    wiki?: string;
    facebook?: string;
}



export interface Collection {
    chainId: string;
    address: string;
    tokenStandard: TokenStandard;

    deployer: string;
    owner: string;

    /**
     * editable collection metadata
     */
    metadata: CollectionMetadata;

    /**
     * traits for all tokens
     */
    traits: any;
}

