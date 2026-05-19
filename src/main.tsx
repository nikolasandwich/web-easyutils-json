import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSONPath } from 'jsonpath-plus';
import {
  AlertCircle,
  Braces,
  CheckCircle2,
  Clipboard,
  ClipboardPaste,
  Download,
  Eraser,
  FileJson,
  KeyRound,
  Lock,
  Repeat2,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
  WrapText
} from 'lucide-react';
import './styles.css';

const sampleJson = `{
  "name": "EasyUtils JSON",
  "purpose": "Format, validate, minify and convert JSON in the browser",
  "features": ["format", "validate", "minify", "sort keys", "escape", "base64"],
  "private": true
}`;

const binaryChunkSize = 0x8000;
const sampleJsonPath = '$.features[*]';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type JsonSchema = {
  $schema?: string;
  title?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonValue[];
  const?: JsonValue;
  default?: JsonValue;
  examples?: JsonValue[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
};

type ParseResult =
  | { ok: true; value: JsonValue; formatted: string; minified: string }
  | { ok: false; message: string; position?: number; line?: number; column?: number };

type Stats = {
  keys: number;
  arrays: number;
  objects: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  depth: number;
};

function parseJson(input: string): ParseResult {
  try {
    const value = JSON.parse(input) as JsonValue;
    return {
      ok: true,
      value,
      formatted: JSON.stringify(value, null, 2),
      minified: JSON.stringify(value)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    const details = getJsonErrorDetails(input, message);
    return {
      ok: false,
      message,
      ...details
    };
  }
}

function getJsonErrorDetails(input: string, message: string) {
  const positionMatch = message.match(/position (\d+)/i);
  if (positionMatch) {
    const position = Number(positionMatch[1]);
    return { position, ...positionToLineColumn(input, position) };
  }

  const lineColumnMatch = message.match(/line (\d+) column (\d+)/i);
  if (lineColumnMatch) {
    return {
      line: Number(lineColumnMatch[1]),
      column: Number(lineColumnMatch[2])
    };
  }

  return {};
}

function formatParseError(result: Extract<ParseResult, { ok: false }>) {
  if (!result.line || /line \d+/i.test(result.message)) {
    return result.message;
  }

  return `${result.message} at line ${result.line}, column ${result.column}`;
}

function positionToLineColumn(input: string, position: number) {
  const before = input.slice(0, position);
  const lines = before.split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, JsonValue>>((result, key) => {
        result[key] = sortKeys(value[key]);
        return result;
      }, {});
  }

  return value;
}

function schemaType(value: JsonValue) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function uniqueTypes(types: Array<string | string[] | undefined>) {
  const result = new Set<string>();
  types.forEach((type) => {
    if (Array.isArray(type)) {
      type.forEach((item) => result.add(item));
    } else if (type) {
      result.add(type);
    }
  });

  const next = [...result];
  if (next.length === 0) return undefined;
  return next.length === 1 ? next[0] : next;
}

function detectStringFormat(value: string) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) {
    return 'date-time';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? 'uri' : undefined;
  } catch {
    return undefined;
  }
}

