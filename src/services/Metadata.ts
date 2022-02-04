import got, { Got } from "got/dist/source";

enum Protocol {
    HTTPS = 'https:',
    HTTP = 'http:',
    IPFS = 'ipfs:'
}

export default class MetadataClient {
    private readonly client: Got;

    constructor() {
        this.client = got.extend({
            timeout: 10_000,
            throwHttpErrors: false,
            cache: false,
            hooks: {
                init: [
                    (options) => {
                        if(!options.url) {
                            throw new Error("Url must be set in options object to use this client")
                        }
                        const url = new URL(options.url);
                        switch(url.protocol.toLowerCase()) {
                            case Protocol.IPFS:
                                const cid = url.host;
                                const id = url.pathname
                                options.url = new URL(`https://ipfs.io/ipfs/${cid}${id}`);
                                break;
                            case Protocol.HTTP:
                                break;
                            case Protocol.HTTPS:
                                break;
                            default:
                                throw new Error(`Unknown protocol while getting metadata. URL: ${options.url?.toString()}`);
                        }
                    }
                ]
            }
        })
    }


    async getMetadata(url: string):Promise<unknown> {
        try{
            const response = await this.client({url});
            if(response.statusCode === 200) {
                return response.body;
            }

            console.log(response.statusCode); // TODO add error handling
        }catch(err) {
            console.log(err);
        }
    }
}