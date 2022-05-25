import { Token } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import BatchHandler from 'models/BatchHandler';

export async function updateGoerliDoodlesImages() {
  const collectionAddress = '0x142c5b3a5689ba0871903c53dacf235a28cb21f0';
  const chainId = '5';

  const doodlesAddress = '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e';

  const collectionRef = firebase.db.collection(firestoreConstants.COLLECTIONS_COLL).doc(`${chainId}:${collectionAddress}`);
  const nftsRef = collectionRef.collection(firestoreConstants.COLLECTION_NFTS_COLL);

  const doodlesRef = firebase.db.collection(firestoreConstants.COLLECTIONS_COLL).doc(`1:${doodlesAddress}`);
  const doodlesNfts = doodlesRef.collection(firestoreConstants.COLLECTION_NFTS_COLL);

  const nftSnaps = await nftsRef.get();
  const batch = new BatchHandler();
  for (const nftDoc of nftSnaps.docs) {
    const nft = nftDoc.data() as Token;
    const doodleNftSnap = await doodlesNfts.doc(nft.tokenId).get();
    const doodleNft = doodleNftSnap.data() as Token;
    batch.add(nftDoc.ref, { image: doodleNft.image }, { merge: true });
  }
  await batch.flush();
}
