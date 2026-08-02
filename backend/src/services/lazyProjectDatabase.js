'use strict';

const { getProjectDatabase } = require('./projectDatabase');

function createLazyProjectDatabase(config, factory = getProjectDatabase) {
  let database = null;
  const resolve = () => {
    if (!database) database = factory(config);
    return database;
  };
  return new Proxy({}, {
    get(_target, property) {
      if (property === '__peek') return () => database;
      const owner = resolve();
      const value = Reflect.get(owner, property, owner);
      return typeof value === 'function' ? value.bind(owner) : value;
    },
    set(_target, property, value) {
      return Reflect.set(resolve(), property, value);
    },
    has(_target, property) {
      return property in resolve();
    },
  });
}

module.exports = { createLazyProjectDatabase };
