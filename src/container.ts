import Firebase from './database/Firebase';
import { container } from 'tsyringe';
import MetadataClient from './services/Metadata';

export const firebase: Firebase = container.resolve(Firebase);
export const metadataClient: MetadataClient = container.resolve(MetadataClient)