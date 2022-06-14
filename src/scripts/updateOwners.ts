/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import 'reflect-metadata';
import { BaseCollection, BaseToken, TokenStandard, UserOwnedCollection, UserOwnedToken } from '@infinityxyz/lib/types/core';
import { firestoreConstants, getCollectionDocId } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import { QuerySnapshot } from 'firebase-admin/firestore';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { gql, GraphQLClient } from 'graphql-request';
import BatchHandler from 'models/BatchHandler';
import path from 'path';
import 'reflect-metadata';
import { ZoraTokensOwnerContentImageResponse } from 'types/Zora';
import { ZORA_API_KEY } from '../constants';
import { firestore } from 'firebase-admin';

const ZORA_API_ENDPOINT = 'https://api.zora.co/graphql';
const zoraClient = new GraphQLClient(ZORA_API_ENDPOINT, {
  headers: {
    'X-API-KEY': ZORA_API_KEY
  }
});

const db = firebase.db;

export async function main() {
  // fetch collections from firestore
  console.log('============================== Fetching collections from firestore =================================');
  let startAfter = '';
  const offsetFile = path.join(__dirname, 'offset.txt');
  if (existsSync(offsetFile)) {
    startAfter = readFileSync(offsetFile, 'utf8');
  }
  const limit = 10;
  let done = false;
  while (!done) {
    const colls = await db
      .collection(firestoreConstants.COLLECTIONS_COLL)
      .orderBy('address', 'asc')
      .startAfter(startAfter)
      .limit(limit)
      .get();
    console.log('================ START AFTER ===============', startAfter, colls.size);
    writeFileSync(offsetFile, `${startAfter}`);

    // update cursor
    startAfter = colls.docs[colls.size - 1].get('address');

    // break condition
    if (colls.size < limit) {
      done = true;
    }
    await runAFew(colls);
  }
}

async function runAFew(colls: QuerySnapshot) {
  try {
    for (const coll of colls.docs) {
      const data = coll.data() as BaseCollection;
      if (!data) {
        console.error('Data is null for collection', coll);
        continue;
      }
      await run(data.chainId, data.address, data);
    }
  } catch (e) {
    console.error('Error running a few', e);
  }
}

async function run(chainId: string, address: string, collectionData: BaseCollection) {
  try {
    // check if collection indexing is complete
    const status = collectionData?.state.create.step;
    if (status !== 'complete') {
      console.error('Collection indexing is not complete for', address);
      return;
    }

    // exception for ENS
    if (address === '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85') {
      return;
    }
    await updateOwners(chainId, address, collectionData);
  } catch (e) {
    console.error('Error in running collection', address, e);
  }
}

async function updateOwners(chainId: string, collectionAddress: string, collectionDocData: BaseCollection) {
  console.log('Updating owners for', collectionAddress, '....');
  const fsBatchHandler = new BatchHandler();
  const limit = 500;
  let cursor = '';
  let done = false;
  let totalFetchedSoFar = 0;
  while (!done) {
    const zoraData = await fetchZoraData(collectionAddress, limit, cursor);
    totalFetchedSoFar += zoraData.tokens.nodes.length;
    console.log('Total fetched so far', totalFetchedSoFar);
    cursor = zoraData.tokens.pageInfo.endCursor;
    // write to firestore
    await updateDataInFirestore(chainId, collectionAddress, collectionDocData, zoraData, fsBatchHandler);
    done = !zoraData.tokens.pageInfo.hasNextPage;
  }

  // set collection ownersFetched status to true
  const collectionDocId = getCollectionDocId({ chainId, collectionAddress });
  const collectionDocRef = db.collection(firestoreConstants.COLLECTIONS_COLL).doc(collectionDocId);
  fsBatchHandler.add(collectionDocRef, { ownersFetched: true }, { merge: true });
  
  // write batch
  fsBatchHandler
    .flush()
    .then(() => {
      console.log(`===================== Finished updating owners for collection ${collectionAddress} ========================`);
    })
    .catch((e) => {
      console.error('Error updating owners for collection', collectionAddress, e);
    });
}

