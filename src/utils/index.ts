


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