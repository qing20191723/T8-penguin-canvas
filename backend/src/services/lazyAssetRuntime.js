'use strict';

const instances = {
  previewPipeline: null,
  indexer: null,
  semanticPipeline: null,
};

function lazyProxy(factory) {
  return new Proxy({}, {
    get(_target, property) {
      const instance = factory();
      const value = Reflect.get(instance, property, instance);
      return typeof value === 'function' ? value.bind(instance) : value;
    },
  });
}

function previewPipeline(config, database) {
  if (!instances.previewPipeline) {
    const { getAssetPreviewPipeline } = require('./assetPreviewPipeline');
    instances.previewPipeline = getAssetPreviewPipeline(config, database);
  }
  return instances.previewPipeline;
}

function indexer(config, database) {
  if (!instances.indexer) {
    const { getBackgroundAssetIndexer } = require('./assetIndexer');
    instances.indexer = getBackgroundAssetIndexer(config, database, previewPipeline(config, database));
  }
  return instances.indexer;
}

function semanticPipeline(config, database) {
  if (!instances.semanticPipeline) {
    const { getAssetSemanticPipeline } = require('./assetSemanticPipeline');
    instances.semanticPipeline = getAssetSemanticPipeline(config, database);
  }
  return instances.semanticPipeline;
}

function createLazyAssetRuntime(config, database) {
  return {
    previewPipeline: lazyProxy(() => previewPipeline(config, database)),
    indexer: lazyProxy(() => indexer(config, database)),
    semanticPipeline: lazyProxy(() => semanticPipeline(config, database)),
  };
}

function peekAssetRuntime() {
  return { ...instances };
}

function resetLazyAssetRuntimeForTests() {
  instances.previewPipeline = null;
  instances.indexer = null;
  instances.semanticPipeline = null;
}

module.exports = {
  createLazyAssetRuntime,
  peekAssetRuntime,
  resetLazyAssetRuntimeForTests,
};
