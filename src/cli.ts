import { readFile } from 'fs/promises';
import path from 'path';
import { collectionService, logger } from './container';

enum Task {
  CreateCollection = 'create'
}

const parseArg = (arg: string): string => {
  return arg.split('=')[1]?.trim()?.toLowerCase?.() ?? '';
};

export async function main(): Promise<void> {
  const fileArg = process.argv.find((item) => {
    return item.includes('file');
  });

  const addressArg = process.argv.find((item) => {
    return item.includes('address');
  });

  if (fileArg) {
    return await fileMode(fileArg);
  } else if (addressArg) {
    return await addressMode(addressArg);
  } else {
    throw new Error('Failed to pass a file or address');
  }
}

async function addressMode(addressArg: string): Promise<void> {
  let address;
  let chainId = '1';
  let task = Task.CreateCollection;
  let hasBlueCheck = false;
  if (addressArg) {
    address = parseArg(addressArg);
  } else {
    throw new Error('Must pass a collection address');
  }

  const chainIdArg = process.argv.find((item) => {
    return item.includes('chain');
  });

  const taskArg = process.argv.find((item) => {
    return item.includes('task');
  });

  const hasBlueCheckArg = process.argv.find((item) => {
    return item.includes('hasBlueCheck');
  });

  if (chainIdArg) {
    chainId = parseArg(chainIdArg);
  }

  if (taskArg) {
    task = parseArg(taskArg) as Task;
  }

  if (hasBlueCheckArg) {
    hasBlueCheck = parseArg(hasBlueCheckArg) === 'true';
  }

  let method: () => Promise<any>;
  switch (task) {
    case Task.CreateCollection:
      method = collectionService.createCollection.bind(collectionService, address, chainId, hasBlueCheck);
      break;
    default:
      throw new Error(`Invalid task type ${task}`);
  }

  try {
    logger.log(`Starting Task: ${task} Address: ${address} Chain Id: ${chainId} `);
    await method();
  } catch (err) {
    logger.log(`Failed to complete task`);
    logger.error(err);
  }
}

async function fileMode(fileArg: string): Promise<void> {
  const file = parseArg(fileArg);
  const filePath = path.resolve(file);
  const contents = await readFile(filePath, 'utf-8');
  const data = JSON.parse(contents);

  let hasBlueCheck: boolean | undefined;

  const hasBlueCheckArg = process.argv.find((item) => {
    return item.includes('hasBlueCheck');
  });

  if (hasBlueCheckArg) {
    hasBlueCheck = parseArg(hasBlueCheckArg) === 'true';
  }

  logger.log(`Creating ${data.length} collections. hasBlueCheck: ${hasBlueCheck}`);

  const promises: Array<Promise<void>> = [];
  for (const item of data) {
    if (typeof item.address !== 'string') {
      throw new Error('Expected an array of objects containing an address property');
    }
    const chainId = typeof item?.chainId === 'string' ? (item?.chainId as string) : '1';

    const itemHasBlueCheck = typeof item.hasBlueCheck === 'boolean' ? item.hasBlueCheck : false;
    const shouldHaveBlueCheck = (hasBlueCheck === undefined ? itemHasBlueCheck : hasBlueCheck) as boolean;

    promises.push(collectionService.createCollection(item.address as string, chainId, shouldHaveBlueCheck));
  }

  await Promise.allSettled(promises);
}
