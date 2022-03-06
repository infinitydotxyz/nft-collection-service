import { CollectionMetadata } from '@infinityxyz/types/core/Collection';

export interface CollectionMetadataProvider {
  getCollectionMetadata: (address: string) => Promise<CollectionMetadata>;
}
