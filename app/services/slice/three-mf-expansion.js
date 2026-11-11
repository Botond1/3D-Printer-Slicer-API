'use strict';

/**
 * 3MF build-expansion pre-scan (3.9.0 §4.4).
 *
 * A streaming tag tokenizer over the inflated bytes of every `3D/**\/*.model`
 * part. It recognises only `<object id=`, `<triangle`, `<vertex`,
 * `<component objectid= [p:path=]` and `<item objectid= [p:path=]` (any
 * namespace prefix on the tag, any attribute order, both quote styles),
 * skips comments, CDATA sections, processing instructions and declarations,
 * and keeps per (part, object id) a triangle count, a vertex count and every
 * component edge. It is not an XML parser and resolves no entity: lxml in
 * `mesh2stl.py` stays the validity authority. Attribute values get the
 * predefined and numeric character references decoded and XML whitespace
 * normalisation, because lxml resolves both and an encoded reference must
 * never hide an edge.
 *
 * The build is then expanded with a depth-bounded memo
 * `E(o, d) = tri(o) + Σ E(t, d + 1)` and `L(o, d) = [tri(o) > 0] + Σ L(t, d + 1)`
 * for `d ≤ 16` (Python refuses deeper nesting itself), summed over the root
 * part's build items and refused as soon as a limit is passed. The count
 * over-counts (an object's mesh and components both count, object types are
 * ignored) but never under-counts what the Python build walk would flatten.
 * Missing references and cycles are left to Python, as in 3.8.3, but they
 * are bounded: every distinct (part, id) the archive names, declared or not,
 * counts against the object limit, and every component reference and build
 * item counts against the instance limit.
 */

const { SliceResourceError, labelArchiveError } = require('./resource-errors');

/** Root build part, compared as the canonical lower-case key. */
const ROOT_MODEL_PART = '3d/3dmodel.model';
/** Mirrors `THREE_MF_MAX_DEPTH` of `mesh2stl.py`. */
const MAX_COMPONENT_DEPTH = 16;
/** Longest unfinished tag carried between chunks before the scan refuses. */
const MAX_TAG_CARRY_BYTES = 64 * 1024;
/**
 * Key of an absent `id`/`objectid`: Python's walk keys objects by
 * `element.get('id')`, so an item without `objectid` reaches an object
 * without `id` there, and must here too.
 */
const MISSING_ID = '\u0000absent';
/** Verdicts kept for the job that follows a preflight, and how long. */
const MAX_REGISTERED_VERDICTS = 256;
const VERDICT_TTL_MS = 30 * 60 * 1000;

const LT = 0x3c;
const GT = 0x3e;
const SLASH = 0x2f;
const BANG = 0x21;
const QUESTION = 0x3f;
const COLON = 0x3a;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;
const COMMENT_END = Buffer.from('-->');
const CDATA_END = Buffer.from(']]>');
const PI_END = Buffer.from('?>');
const COMMENT_OPEN = '--';
const CDATA_OPEN = '[CDATA[';

const KIND_SKIP = 0;
const KIND_OBJECT = 1;
const KIND_COMPONENT = 2;
const KIND_ITEM = 3;
const KIND_TRIANGLE = 4;
const KIND_VERTEX = 5;

function isNameTerminator(byte) {
    return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === SLASH || byte === GT;
}

function kindOfLocalName(localName) {
    switch (localName) {
        case 'object': return KIND_OBJECT;
        case 'component': return KIND_COMPONENT;
        case 'item': return KIND_ITEM;
        case 'triangle': return KIND_TRIANGLE;
        case 'vertex': return KIND_VERTEX;
        default: return KIND_SKIP;
    }
}

/**
 * Kind of a complete element name (`prefix:local`); an end tag or an empty
 * name is skipped.
 * @param {string} name Element name as read.
 * @returns {number} Tag kind.
 */
function kindOfName(name) {
    if (name === '' || name.charCodeAt(0) === SLASH) return KIND_SKIP;
    const colon = name.lastIndexOf(':');
    return kindOfLocalName(colon >= 0 ? name.slice(colon + 1) : name);
}

