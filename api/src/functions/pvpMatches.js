import { createPvpHandlers } from './pvp.js';

export function createPvpMatchHandlers(dependencies = {}) {
  const handlers = createPvpHandlers(dependencies);
  return {
    search: handlers.search,
    getSearch: handlers.getSearch,
    cancelSearch: handlers.cancelSearch,
    startMatch: handlers.startMatch,
    submit: handlers.submit,
    topFive: handlers.topFive,
    history: handlers.history,
  };
}

export function registerPvpMatchFunctions(app, dependencies = {}) {
  const handlers = createPvpMatchHandlers(dependencies);
  app.http('pvpMatchSearch', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'pvp/matches/search',
    handler: handlers.search,
  });
  app.http('pvpMatchSearchStatus', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'pvp/matches/search/{searchId}',
    handler: handlers.getSearch,
  });
  app.http('pvpMatchSearchCancel', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'pvp/matches/search/{searchId}/cancel',
    handler: handlers.cancelSearch,
  });
  app.http('pvpMatchStart', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'pvp/matches/{matchId}/start',
    handler: handlers.startMatch,
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
