import { CreationFlow } from '../Collection';

export class CreationFlowError extends Error {
  discriminator: CreationFlow | 'unknown';

  constructor(discriminator: CreationFlow | 'unknown', message?: string) {
    super(message);
    this.discriminator = discriminator;
  }

  toJSON(): { message: string; discriminator: string } {
    return {
      message: this.message,
      discriminator: this.discriminator
    };
  }
}

export class CollectionCreatorError extends CreationFlowError {
  constructor(message?: string) {
    super(CreationFlow.CollectionCreator, message);
  }
}

export class CollectionMetadataError extends CreationFlowError {
  constructor(message?: string) {
    super(CreationFlow.CollectionMetadata, message);
  }
}

export enum TokenMetadataError {
  KnownTokenErrors = 'knownTokenErrors',
  UnknownTokenErrors = 'unknownTokenErrors'
}

export interface CollectionTokenMetadataErrorType {
  message: string;
  discriminator: CreationFlow.TokenMetadata;
  type: TokenMetadataError;
}

export class CollectionMintsError extends CreationFlowError {
  constructor(message?: string) {
    super(CreationFlow.CollectionMints, message);
  }
}

export class CollectionTokenMetadataError extends CreationFlowError {
  type: TokenMetadataError;

  constructor(type: TokenMetadataError, message?: string) {
    super(CreationFlow.TokenMetadata, message);
    this.type = type;
  }

  toJSON(): CollectionTokenMetadataErrorType {
    return {
      message: this.message,
      discriminator: this.discriminator as CreationFlow.TokenMetadata,
      type: this.type
    };
  }
}

export class CollectionAggregateMetadataError extends CreationFlowError {
  constructor(message?: string) {
    super(CreationFlow.AggregateMetadata, message);
  }
}

export class UnknownError extends CreationFlowError {
  constructor(message?: string) {
    super('unknown', message);
  }
}