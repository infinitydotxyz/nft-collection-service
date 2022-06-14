/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import 'reflect-metadata';
import { BaseCollection, TokenStandard, UserOwnedCollection, UserOwnedToken } from '@infinityxyz/lib/types/core';
import { firestoreConstants, getCollectionDocId, getSearchFriendlyString } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import { QuerySnapshot } from 'firebase-admin/firestore';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { gql, GraphQLClient } from 'graphql-request';
import BatchHandler from 'models/BatchHandler';
import path from 'path';
import { ZoraTokensResponse } from 'types/Zora';
import { ZORA_API_KEY } from '../constants';
import { firestore } from 'firebase-admin';

const ZORA_API_ENDPOINT = 'https://api.zora.co/graphql';
const zoraClient = new GraphQLClient(ZORA_API_ENDPOINT, {
  headers: {
    'X-API-KEY': ZORA_API_KEY
  }
});

const db = firebase.db;

const errorFile = path.join(__dirname, 'errors.txt');

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
      const data = coll.data();
      if (!data) {
        console.error('Data is null for collection', coll);
        continue;
      }
      // check if owners are already fetched
      const ownersFetched = data.ownersFetched;
      if (ownersFetched) {
        console.error('Collection owners already fetched for', data.address);
        continue;
      }
      await run(data.chainId, data.address, data as BaseCollection);
    }
  } catch (e) {
    console.error('Error running a few', e);
  }
}

async function run(chainId: string, address: string, collectionData: BaseCollection) {
  try {
    // check if collection indexing is complete
    // const status = collectionData?.state.create.step;
    // if (status !== 'complete') {
    //   console.error('Collection indexing is not complete for', address);
    //   return;
    // }

    // exception for ENS
    if (address === '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85') {
      return;
    }
    await updateOwners(chainId, address, collectionData);
  } catch (e) {
    console.error('Error in running collection', address, e);
    appendFileSync(errorFile, `${address}\n`);
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
    try {
      const zoraData = await fetchZoraData(collectionAddress, limit, cursor);
      totalFetchedSoFar += zoraData.tokens.nodes.length;
      console.log('Total fetched so far', totalFetchedSoFar);
      cursor = zoraData.tokens.pageInfo.endCursor;
      // write to firestore
      updateDataInFirestore(chainId, collectionAddress, collectionDocData, zoraData, fsBatchHandler);
      done = !zoraData.tokens.pageInfo.hasNextPage;
    } catch (err) {
      console.error(err);
      appendFileSync(errorFile, `${collectionAddress}\n`);
      throw err;
    }
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
      appendFileSync(errorFile, `${collectionAddress}\n`);
    });
}

function updateDataInFirestore(
  chainId: string,
  collectionAddress: string,
  collectionDocData: BaseCollection,
  zoraData: ZoraTokensResponse,
  fsBatchHandler: BatchHandler
) {
  console.log('Updating data in firestore for', collectionAddress);
  for (let i = 0; i < zoraData.tokens.nodes.length; i++) {
    const zoraTokenData = zoraData.tokens.nodes[i];
    const owner = zoraTokenData.token.owner;
    if (owner) {
      const collectionDocId = `${chainId}:${collectionAddress}`;
      const tokenId = zoraTokenData.token.tokenId;

      // update userAsset
      const userAssetDocRef = db.collection(firestoreConstants.USERS_COLL).doc(owner);
      const userAssetCollectionDocRef = userAssetDocRef.collection(firestoreConstants.USER_COLLECTIONS_COLL).doc(collectionDocId);
      const userAssetTokenDocRef = userAssetCollectionDocRef.collection(firestoreConstants.USER_NFTS_COLL).doc(tokenId);
      fsBatchHandler.add(userAssetDocRef, { numNftsOwned: firestore.FieldValue.increment(1) }, { merge: true });

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
      fsBatchHandler.add(userAssetCollectionDocRef, userOwnedCollectionData, { merge: true });
      fsBatchHandler.add(
        userAssetCollectionDocRef,
        { numCollectionNftsOwned: firestore.FieldValue.increment(1) },
        { merge: true }
      );

      const userAssetData: Partial<UserOwnedToken> = {
        ...userOwnedCollectionData,
        tokenId: zoraTokenData.token.tokenId,
        slug: getSearchFriendlyString(zoraTokenData.token.name),
        metadata: {
          name: zoraTokenData.token.name,
          description: zoraTokenData.token.description,
          image: zoraTokenData.token.image?.url,
          attributes: zoraTokenData.token.attributes
        },
        minter: zoraTokenData.token.mintInfo?.originatorAddress,
        mintedAt: new Date(zoraTokenData.token.mintInfo?.mintContext?.blockTimestamp).getTime(),
        mintTxHash: zoraTokenData.token.mintInfo?.mintContext?.transactionHash,
        mintPrice: zoraTokenData.token.mintInfo?.price?.chainTokenPrice?.decimal,
        owner,
        tokenStandard: TokenStandard.ERC721,
        numTraitTypes: zoraTokenData.token.attributes?.length,
        zoraImage: zoraTokenData.token.image,
        zoraContent: zoraTokenData.token.content,
        image: {
          url: zoraTokenData.token.image?.mediaEncoding?.preview ?? zoraTokenData.token.image?.mediaEncoding?.large,
          updatedAt: Date.now(),
          originalUrl: zoraTokenData.token.image?.url
        },
        tokenUri: zoraTokenData.token.tokenUrl,
        updatedAt: Date.now()
      };

      // add token data to user assets
      fsBatchHandler.add(userAssetTokenDocRef, userAssetData, { merge: true });

      // update asset in collection/nfts collection
      const tokenRef = db
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .doc(collectionDocId)
        .collection(firestoreConstants.COLLECTION_NFTS_COLL)
        .doc(tokenId);
      fsBatchHandler.add(tokenRef, userAssetData, { merge: true });
    }
  }
}

async function fetchZoraData(collectionAddress: string, limit: number, cursor: string): Promise<ZoraTokensResponse> {
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
            name
            description
            tokenUrl
            tokenUrlMimeType
            attributes {
              displayType
              traitType
              value
            }
            mintInfo {
              mintContext {
                blockNumber
                blockTimestamp
                transactionHash
              }
              price {
                chainTokenPrice {
                  currency {
                    address
                    decimals
                    name
                  }
                  decimal
                }
              }
              toAddress
              originatorAddress
            }
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
  const data = (await zoraClient.request(query)) as ZoraTokensResponse;
  return data;
}

void main();
