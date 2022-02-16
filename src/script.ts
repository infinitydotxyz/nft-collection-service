import { metadataClient } from "./container";
import { sleep } from "./utils";

export async function main(): Promise<void> {
  // const address = '0x1a92f7381b9f03921564a437210bb9396471050c'.toLowerCase();
  // const chainId = '1';
  try{
    // const res = await metadataClient.get('ipfs://Qmcob1MaPTXUZt5MztHEgsYhrf7R6G7wV8hpcweL8nEfgU/meka/398');
    console.time('image')
    const res = await metadataClient.get('ipfs://QmQoz3j64vHNXPADoCaYdXGSA14SiKch7oPpV9jzDe6Dui/red_red_darkbrown_darkbrown_lightgreen_darkbrown_D_4D_2D_3D_1D_1D_2D_0_0_0_0_0_0_0163.png');
    // console.log(res.body);
    console.log(res.statusCode);
    console.timeEnd('image')
  }catch(err) {
    console.error(err);
  }

  await sleep(200);
}