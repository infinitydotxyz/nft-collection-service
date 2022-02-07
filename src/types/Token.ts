import { ERC721Metadata } from "./Metadata.interface";


export interface ERC721Token {

    /**
     * current owner of the token
     */
    owner: string;

    tokenId: string;

    /**
     * unix timestamp (in ms)
     */
    mintDate: number;
    
    /**
     * unix timestamp (in ms) of when the token was burned
     * 
     * only available if the token has been burned
     */
    destroyedDate?: number;

    /**
     * cached raw metadata
     */
    metadata: ERC721Metadata;

    /**
     * image stored by us
     */
    image: string;
}