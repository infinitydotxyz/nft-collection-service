function getEnvironmentVariable(name: string, required = true): string {
    const variable = process.env[name] ?? "";
    if (required && !variable) {
      throw new Error(`Missing environment variable ${name}`);
    }
    return variable;
}

export const JSON_RPC_MAINNET = getEnvironmentVariable("JSON_RPC_MAINNET");
export const OPENSEA_API_KEY = getEnvironmentVariable("OPENSEA_API_KEY");
const INFURA_IPFS_PROJECT_ID = getEnvironmentVariable("INFURA_IPFS_PROJECT_ID");
const INFURA_IPFS_PROJECT_SECRET = getEnvironmentVariable("INFURA_IPFS_PROJECT_SECRET");

const infuraApiKey = Buffer.from(`${INFURA_IPFS_PROJECT_ID}:${INFURA_IPFS_PROJECT_SECRET}`).toString('base64');
export const INFURA_API_KEY = `Basic ${infuraApiKey}`;

export const NULL_ADDR = "0x0000000000000000000000000000000000000000"