const KIND_BY_LENGTH = new Map([
    [4, [['item', KIND_ITEM]]],
    [6, [['object', KIND_OBJECT], ['vertex', KIND_VERTEX]]],
    [8, [['triangle', KIND_TRIANGLE]]],
    [9, [['component', KIND_COMPONENT]]]
].map(([size, names]) => [size, names.map(([text, kind]) => [Buffer.from(text, 'latin1'), kind])]));

/**
 * Kind of the element name held in `buffer[start, end)`, without a string.
 * @returns {number} Tag kind.
 */
function kindOfNameBytes(buffer, start, end) {
    let local = start;
    for (let position = end - 1; position >= start; position -= 1) {
        if (buffer[position] === COLON) {
            local = position + 1;
            break;
        }
    }
    if (end === start || buffer[start] === SLASH) return KIND_SKIP;
    const candidates = KIND_BY_LENGTH.get(end - local);
    if (!candidates) return KIND_SKIP;
    for (const [text, kind] of candidates) {
        if (buffer.compare(text, 0, text.length, local, end) === 0) return kind;
    }
    return KIND_SKIP;
}

/**
 * Resolve the predefined and numeric character references lxml would resolve
 * in an attribute value, then apply XML attribute-value whitespace
 * normalisation (tab, CR, LF become a space).
 * @param {string} value Raw attribute value.
 * @returns {string} Value as lxml reports it.
 */
function decodeAttributeValue(value) {
    const decoded = value.includes('&')
        ? value.replace(/&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g, (match, hex, dec, named) => {
            if (named) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named];
            const codePoint = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
            return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
        })
        : value;
    return decoded.replace(/[\t\r\n]/g, ' ');
}

