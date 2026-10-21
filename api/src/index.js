import { app } from '@azure/functions';
import { ManagedIdentityCredential } from '@azure/identity';
import { registerMeFunction } from './functions/me.js';
import { registerCloudSaveFunctions } from './functions/cloudSave.js';
import { registerStageRunFunctions } from './functions/stageRuns.js';
import { registerRankingFunctions } from './functions/rankings.js';
import { registerPlayerSnapshotFunction } from './functions/playerSnapshots.js';
import { registerPvpMatchFunctions } from './functions/pvpMatches.js';
import { registerSignalRFunction } from './functions/signalr.js';
import { createStageRunService } from './services/stageRunService.js';
import { createPvpResultService } from './services/pvpResultService.js';
import { createRankingEventsService } from './services/rankingEvents.js';

const credential = new ManagedIdentityCredential();
const rankingEvents = createRankingEventsService({ credential });
const stageService = createStageRunService({
  publishRankingChanged:rankingEvents.publishTopFiveChanged,
  publishPlayerRankChanged:rankingEvents.publishPlayerRankChanged,
});
const pvpResultService = createPvpResultService({
  publishMatchCompleted:rankingEvents.publishTopFiveChanged,
  publishPlayerRankChanged:rankingEvents.publishPlayerRankChanged,
});

registerMeFunction(app, { credential });
registerCloudSaveFunctions(app, { credential });
registerStageRunFunctions(app, { credential, service:stageService });
registerRankingFunctions(app, { credential, stageService, pvpService:pvpResultService });
registerPlayerSnapshotFunction(app, { credential });
registerPvpMatchFunctions(app, { credential, resultService:pvpResultService });
registerSignalRFunction(app, { credential, service:rankingEvents });
