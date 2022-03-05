import { CreationFlow } from '../models/Collection';
import { TokenStandard } from '../models/contracts/Contract.interface';
import { DisplayType } from './Metadata.interface';

export type Collection = Erc721Collection | Erc1155Collection;
export interface Erc721Collection extends BaseCollection {
  tokenStandard: TokenStandard.ERC721;
}

export interface Erc1155Collection extends BaseCollection {
  tokenStandard: TokenStandard.ERC1155;
  // TODO this is not finished
}

interface BaseCollection {
  chainId: string;

  address: string;

  tokenStandard: TokenStandard;

  /**
   * address of the user that queued the index
   * NULL address if not queued by a user
   */
  indexInitiator: string;

  /**
   * whether the collection is verified
   */
  hasBlueCheck: boolean;

  /**
   * deployer of the contract
   * (i.e the address that created the contract)
   */
  deployer: string;

  /**
   * unix timestamp that the contract was deployed at (in ms)
   */
  deployedAt: number;

  /**
   * block the collection was deployed at
   */
  deployedAtBlock: number;

  /**
   * current owner of the contract
   */
  owner: string;

  /**
   * number of unique owners
   */
  numOwners?: number;

  numOwnersUpdatedAt: number;

  /**
   * editable collection metadata
   */
  metadata: CollectionMetadata;

  slug: string;

  /**
   * number of available tokens in the collection
   * (i.e. not burned/destroyed)
   */
  numNfts: number;

  attributes: CollectionAttributes;

  /**
   * total number of trait_types in the collection
   */
  numTraitTypes: number;

  /**
   *
   */
  state: {
    version: number; // provides a way to query and migrate previous version of collections
    create: {
      step: CreationFlow;
      /**
       * epoch of when the step/error was last updated
       */
      updatedAt: number;
      error?: Record<string, any>;
      progress: number;
    };
    export: {
      done: boolean;
    };
  };
}

interface TraitValueMetadata {
  /**
   * number of tokens with this trait
   */
  count: number;

  /**
   * percent of tokens with this trait
   */
  percent: number;

  /**
   * 1 / (percent / 100)
   */
  rarityScore: number;
}

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
  displayType?: string;
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

export interface CollectionAttributes {
  [traitType: string]: {
    displayType?: DisplayType;

    /**
     * number of nfts with this trait type
     */
    count: number;

    /**
     * percent of nfts with this trait type
     */
    percent: number;

    values: { [traitValue: string | number]: TraitValueMetadata };
  };
}
