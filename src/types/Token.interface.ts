import { ERC721Metadata } from './Metadata.interface';


export type TokenMetadata = ERC721Metadata;

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
   * unix timestamp of when the metadata was updated
   */
  metadataUpdatedAt: number;

  image: {
      /**
       * url to the image stored in gcs
       */
      url: string;

      /**
       * mime type for the media
       */
      mime: string;

      /**
       * unix timestamp of when the image was updated
       */
      updatedAt: number;
  }
}

export interface ERC721Token extends BaseToken {
  metadata: ERC721Metadata;
}


export type Token = ERC721Token;