import express, { Request, Response } from 'express';
import { collectionService, logger } from './container';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { validateAddress, validateChainId, normalizeAddress } from './utils/ethers';
import { NULL_ADDR } from './constants';

export async function main(): Promise<void> {
  const packageDotJSON = resolve('./package.json');
  const { version } = JSON.parse(await readFile(packageDotJSON, 'utf-8'));

  const app = express();

  app.enable('trust proxy');

  app.use(express.json());
  app.use(express.raw({ type: 'application/octet-stream' }));

  app.get('/', (req, res) => {
    res.send(`NFT Collection Service Version: ${version}`).status(200);
  });


  app.post('/collection', async (req: Request<any, { chainId: string; address: string, indexInitiator: string }>, res: Response) => {
    let address: string;
    let chainId: string;
    let indexInitiator: string;
    console.log("receive request with payload", req.body);
    try{  
      const str = Buffer.from((req.body as Buffer).toString(), 'base64').toString('ascii');
      const data = JSON.parse(str);
      address = data.address as string;
      chainId = data.chainId as string;
      indexInitiator = data.indexInitiator as string;
  
      if(!indexInitiator) {
        indexInitiator = NULL_ADDR;
      }
      chainId = validateChainId(chainId);
      address = validateAddress(normalizeAddress(address));
      indexInitiator = validateAddress(normalizeAddress(indexInitiator));
    }catch(err) {
      res.send(err).status(400);
      return;
    }

    try {
      // collectionService.createCollection(address, chainId, false, false, indexInitiator).then(() => {
      //   logger.log('completed collection from task queue');
      // }).catch((err) => {
      //   logger.error(err);
      // });
      await collectionService.createCollection(address, chainId, false, false, indexInitiator);
      res.sendStatus(200);
    } catch (err) {
      res.send(err).status(500);
    }
  });

  const PORT = process.env.PORT ?? 8080;

  app.listen(PORT, () => {
    logger.log(`App listening on port ${PORT}`);
  });
}
