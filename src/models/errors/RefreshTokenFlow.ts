import { RefreshTokenFlow } from '../../types/Token.interface';

export interface RefreshTokenErrorJson {
    message: string;

    discriminator: RefreshTokenFlow;
}

export class RefreshTokenError extends Error {
    discriminator: RefreshTokenFlow;


    constructor(discriminator: RefreshTokenFlow, message?: string) {
        super(message);
        this.discriminator = discriminator;
    }

    toJSON(): RefreshTokenErrorJson {
        return  {
            message: this.message,
            discriminator: this.discriminator
        }
    }
}

export class RefreshTokenUriError extends RefreshTokenError {
    constructor(message?: string) {
        super(RefreshTokenFlow.Uri, message);
    }
}


export class RefreshTokenMetadataError extends RefreshTokenError {
    constructor(message?: string) {
        super(RefreshTokenFlow.Metadata, message);
    }
}

export class RefreshTokenImageError extends RefreshTokenError {
    constructor(message?: string) {
        super(RefreshTokenFlow.Image, message);
    }
}

export class RefreshTokenAggregateError extends RefreshTokenError {
    constructor(message?: string) {
        super(RefreshTokenFlow.Aggregate, message);
    }
}