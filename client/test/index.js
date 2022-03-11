const client = require('../');

async function main() {

    const res = await client.enqueueCollection({chainId: '1', address: '0x892848074ddea461a15f337250da3ce55580ca85', indexInitiator: '0x22c3b13EC38cbE06Cf3a4C49c100C65ce830A662'}, {url: client.DEV_COLLECTION_SERVICE_URL});

    console.log(res);

}

main();