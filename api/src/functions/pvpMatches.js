import { createPvpHandlers } from './pvp.js';

export function createPvpMatchHandlers(dependencies = {}) {
  const handlers = createPvpHandlers(dependencies);
  return { search: handlers.search, submit: handlers.submit, topFive: handlers.topFive, history: handlers.history };
}

export function registerPvpMatchFunctions(app, dependencies = {}) {
  const handlers = createPvpMatchHandlers(dependencies);
  app.http('pvpMatchSearch', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'pvp/matches/search',
    handler: handlers.search,
  });
  app.http('pvpMatchResult', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'pvp/matches/{matchId}/result',
    handler: handlers.submit,
  });
  app.http('pvpMatchHistory', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'pvp/matches/history',
    handler: handlers.history,
  });
  app.http('pvpRankingTop', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'rankings/pvp/top',
    handler: handlers.topFive,
  });
}
