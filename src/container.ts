import Firebase from './database/Firebase';
import { container, delay } from 'tsyringe';
import MetadataClient from './services/Metadata';
import TokenDao from './dao/Token.dao';
import CollectionService from './models/CollectionService';

export const firebase: Firebase = container.resolve(Firebase);
export const metadataClient: MetadataClient = container.resolve(MetadataClient);
export const tokenDao: TokenDao = container.resolve(TokenDao);
export const collectionService: CollectionService = container.resolve(delay(() => CollectionService));
