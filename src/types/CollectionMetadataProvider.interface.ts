import { CollectionMetadata } from '@infinityxyz/lib/types/core';

export interface CollectionMetadataProvider {
  getCollectionMetadata: (address: string) => Promise<CollectionMetadata>;
}
