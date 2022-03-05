import { CollectionMetadata } from 'infinity-types/types/Collection';

export interface CollectionMetadataProvider {
  getCollectionMetadata: (address: string) => Promise<CollectionMetadata>;
}