async function updateDataInFirestore(
  chainId: string,
  collectionAddress: string,
  collectionDocData: BaseCollection,
  zoraData: ZoraTokensOwnerContentImageResponse,
  fsBatchHandler: BatchHandler
) {
  console.log('Updating data in firestore for', collectionAddress);
  // first fetch token data from collections/nfts
  const nfts = [];
  for (const zoraTokenData of zoraData.tokens.nodes) {
    nfts.push({ chainId, address: collectionAddress, tokenId: zoraTokenData.token.tokenId });
  }
  const tokenDataDocs = await getNftsFromInfinityFirestore(nfts);

  for (let i = 0; i < zoraData.tokens.nodes.length; i++) {
    const zoraTokenData = zoraData.tokens.nodes[i];
    const tokenDataDoc = tokenDataDocs[i];
    if (tokenDataDoc?.tokenId !== zoraTokenData.token.tokenId) {
      console.error('Token id mismatch', tokenDataDoc?.tokenId, zoraTokenData.token.tokenId);
      continue;
    }
    const owner = zoraTokenData.token.owner;
    // update in firestore
    if (owner) {
      // update asset in collection/nfts collection
      const collectionDocId = `${chainId}:${collectionAddress}`;
      const tokenId = zoraTokenData.token.tokenId;
      const tokenRef = db
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .doc(collectionDocId)
        .collection(firestoreConstants.COLLECTION_NFTS_COLL)
        .doc(tokenId);
      fsBatchHandler.add(tokenRef, { owner }, { merge: true });

      // update toUser
      const toUserDocRef = db.collection(firestoreConstants.USERS_COLL).doc(owner);
      const toUserCollectionDocRef = toUserDocRef.collection(firestoreConstants.USER_COLLECTIONS_COLL).doc(collectionDocId);
      const toUserTokenDocRef = toUserCollectionDocRef.collection(firestoreConstants.USER_NFTS_COLL).doc(tokenId);
      fsBatchHandler.add(toUserDocRef, { numNftsOwned: firestore.FieldValue.increment(1) }, { merge: true });

      const userOwnedCollectionData: Omit<UserOwnedCollection, 'numCollectionNftsOwned'> = {
        chainId: collectionDocData.chainId,
        collectionAddress: collectionDocData.address,
        collectionSlug: collectionDocData.slug,
        collectionName: collectionDocData.metadata.name,
        collectionDescription: collectionDocData.metadata.description,
        collectionSymbol: collectionDocData.metadata.symbol,
        collectionProfileImage: collectionDocData.metadata.profileImage,
        collectionBannerImage: collectionDocData.metadata.bannerImage,
        displayType: collectionDocData.metadata.displayType ?? '',
        hasBlueCheck: collectionDocData.hasBlueCheck,
        tokenStandard: TokenStandard.ERC721
      };
      fsBatchHandler.add(toUserCollectionDocRef, userOwnedCollectionData, { merge: true });
      fsBatchHandler.add(toUserCollectionDocRef, { numCollectionNftsOwned: firestore.FieldValue.increment(1) }, { merge: true });

      const tokenData = tokenDataDoc;
      const data: UserOwnedToken = {
        ...userOwnedCollectionData,
        ...tokenData
      };
      fsBatchHandler.add(toUserTokenDocRef, data, { merge: false });
    }
  }
}

async function getNftsFromInfinityFirestore(nfts: { address: string; chainId: string; tokenId: string }[]) {
  const refs = nfts.map((item) => {
    const collectionDocId = getCollectionDocId({
      collectionAddress: item.address,
      chainId: item.chainId
    });
    return db
      .collection(firestoreConstants.COLLECTIONS_COLL)
      .doc(collectionDocId)
      .collection(firestoreConstants.COLLECTION_NFTS_COLL)
      .doc(item.tokenId);
  });

  if (refs.length === 0) {
    return [];
  }
  const snapshots = await db.getAll(...refs);

  const retrievedNfts = snapshots.map((snapshot) => {
    const nft = snapshot.data() as BaseToken | undefined;
    return nft;
  });

  return retrievedNfts;
}

async function fetchZoraData(
  collectionAddress: string,
  limit: number,
  cursor: string
): Promise<ZoraTokensOwnerContentImageResponse> {
  console.log('Fetching zora data for', collectionAddress, 'with limit', limit, 'and cursor', cursor);
  const query = gql`
    query PreviewTokens {
      tokens(
        pagination: { limit: ${limit}, after: "${cursor}" }
        where: { collectionAddresses: ["${collectionAddress}"] },
        sort: {sortKey: TOKEN_ID, sortDirection: ASC}
      ) {
        nodes {
          token {
            owner
            tokenId
            content {
              mediaEncoding {
                ... on ImageEncodingTypes {
                  large
                  poster
                  original
                  thumbnail
                }
                ... on VideoEncodingTypes {
                  large
                  poster
                  original
                  preview
                  thumbnail
                }
                ... on AudioEncodingTypes {
                  large
                  original
                }
              }
              mimeType
              size
              url
            }
            image {
              url
              mediaEncoding {
                ... on ImageEncodingTypes {
                  large
                  poster
                  original
                  thumbnail
                }
                ... on VideoEncodingTypes {
                  large
                  poster
                  original
                  preview
                  thumbnail
                }
                ... on AudioEncodingTypes {
                  large
                  original
                }
              }
              mimeType
              size
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
          limit
        }
      }
    }
  `;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const data = (await zoraClient.request(query)) as ZoraTokensOwnerContentImageResponse;
  return data;
}

void main();
