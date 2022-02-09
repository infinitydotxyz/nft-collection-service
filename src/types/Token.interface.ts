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
   * unix timestamp that the token metadata was updated at
   */
  updatedAt: number;

  tokenUri: string;


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
     * unix timestamp of when the image was updated
     */
    updatedAt: number;
  };
}

export interface Erc721Token extends BaseToken {
  metadata: Erc721Metadata;
}

export type Token = Erc721Token;