function inferSchema(value: JsonValue, isRoot = true): JsonSchema {
  if (Array.isArray(value)) {
    return {
      ...(isRoot ? { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Generated schema' } : {}),
      type: 'array',
      items: value.length > 0 ? mergeSchemas(value.map((item) => inferSchema(item, false))) : {}
    };
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return {
      ...(isRoot ? { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Generated schema' } : {}),
      type: 'object',
      properties: entries.reduce<Record<string, JsonSchema>>((properties, [key, item]) => {
        properties[key] = inferSchema(item, false);
        return properties;
      }, {}),
      required: entries.map(([key]) => key)
    };
  }

  const type = schemaType(value);
  const schema: JsonSchema = {
    ...(isRoot ? { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Generated schema' } : {}),
    type
  };

  if (typeof value === 'string') {
    const format = detectStringFormat(value);
    if (format) schema.format = format;
  }

  return schema;
}

function mergeSchemas(schemas: JsonSchema[]): JsonSchema {
  if (schemas.length === 0) return {};
  if (schemas.length === 1) return schemas[0];

  const type = uniqueTypes(schemas.map((schema) => schema.type));
  const merged: JsonSchema = type ? { type } : {};
  const typeList = type ? (Array.isArray(type) ? type : [type]) : [];

  if (typeList.includes('object')) {
    const objectSchemas = schemas.filter((schema) =>
      Array.isArray(schema.type) ? schema.type.includes('object') : schema.type === 'object'
    );
    const allKeys = new Set<string>();
    objectSchemas.forEach((schema) => Object.keys(schema.properties ?? {}).forEach((key) => allKeys.add(key)));

    merged.properties = {};
    allKeys.forEach((key) => {
      const propertySchemas = objectSchemas
        .map((schema) => schema.properties?.[key])
        .filter((schema): schema is JsonSchema => Boolean(schema));
      merged.properties![key] = mergeSchemas(propertySchemas);
    });

    merged.required = [...allKeys].filter((key) =>
      objectSchemas.every((schema) => Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key))
    );
  }

  if (typeList.includes('array')) {
    const itemSchemas = schemas
      .map((schema) => schema.items)
      .filter((schema): schema is JsonSchema => Boolean(schema));
    if (itemSchemas.length > 0) merged.items = mergeSchemas(itemSchemas);
  }

  const formats = [...new Set(schemas.map((schema) => schema.format).filter(Boolean))];
  if (formats.length === 1) merged.format = formats[0];

  return merged;
}

function firstSchemaOption(schema: JsonSchema) {
  return schema.default ?? schema.examples?.[0] ?? schema.const ?? schema.enum?.[0];
}

function schemaToDemo(schema: JsonSchema): JsonValue {
  const preferred = firstSchemaOption(schema);
  if (preferred !== undefined) return preferred;

  if (schema.allOf?.length) {
    const objects = schema.allOf.map(schemaToDemo).filter((value) => value && typeof value === 'object' && !Array.isArray(value));
    return Object.assign({}, ...objects) as JsonValue;
  }

  const option = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (option) return schemaToDemo(option);

  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== 'null') ?? schema.type[0] : schema.type;

  if (type === 'object' || schema.properties) {
    return Object.entries(schema.properties ?? {}).reduce<Record<string, JsonValue>>((result, [key, property]) => {
      result[key] = schemaToDemo(property);
      return result;
    }, {});
  }

  if (type === 'array') {
    const count = Math.max(1, Math.min(schema.minItems ?? 1, 3));
    return Array.from({ length: count }, () => schemaToDemo(schema.items ?? {}));
  }

  if (type === 'integer') return Math.trunc(schema.minimum ?? schema.maximum ?? 1);
  if (type === 'number') return schema.minimum ?? schema.maximum ?? 1.5;
  if (type === 'boolean') return true;
  if (type === 'null') return null;

  if (type === 'string' || schema.format || schema.minLength) {
    if (schema.format === 'email') return 'user@example.com';
    if (schema.format === 'uri') return 'https://example.com';
    if (schema.format === 'date') return '2026-05-19';
    if (schema.format === 'date-time') return '2026-05-19T00:00:00.000Z';
    return 'string'.padEnd(Math.max(schema.minLength ?? 6, 1), 'x');
  }

  return {};
}

function collectStats(value: JsonValue, depth = 1): Stats {
  const stats: Stats = {
    keys: 0,
    arrays: 0,
    objects: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    depth
  };

  const merge = (next: Stats) => {
    stats.keys += next.keys;
    stats.arrays += next.arrays;
    stats.objects += next.objects;
    stats.strings += next.strings;
    stats.numbers += next.numbers;
    stats.booleans += next.booleans;
    stats.nulls += next.nulls;
    stats.depth = Math.max(stats.depth, next.depth);
  };

  if (value === null) {
    stats.nulls += 1;
    return stats;
  }

  if (Array.isArray(value)) {
    stats.arrays += 1;
    value.forEach((item) => merge(collectStats(item, depth + 1)));
    return stats;
  }

  if (typeof value === 'object') {
    stats.objects += 1;
    stats.keys += Object.keys(value).length;
    Object.values(value).forEach((item) => merge(collectStats(item, depth + 1)));
    return stats;
  }

  if (typeof value === 'string') stats.strings += 1;
  if (typeof value === 'number') stats.numbers += 1;
  if (typeof value === 'boolean') stats.booleans += 1;

  return stats;
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += binaryChunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + binaryChunkSize)));
  }
  const binary = chunks.join('');
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return decodeBase64(padded);
}

function decodeJwt(value: string) {
  const token = value.trim();
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('JWT must include at least header and payload segments.');
  }

  const header = JSON.parse(decodeBase64Url(parts[0])) as JsonValue;
  const payload = JSON.parse(decodeBase64Url(parts[1])) as JsonValue;
  return JSON.stringify({ header, payload }, null, 2);
}

function runJsonPathQuery(json: JsonValue, path: string) {
  const query = path.trim();
  if (!query) {
    throw new Error('Enter a JSONPath query first.');
  }

  return JSONPath({
    path: query,
    json,
    wrap: true,
    eval: 'safe'
  }) as JsonValue[];
}

