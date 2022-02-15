import {
  ImageToken,
  MetadataToken,
  MintToken,
  Token as TokenType,
  TokenMetadata,
  RefreshTokenFlow,
  UriToken,
  AggregatedToken
} from '../types/Token.interface';
import Contract from './contracts/Contract.interface';
import {
    RefreshTokenAggregateError,
  RefreshTokenError,
  RefreshTokenImageError,
  RefreshTokenMetadataError,
  RefreshTokenUriError
} from './errors/RefreshTokenFlow';
import { firebase, metadataClient } from '../container';
import { Response } from 'got';
import { createHash } from 'crypto';

export default class Nft {
  private token: Partial<TokenType>;

  private readonly contract: Contract;

  constructor(token: MintToken & Partial<TokenType>, contract: Contract) {
    this.token = token;
    this.contract = contract;
  }

  public async *refreshToken(reset = false):  AsyncGenerator<{ token: Partial<TokenType>, action?: 'aggregateRequest' }, any, { rarityScore: number, rarityRank: number } | undefined> {
      if(!this.token.state?.metadata?.step) {
          this.token.state = {
              ...(this.token.state ?? {}),
              metadata: {
                  step: RefreshTokenFlow.Uri
              }
          }
      }
    if (reset) {
      this.token.state.metadata.step = RefreshTokenFlow.Uri;
    }

    try {
      while (true) {
          console.log(`Starting step: ${this.token.state?.metadata.step}`)
        switch (this.token.state?.metadata.step) {
          case RefreshTokenFlow.Uri:
            const mintToken = this.token as MintToken;
            try {
              const tokenUri = await this.contract.getTokenUri(mintToken.tokenId);

              const uriToken: UriToken = {
                ...mintToken,
                tokenUri: tokenUri,
                state: {
                  metadata: {
                    step: RefreshTokenFlow.Metadata
                  }
                }
              };
              this.token = uriToken;

              yield { token: this.token };
            } catch (err: any) {
              const message = typeof err?.message === 'string' ? (err.message as string) : 'Failed to get token uri';
              throw new RefreshTokenUriError(message);
            }

            break;

          case RefreshTokenFlow.Metadata:
            const uriToken: UriToken = this.token as UriToken;

            try {
              const tokenUri = uriToken.tokenUri;
              const tokenMetadataResponse: Response<string> = (await metadataClient.get(tokenUri)) as Response<string>;
              if (tokenMetadataResponse.statusCode !== 200) {
                throw new RefreshTokenMetadataError(`Bad response. Status Code: ${tokenMetadataResponse.statusCode}`);
              }
              const body = tokenMetadataResponse.body;
              const metadata = JSON.parse(body ) as TokenMetadata;
              const metadataToken: MetadataToken = {
                ...uriToken,
                metadata,
                updatedAt: Date.now(),
                numTraitTypes: metadata.attributes.length,
                state: {
                  metadata: {
                    step: RefreshTokenFlow.Image
                  }
                }
              };
              this.token = metadataToken;

              yield { token: this.token };
            } catch (err: any) {
              const message =
                typeof err?.message === 'string' ? (err.message as string) : 'Failed to get token metadata';
              throw new RefreshTokenMetadataError(message);
            }
            break;

          case RefreshTokenFlow.Image:
            const metadataToken: MetadataToken = this.token as MetadataToken;
            try {
              const imageUrl = metadataToken.metadata.image;

              if (!imageUrl) {
                throw new RefreshTokenMetadataError('Invalid image url');
              }

              const response = await metadataClient.get(imageUrl);
              if (response.statusCode !== 200) {
                throw new RefreshTokenImageError(`Bad response. Status code: ${response.statusCode}`);
              }

              const contentType = response.headers['content-type'];
              const imageBuffer = response.rawBody;
              const hash = createHash('sha256').update(imageBuffer).digest('hex');
              const path = `images/${this.contract.chainId}/collections/${this.contract.address}/${hash}`;
              let publicUrl;

              if (imageBuffer && contentType) {
                const remoteFile = await firebase.uploadBuffer(imageBuffer, path, contentType);
                publicUrl = remoteFile.publicUrl();
              } else if (!imageBuffer) {
                throw new RefreshTokenImageError(
                  `Failed to get image for collection: ${this.contract.address} imageUrl: ${imageUrl}`
                );
              } else if (!contentType) {
                throw new RefreshTokenImageError(
                  `Failed to get content type for image. Collection: ${this.contract.address} imageUrl: ${imageUrl}`
                );
              } else if (!publicUrl) {
                throw new RefreshTokenImageError(
                  `Failed to get image public url for collection: ${this.contract.address} imageUrl: ${imageUrl}`
                );
              }

              const now = Date.now();
              const image = {
                url: publicUrl,
                contentType,
                updatedAt: now
              };

              const imageToken: ImageToken = {
                ...metadataToken,
                image,
                state: {
                  metadata: {
                    step: RefreshTokenFlow.Aggregate
                  }
                }
              };
              this.token = imageToken;

              yield { token: this.token };
            } catch (err: RefreshTokenMetadataError | any) {
              if (err instanceof RefreshTokenMetadataError) {
                throw err;
              }
              const message =
                typeof err?.message === 'string' ? (err.message as string) : 'Failed to upload token image';
              throw new RefreshTokenImageError(message);
            }

            break;

          case RefreshTokenFlow.Aggregate:
            // request aggregated data
            const response = yield { token: this.token, action: 'aggregateRequest' };
            if(typeof response?.rarityRank !== 'number' || typeof response.rarityScore !== 'number')  {
                throw new RefreshTokenAggregateError("Client failed to pass valid aggregate response to nft")
            }
            const { rarityRank, rarityScore} = response;

            const imageToken: ImageToken = this.token as ImageToken;
            const aggregatedToken: AggregatedToken = {
              ...imageToken,
              rarityScore,
              rarityRank,
              state: {
                  metadata: {
                      step: RefreshTokenFlow.Complete
                  }
              }
            };
            this.token = aggregatedToken;

            yield { token: this.token };

            break;
        
          case RefreshTokenFlow.Complete:
            return;
        }
      }
    } catch (err: RefreshTokenError | any) {
      let error;
      let stepToSave: RefreshTokenFlow = this.token.state?.metadata.step ?? RefreshTokenFlow.Uri;
      if (err instanceof RefreshTokenError) {
        error = err;
      } else {
        const message =
          typeof err?.message === 'string'
            ? (err.message as string)
            : "Failed to refresh metadata. It's likely errors are not being handled correctly.";
        stepToSave = RefreshTokenFlow.Uri; // restart
        error = new RefreshTokenError(stepToSave, message);
      }

      const token: Partial<TokenType> = {
        ...this.token,
        state: {
          metadata: {
            step: stepToSave,
            error: error.toJSON()
          }
        }
      };

      this.token = token;

      yield { token };
    }
  }
}
