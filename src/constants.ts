

function getEnvironmentVariable(name: string, required = true): string {
    const variable = process.env[name] ?? "";
    if (required && !variable) {
      throw new Error(`Missing environment variable ${name}`);
    }
    return variable;
}


export const JSON_RPC_MAINNET = getEnvironmentVariable("JSON_RPC_MAINNET");
export const OPENSEA_API_KEY = getEnvironmentVariable("OPENSEA_API_KEY");

export const NULL_ADDR = "0x0000000000000000000000000000000000000000"