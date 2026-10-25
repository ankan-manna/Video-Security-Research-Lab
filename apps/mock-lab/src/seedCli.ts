import path from "node:path";
import { loadRootEnvFile } from "./loadRootEnv.js";
import { loadEnv } from "./env.js";
import { UserStore } from "./account/userStore.js";
import { ChannelStore } from "./account/channelStore.js";
import { MembershipPlanStore } from "./account/membershipStore.js";
import { seedDemoAccounts } from "./account/seed.js";

loadRootEnvFile();

async function main() {
  const env = loadEnv();
  const dataDir = env.MOCK_LAB_DATA_DIR;

  const result = await seedDemoAccounts({
    userStore: new UserStore(path.join(dataDir, "users.json")),
    channelStore: new ChannelStore(path.join(dataDir, "channels.json")),
    membershipPlanStore: new MembershipPlanStore(path.join(dataDir, "membership-plans.json")),
  });

  console.log("Seeded demo accounts in", dataDir);
  console.log(JSON.stringify(result, null, 2));
}

main();
