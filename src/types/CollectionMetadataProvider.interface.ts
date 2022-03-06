import { CollectionMetadata } from '@infinityxyz/types/core';

export interface CollectionMetadataProvider {
  getCollectionMetadata: (address: string) => Promise<CollectionMetadata>;
}