function bytes(value: string) {
  return new Blob([value]).size;
}

function App() {
  const [input, setInput] = useState(sampleJson);
  const [output, setOutput] = useState(() => JSON.stringify(JSON.parse(sampleJson), null, 2));
  const [jsonPathQuery, setJsonPathQuery] = useState(sampleJsonPath);
  const [notice, setNotice] = useState('Sample JSON loaded');

  const parseResult = useMemo(() => parseJson(input), [input]);
  const stats = useMemo(() => (parseResult.ok ? collectStats(parseResult.value) : null), [parseResult]);

  const runJsonAction = (action: 'format' | 'minify' | 'sort' | 'schema' | 'demo') => {
    const result = parseJson(input);
    if (!result.ok) {
      setNotice(`Invalid JSON: ${formatParseError(result)}`);
      return;
    }

    if (action === 'format') {
      setOutput(result.formatted);
      setNotice('JSON formatted with 2-space indentation');
    }

    if (action === 'minify') {
      setOutput(result.minified);
      setNotice('Whitespace removed from JSON');
    }

    if (action === 'sort') {
      setOutput(JSON.stringify(sortKeys(result.value), null, 2));
      setNotice('Object keys sorted alphabetically');
    }

    if (action === 'schema') {
      setOutput(JSON.stringify(inferSchema(result.value), null, 2));
      setNotice('JSON Schema generated from the sample input');
    }

    if (action === 'demo') {
      setOutput(JSON.stringify(schemaToDemo(result.value as JsonSchema), null, 2));
      setNotice('Demo JSON generated from the schema input');
    }
  };

  const escapeInput = () => {
    setOutput(JSON.stringify(input));
    setNotice('Input escaped as a JSON string');
  };

  const unescapeInput = () => {
    try {
      const value = JSON.parse(input);
      setOutput(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      setNotice('JSON string unescaped');
    } catch (error) {
      setNotice(error instanceof Error ? `Cannot unescape: ${error.message}` : 'Cannot unescape input');
    }
  };

  const base64 = (mode: 'encode' | 'decode') => {
    try {
      setOutput(mode === 'encode' ? encodeBase64(input) : decodeBase64(input.trim()));
      setNotice(mode === 'encode' ? 'Input encoded to Base64' : 'Base64 decoded');
    } catch {
      setNotice(`Base64 ${mode} failed. Check the input and try again.`);
    }
  };

  const decodeJwtInput = () => {
    try {
      setOutput(decodeJwt(input));
      setNotice('JWT header and payload decoded locally');
    } catch (error) {
      setNotice(error instanceof Error ? `JWT decode failed: ${error.message}` : 'JWT decode failed');
    }
  };

  const extractJsonPath = () => {
    const result = parseJson(input);
    if (!result.ok) {
      setNotice(`Invalid JSON: ${formatParseError(result)}`);
      return;
    }

    try {
      const matches = runJsonPathQuery(result.value, jsonPathQuery);
      setOutput(JSON.stringify(matches, null, 2));
      setNotice(`JSONPath returned ${matches.length.toLocaleString()} match${matches.length === 1 ? '' : 'es'}`);
    } catch (error) {
      setNotice(error instanceof Error ? `JSONPath failed: ${error.message}` : 'JSONPath query failed');
    }
  };

  const clearEditors = () => {
    setInput('');
    setOutput('');
    setNotice('Input and output cleared');
  };

  const pasteInput = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      setNotice('Clipboard pasted into input');
    } catch {
      setNotice('Clipboard read failed. Paste into the input manually.');
    }
  };

  const swapEditors = () => {
    setInput(output);
    setOutput(input);
    setNotice('Input and output swapped');
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setNotice('Output copied to clipboard');
    } catch {
      setNotice('Clipboard access failed. Select the output and copy it manually.');
    }
  };

  const downloadOutput = () => {
    const blob = new Blob([output], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'easyutils-json-output.json';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice('Output downloaded');
  };

  const loadSample = () => {
    setInput(sampleJson);
    setOutput(JSON.stringify(JSON.parse(sampleJson), null, 2));
    setNotice('Sample JSON loaded');
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="EasyUtils JSON home">
          <span className="brand-mark">
            <Braces size={24} />
          </span>
          <span>
            <strong>EasyUtils JSON</strong>
            <small>Browser JSON toolbox</small>
          </span>
        </a>
        <nav aria-label="Primary">
          <a href="#tool">Tool</a>
          <a href="#features">Features</a>
          <a href="#references">Refs</a>
          <a href="#faq">FAQ</a>
        </nav>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">Private, instant and Vercel-ready</p>
          <h1 id="page-title">Free JSON formatter, validator and converter</h1>
          <p>
            Clean messy JSON, validate payloads with line and column hints, minify responses, sort keys,
            decode JWTs and convert strings without sending your data to a server.
          </p>
        </div>
        <div className="hero-panel" aria-label="Tool status">
          <ShieldCheck size={24} />
          <span>All transformations run locally in your browser.</span>
        </div>
      </section>

      <section className="workspace" id="tool" aria-label="JSON tool">
        <div className="query-bar" aria-label="JSONPath query">
          <label htmlFor="jsonpath-query">JSONPath</label>
          <input
            id="jsonpath-query"
            spellCheck="false"
            value={jsonPathQuery}
            onChange={(event) => setJsonPathQuery(event.target.value)}
            placeholder="$.users[*].email"
          />
          <button onClick={extractJsonPath} title="Extract with JSONPath">
            <Search size={18} />
            Extract
          </button>
        </div>

        <div className="toolbar" aria-label="JSON actions">
          <button onClick={() => runJsonAction('format')} title="Format JSON">
            <Sparkles size={18} />
            Format
          </button>
          <button onClick={() => runJsonAction('minify')} title="Minify JSON">
            <WrapText size={18} />
            Minify
          </button>
          <button onClick={() => runJsonAction('sort')} title="Sort JSON keys">
            <FileJson size={18} />
            Sort keys
          </button>
          <button onClick={() => runJsonAction('schema')} title="Generate JSON Schema">
            <Wand2 size={18} />
            JSON to Schema
          </button>
          <button onClick={() => runJsonAction('demo')} title="Generate demo JSON from schema">
            <Braces size={18} />
            Schema to JSON
          </button>
          <button onClick={escapeInput} title="Escape input">
            <Lock size={18} />
            Escape
          </button>
          <button onClick={unescapeInput} title="Unescape JSON string">
            <Braces size={18} />
            Unescape
          </button>
          <button onClick={() => base64('encode')} title="Encode Base64">
            B64+
          </button>
          <button onClick={() => base64('decode')} title="Decode Base64">
            B64-
          </button>
          <button onClick={decodeJwtInput} title="Decode JWT">
            <KeyRound size={18} />
            JWT
          </button>
          <button onClick={pasteInput} title="Paste from clipboard">
            <ClipboardPaste size={18} />
            Paste
          </button>
          <button onClick={swapEditors} title="Swap input and output">
            <Repeat2 size={18} />
            Swap
          </button>
          <button onClick={clearEditors} title="Clear input and output">
            <Eraser size={18} />
            Clear
          </button>
          <button onClick={loadSample} title="Load sample JSON">
            Sample
          </button>
        </div>

        <div className="editor-grid">
          <section className="editor-pane" aria-labelledby="input-label">
            <div className="pane-header">
              <h2 id="input-label">Input</h2>
              <span>{bytes(input).toLocaleString()} bytes</span>
            </div>
            <textarea
              spellCheck="false"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label="JSON input"
            />
          </section>

          <section className="editor-pane" aria-labelledby="output-label">
            <div className="pane-header">
              <h2 id="output-label">Output</h2>
              <div className="icon-actions">
                <button onClick={copyOutput} title="Copy output" aria-label="Copy output">
                  <Clipboard size={18} />
                </button>
                <button onClick={downloadOutput} title="Download output" aria-label="Download output">
                  <Download size={18} />
                </button>
              </div>
            </div>
            <textarea spellCheck="false" value={output} onChange={(event) => setOutput(event.target.value)} aria-label="JSON output" />
          </section>
        </div>

        <aside className="diagnostics" aria-live="polite">
          <div className={parseResult.ok ? 'status ok' : 'status error'}>
            {parseResult.ok ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span>
              {parseResult.ok
                ? 'Valid JSON'
                : formatParseError(parseResult)}
            </span>
          </div>
          <p>{notice}</p>
          {stats && (
            <dl>
              <div>
                <dt>Keys</dt>
                <dd>{stats.keys}</dd>
              </div>
              <div>
                <dt>Objects</dt>
                <dd>{stats.objects}</dd>
              </div>
              <div>
                <dt>Arrays</dt>
                <dd>{stats.arrays}</dd>
              </div>
              <div>
                <dt>Depth</dt>
                <dd>{stats.depth}</dd>
              </div>
              <div>
                <dt>Values</dt>
                <dd>{stats.strings + stats.numbers + stats.booleans + stats.nulls}</dd>
              </div>
            </dl>
          )}
        </aside>
      </section>

      <section className="feature-band" id="features" aria-labelledby="features-title">
        <div>
          <p className="eyebrow">Common JSON utilities</p>
          <h2 id="features-title">Built for quick developer workflows</h2>
        </div>
        <div className="feature-grid">
          <article>
            <Search size={22} />
            <h3>Validate and inspect</h3>
            <p>Catch parse errors early with line and column hints plus counts for keys, objects and depth.</p>
          </article>
          <article>
            <Search size={22} />
            <h3>JSONPath extraction</h3>
            <p>Pull fields, array items or filtered matches from larger API payloads with browser-side JSONPath.</p>
          </article>
          <article>
            <Sparkles size={22} />
            <h3>Format and minify</h3>
            <p>Turn pasted payloads into readable JSON or compact output for transport and storage.</p>
          </article>
          <article>
            <ShieldCheck size={22} />
            <h3>Local by design</h3>
            <p>Formatting, conversions and JWT decoding run in the browser for private API responses and test data.</p>
          </article>
          <article>
            <Wand2 size={22} />
            <h3>Schema conversion</h3>
            <p>Infer a practical JSON Schema from sample data or generate demo JSON from common schema fields.</p>
          </article>
          <article>
            <KeyRound size={22} />
            <h3>JWT payload decode</h3>
            <p>Decode JWT header and payload segments into readable JSON without uploading token contents.</p>
          </article>
        </div>
      </section>

      <section className="references" id="references" aria-labelledby="references-title">
        <div>
          <p className="eyebrow">References</p>
          <h2 id="references-title">Useful specs and docs</h2>
        </div>
        <div className="reference-grid">
          <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON" target="_blank" rel="noreferrer">
            <strong>JSON on MDN</strong>
            <span>How JavaScript parses and serializes JSON data.</span>
          </a>
          <a href="https://json-schema.org/draft/2020-12" target="_blank" rel="noreferrer">
            <strong>JSON Schema 2020-12</strong>
            <span>The official draft used by the generated schema output.</span>
          </a>
          <a href="https://www.rfc-editor.org/rfc/rfc9535.html" target="_blank" rel="noreferrer">
            <strong>JSONPath RFC 9535</strong>
            <span>The IETF standard for selecting values from JSON documents.</span>
          </a>
          <a href="https://jwt.io/introduction/" target="_blank" rel="noreferrer">
            <strong>JWT introduction</strong>
            <span>What JWT header, payload and signature segments mean.</span>
          </a>
          <a href="https://developer.mozilla.org/docs/Web/API/Window/btoa" target="_blank" rel="noreferrer">
            <strong>Base64 on MDN</strong>
            <span>Browser Base64 encoding details and binary string behavior.</span>
          </a>
        </div>
      </section>

      <section className="faq" id="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">JSON tool FAQ</h2>
        <details>
          <summary>Is this JSON formatter free?</summary>
          <p>Yes. EasyUtils JSON is a free browser-based JSON formatter and validator.</p>
        </details>
        <details>
          <summary>Does uploaded JSON leave my browser?</summary>
          <p>No. This static app runs transformations locally and does not upload JSON to a backend.</p>
        </details>
        <details>
          <summary>Can it show where JSON is invalid?</summary>
          <p>Yes. When the browser parser reports a character position, the tool converts it into a line and column.</p>
        </details>
        <details>
          <summary>Can it decode JWT tokens?</summary>
          <p>
            Yes. It decodes JWT header and payload segments locally. It does not verify signatures or prove
            that a token is trustworthy.
          </p>
        </details>
        <details>
          <summary>Can this be deployed on Vercel?</summary>
          <p>Yes. The project builds to static files with Vite and can be deployed directly to Vercel.</p>
        </details>
        <details>
          <summary>Can it convert JSON to JSON Schema?</summary>
          <p>
            Yes. It infers object properties, required fields, arrays, union types and common string formats from
            sample JSON. Treat the result as a practical starting point rather than a complete validation contract.
          </p>
        </details>
        <details>
          <summary>Can it extract data with JSONPath?</summary>
          <p>
            Yes. Enter a JSONPath expression such as <code>$.items[*].id</code> or
            <code> $.users[?(@.active === true)]</code> and the output will contain the matching values.
          </p>
        </details>
        <details>
          <summary>Which external references are useful?</summary>
          <p>
            MDN is useful for JSON and Base64 browser behavior, json-schema.org documents JSON Schema, and jwt.io
            explains JWT structure and verification concepts.
          </p>
        </details>
        <details>
          <summary>Can it create demo JSON from a JSON Schema?</summary>
          <p>
            Yes. It supports common schema fields including type, properties, items, enum, const, default,
            examples and simple format hints.
          </p>
        </details>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
