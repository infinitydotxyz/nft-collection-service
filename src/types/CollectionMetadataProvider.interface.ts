import { CollectionMetadata } from './Collection.interface';

export interface CollectionMetadataProvider {
  getCollectionMetadata: (address: string) => Promise<CollectionMetadata>;
}
