import { Collection } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import BatchHandler from 'models/BatchHandler';
import PQueue from 'p-queue';
import OpenSeaClient from 'services/OpenSea';
import { sleep } from 'utils';

export async function updateCollectionMetadata() {
  const queue = new PQueue({ concurrency: 1 });
  console.log(`Updating collections`);
  const collectionStream = firebase.db.collection(firestoreConstants.COLLECTIONS_COLL).stream() as AsyncIterable<
    FirebaseFirestore.DocumentSnapshot<Partial<Collection>>
  >;
  const batchHandler = new BatchHandler();

  const updateMetadata = async (collection: Partial<Collection>, ref: FirebaseFirestore.DocumentReference) => {
    const recentlyUpdated = collection?.metadata?.updatedAt
      ? collection.metadata.updatedAt > Date.now() - 1000 * 60 * 60 * 24 // 1 day
      : false;
    if (recentlyUpdated) {
      console.log(
        `[${collection.chainId}:${collection?.address}] Metadata for collection: ${
          collection?.metadata?.name ?? collection.address
        } was recently updated`
      );
      return;
    }

    if (collection?.address) {
      console.log(
        `[${collection.chainId}:${collection?.address}] Getting metadata for collection: ${
          collection?.metadata?.name ?? collection.address
        }`
      );
      try {
        const opensea = new OpenSeaClient(collection.chainId ?? '1');
        const resp = await opensea.getCollectionMetadata(collection.address);
        // only update non empty fields
        const metadata = {
          links: {}
        } as any;

        if (resp.name) {
          metadata.name = resp.name;
        }
        if (resp.description) {
          metadata.description = resp.description;
        }
        if (resp.symbol) {
          metadata.symbol = resp.symbol;
        }
        if (resp.profileImage) {
          metadata.profileImage = resp.profileImage;
        }
        if (resp.bannerImage) {
          metadata.bannerImage = resp.bannerImage;
        }
        if (resp.displayType) {
          metadata.displayType = resp.displayType;
        }
        if (resp.links.discord) {
          metadata.links.discord = resp.links.discord;
        }
        if (resp.links.external) {
          metadata.links.external = resp.links.external;
        }
        if (resp.links.medium) {
          metadata.links.medium = resp.links.medium;
        }
        if (resp.links.twitter) {
          metadata.links.twitter = resp.links.twitter?.toLowerCase();
        }
        if (resp.links.telegram) {
          metadata.links.telegram = resp.links.telegram;
        }
        if (resp.links.instagram) {
          metadata.links.instagram = resp.links.instagram;
        }
        if (resp.links.slug) {
          metadata.links.slug = resp.links.slug;
        }
        if (resp.links.wiki) {
          metadata.links.wiki = resp.links.wiki;
        }

        const update: Partial<Collection> = {
          metadata: { ...metadata, updatedAt: Date.now() }
        };

        // add to batch
        batchHandler.add(ref, update, { merge: true });
      } catch (err) {
        console.error(err);
      }
      await sleep(1000);
    }
  };

  setInterval(() => {
    console.log(`Queue: ${queue.size} Pending: ${queue.pending}`);
  }, 5_000);

  for await (const collectionSnap of collectionStream) {
    const collection = collectionSnap.data() as Collection;
    queue
      .add(async () => {
        return updateMetadata(collection, collectionSnap.ref);
      })
      .catch(console.error);
  }

  await batchHandler.flush();
}
