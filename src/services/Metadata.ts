import { INFURA_API_KEYS, METADATA_CONCURRENCY } from '../constants';
import got, { Got, Options, Response } from 'got/dist/source';
import PQueue from 'p-queue';
import { detectContentType } from '../utils/sniff';
import { Readable } from 'stream';
import { singleton } from 'tsyringe';
import { randomItem } from '../utils';
import v8 from 'v8';

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
  url = new URL(url?.toString());
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
        const url = new URL(options.url!.toString?.());
        options.method = 'post';
        const cid = url.host;
        const id = url.pathname;
        const domain = 'https://ipfs.infura.io:5001/api/v0/cat?arg=';
        options.url = new URL(`${domain}${cid}${id}`);
        const apiKey = randomItem(INFURA_API_KEYS);
        options.headers = {
          Authorization: apiKey
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
 * flooding
 */
@singleton()
export default class MetadataClient {
  private readonly client: Got;

  private readonly queue: PQueue;

  constructor() {
    this.queue = new PQueue({
      concurrency: METADATA_CONCURRENCY
    });
    function setTerminalTitle(title: string):void {
      process.stdout.write(String.fromCharCode(27) + ']0;' + title + String.fromCharCode(7));
    }

    setInterval(() => {
      const size = this.queue.size + this.queue.pending;
      setTerminalTitle(`Metadata Queue Size: ${this.queue.size} Pending: ${this.queue.pending}  Total: ${size}`);
    }, 3000);

    this.client = got.extend({
      timeout: 120_000,
      throwHttpErrors: false,
      retry: {
        limit: 0
      },
      http2: true,
      hooks: {
        init: [
          (options) => {
            if (!options.url) {
              throw new Error('Url must be set in options object to use this client');
            }
            const url = new URL(options.url?.toString?.());
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
  async get(u: string | URL, priority = 0, attempt = 0): Promise<Response<string>> {
    attempt += 1;

    let url = new URL(u.toString());
    if (url.href.includes('/ipfs/')) {
      const pathname = url.pathname.split('/ipfs/')[1];
      if (pathname) {
        url = new URL(`ipfs://${pathname}`);
      }
    }

    try {
      const response: Response<string> = await this.queue.add(
        async () => {
          /**
           * you have to set the url in options for it to be defined in the init hook
           */
          return await this.client({ url });
        },
        { priority }
      ) ;


      switch (response.statusCode) {
        case 200:
          if (isIpfs(response.requestUrl)) {
            const path = config.protocols[Protocol.IPFS].ipfsPathFromUrl(url);
            const { contentType: ipfsContentType } = await detectContentType(path, Readable.from(response.rawBody));
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            const contentType = ipfsContentType || 'text/plain';
            response.headers['content-type'] = contentType;
          }

          return response ;

        case 429:
          throw new Error('Rate limited');

        default:
          throw new Error(`Unknown error. Status code: ${response.statusCode}`);
      }
    } catch (err: any) {
      if (attempt > 5) {
        console.log(`Failed to get metadata. URL: ${url.href}`);
        throw err;
      }
      return await this.get(url, priority, attempt);
    }
  }
}
