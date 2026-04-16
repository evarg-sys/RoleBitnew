const path = require("path");
const { open } = require("lmdb");

const LMDB_PATH = path.join(__dirname, "..", "rolebit.lmdb");

const store = open({
  path: LMDB_PATH,
  compression: true
});

module.exports = store;
