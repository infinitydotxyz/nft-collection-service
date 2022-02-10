import { Erc721Metadata } from './Metadata.interface';

export type TokenMetadata = Erc721Metadata;

interface BaseToken {
  /**
   * current owner of the token
   */
  owner: string;

  tokenId: string;

  /**
   * unix timestamp (in ms)
   */
  mintedAt: number;

  /**
   * unix timestamp (in ms) of when the token was burned
   *
   * only available if the token has been burned
   */
  destroyedAt?: number;

  /**
   * cached raw metadata
   */
  metadata: TokenMetadata;
  
  /**
   * number of trait_types that this token has
   */
  numTraitTypes: number;

  /**
   * unix timestamp (in ms) that the token metadata was updated at 
   */
  updatedAt: number;

  tokenUri: string;

  /**
   * sum of the token's rarity scores
   * 
   * should not be changed until all tokens are ready to be updated
   */
  rarityScore?: number;

  /**
   * rank relative to other items in the collection
   */
  rarityRank?: number;

  /**
   * cached token image
   */
  image: {
    /**
     * url to the image stored in gcs
     */
    url: string;

    /**
     * mime type for the media
     */
    contentType: string;

    /**
     * unix timestamp (in ms) of when the image was updated 
     */
    updatedAt: number;
  };

  /**
   * indicates if we failed to update this token 
   */
  error?: {
    reason: string;
    timestamp: number;
  }
}

export interface Erc721Token extends BaseToken {
  metadata: Erc721Metadata;
}

export type Token = Erc721Token;
