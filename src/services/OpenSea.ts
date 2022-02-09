import { ethers } from 'ethers';
import got, {
  CacheError,
  CancelError,
  Got,
  MaxRedirectsError,
  ParseError,
  ReadError,
  RequestError,
  TimeoutError,
  UnsupportedProtocolError,
  UploadError
} from 'got';
import { sleep } from '../utils';
import { OPENSEA_API_KEY } from '../constants';
import {CollectionMetadata} from '../types/Collection.interface' 
import { CollectionMetadataProvider } from '../types/CollectionMetadataProvider.interface';

type GotError =
  | RequestError
  | CacheError
  | ReadError
  | ParseError
  | UploadError
  | MaxRedirectsError
  | UnsupportedProtocolError
  | TimeoutError
  | CancelError;

function isGotError(error: GotError | unknown): boolean {
  return (
    error instanceof CacheError ||
    error instanceof ReadError ||
    error instanceof RequestError ||
    error instanceof ParseError ||
    error instanceof UploadError ||
    error instanceof MaxRedirectsError ||
    error instanceof UnsupportedProtocolError ||
    error instanceof TimeoutError ||
    error instanceof CancelError
  );
}

/**
 * we try not to use OpenSea more than we have to 
 * prefer other methods of getting data if possible
 */
export default class OpenSeaClient implements CollectionMetadataProvider {
  private readonly client: Got;
  private readonly maxAttempts: number;
  constructor(maxAttempts?: number) {
    this.maxAttempts = typeof maxAttempts === 'number' ? maxAttempts : 3;

    this.client = got.extend({
      prefixUrl: 'https://api.opensea.io/api/v1/',
      headers: {
        'x-api-key': OPENSEA_API_KEY
      },
      /**
       * requires us to check status code
       */
      throwHttpErrors: false,
      cache: false,
      timeout: 20_000,
    });
  }

  /**
   * getCollectionMetadata gets basic info about a collection: name, description, links, images
   * 
   * it seems like rate limits are not an issue on this endpoint - at this time
   * (it handles ~500 requests at once using the default api key and none get rate limited)
   * 
   * etherscan has a similar endpoint that seems decent if this begins to fail
   */
  async getCollectionMetadata(address: string, attempt?: number): Promise<CollectionMetadata> {

    attempt = (attempt ?? 0) + 1;

    if (!ethers.utils.isAddress(address)) {
      throw new Error('Invalid address');
    }

    let response;
    try {
      response = await this.client.get(`asset_contract/${address}`, {
          responseType: 'json'
      });
    } catch (error: GotError | unknown) {
      if (!isGotError(error)) {
        throw error;
      }
  
      if (attempt > this.maxAttempts) {
        throw new Error(`failed to get contract in ${this.maxAttempts} attempts`);
      }

      return await this.getCollectionMetadata(address, attempt);
    }

    const OpenSeaIsShit = 504;
    switch (response?.statusCode) {
      case 200:
        const data = response.body as OpenSeaContractResponse;
        const collection = data.collection;

        const dataInInfinityFormat: CollectionMetadata = {
            name: data.name ?? "",
            description: data.description ?? "",
            symbol: data.symbol ?? "",
            profileImage: collection.image_url,
            bannerImage: collection.banner_image_url,
            links: {
                timestamp: new Date().getTime(),
                discord: collection.discord_url ?? '',
                external: collection.external_url ?? '',
                medium: typeof collection?.medium_username === 'string' ? `https://medium.com/${collection.medium_username}` : '',
                slug: collection?.slug ?? '',
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                telegram: collection?.telegram_url  ?? '',
                twitter: typeof collection?.twitter_username ==='string' ? `https://twitter.com/${collection.twitter_username}` : '',
                instagram: typeof collection?.instagram_username  === 'string' ? `https://instagram.com/${collection.instagram_username}` : '',
                wiki: collection?.wiki_url ?? ''
            } 
        }
        return dataInInfinityFormat;
      case 404:
        throw new Error('not found');
      
      case 429: 
        await sleep(5000);
        return await this.getCollectionMetadata(address, attempt)

      case 500: 
        return await this.getCollectionMetadata(address, attempt);

      case OpenSeaIsShit: 
        await sleep(2000);
        return await this.getCollectionMetadata(address, attempt)

      default: 
        await sleep(2000);
        return await this.getCollectionMetadata(address, attempt);
        
    }
  }
}


interface OpenSeaContractResponse {
    collection: Collection;
    address: string;
    asset_contract_type: string;
    created_date: string;
    name: string;
    nft_version: string;
    opensea_version?: unknown;
    owner: number;
    schema_name: string;
    symbol: string;
    total_supply?: unknown;
    description: string;
    external_link: string;
    image_url: string;
    default_to_fiat: boolean;
    dev_buyer_fee_basis_points: number;
    dev_seller_fee_basis_points: number;
    only_proxied_transfers: boolean;
    opensea_buyer_fee_basis_points: number;
    opensea_seller_fee_basis_points: number;
    buyer_fee_basis_points: number;
    seller_fee_basis_points: number;
    payout_address?: unknown;
  }
  interface Collection {
    banner_image_url: string;
    chat_url?: string;
    created_date: string;
    default_to_fiat: boolean;
    description: string;
    dev_buyer_fee_basis_points: string;
    dev_seller_fee_basis_points: string;
    discord_url: string;
    display_data: DisplayData;
    external_url: string;
    featured: boolean;
    featured_image_url: string;
    hidden: boolean;
    safelist_request_status: string;
    image_url: string;
    is_subject_to_whitelist: boolean;
    large_image_url: string;
    medium_username?: string;
    name: string;
    only_proxied_transfers: boolean;
    opensea_buyer_fee_basis_points: string;
    opensea_seller_fee_basis_points: string;
    payout_address?: string;
    require_email: boolean;
    short_description?: string;
    slug: string;
    telegram_url?: string;
    twitter_username: string;
    instagram_username?: string;
    wiki_url: string;
  }
  
  interface DisplayData {
    card_display_style: string;
  }
  
