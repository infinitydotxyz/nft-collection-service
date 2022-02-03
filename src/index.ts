import Erc721Contract from './contracts/Erc721Contract';

async function main() {
    // const addr = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
    const addr= '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e';

    const bayc = new Erc721Contract(addr, '1');

    await bayc.getTokenIds();

}

void main();