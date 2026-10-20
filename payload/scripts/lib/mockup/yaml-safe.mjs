import { isMap, isScalar, isSeq, parse, parseDocument, Scalar, visit } from './vendor/yaml.mjs';

export { isMap, isScalar, isSeq, parse, parseDocument, Scalar };

const CORE_TAGS = new Set(['tag:yaml.org,2002:str', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float', 'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null', 'tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq', '!!str', '!!int', '!!float', '!!bool', '!!null', '!!map', '!!seq']);

// Parses YAML and reports aliases and non-core tags, which the add-on never edits or trusts.
export function parseYamlText(text) {
  let doc;
  try {
    doc = parseDocument(String(text), { prettyErrors: false });
  } catch (err) {
    return { doc: null, data: null, errors: [err.message], alias: false, tagged: false };
  }
  const errors = (doc.errors ?? []).map(error => error.message);
  let alias = false;
  let tagged = false;
  visit(doc, {
    Alias() {
      alias = true;
    },
    Node(_key, node) {
      if (node.tag && !CORE_TAGS.has(node.tag)) tagged = true;
    },
  });
  let data = null;
  if (!errors.length) {
    try {
      data = doc.toJS();
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { doc, data, errors, alias, tagged };
}