const ATTRIBUTE_PATTERN = /([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Read the attributes the scan needs from one captured tag body.
 * @param {string} body Tag text after the element name.
 * @returns {{id?: string, objectid?: string, path?: string}} Decoded values.
 */
function readAttributes(body) {
    const found = {};
    let prefixedId;
    ATTRIBUTE_PATTERN.lastIndex = 0;
    let match;
    while ((match = ATTRIBUTE_PATTERN.exec(body)) !== null) {
        const qualified = match[1];
        const colon = qualified.lastIndexOf(':');
        const local = colon >= 0 ? qualified.slice(colon + 1) : qualified;
        const value = decodeAttributeValue(match[2] ?? match[3] ?? '');
        if (local === 'id') {
            if (colon < 0) found.id ??= value;
            else prefixedId ??= value;
        } else if (local === 'objectid') {
            found.objectid ??= value;
        } else if (local === 'path') {
            // Python takes the first attribute whose local name is `path`.
            found.path ??= value;
        }
    }
    if (found.id === undefined && prefixedId !== undefined) found.id = prefixedId;
    return found;
}

/** Canonical archive key, as `_three_mf_key` of `mesh2stl.py` builds it. */
function threeMfPartKey(name) {
    return String(name ?? '').replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
}

/**
 * Error of an archive whose build expands past a limit. It keeps the
 * converter's own refusal (400 `INVALID_SOURCE_GEOMETRY`), which the live
 * plugin already reads as a model refusal, and adds the rule label.
 * @param {string} message Bounded reason (no path, no name).
 * @param {number} limit The limit that was passed.
 * @param {{triangles: number, instances: number, objects: number}} counts Counts at refusal.
 * @returns {SliceResourceError} Labelled refusal.
 */
function expansionExceeded(message, limit, counts) {
    const error = labelArchiveError(
        new SliceResourceError('INVALID_SOURCE_GEOMETRY', message, 400),
        'ARCHIVE_EXPANSION_EXCEEDED',
        limit
    );
    error.expansion = {
        triangles: counts.triangles,
        instances: counts.instances,
        objects: counts.objects
    };
    return error;
}

/**
 * Default limits from the release policy (resolved from the environment
 * once, when that module is first required).
 * @returns {{maxTriangles: number, maxInstances: number, maxObjects: number}} Limits.
 */
function defaultExpansionLimits() {
    const { archive } = require('../../config/release-policy');
    return {
        maxTriangles: archive.MAX_3MF_EXPANDED_TRIANGLES,
        maxInstances: archive.MAX_3MF_EXPANDED_INSTANCES,
        maxObjects: archive.MAX_3MF_MODEL_OBJECTS
    };
}

function resolveLimits(limits) {
    const defaults = limits && Number.isSafeInteger(limits.maxTriangles)
        && Number.isSafeInteger(limits.maxInstances) && Number.isSafeInteger(limits.maxObjects)
        ? null
        : defaultExpansionLimits();
    return Object.freeze({
        maxTriangles: Number.isSafeInteger(limits?.maxTriangles) ? limits.maxTriangles : defaults.maxTriangles,
        maxInstances: Number.isSafeInteger(limits?.maxInstances) ? limits.maxInstances : defaults.maxInstances,
        maxObjects: Number.isSafeInteger(limits?.maxObjects) ? limits.maxObjects : defaults.maxObjects
    });
}

/**
 * Per-archive expansion counter. One scanner per model part feeds it; the
 * build is expanded by `finish()` once every part has been read.
 */
class ExpansionCounter {
    /**
     * @param {{maxTriangles?: number, maxInstances?: number, maxObjects?: number}} [limits] Limits; absent = release policy.
     */
    constructor(limits) {
        this.limits = resolveLimits(limits);
        this.nodeIndex = new Map();
        this.triangles = [];
        this.vertices = [];
        this.edges = [];
        this.items = [];
        this.objects = 0;
        this.references = 0;
        this.walkVisits = 0;
        this.finished = null;
    }

    node(partKey, objectId) {
        const key = `${partKey}\u0000${objectId}`;
        let index = this.nodeIndex.get(key);
        if (index === undefined) {
            // Every distinct (part, id) the archive names, declared or only
            // referenced, takes a node and memo slots: bound them all, so
            // references to undeclared ids cannot grow the scan unbounded.
            if (this.nodeIndex.size >= this.limits.maxObjects) {
                throw expansionExceeded('3MF names more model objects than the allowed limit.',
                    this.limits.maxObjects, this.counts());
            }
            index = this.triangles.length;
            this.nodeIndex.set(key, index);
            this.triangles.push(0);
            this.vertices.push(0);
            this.edges.push(null);
        }
        return index;
    }

    counts(extra = {}) {
        return { triangles: 0, instances: 0, objects: this.objects, ...extra };
    }

    declareObject(partKey, objectId) {
        this.objects += 1;
        if (this.objects > this.limits.maxObjects) {
            throw expansionExceeded('3MF declares more model objects than the allowed limit.',
                this.limits.maxObjects, this.counts());
        }
        return this.node(partKey, objectId);
    }

    /**
     * Count one component reference or build item. Each can place an
     * instance, so more of them than the instance limit is refused before
     * the edge lists grow unbounded (an over-count, as the rest of the scan).
     */
    countReference() {
        this.references += 1;
        if (this.references > this.limits.maxInstances) {
            throw expansionExceeded(
                '3MF holds more component references and build items than the allowed instance count.',
                this.limits.maxInstances, this.counts());
        }
    }

    addEdge(from, to) {
        this.countReference();
        const list = this.edges[from];
        if (list) list.push(to);
        else this.edges[from] = [to];
    }

    /**
     * Create the streaming scanner of one model part.
     * @param {string} partName Archive entry name of the part.
     * @returns {{write(chunk: Buffer): void, end(): void}} Scanner.
     */
    createPartScanner(partName) {
        return new PartScanner(this, threeMfPartKey(partName));
    }

    /**
     * Expand the build. Throws the labelled refusal as soon as a limit is
     * passed; otherwise returns the totals.
     * @returns {{triangles: number, instances: number, objects: number}} Expanded totals.
     */
    finish() {
        if (this.finished) return this.finished;
        const { maxTriangles, maxInstances } = this.limits;
        const levels = MAX_COMPONENT_DEPTH + 1;
        const nodeCount = this.triangles.length;
        const memoTriangles = new Float64Array(nodeCount * levels).fill(-1);
        const memoInstances = new Float64Array(nodeCount * levels);
        const refuse = (triangles, instances) => {
            if (triangles > maxTriangles) {
                throw expansionExceeded('3MF build expands past the allowed triangle count.', maxTriangles,
                    this.counts({ triangles, instances }));
            }
            if (instances > maxInstances) {
                throw expansionExceeded('3MF build expands past the allowed instance count.', maxInstances,
                    this.counts({ triangles, instances }));
            }
        };
        const walk = (node, depth) => {
            const slot = node * levels + depth;
            if (memoTriangles[slot] >= 0) return slot;
            // Memo misses: the walk's work, which tests bound (not its time).
            this.walkVisits += 1;
            let triangles = this.triangles[node];
            let instances = triangles > 0 ? 1 : 0;
            const targets = this.edges[node];
            if (targets && depth < MAX_COMPONENT_DEPTH) {
                for (const target of targets) {
                    const child = walk(target, depth + 1);
                    triangles += memoTriangles[child];
                    instances += memoInstances[child];
                    refuse(triangles, instances);
                }
            }
            refuse(triangles, instances);
            memoTriangles[slot] = triangles;
            memoInstances[slot] = instances;
            return slot;
        };
        let triangles = 0;
        let instances = 0;
        for (const item of this.items) {
            const slot = walk(item, 0);
            triangles += memoTriangles[slot];
            instances += memoInstances[slot];
            refuse(triangles, instances);
        }
        this.finished = Object.freeze({ triangles, instances, objects: this.objects });
        return this.finished;
    }
}

/** Streaming tokenizer of one model part (chunk + carry of the unfinished tag). */
class PartScanner {
    constructor(counter, partKey) {
        this.counter = counter;
        this.partKey = partKey;
        this.isRoot = partKey === ROOT_MODEL_PART;
        this.current = -1;
        this.state = 'text';
        // Element name being read, and the tag body captured for the kinds
        // whose attributes are needed.
        this.name = '';
        this.kind = KIND_SKIP;
        this.quote = 0;
        this.capture = null;
        this.captureBytes = 0;
        // Leading bytes of a `<!` construct while it is classified.
        this.bang = '';
        // Terminator search of comments, CDATA and processing instructions.
        this.terminator = null;
        this.tail = Buffer.alloc(0);
    }

    refuseCarry() {
        throw expansionExceeded('3MF model part holds an unfinished tag longer than the scan carries.',
            MAX_TAG_CARRY_BYTES, this.counter.counts());
    }

    /**
     * @param {Buffer} chunk Inflated bytes of the part.
     */
    write(chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let index = 0;
        const length = buffer.length;
        while (index < length) {
            switch (this.state) {
                case 'text': {
                    const open = buffer.indexOf(LT, index);
                    if (open < 0) return;
                    index = open + 1;
                    this.state = 'open';
                    break;
                }
                case 'open': {
                    const byte = buffer[index];
                    if (byte === BANG) {
                        this.state = 'bang';
                        this.bang = '';
                        index += 1;
                    } else if (byte === QUESTION) {
                        this.beginTerminator(PI_END);
                        index += 1;
                    } else {
                        this.state = 'name';
                        this.name = '';
                    }
                    break;
                }
                case 'bang':
                    index = this.readBang(buffer, index);
                    break;
                case 'name':
                    index = this.readName(buffer, index);
                    break;
                case 'tag':
                    index = this.readTag(buffer, index);
                    break;
                case 'terminator':
                    index = this.readTerminator(buffer, index);
                    break;
                default:
                    return;
            }
        }
    }

    beginTerminator(terminator) {
        this.state = 'terminator';
        this.terminator = terminator;
        this.tail = Buffer.alloc(0);
    }

    readBang(buffer, index) {
        while (index < buffer.length) {
            this.bang += String.fromCharCode(buffer[index]);
            index += 1;
            if (this.bang === COMMENT_OPEN) {
                this.beginTerminator(COMMENT_END);
                return index;
            }
            if (this.bang === CDATA_OPEN) {
                this.beginTerminator(CDATA_END);
                return index;
            }
            if (!COMMENT_OPEN.startsWith(this.bang) && !CDATA_OPEN.startsWith(this.bang)) {
                // A declaration (`<!DOCTYPE`, `<!ENTITY`): skipped to its `>`.
                this.state = 'tag';
                this.kind = KIND_SKIP;
                this.quote = 0;
                this.capture = null;
                return this.bang.charCodeAt(this.bang.length - 1) === GT ? this.endTag(index) : index;
            }
        }
        return index;
    }

    readName(buffer, index) {
        let end = index;
        while (end < buffer.length && !isNameTerminator(buffer[end])) end += 1;
        if (end === buffer.length) {
            if (end > index) this.name += buffer.toString('latin1', index, end);
            if (this.name.length > MAX_TAG_CARRY_BYTES) this.refuseCarry();
            return end;
        }
        // Common case: the whole name sits in this chunk, classified from
        // its bytes without building a string.
        this.kind = this.name === ''
            ? kindOfNameBytes(buffer, index, end)
            : kindOfName(this.name + buffer.toString('latin1', index, end));
        this.state = 'tag';
        this.quote = 0;
        this.capture = this.kind === KIND_OBJECT || this.kind === KIND_COMPONENT || this.kind === KIND_ITEM ? [] : null;
        this.captureBytes = 0;
        return end;
    }

    readTag(buffer, index) {
        const start = index;
        const length = buffer.length;
        let position = index;
        let quote = this.quote;
        while (position < length) {
            const byte = buffer[position];
            if (quote !== 0) {
                if (byte === quote) quote = 0;
            } else if (byte === GT) {
                this.quote = 0;
                this.keep(buffer, start, position);
                return this.endTag(position + 1);
            } else if (byte === DOUBLE_QUOTE || byte === SINGLE_QUOTE) {
                quote = byte;
            }
            position += 1;
        }
        this.quote = quote;
        this.keep(buffer, start, position);
        return position;
    }

    keep(buffer, start, end) {
        if (!this.capture || end <= start) return;
        this.captureBytes += end - start;
        if (this.captureBytes > MAX_TAG_CARRY_BYTES) this.refuseCarry();
        this.capture.push(Buffer.from(buffer.subarray(start, end)));
    }

    endTag(nextIndex) {
        const kind = this.kind;
        const counter = this.counter;
        if (kind === KIND_TRIANGLE) {
            if (this.current >= 0) counter.triangles[this.current] += 1;
        } else if (kind === KIND_VERTEX) {
            if (this.current >= 0) counter.vertices[this.current] += 1;
        } else if (kind !== KIND_SKIP) {
            const attributes = readAttributes(Buffer.concat(this.capture).toString('utf8'));
            if (kind === KIND_OBJECT) {
                this.current = counter.declareObject(this.partKey, attributes.id ?? MISSING_ID);
            } else {
                const objectId = attributes.objectid ?? MISSING_ID;
                const targetPart = attributes.path ? threeMfPartKey(attributes.path) : this.partKey;
                if (kind === KIND_COMPONENT) {
                    if (this.current >= 0) counter.addEdge(this.current, counter.node(targetPart, objectId));
                } else if (this.isRoot) {
                    counter.countReference();
                    counter.items.push(counter.node(attributes.path ? targetPart : ROOT_MODEL_PART, objectId));
                }
            }
        }
        this.state = 'text';
        this.capture = null;
        this.captureBytes = 0;
        this.kind = KIND_SKIP;
        this.name = '';
        return nextIndex;
    }

    readTerminator(buffer, index) {
        const terminator = this.terminator;
        if (this.tail.length > 0) {
            const joined = Buffer.concat([this.tail, buffer.subarray(index, index + terminator.length - 1)]);
            const found = joined.indexOf(terminator);
            if (found >= 0) {
                this.state = 'text';
                return index + (found + terminator.length - this.tail.length);
            }
        }
        const found = buffer.indexOf(terminator, index);
        if (found >= 0) {
            this.state = 'text';
            return found + terminator.length;
        }
        const keepFrom = Math.max(index, buffer.length - (terminator.length - 1));
        this.tail = Buffer.concat([this.tail, buffer.subarray(keepFrom)]).subarray(-(terminator.length - 1));
        return buffer.length;
    }

    /** End of the part. An unfinished tag is left to the XML parser. */
    end() {
        this.state = 'done';
        this.capture = null;
    }
}

/**
 * Whether an archive entry is a model part the scan reads.
 * @param {string} canonicalName Lower-case canonical entry name.
 * @returns {boolean} True for `3d/**\/*.model`.
 */
function isModelPart(canonicalName) {
    return canonicalName.startsWith('3d/') && canonicalName.endsWith('.model');
}

// Verdicts handed from the pre-queue preflight to the job, so the tokenizer
// does not run twice over the same bytes. Keyed by the file's identity; a
// verdict is consumed once.
const registeredVerdicts = new Map();

function identityKey(stats) {
    return [stats.dev, stats.ino, stats.size, stats.mtimeNs].map(String).join(':');
}

function pruneVerdicts(now) {
    for (const [key, verdict] of registeredVerdicts) {
        if (now - verdict.registeredAt > VERDICT_TTL_MS) registeredVerdicts.delete(key);
    }
    while (registeredVerdicts.size > MAX_REGISTERED_VERDICTS) {
        registeredVerdicts.delete(registeredVerdicts.keys().next().value);
    }
}

/**
 * Register a successful preflight for the job that will read the same file.
 * @param {{realpath: string, dev: bigint, ino: bigint, size: bigint, mtimeNs: bigint, counts: object}} verdict File identity and counts.
 * @param {() => number} [now] Clock.
 */
function registerExpansionVerdict(verdict, now = Date.now) {
    const at = now();
    registeredVerdicts.delete(identityKey(verdict));
    registeredVerdicts.set(identityKey(verdict), {
        realpath: verdict.realpath,
        counts: Object.freeze({ ...verdict.counts }),
        registeredAt: at
    });
    pruneVerdicts(at);
}

/**
 * Take (once) the verdict registered for this file. The job renames the
 * upload to carry its original extension (same inode, size and mtime), so a
 * verdict registered for `<upload>` also matches `<upload>.3mf`.
 * @param {string} realpath Real path of the file the job inspects.
 * @param {{dev: bigint, ino: bigint, size: bigint, mtimeNs: bigint}} stats Its bigint `lstat`.
 * @param {() => number} [now] Clock.
 * @returns {{triangles: number, instances: number, objects: number}|null} Counts, or null.
 */
function consumeExpansionVerdict(realpath, stats, now = Date.now) {
    pruneVerdicts(now());
    const key = identityKey(stats);
    const verdict = registeredVerdicts.get(key);
    if (!verdict) return null;
    const samePath = realpath === verdict.realpath
        || (realpath.toLowerCase().endsWith('.3mf') && realpath.slice(0, -4) === verdict.realpath);
    if (!samePath) return null;
    registeredVerdicts.delete(key);
    return verdict.counts;
}

function clearExpansionVerdictsForTests() {
    registeredVerdicts.clear();
}

module.exports = {
    ExpansionCounter,
    MAX_COMPONENT_DEPTH,
    MAX_TAG_CARRY_BYTES,
    ROOT_MODEL_PART,
    clearExpansionVerdictsForTests,
    consumeExpansionVerdict,
    decodeAttributeValue,
    defaultExpansionLimits,
    expansionExceeded,
    isModelPart,
    readAttributes,
    registerExpansionVerdict,
    threeMfPartKey
};
