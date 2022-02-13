function getEnvironmentVariable(name: string, required = true): string {
    const variable = process.env[name] ?? "";
    if (required && !variable) {
      throw new Error(`Missing environment variable ${name}`);
    }
    return variable;
}


export const OPENSEA_API_KEY = getEnvironmentVariable("OPENSEA_API_KEY");

export const FB_STORAGE_BUCKET='infinity-static';
export const FIREBASE_SERVICE_ACCOUNT = 'firebase-prod.json';


const getInfuraIPFSAuthKeys = (): string[] => {
  const apiKeys = [];
  
  let i = 0;
  while(true) {
    try {
      const projectId = getEnvironmentVariable(`INFURA_IPFS_PROJECT_ID${i}`);
      const projectSecret = getEnvironmentVariable(`INFURA_IPFS_PROJECT_SECRET${i}`);
      const apiKey = Buffer.from(`${projectId}:${projectSecret}`).toString('base64');
      const header = `Basic ${apiKey}`;
      apiKeys.push(header);
      i+= 1;
    }catch(err) {
      break;
    }
  }

  return apiKeys;
}

export const INFURA_API_KEYS = getInfuraIPFSAuthKeys();

export const JSON_RPC_MAINNET_KEYS = (() => {
  const apiKeys = [];
  let i = 0;
  while(true) {
    try {
      const apiKey = getEnvironmentVariable(`JSON_RPC_MAINNET${i}`);
      apiKeys.push(apiKey);
      i+= 1;
    }catch(err) {
      break;
    }
  }

  return apiKeys;
})();


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
