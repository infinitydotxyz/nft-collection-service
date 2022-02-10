function getEnvironmentVariable(name: string, required = true): string {
    const variable = process.env[name] ?? "";
    if (required && !variable) {
      throw new Error(`Missing environment variable ${name}`);
    }
    return variable;
}

export const JSON_RPC_MAINNET = getEnvironmentVariable("JSON_RPC_MAINNET");
export const OPENSEA_API_KEY = getEnvironmentVariable("OPENSEA_API_KEY");

export const FB_STORAGE_BUCKET='nftc-dev.appspot.com'; // TODO adi change for prod
export const FIREBASE_SERVICE_ACCOUNT = 'firebase-dev.json'; // TODO adi change for prod

const INFURA_IPFS_PROJECT_ID = getEnvironmentVariable("INFURA_IPFS_PROJECT_ID");
const INFURA_IPFS_PROJECT_SECRET = getEnvironmentVariable("INFURA_IPFS_PROJECT_SECRET");

const infuraApiKey = Buffer.from(`${INFURA_IPFS_PROJECT_ID}:${INFURA_IPFS_PROJECT_SECRET}`).toString('base64');
export const INFURA_API_KEY = `Basic ${infuraApiKey}`;


export const NULL_ADDR = "0x0000000000000000000000000000000000000000";


/**
 * in most cases we should not pay attention to blocks until 
 * we are sure they won't be uncle'd
 */
export const MAX_UNCLE_ABLE_BLOCKS = 6;

/**
 * times
 */
export const ONE_MIN = 60_000;
export const ONE_HOUR = 60 * ONE_MIN;
