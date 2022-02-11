


export function filterDuplicates<T>(items: T[], propertySelector: (item: T) => string): T[] {
    const hashes = new Set();
    return items.filter((item: T) => {
        const property = propertySelector(item);
        if(!hashes.has(property)) {
          hashes.add(property);
          return true;
        }
        return false;
    })
}


export async function sleep(duration: number): Promise<void> {
  return await new Promise<void>((resolve) => {
    setTimeout(()=> {
      resolve();
    }, duration)
  })
}

export function isDev(): boolean {
  return !!process.env.NODE_ENV;
}


export enum Env {
  Cli = 'cli',
  Script = 'script',
  Production = 'production'
}

export function getEnv(): Env {
  switch(process.env.NODE_ENV) {
    case Env.Cli: 
      return Env.Cli;
    case Env.Script: 
      return Env.Script;
    default:
      if(process.env.NODE_ENV) {
        throw new Error(`Invalid NODE_ENV: ${process.env.NODE_ENV}`);
      } 
      return Env.Production
  }
}