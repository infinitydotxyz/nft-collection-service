import { ethers } from 'ethers';
import { readFile } from 'fs/promises';
import path from 'path';
import { buildCollections } from './scripts/buildCollections';
import { collectionService, logger } from './container';

enum Task {
  CreateCollection = 'create',
  ScrapeCollections = 'scrape'
}

interface ModeArgument {
  arg: string;
  default?: string;
  required?: {
    errorMessage: string;
  };
  validate?: (parsedArg: string) => true | string;
}

enum Mode {
  File = 'file',
  Address = 'address'
}

function getMode(): Mode {
  const fileArg = process.argv.find((item) => {
    return item.includes('file');
  });

  if (fileArg) {
    return Mode.File;
  }

  const addressArg = process.argv.find((item) => {
    return item.includes('address');
  });

  if (addressArg) {
    return Mode.Address;
  }

  throw new Error('Invalid mode');
}

function getTask(): Task {
  const args = parseArgs([
    {
      arg: 'task',
      default: Task.CreateCollection
    }
  ]);

  switch (args.task) {
    case Task.CreateCollection:
      return Task.CreateCollection;
    case Task.ScrapeCollections:
      return Task.ScrapeCollections;
    default:
      throw new Error(`Invalid task type: ${args.task}`);
  }
}

export async function main(): Promise<void> {
  const task = getTask();

  switch (task) {
    case Task.CreateCollection:
      return await create();
    case Task.ScrapeCollections:
      return await buildCollections();
  }
}

async function create(): Promise<void> {
  const mode = getMode();

  switch (mode) {
    case Mode.File:
      return await fileMode();
    case Mode.Address:
      return await addressMode();
    default:
      throw new Error('Mode not yet implemented');
  }
}

function parseArgs(modeArgs: ModeArgument[]): { [key: string]: string } {
  const parseArg = (arg: string): string => {
    const fullArg = process.argv.find((item) => {
      return item.includes(arg);
    });
    return (fullArg ?? '').split('=')[1]?.trim() ?? '';
  };

  const args: { [key: string]: string } = {};

  for (const desc of modeArgs) {
    let arg: string | number = parseArg(desc.arg);
    if (!arg && desc.default) {
      arg = desc.default;
    }

    if (desc.required && !arg) {
      throw new Error(desc.required.errorMessage);
    }

    if (typeof desc.validate === 'function') {
      const result = desc.validate(arg);
      if (typeof result === 'string' || !result) {
        throw new Error(result);
      }
    }

    args[desc.arg] = arg;
  }

  return args;
}

async function addressMode(): Promise<void> {
  const addressModeArgs: ModeArgument[] = [
    {
      arg: 'address',
      default: '',
      required: {
        errorMessage: 'failed to pass address'
      },
      validate: (address: string) => (ethers.utils.isAddress(address) ? true : 'Invalid address')
    },
    {
      arg: 'chain',
      default: '1'
    },
    {
      arg: 'hasBlueCheck',
      default: 'false'
    },
    {
      arg: 'reset',
      default: 'false'
    }
  ];

  const args = parseArgs(addressModeArgs);

  const address = args.address;
  const chainId = args.chain;
  const hasBlueCheck = args.hasBlueCheck === 'true';
  const reset = args.reset === 'true';

  try {
    logger.log(`Starting Task: create Address: ${address} Chain Id: ${chainId} `);
    await collectionService.createCollection(address, chainId, hasBlueCheck, reset);
  } catch (err) {
    logger.log(`Failed to complete task`);
    logger.error(err);
  }
}

async function fileMode(): Promise<void> {
  const fileModeArgs: ModeArgument[] = [
    {
      arg: 'file',
      default: '',
      required: {
        errorMessage: 'failed to pass path to input file'
      }
    },
    {
      arg: 'hasBlueCheck',
      default: 'false'
    },
    {
      arg: 'reset',
      default: 'false'
    }
  ];

  const args = parseArgs(fileModeArgs);

  const file = args.file;
  const filePath = path.resolve(file);
  const contents = await readFile(filePath, 'utf-8');
  const data = JSON.parse(contents);

  const hasBlueCheck = args.hasBlueCheck === 'true' ? true : undefined;
  const reset = args.reset === 'true';

  logger.log(`Creating ${data.length} collections`);

  const promises: Array<Promise<void>> = [];
  for (const item of data) {
    if (typeof item.address !== 'string') {
      throw new Error('Expected an array of objects containing an address property');
    }
    const chainId = typeof item?.chainId === 'string' ? (item?.chainId as string) : '1';

    const itemHasBlueCheck = typeof item.hasBlueCheck === 'boolean' ? item.hasBlueCheck : false;
    const shouldHaveBlueCheck = (hasBlueCheck === undefined ? itemHasBlueCheck : hasBlueCheck) as boolean;

    promises.push(collectionService.createCollection(item.address as string, chainId, shouldHaveBlueCheck, reset));
  }

  await Promise.allSettled(promises);
}
