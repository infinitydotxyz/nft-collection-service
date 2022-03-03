/* eslint-disable @typescript-eslint/no-unused-vars */
import BatchHandler from './models/BatchHandler';
import { CreationFlow } from './models/Collection';
import { Collection } from 'types/Collection.interface';
import { collectionDao, firebase, logger } from './container';
import { buildCollections } from './scripts/buildCollections';

import {CloudTasksClient, protos } from '@google-cloud/tasks';
import Logger from './utils/Logger';
import { resolve } from 'path';
import { FIREBASE_SERVICE_ACCOUNT, TASK_QUEUE_SERVICE_ACCOUNT } from './constants';
import { readFileSync } from 'fs';
import { ServiceAccount } from 'firebase-admin';

// eslint-disable-next-line @typescript-eslint/require-await
export async function main(): Promise<void> {
  try {
    /**
     * must be run to add numOwnersUpdatedAtAndDataExported fields to existing collections
     * that don't yet have these fields
     */
    // await addNumOwnersUpdatedAtAndDataExportedFields();
    // await buildCollections();
    // await collectionDao.getCollectionsSummary();
    
    // await addQueuePropertiesToCollections();

    // Imports the Google Cloud Tasks library.


// Instantiates a client.


  // TODO(developer): Uncomment these lines and replace with your values.
  const project = 'nftc-dev';
  const queue = 'collection-scraping-queue';
  const location = 'us-east1';
  const url = 'https://nft-collection-service-dot-nftc-dev.ue.r.appspot.com/collection'
  // const payload = 'Hello, World!';
  const payload = JSON.stringify({
    chainId: '1',
    address: '0xce25e60a89f200b1fa40f6c313047ffe386992c3',
  });


  const serviceAccountFile = resolve(`./creds/${TASK_QUEUE_SERVICE_ACCOUNT}`);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountFile;

  const client = new CloudTasksClient();
  // Construct the fully qualified queue name.
  const parent = client.queuePath(project, location, queue);

  const request: protos.google.cloud.tasks.v2.ICreateTaskRequest = {
    parent,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url,
        body: Buffer.from(payload).toString('base64')
      },
    }
  };

  logger.log('Sending task:');
  logger.log(request)
  // Send create task request.
  const [response] = await client.createTask(request);
  const name = response.name;
  logger.log(`Created task ${name}`);



  } catch (err) {
    logger.error(err);
  }
}
