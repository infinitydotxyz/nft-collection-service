import { Erc721Metadata } from './Metadata.interface';
import { RefreshTokenErrorJson } from '../models/errors/RefreshTokenFlow'

export type TokenMetadata = Erc721Metadata;


export type MintToken = Pick<Token, 'mintedAt' | 'minter' | 'tokenId' | 'state'>;

export type UriToken = MintToken & Pick<Token, 'tokenUri'>;

export type MetadataToken = UriToken & Pick<Token, 'metadata' | 'numTraitTypes' | 'updatedAt'>;

export type ImageToken = MetadataToken & Pick<Token, 'image'>;

export type AggregatedToken = ImageToken & Pick<Token, 'rarityScore' | 'rarityRank'>;


export enum RefreshTokenFlow {
  /**
   * get the token uri
   */
  Uri = 'token-uri',

  /**
   * get the token metadata
   */
  Metadata = 'token-metadata',

  /**
   * upload the image to gcs
   */
  Image = 'token-image',

  /**
   * set token rarity
   */
  Aggregate = 'token-aggregate',

  Complete = 'complete'
}

interface BaseToken {
  /**
   * original minter of the token
   */
  minter: string;

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

  state?: {
    metadata: { 
      step: RefreshTokenFlow,
      error?: RefreshTokenErrorJson
    }
  }
}

export interface Erc721Token extends BaseToken {
  metadata: Erc721Metadata;
}

export type Token = Erc721Token;
