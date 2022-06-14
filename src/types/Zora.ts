import { ZoraContent } from '@infinityxyz/lib/types/services/zora/tokens';

export interface ZoraTokensOwnerContentImageResponse {
  tokens: {
    nodes: ZoraToken[];
    pageInfo: {
      endCursor: string;
      hasNextPage: boolean;
      limit: number;
    };
  };
}

export interface ZoraToken {
  token: {
    tokenId: string;
    owner: string;
    content: ZoraContent;
    image: ZoraContent;
  };
}
