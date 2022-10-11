// // eslint-disable-next-line eslint-comments/disable-enable-pair
// /* eslint-disable @typescript-eslint/no-unsafe-call */
// /* eslint-disable eslint-comments/disable-enable-pair */
// /* eslint-disable @typescript-eslint/no-unsafe-argument */
// import { collectionDao } from '../container';
// import BatchHandler from '../models/BatchHandler';
// import { FieldValue } from 'firebase-admin/firestore';
// import { getAttributeDocId, getSearchFriendlyString } from '@infinityxyz/lib/utils';
// import { firestoreConstants } from '@infinityxyz/lib/utils/constants';
// import { Collection, CollectionAttribute } from '@infinityxyz/lib/types/core';

// /**
//  * Verify that the specified value is not null, undefined or {}.
//  */
// function isSet(field: any | null | undefined) {
//   return field != null && Object.entries(field).length != 0;
// }

// function writeAtrributes(docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[], batch: BatchHandler) {
//   for (const attributeDoc of docs) {
//     const attributeData = attributeDoc.data() as CollectionAttribute;

//     if (isSet(attributeData?.values)) {
//       for (const value in attributeData.values) {
//         const docId = getAttributeDocId(value);
//         if (docId) {
//           const valueDoc = attributeDoc.ref.collection(firestoreConstants.COLLECTION_ATTRIBUTES_VALUES).doc(docId);
//           const valueData = {
//             ...attributeData.values[value],
//             attributeType: attributeData.attributeType ?? attributeDoc.id,
//             attributeTypeSlug: getSearchFriendlyString(attributeData.attributeType ?? attributeDoc.id),
//             attributeValue: value,
//             attributeValueSlug: getSearchFriendlyString(value)
//           };
//           batch.add(valueDoc, valueData, { merge: true });
//         }
//       }
//       batch.add(attributeDoc.ref, { values: FieldValue.delete() }, { merge: true });
//     }
//   }

//   return batch;
// }

// function rewriteMalformedAtrributes(
//   docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[],
//   batch: BatchHandler
// ) {
//   for (const attributeDoc of docs) {
//     const attributeDocData = attributeDoc.data();

//     if (attributeDocData?.attributeData) {
//       batch.add(attributeDoc.ref, { ...attributeDocData?.attributeData, attributeData: FieldValue.delete() }, { merge: true });
//     } else {
//       const data = {
//         ...attributeDocData,
//         attributeType: attributeDocData?.attributeType || attributeDoc.id,
//         attributeTypeSlug: attributeDocData?.attributeTypeSlug || getSearchFriendlyString(attributeDoc.id)
//       };
//       batch.add(attributeDoc.ref, data, { merge: true });
//     }
//   }

//   return batch;
// }

// /**
//  * Migrates all collections that don't have a 'attributes' subcollection yet.
//  */
// export async function migrateAttributes(): Promise<void> {
//   let batch = new BatchHandler();

//   // list of batches to flush
//   const batches: BatchHandler[] = [];

//   let errors = 0;

//   let startAfter;

//   // eslint-disable-next-line no-constant-condition
//   while (true) {
//     let query = collectionDao.database.collection(firestoreConstants.COLLECTIONS_COLL).orderBy('address', 'asc').limit(500);

//     if (startAfter) {
//       query = query.startAfter(startAfter);
//     }

//     const snapshot = await query.get();

//     if (snapshot.size === 0) {
//       break;
//     }

//     for (const doc of snapshot.docs) {
//       const collection = doc.data() as Collection;
//       const collectionRef = doc.ref;

//       const attributesRef = collectionRef.collection(firestoreConstants.COLLECTION_ATTRIBUTES);

//       // check if the 'attributes' field is set directly on the collection document
//       if (isSet(collection?.attributes)) {
//         console.log(`scheduled migration of collection: ${collection.chainId}:${collection.address}`);

//         for (const attribute in collection.attributes) {
//           // write attributes to subcollection (collection > attributes)
//           const docId = getAttributeDocId(attribute);
//           if (docId) {
//             const attributeDoc = attributesRef.doc(docId);
//             const attributeData = {
//               attributeType: attribute,
//               attributeTypeSlug: getSearchFriendlyString(attribute),
//               count: collection.attributes[attribute].count,
//               percent: collection.attributes[attribute].percent,
//               displayType: collection.attributes[attribute].displayType
//             };
//             batch.add(attributeDoc, { ...attributeData, values: FieldValue.delete() }, { merge: true });

//             // write attribute values to another subcollection within the attributes subcollection (collection > attributes > values)
//             const values = collection.attributes[attribute].values;
//             if (isSet(values)) {
//               for (const value in values) {
//                 const docId = getAttributeDocId(value);
//                 if (docId) {
//                   const valueDoc = attributeDoc.collection(firestoreConstants.COLLECTION_ATTRIBUTES_VALUES).doc(docId);
//                   const valueData = {
//                     ...values[value],
//                     attributeType: attribute,
//                     attributeTypeSlug: getSearchFriendlyString(attribute),
//                     attributeValue: value,
//                     attributeValueSlug: getSearchFriendlyString(value)
//                   };
//                   batch.add(valueDoc, valueData, { merge: true });
//                 }
//               }
//             }
//           }
//         }
//         batch.add(collectionRef, { attributes: FieldValue.delete() }, { merge: true });
//       }

//       // check and migrate if the collection has the 'attributes' subcollection, but not the 'values' subcollection within
//       const attributesSnapshot = await attributesRef.get();
//       if (attributesSnapshot.docs.length > 0) {
//         const currentBatchSize = batch.size;
//         batch = writeAtrributes(attributesSnapshot.docs, batch);
//         if (currentBatchSize != batch.size) {
//           console.log(`scheduled migration of partially migrated collection: ${collection.chainId}:${collection.address}`);
//         }
//       }

//       // check if the collection has the 'values' subcollection within the 'attributes' subcollection but attributes is malformed
//       if (attributesSnapshot.docs.length > 0) {
//         const currentBatchSize = batch.size;
//         batch = rewriteMalformedAtrributes(attributesSnapshot.docs, batch);
//         if (currentBatchSize != batch.size) {
//           console.log(`scheduled migration of malformed collection: ${collection.chainId}:${collection.address}`);
//         }
//       }

//       if (batch.size >= 100) {
//         batches.push(batch);
//         batch = new BatchHandler();
//       }
//     }

//     // push last batch
//     if (batch.size > 0) {
//       batches.push(batch);
//     }

//     for (let i = 0; i < batches.length; i++) {
//       const batch = batches[i];
//       console.log(`writing batch ${i + 1} / ${batches.length}`);
//       try {
//         await batch.flush();
//       } catch (err) {
//         console.error(err);
//         errors++;
//       }
//     }

//     startAfter = snapshot.docs[snapshot.size - 1].get('address');

//     console.log(`selecting next collections after ${startAfter}`);
//   }

//   if (errors > 0) {
//     console.warn(`caught ${errors} errors. `);
//   }
// }
