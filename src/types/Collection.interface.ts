import { TokenStandard } from 'contracts/Contract.interface';

/**
 * Collection metadata that can be edited by the owner
 */
export interface CollectionMetadata {
  name: string;
  description: string;
  symbol: string;
  profileImage: string;
  bannerImage: string;
  links: Links;
}

/**
 * Relevant links
 */
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

  /**
   * deployer of the contract
   * (i.e the address that created the contract)
   */
  deployer: string;

  /**
   * current owner of the contract
   */
  owner: string;

  /**
   * editable collection metadata
   */
  metadata: CollectionMetadata;
}

interface BaseCollection {
  chainId: string;

  address: string;

  tokenStandard: TokenStandard;

  deployer: string;
  
  owner: string;

  metadata: CollectionMetadata;

  /**
   * number of available tokens in the collection 
   * (i.e. not burned/destroyed)
   */
  tokens: number; 

  traits: { [traitType: string]: { [traitValue: string | number]: TraitValueMetadata } };
}

export interface ERC721Collection extends BaseCollection {
  tokenStandard: TokenStandard.ERC721;
}

interface TraitValueMetadata {
    /**
     * number of tokens with this trait
     */
    count: number;
}