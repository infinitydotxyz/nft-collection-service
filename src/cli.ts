import { ethers } from 'ethers';
import { readFile } from 'fs/promises';
import path from 'path';
import { buildCollections } from './scripts/buildCollections';
import { collectionService, logger } from './container';
import { parseArgs, ModeArgument, setTerminalTitle } from './utils/cli';
import { NULL_ADDR } from './constants';
import { normalizeAddress } from './utils/ethers';

enum Task {
  CreateCollection = 'create',
  ScrapeCollections = 'scrape'
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
  collectionService.on('sizeChange', (data: { size: number; pending: number }) => {
    setTerminalTitle(`Collection Queue Size: ${data.size} Pending: ${data.pending}  Total: ${data.size + data.pending}`);
  });

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
    },
    {
      arg: 'partial',
      default: 'true'
    },
    {
      arg: 'mintData',
      default: 'false'
    }
  ];

  const args = parseArgs(addressModeArgs);

  const address = normalizeAddress(args.address);
  const chainId = args.chain;
  const hasBlueCheck = args.hasBlueCheck === 'true';
  const reset = args.reset === 'true';
  const partial = args.partial === 'true';
  const mintData = args.mintData === 'true';

  try {
    logger.log(`Starting Task: create Address: ${address} Chain Id: ${chainId} `);
    await collectionService.createCollection(address, chainId, hasBlueCheck, reset, NULL_ADDR, partial, mintData);
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
    }
  ];

  const args = parseArgs(fileModeArgs);

  const file = args.file;
  const filePath = path.resolve(file);
  const contents = await readFile(filePath, 'utf-8');
  const data = JSON.parse(contents);

  logger.log(`Creating ${data.length} collections`);

  const promises: Array<Promise<void>> = [];
  for (const item of data) {
    if (typeof item.address !== 'string') {
      throw new Error('Expected an array of objects containing an address property');
    }
    const chainId = typeof item?.chainId === 'string' ? (item?.chainId as string) : '1';

    const hasBlueCheck = item.hasBlueCheck === true;
    const reset = item.reset === true;
    const partial = item.partial === true;
    const mintData = item.mintData === true;

    promises.push(collectionService.createCollection(item.address as string, chainId, hasBlueCheck, reset, NULL_ADDR, partial, mintData));
  }

  await Promise.allSettled(promises);
}
