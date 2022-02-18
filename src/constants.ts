import chalk from 'chalk';
import v8 from 'v8';
import os from 'os';

function getEnvironmentVariable(name: string, required = true): string {
  const variable = process.env[name] ?? '';
  if (required && !variable) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return variable;
}

export const OPENSEA_API_KEY = getEnvironmentVariable('OPENSEA_API_KEY');
export const MORALIS_API_KEY = getEnvironmentVariable('MORALIS_API_KEY');

export const FB_STORAGE_BUCKET = 'nftc-dev.appspot.com';
export const FIREBASE_SERVICE_ACCOUNT = 'firebase-dev.json';

const getInfuraIPFSAuthKeys = (): string[] => {
  const apiKeys = [];

  let i = 0;
  while (true) {
    try {
      const projectId = getEnvironmentVariable(`INFURA_IPFS_PROJECT_ID${i}`);
      const projectSecret = getEnvironmentVariable(`INFURA_IPFS_PROJECT_SECRET${i}`);
      const apiKey = Buffer.from(`${projectId}:${projectSecret}`).toString('base64');
      const header = `Basic ${apiKey}`;
      apiKeys.push(header);
      i += 1;
    } catch (err) {
      break;
    }
  }

  return apiKeys;
};

export const INFURA_API_KEYS = getInfuraIPFSAuthKeys();

export const JSON_RPC_MAINNET_KEYS = (() => {
  const apiKeys = [];
  let i = 0;
  while (true) {
    try {
      const apiKey = getEnvironmentVariable(`JSON_RPC_MAINNET${i}`);
      apiKeys.push(apiKey);
      i += 1;
    } catch (err) {
      break;
    }
  }

  return apiKeys;
})();

export const NULL_ADDR = '0x0000000000000000000000000000000000000000';

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



/**
 * 
 * configs
 * 
 */
export const NUM_OWNERS_TTS = ONE_HOUR * 24;

const available = v8.getHeapStatistics().total_available_size;
const availableInMB = Math.floor(available / 1000000 / 1000) * 1000;
const maxExpectedImageSize = 10; // MB

export const COLLECTION_TASK_CONCURRENCY = os.cpus().length - 1;

const maxConcurrencyPerCollection = Math.floor(((availableInMB / 1.5) / maxExpectedImageSize) / COLLECTION_TASK_CONCURRENCY);
const maxConcurrencyForIPFS = INFURA_API_KEYS.length * 100;
const getMaxConcurrency = (): { limit: number, message: string } => {
  const systemLimit = (maxConcurrencyPerCollection * COLLECTION_TASK_CONCURRENCY);

  if(maxConcurrencyForIPFS < systemLimit) {
    const difference =  systemLimit - maxConcurrencyForIPFS;
    return { 
      limit: maxConcurrencyForIPFS,
      message: `IPFS. Create more ${Math.ceil(difference / 100)} keys to reach max of ${systemLimit}`
    }
  }

  return {
    limit: maxConcurrencyPerCollection,
    message: 'process heap size'
  }
}
const maxConcurrencyObj = getMaxConcurrency();
export const METADATA_CONCURRENCY = maxConcurrencyObj.limit;

export const TOKEN_URI_CONCURRENCY = METADATA_CONCURRENCY;


/**
 * start up log
 */
const bar = '-'.repeat(process.stdout.columns);
const title = 'NFT Scraper'
const margin = process.stdout.columns - title.length
export const START_UP_MESSAGE = `
${bar}
\n
${' '.repeat(Math.abs(margin) / 2)}${chalk.green('NFT Scraper Settings')}
\n
${chalk.gray(bar)}

Collection Concurrency: ${COLLECTION_TASK_CONCURRENCY}
  Concurrency limited by: ${maxConcurrencyObj.message}
Metadata Client Concurrency: ${METADATA_CONCURRENCY} per collection
Token Uri Concurrency: ${TOKEN_URI_CONCURRENCY} per collection

System:
  Heap size: ${availableInMB / 1000} GB

${bar}
`

