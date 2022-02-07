import { INFURA_API_KEY } from '../constants';
import got, { Got, Options, Response } from 'got/dist/source';
import PQueue from 'p-queue';
import { detectContentType } from '../utils/sniff';
import { Readable } from 'stream';
import { singleton } from 'tsyringe';

enum Protocol {
  HTTPS = 'https:',
  HTTP = 'http:',
  IPFS = 'ipfs:'
}

type RequestTransformer = ((options: Options) => void) | null;

interface MetadataClientOptions {
  protocols: Record<Protocol, { transform: RequestTransformer; ipfsPathFromUrl: (url: string | URL) => string }>;
}

const defaultIpfsPathFromUrl = (url: string | URL): string => {
  url = new URL(url);
  const cid = url.host;
  const id = url.pathname;
  return `${cid}${id}`;
};

/**
 * config allows us to define handling of protocols besides
 * http and https
 */
export const config: MetadataClientOptions = {
  protocols: {
    [Protocol.IPFS]: {
      transform: (options: Options) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const url = new URL(options.url!);
        options.method = 'post';
        const cid = url.host;
        const id = url.pathname;
        const domain = 'https://ipfs.infura.io:5001/api/v0/cat?arg=';
        options.url = new URL(`${domain}${cid}${id}`);
        options.headers = {
          Authorization: INFURA_API_KEY
        };
      },
      ipfsPathFromUrl: defaultIpfsPathFromUrl
    },

    [Protocol.HTTP]: { transform: null, ipfsPathFromUrl: defaultIpfsPathFromUrl },
    [Protocol.HTTPS]: { transform: null, ipfsPathFromUrl: defaultIpfsPathFromUrl }
  }
};

function isIpfs(requestUrl: string | URL): boolean {
  return requestUrl.toString().includes('ipfs.infura.io:5001');
}

/**
 * Metadata client handles transforming requests for different protocols, 
 * basic error handling of responses, and controls concurrency to prevent
 * flooding our network 
 */
@singleton()
export default class MetadataClient {
  private readonly client: Got;

  /**
   * we only use one
   */
  private readonly queue: PQueue;

  constructor() {
    this.queue = new PQueue({
      concurrency: 30
    });

    this.client = got.extend({
      timeout: 10_000,
      throwHttpErrors: false,
      cache: false,
      hooks: {
        init: [
          (options) => {
            if (!options.url) {
              throw new Error('Url must be set in options object to use this client');
            }
            const url = new URL(options.url);
            const protocol = url.protocol.toLowerCase();
            const protocolConfig = config.protocols[protocol as Protocol];
            if (typeof protocolConfig.transform === 'function') {
              protocolConfig.transform(options);
            } else if (protocolConfig.transform !== null) {
              throw new Error(`Invalid protocol: ${protocol}`);
            }
          }
        ]
      }
    });
  }

  /**
   * returns a promise for a successful response (i.e. status code 200)
   *
   */
  async get(url: string | URL, attempt = 0): Promise<Response> {
    attempt += 1;
    try {
      const response: Response = await this.queue.add(async () => {
        /**
         * you have to set the url in options for it to be defined in the init hook
         */
        return await this.client({ url });
      });

      switch (response.statusCode) {
        case 200:
          if (isIpfs(response.requestUrl)) {
            const path = config.protocols[Protocol.IPFS].ipfsPathFromUrl(url);
            const { contentType: ipfsContentType } = await detectContentType(path, Readable.from(response.rawBody));
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            const contentType = ipfsContentType || 'text/plain';
            response.headers['content-type'] = contentType;
          }

          return response;

        case 429:
          throw new Error('Rate limited');

        default:
          throw new Error(`Unknown error. Status code: ${response.statusCode}`);
      }
    } catch (err) {
      if (attempt > 3) {
        throw err;
      }
      return await this.get(url, attempt);
    }
  }
}
