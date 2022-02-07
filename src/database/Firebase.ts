

import { singleton } from 'tsyringe';
import firebaseAdmin, { ServiceAccount } from 'firebase-admin';
import { Bucket, File } from '@google-cloud/storage';
import { FB_STORAGE_BUCKET } from '../constants';
import { Readable } from 'stream';
import { readFileSync } from 'fs';
import { resolve } from 'path';

@singleton()
export default class Firebase {
  db: FirebaseFirestore.Firestore;

  firebaseAdmin: firebaseAdmin.app.App;

  bucket: Bucket;

  constructor() {
    const serviceAccountFile = resolve('./creds/firebase.json');

    const serviceAccount = JSON.parse(readFileSync(
      serviceAccountFile, 'utf-8'
    ));
    const app = firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount as ServiceAccount),
      storageBucket: FB_STORAGE_BUCKET
    });
    this.firebaseAdmin = app;
    this.db = firebaseAdmin.firestore();
    this.db.settings({ ignoreUndefinedProperties: true });
    this.bucket = firebaseAdmin.storage().bucket();
  }

  async uploadBuffer(buffer: Buffer, path: string, contentType: string): Promise<File> {
    const remoteFile = this.bucket.file(path);
    // no idea why exists() returns an array [boolean]
    const existsArray = await remoteFile.exists();
    if (existsArray && existsArray.length > 0 && !existsArray[0]) {
      return await new Promise<File>((resolve, reject) => {
        Readable.from(buffer).pipe(
          remoteFile
            .createWriteStream({
              metadata: {
                contentType
              }
            })
            .on('error', (err) => {
              console.error(err);

              reject(err);
            })
            .on('finish', () => {
              console.log(`uploaded: ${remoteFile.name}`);

              resolve(remoteFile);
            })
        );
      });
    }

    return remoteFile;
  }
}
