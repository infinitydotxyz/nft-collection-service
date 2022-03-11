import chalk from 'chalk';
import v8 from 'v8';

/**
 *
 * TODO adi change these for prod
 * ---------------------------------------
 */
export const PROJECT = 'nftc-dev';
export const PROJECT_LOCATION = 'us-east1';
export const FIREBASE_SERVICE_ACCOUNT = 'firebase-dev.json';
export const FB_STORAGE_BUCKET = `${PROJECT}.appspot.com`;
export const TASK_QUEUE_SERVICE_ACCOUNT = 'nftc-dev-task-queue.json';
export const COLLECTION_QUEUE = 'collection-scraping-queue';
export const DEV_COLLECTION_SERVICE_URL = 'https://nft-collection-service-dot-nftc-dev.ue.r.appspot.com';
export const PROD_COLLECTION_SERVICE_URL = ''; // TODO adi add this once deployed to prod
export const COLLECTION_SERVICE_URL = DEV_COLLECTION_SERVICE_URL; 
/**
 * ---------------------------------------
 */

export const COLLECTION_SCHEMA_VERSION = 1;

export const OPENSEA_API_KEY = getEnvironmentVariable('OPENSEA_API_KEY');
export const MORALIS_API_KEY = getEnvironmentVariable('MORALIS_API_KEY');

/**
 * can be any randomly generated key as long as it's consistent across
 * all version of the server
 */
export const COLLECTION_QUEUE_API_KEY = getEnvironmentVariable('COLLECTION_QUEUE_API_KEY');

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

/**
 * in most cases we should not pay attention to blocks until
 * we are sure they won't be uncle'd
 */
export const MAX_UNCLE_ABLE_BLOCKS = 6;
export const NULL_ADDR = '0x0000000000000000000000000000000000000000';

/**
 *
 * times
 *
 */
export const ONE_MIN = 60_000;
export const ONE_HOUR = 60 * ONE_MIN;

/**
 *
 * Concurrency configs
 *
 */
export const NUM_OWNERS_TTS = ONE_HOUR * 24;

const available = v8.getHeapStatistics().total_available_size;
const availableInMB = Math.floor(available / 1000000 / 1000) * 1000;
const maxExpectedImageSize = 10; // MB

export const COLLECTION_TASK_CONCURRENCY = 5;

const maxConcurrencyPerCollection = Math.floor(availableInMB / 1.5 / maxExpectedImageSize / COLLECTION_TASK_CONCURRENCY);
let maxConcurrencyForIPFS = INFURA_API_KEYS.length * 100;
if (maxConcurrencyForIPFS > 400) {
  // set the max concurrency lower since we currently get rate limited based on ip or account
  maxConcurrencyForIPFS = 400;
}
const maxConcurrencyForIPFSPerCollection = Math.floor(maxConcurrencyForIPFS / COLLECTION_TASK_CONCURRENCY);

const maxConcurrencyObj = getMaxConcurrency();
export const METADATA_CONCURRENCY = maxConcurrencyObj.limit;

export const ALCHEMY_CONCURRENCY = 50;
export const IMAGE_UPLOAD_CONCURRENCY = 50;

/**
 *
 * Logger Config
 *
 */
export const INFO_LOG = process.env.INFO_LOG !== 'false'; // explicity set to false to disable logs
export const ERROR_LOG = process.env.ERROR_LOG !== 'false'; // explicitly set to false to disable logs
export const ERROR_LOG_FILE = process.env.ERROR_LOG_FILE ?? ''; // specify file to write to error log file

/**
 *
 * start up log
 *
 */
const bar = '-'.repeat(process.stdout.columns);
const title = 'NFT Scraper';
const margin = process.stdout.columns - title.length;
export const START_UP_MESSAGE = `
${bar}
\n
${' '.repeat(Math.abs(margin) / 2)}${chalk.green('NFT Scraper Settings')}
\n
${chalk.gray(bar)}

Collection Concurrency: ${COLLECTION_TASK_CONCURRENCY}
  Concurrency limited by: ${maxConcurrencyObj.message}
Metadata Client Concurrency: ${METADATA_CONCURRENCY} per collection
Alchemy Concurrency: ${ALCHEMY_CONCURRENCY} per collection
Image Upload Concurrency: ${IMAGE_UPLOAD_CONCURRENCY} per collection

System:
  Heap size: ${availableInMB / 1000} GB

${bar}
`;

/**
 *
 * helper functions
 *
 */

function getEnvironmentVariable(name: string, required = true): string {
  const variable = process.env[name] ?? '';
  if (required && !variable) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return variable;
}

function getMaxConcurrency(): { limit: number; message: string } {
  const systemLimit = maxConcurrencyPerCollection * COLLECTION_TASK_CONCURRENCY;

  if (maxConcurrencyForIPFS < systemLimit) {
    const difference = systemLimit - maxConcurrencyForIPFS;
    return {
      limit: maxConcurrencyForIPFSPerCollection > 20 ? maxConcurrencyForIPFS : 20,
      message: `IPFS. Create more ${Math.ceil(difference / 100)} keys to reach max of ${systemLimit}`
    };
  }

  return {
    limit: maxConcurrencyPerCollection > 20 ? maxConcurrencyPerCollection : 20,
    message: 'process heap size'
  };
}
