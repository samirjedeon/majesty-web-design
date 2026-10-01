// The subset of config.js the screen needs (no provider symbols or secrets).
export function publicConfig(config, buildId) {
  const { assets, layout, refresh, charts, display, usMarket } = config;
  return {
    buildId,
    assets: assets.map(({ id, name, ticker, type, decimals, prefix }) => ({ id, name, ticker, type, decimals, prefix })),
    layout, charts, display, usMarket,
    refresh: { browserPoll: refresh.browserPoll, crypto: refresh.crypto, us: refresh.us },
  };
}
