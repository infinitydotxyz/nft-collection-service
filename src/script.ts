/* eslint-disable @typescript-eslint/no-unused-vars */
import Alchemy from './services/Alchemy';
import { collectionDao, firebase, logger, alchemy, opensea } from './container';
import { buildCollections } from './scripts/buildCollections';
import { sleep } from './utils';
import fs, { read } from 'fs';
import path from 'path';
import { readFile , writeFile } from 'fs/promises';
import got from 'got/dist/source';
import { COLLECTION_SERVICE_URL } from './constants';

// eslint-disable-next-line @typescript-eslint/require-await
// do not remove commented code
export async function main(): Promise<void> {
  try {
    await enqueueResultsDotJson();
    const rawData = await readFile('./enqueued.json', 'utf-8');
    const data: Array<{address: string}> = JSON.parse(rawData);
    logger.log(`${data.length} collections were enqueued`);
    // for(const collection of data) {

    // }

    while(true) {
      await sleep(60_000);
      await collectionDao.getCollectionsSummary();
    }



    // await apppendDisplayTypeToCollections();
  } catch (err) {
    logger.error(err);
  }
}



async function enqueueResultsDotJson(): Promise<void> {
  const file = './results.json';

  const rawData = await readFile(file, 'utf-8');
  const data: Array<{address: string, chainId: string}> = JSON.parse(rawData);

  const collectionsEnqueued: Array<{address: string}> = [];
  
  for(const collection of data) {
    const response = await got.post({
      url: `${COLLECTION_SERVICE_URL}/collection`,
      json: {
        address: collection.address,
        chainId: collection.chainId
      }
    });

    if(response.statusCode === 202) {
      collectionsEnqueued.push({address: collection.address});
    }
  }

  await writeFile('./enqueued.json', JSON.stringify(collectionsEnqueued));
}

export function flattener(): void {
  const file = path.join(__dirname, '../resultsbak.json');
  const data = fs.readFileSync(file, 'utf-8');
  const parsed = JSON.parse(data);
  const onlyObj = parsed[0];
  fs.appendFileSync('results.json', '[');
  for (const obj in onlyObj) {
    const val = onlyObj[obj];
    const datum = {
      address: val.address,
      chainId: val.chainId,
      hasBlueCheck: val.hasBlueCheck
    };
    if (datum.address && datum.chainId === '1' && String(datum.hasBlueCheck)) {
      fs.appendFileSync('results.json', JSON.stringify(datum) + ',');
    }
  }
  fs.appendFileSync('results.json', ']');
}

export async function apppendDisplayTypeToCollections(): Promise<void> {
  const data = await firebase.db.collection('collections').get();
  data.forEach(async (doc) => {
    await sleep(2000);
    const address = doc.get('address') as string;
    const dispType = doc.get('displayType');
    if (address && !dispType) {
      const resp = await opensea.getCollectionMetadata(address);
      logger.log(address, resp.displayType);
      await firebase.db
        .collection('collections')
        .doc('1:' + address)
        .set({ displayType: resp.displayType }, { merge: true });
    }
  });
}
