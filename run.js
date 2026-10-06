#!/usr/bin/env node
// Minimal host for json2dir.jsonscript.json: decode stdin into a JSON value, register thin
// executors, and evaluate the JSONScript program with the document as its data instance.
// Every json2dir decision (validation, existing-entry rules, recursion) is in the script.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const JSONScript = require("jsonscript-js");

if (process.argv.length > 2) {
  process.stderr.write("usage: json2dir < document.json\n");
  process.exit(2);
}

const die = (msg) => {
  process.stderr.write(`json2dir: ${msg}\n`);
  process.exit(1);
};

// Parsing the document is the host's job: JSONScript operates on JSON values, not bytes.
let document;
try {
  document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(0)));
} catch (e) {
  die(`input is not valid UTF-8 JSON: ${e.message}`);
}

const js = new JSONScript();

// Pure helpers for what JSONScript cannot express: value types, object iteration,
// array length, UTF-16 well-formedness (lone surrogates).
js.addExecutor("json", {
  type: (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v),
  length: (v) => v.length,
  wellFormed: (s) => s.isWellFormed(),
  // An object as a linked list {name, value, next}, so the script can recurse over members.
  list: (o) => Object.keys(o).reverse().reduce((next, name) => ({ name, value: o[name], next }), null),
});

js.addExecutor("fail", (msg) => {
  throw new Error(msg);
});

// Thin wrappers over single file system operations.
js.addExecutor("fs", {
  kind: (p) => {
    try {
      return fs.lstatSync(p).isDirectory() ? "dir" : "other";
    } catch (e) {
      if (e.code === "ENOENT") return "none";
      throw e;
    }
  },
  mkdir: (p) => (fs.mkdirSync(p), true),
  unlink: (p) => (fs.unlinkSync(p), true),
  write: ({ path: p, content }) => (fs.writeFileSync(p, content, { flag: "wx", mode: 0o666 }), true),
  symlink: ({ target, path: p }) => (fs.symlinkSync(target, p), true),
  chmodx: (p) => (fs.chmodSync(p, fs.statSync(p).mode | 0o111), true),
});

const script = JSON.parse(fs.readFileSync(path.join(__dirname, "json2dir.jsonscript.json"), "utf8"));
js.evaluate(script, document).then(
  () => {},
  (e) => die((e.message || String(e)) + (e.errors ? " " + JSON.stringify(e.errors) : "")),
);
