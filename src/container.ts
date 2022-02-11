import Firebase from './database/Firebase';
import { container } from 'tsyringe';
import MetadataClient from './services/Metadata';
import TokenDao from './dao/Token.dao';

export const firebase: Firebase = container.resolve(Firebase);
export const metadataClient: MetadataClient = container.resolve(MetadataClient);
export const tokenDao: TokenDao = container.resolve(TokenDao)