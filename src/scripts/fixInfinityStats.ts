import { StatType } from '@infinityxyz/lib/types/core/SocialsStats';
import BatchHandler from 'models/BatchHandler';
import { firebase } from '../container';

export async function fixInfinityStats() {
  const statsGroups = ['collectionStats', 'nftStats'];
  const percentChangeStats = [
    StatType.CeilPriceChange,
    StatType.VolumeChange,
    StatType.SalesChange,
    StatType.AveragePriceChange,
    StatType.DiscordFollowersPercentChange,
    StatType.DiscordPresencePercentChange,
    StatType.TwitterFollowersPercentChange,
    StatType.FloorPriceChange
  ];

  const batchHandler = new BatchHandler();
  let docsUpdated = 0;
  for (const statsGroup of statsGroups) {
    for (const stat of percentChangeStats) {
      console.log(`Fixing ${statsGroup} ${stat}`);
      try {
        const query = firebase.db.collectionGroup(statsGroup).where(stat, '==', Infinity).stream();

        for await (const docSnap of query) {
          docsUpdated += 1;
          const doc = docSnap as any as FirebaseFirestore.QueryDocumentSnapshot;
          batchHandler.add(doc.ref, { [stat]: 0 }, { merge: true });
          if (docsUpdated % 1000 === 0) {
            console.log(`Updated ${docsUpdated} docs`);
          }
        }
      } catch (err) {
        console.error(err);
      }
    }
  }
}
