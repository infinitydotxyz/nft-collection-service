// eslint-disable-next-line @typescript-eslint/no-unused-vars
import axios, { AxiosError } from 'axios';
import { COLLECTION_SERVICE_URL } from '../constants';
import { join } from 'path';
import PQueue from 'p-queue';
import { CreationFlow } from '@infinityxyz/lib/types/core';
import { firebase } from 'container';
import { firestoreConstants } from '@infinityxyz/lib/utils';

export async function reIndex(step?: CreationFlow) {
  let collectionsSnap;
  if (step) {
    collectionsSnap = await firebase.db
      .collection(firestoreConstants.COLLECTIONS_COLL)
      .where('state.create.step', '==', step)
      .get();
  } else {
    collectionsSnap = await firebase.db
      .collection(firestoreConstants.COLLECTIONS_COLL)
      .where('state.create.step', '!=', CreationFlow.Complete)
      .get();
  }
  const collectionIds = [...new Set(collectionsSnap.docs.map((doc) => doc.ref.id))];
  const collections = collectionIds.map((item) => {
    const [chainId, address] = item.split(':');
    return {
      chainId,
      address
    };
  });
  console.log(`Found: ${collections.length} collections to re-index`);

  const url = new URL(join(COLLECTION_SERVICE_URL, 'collection')).toString();
  const queue = new PQueue({ concurrency: 50 });
  const interval = setInterval(() => {
    console.log(`Queue size: ${queue.size}`);
  }, 5_000);

  for (const collection of collections) {
    try {
      queue
        .add(async () => {
          const res = await enqueueCollection(collection, url);
          console.log(`Collection: ${collection.chainId}:${collection.address} ${res}`);
        })
        .catch(console.error);
    } catch (err) {
      console.error(err);
    }
  }

  await queue.onIdle();
  clearInterval(interval);
}

export enum ResponseType {
  IndexingInitiated = 'INDEXING_INITIATED',
  AlreadyQueued = 'INDEXING_ALREADY_INITIATED',
  BadRequest = 'BAD_REQUEST',
  ServerError = 'SERVER_ERROR',
  UnknownError = 'UNKNOWN_ERROR'
}

function getResponseType(status: number): ResponseType {
  switch (status) {
    case 202:
      return ResponseType.IndexingInitiated;
    case 200:
      return ResponseType.AlreadyQueued;
    case 400:
      return ResponseType.BadRequest;
    case 500:
      return ResponseType.ServerError;
    default:
      return ResponseType.UnknownError;
  }
}

export async function enqueueCollection(
  collection: { chainId: string; address: string; indexInitiator?: string },
  url: string
): Promise<ResponseType> {
  try {
    const res = await axios.post(
      url,
      {
        chainId: collection.chainId,
        address: collection.address,
        indexInitiator: collection.indexInitiator
      },
      {
        headers: {
          'content-type': 'application/json'
        }
      }
    );

    const response = getResponseType(res.status);

    return response;
  } catch (err: AxiosError | any) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status && typeof err.response.status === 'number') {
        const response = getResponseType(err.response.status);
        return response;
      } else {
        throw err;
      }
    }
    throw err;
  }
}
