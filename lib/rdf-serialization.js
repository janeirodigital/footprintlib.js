const N3 = require("n3");
const { DataFactory } = N3;
const { namedNode, literal, defaultGraph, quad } = DataFactory;
const Relateurl = require('relateurl');
const Jsonld = require('jsonld');
const Errors = require('./rdf-errors');

function parseRdf (body, base, contentType) {
  if (!(base instanceof URL)) throw Error(`base ${base} must be an instance of URL`)
  return contentType === 'application/ld+json'
    ? parseJsonLd(body, base, {})
    : parseTurtle(body, base, {});
}

function parseTurtleSync (text, base, prefixes) {
  if (!(base instanceof URL)) throw Error(`base ${base} must be an instance of URL`)
  return new N3.Parser({baseIRI: base.href, blankNodePrefix: "", format: "text/turtle"}).parse(text);
}

async function parseTurtle (text, base, prefixes) {
  if (!(base instanceof URL)) throw Error(`base ${base} must be an instance of URL`);
  const store = new N3.Store();
  return await new Promise((resolve, reject) => {
    new N3.Parser({baseIRI: base.href, blankNodePrefix: "", format: "text/turtle"}).
      parse(text,
            function (error, triple, newPrefixes) {
              if (prefixes) {
                Object.assign(prefixes, newPrefixes)
              }
              if (error) {
                reject(error);
              } else if (triple) {
                store.addQuad(triple);
              } else {
                resolve(store);
              }
            })
  }).catch(e => {
    throw new Errors.ParserError(e, text);
  });
}

function serializeTurtleSync (graph, base, prefixes) {
  if (!(base instanceof URL)) throw Error(`base ${base} must be an instance of URL`)
  // Create RegExp to test for matching namespaces
  // Is this faster than !Object.values(prefixes).find(ns => q[t].value.startsWith(ns) ?
  const p = new RegExp('^(?:' + Object.values(prefixes).map(
    ns => ns.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
  ).map(
    nsr => '(?:' + nsr + ')'
  ).join('|') + ')')

  const writer = new N3.Writer({ prefixes });
  writer.addQuads((graph.constructor === Array ? graph : graph.getQuads()).map(q => {
    const terms = ['subject', 'object'];
    terms.forEach(t => {
      if (q[t].termType === 'NamedNode' // term is an IRI
          && !q[t].value.match(p))      // no applicable prefix
      {
        const old = q[t]
        q[t] = namedNode(Relateurl.relate(base.href, q[t].value))
        // This tests to make sure the URL is valid
        // c.f. https://github.com/stevenvachon/relateurl/issues/28
        try {
          const effective = new URL(q[t].value, base).href;
          if (old.value !== effective)
            throw new Error(`${old.value} !== ${effective}`);
        } catch (e) {
          throw Error(`Relateurl.relate(${base.href}, ${old.value}) => "${q[t].value}" failed: ${e}`)
        }
      }
    });
    return q
  }));
  let text
  writer.end((error, result) => {
    if (error)
      throw Error(error);
    else
      text = result
  });
  return text;
}

async function serializeTurtle (graph, base, prefixes) {
  if (!(base instanceof URL)) throw Error(`base ${base} must be an instance of URL`)
  // Create RegExp to test for matching namespaces
  // Is this faster than !Object.values(prefixes).find(ns => q[t].value.startsWith(ns) ?
  const p = new RegExp('^(?:' + Object.values(prefixes).map(
    ns => ns.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
  ).map(
    nsr => '(?:' + nsr + ')'
  ).join('|') + ')')

  return await new Promise((resolve, reject) => {
    const writer = new N3.Writer({ prefixes });
    writer.addQuads((graph.constructor === Array ? graph : graph.getQuads()).map(q => {
      const terms = ['subject', 'object'];
      terms.forEach(t => {
        if (q[t].termType === 'NamedNode'                            // term is an IRI
            && !q[t].value.match(p)                                  // no applicable prefix
            && new URL(base.href).host === new URL(q[t].value).host) // https://github.com/stevenvachon/relateurl/issues/28
          q[t] = namedNode(Relateurl.relate(base.href, q[t].value, { output: Relateurl.ROOT_PATH_RELATIVE }))
      });
      return q
    }));
    writer.end((error, result) => {
      if (error)
        reject(error);
      else
        resolve(result)
    });
  })
}

async function parseJsonLd (text, base) {
  if (!(base instanceof URL)) throw Error(`base ${base} must be an instance of URL`)
  try {
    const qz = await Jsonld.toRDF(JSON.parse(text), {format: "application/nquads", base: base.href});
    // I think future minor versions will return an RDFJS list of quads.
    return parseTurtle(qz, base);
  } catch(e) {
    throw new Errors.ParserError(e, text)
  }
}

function expectOne (g, s, p, o, nullable) {

  // Throw if s, p or o is an invalid query parameter.
  // This is fussier than N3.js.
  const rendered = ([s, p, o]).map(renderRdfTerm).join(' ')

  const res = g.getQuads(s, p, o);
  if (res.length === 0) {
    if (nullable)
      return null;
    throw Error(`no matches for { ${rendered} }`);
  }
  if (res.length > 1)
    throw Error(`expected one answer to { ${rendered} }; got ${res.length}`);
  return res[0];
}

function zeroOrOne (g, s, p, o) { return expectOne(g, s, p, o, true); }
function one (g, s, p, o) { return expectOne(g, s, p, o, false); }

// good-enough rendering for terms.
function renderRdfTerm (t) {
  return t === null ? '_'
  // : typeof t === 'string' ? `<${t}>` disabled even though N3.js allows bare IRIs.
    : t.termType === 'NamedNode' ? `<${t.value}>`
    : t.termType === 'BlankNode' ? `_:${t.value}`
    : t.termType === 'Literal' ? `"${t.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : (() => { throw Error(`${t} is not an RDFJS term`) })();
}

module.exports = {
  parseRdf,
  parseTurtleSync,
  parseTurtle,
  serializeTurtleSync,
  serializeTurtle,
  parseJsonLd,
  zeroOrOne,
  one,
  renderRdfTerm,
};
