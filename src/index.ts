import {getContractLogs } from './contractLogs';



async function main() {
    const bayc = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
    await getContractLogs(bayc);
}

main();