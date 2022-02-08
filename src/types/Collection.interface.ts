import { TokenStandard } from '../models/contracts/Contract.interface';
import { DisplayType } from './Metadata.interface';

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

export interface CollectionTraits { [traitType: string]: { 
  displayType?: DisplayType;

  values: {[traitValue: string | number]: TraitValueMetadata } }
}

interface BaseCollection {
  chainId: string;

  address: string;

  tokenStandard: TokenStandard;

  /**
   * deployer of the contract
   * (i.e the address that created the contract)
   */
  deployer: string;

  /**
   * unix timestamp that the contract was deployed at
   */
  deployedAt: number;

  /**
   * current owner of the contract
   */
  owner: string;

  /**
   * editable collection metadata
   */
  metadata: CollectionMetadata;

  /**
   * number of available tokens in the collection
   * (i.e. not burned/destroyed)
   */
  tokens: number;

  traits: CollectionTraits;
}

export interface Erc721Collection extends BaseCollection {
  tokenStandard: TokenStandard.ERC721;
}

export interface Erc1155Collection extends BaseCollection {
  tokenStandard: TokenStandard.ERC1155;
  // TODO this is not finished
}


interface TraitValueMetadata {
  /**
   * number of tokens with this trait
   */
  count: number;
}


export type Collection = Erc721Collection | Erc1155Collection ;