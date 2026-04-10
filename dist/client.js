/**
 * BlueSentinelClient — Extends CosmJS SigningStargateClient with Sentinel query extensions.
 *
 * Follows the TKD Alex pattern: extend the ecosystem standard, don't replace it.
 * Every CosmJS method works. Sentinel-specific additions are additive.
 *
 * Usage:
 *   const client = await BlueSentinelClient.connectWithSigner(rpcUrl, signer);
 *   const nodes = await client.sentinelQuery.nodes({ status: 1, limit: 100 });
 *   const balance = await client.getBalance(address, 'udvpn');
 *   const result = await client.signAndBroadcast(address, [msg], fee);
 */
import { SigningStargateClient, StargateClient, QueryClient, GasPrice, } from '@cosmjs/stargate';
import { Tendermint37Client } from '@cosmjs/tendermint-rpc';
// ─── Protobuf Encoding Helpers ──────────────────────────────────────────────
function encodeVarint(value) {
    let n = BigInt(value);
    const bytes = [];
    do {
        let b = Number(n & 0x7fn);
        n >>= 7n;
        if (n > 0n)
            b |= 0x80;
        bytes.push(b);
    } while (n > 0n);
    return new Uint8Array(bytes);
}
function concat(arrays) {
    const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
function encodeString(fieldNum, str) {
    if (!str)
        return new Uint8Array(0);
    const encoder = new TextEncoder();
    const b = encoder.encode(str);
    const tag = encodeVarint((BigInt(fieldNum) << 3n) | 2n);
    const len = encodeVarint(b.length);
    return concat([tag, len, b]);
}
function encodeUint64(fieldNum, value) {
    if (!value && value !== 0)
        return new Uint8Array(0);
    const tag = encodeVarint((BigInt(fieldNum) << 3n) | 0n);
    const val = encodeVarint(value);
    return concat([tag, val]);
}
function encodeEmbedded(fieldNum, bytes) {
    if (!bytes || bytes.length === 0)
        return new Uint8Array(0);
    const tag = encodeVarint((BigInt(fieldNum) << 3n) | 2n);
    const len = encodeVarint(bytes.length);
    return concat([tag, len, bytes]);
}
function encodePagination(opts = {}) {
    const parts = [];
    if (opts.key)
        parts.push(encodeEmbedded(1, opts.key));
    parts.push(encodeUint64(2, opts.limit ?? 100));
    return concat(parts);
}
function decodeProto(buf) {
    const fields = {};
    let i = 0;
    while (i < buf.length) {
        let tag = 0n;
        let shift = 0n;
        while (i < buf.length) {
            const b = buf[i++];
            tag |= BigInt(b & 0x7f) << shift;
            shift += 7n;
            if (!(b & 0x80))
                break;
        }
        const fieldNum = Number(tag >> 3n);
        const wireType = Number(tag & 0x7n);
        if (wireType === 0) {
            let val = 0n;
            let s = 0n;
            while (i < buf.length) {
                const b = buf[i++];
                val |= BigInt(b & 0x7f) << s;
                s += 7n;
                if (!(b & 0x80))
                    break;
            }
            if (!fields[fieldNum])
                fields[fieldNum] = [];
            fields[fieldNum].push({ wireType, value: val });
        }
        else if (wireType === 2) {
            let len = 0n;
            let s = 0n;
            while (i < buf.length) {
                const b = buf[i++];
                len |= BigInt(b & 0x7f) << s;
                s += 7n;
                if (!(b & 0x80))
                    break;
            }
            const numLen = Number(len);
            const data = buf.slice(i, i + numLen);
            i += numLen;
            if (!fields[fieldNum])
                fields[fieldNum] = [];
            fields[fieldNum].push({ wireType, value: data });
        }
        else if (wireType === 5) {
            i += 4;
        }
        else if (wireType === 1) {
            i += 8;
        }
    }
    return fields;
}
function decodeStr(data) {
    return new TextDecoder().decode(data);
}
function decodePrice(fields) {
    return {
        denom: fields[1]?.[0] ? decodeStr(fields[1][0].value) : '',
        base_value: fields[2]?.[0] ? decodeStr(fields[2][0].value) : '0',
        quote_value: fields[3]?.[0] ? decodeStr(fields[3][0].value) : '0',
    };
}
function decodeNode(fields) {
    return {
        address: fields[1]?.[0] ? decodeStr(fields[1][0].value) : '',
        gigabyte_prices: (fields[2] || []).map(f => decodePrice(decodeProto(f.value))),
        hourly_prices: (fields[3] || []).map(f => decodePrice(decodeProto(f.value))),
        remote_addrs: (fields[4] || []).map(f => decodeStr(f.value)),
        status: fields[6]?.[0] ? Number(fields[6][0].value) : 0,
    };
}
// ─── Query-Only Client ──────────────────────────────────────────────────────
export class SentinelQueryClient extends StargateClient {
    sentinelQuery;
    qc;
    constructor(tmClient) {
        super(tmClient, {});
        this.qc = QueryClient.withExtensions(tmClient);
        this.sentinelQuery = this.buildQueryExtension();
    }
    static async connect(endpoint) {
        const tmClient = await Tendermint37Client.connect(endpoint);
        return new SentinelQueryClient(tmClient);
    }
    buildQueryExtension() {
        const qc = this.qc;
        return {
            async nodes(opts = {}) {
                const request = concat([
                    encodeUint64(1, opts.status ?? 1),
                    encodeEmbedded(2, encodePagination({ limit: opts.limit ?? 500 })),
                ]);
                const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNodes', request);
                const fields = decodeProto(new Uint8Array(response.value));
                return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value)));
            },
            async node(address) {
                try {
                    const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNode', encodeString(1, address));
                    const fields = decodeProto(new Uint8Array(response.value));
                    if (!fields[1]?.[0])
                        return null;
                    return decodeNode(decodeProto(fields[1][0].value));
                }
                catch {
                    return null;
                }
            },
            async nodesForPlan(planId, opts = {}) {
                const request = concat([
                    encodeUint64(1, planId),
                    encodeUint64(2, opts.status ?? 1),
                    encodeEmbedded(3, encodePagination({ limit: opts.limit ?? 500 })),
                ]);
                const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNodesForPlan', request);
                const fields = decodeProto(new Uint8Array(response.value));
                return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value)));
            },
            async balance(address, denom = 'udvpn') {
                const request = concat([encodeString(1, address), encodeString(2, denom)]);
                const response = await qc.queryAbci('/cosmos.bank.v1beta1.Query/Balance', request);
                const fields = decodeProto(new Uint8Array(response.value));
                if (!fields[1]?.[0])
                    return { denom, amount: '0' };
                const coinFields = decodeProto(fields[1][0].value);
                return {
                    denom: coinFields[1]?.[0] ? decodeStr(coinFields[1][0].value) : denom,
                    amount: coinFields[2]?.[0] ? decodeStr(coinFields[2][0].value) : '0',
                };
            },
            async sessionsForAccount(address, opts = {}) {
                const request = concat([encodeString(1, address), encodeEmbedded(2, encodePagination(opts))]);
                const response = await qc.queryAbci('/sentinel.session.v3.QueryService/QuerySessionsForAccount', request);
                const fields = decodeProto(new Uint8Array(response.value));
                return (fields[1] || []).map(entry => entry.value);
            },
            async subscriptionsForAccount(address, opts = {}) {
                const request = concat([encodeString(1, address), encodeEmbedded(2, encodePagination(opts))]);
                const response = await qc.queryAbci('/sentinel.subscription.v3.QueryService/QuerySubscriptionsForAccount', request);
                const fields = decodeProto(new Uint8Array(response.value));
                return (fields[1] || []).map(entry => entry.value);
            },
            async plan(planId) {
                try {
                    const response = await qc.queryAbci('/sentinel.plan.v3.QueryService/QueryPlan', encodeUint64(1, planId));
                    const fields = decodeProto(new Uint8Array(response.value));
                    return fields[1]?.[0]?.value || null;
                }
                catch {
                    return null;
                }
            },
        };
    }
}
// ─── Signing Client (Full) ──────────────────────────────────────────────────
export class BlueSentinelClient extends SigningStargateClient {
    sentinelQuery;
    qc;
    constructor(tmClient, signer, options) {
        super(tmClient, signer, options);
        this.qc = QueryClient.withExtensions(tmClient);
        this.sentinelQuery = this.buildQueryExtension();
    }
    /**
     * Connect with a signer for full TX + query capabilities.
     * This is the primary entry point — matches TKD Alex's pattern exactly.
     */
    static async connectWithSigner(endpoint, signer, options) {
        const tmClient = await Tendermint37Client.connect(endpoint);
        return new BlueSentinelClient(tmClient, signer, {
            gasPrice: GasPrice.fromString('0.1udvpn'),
            ...options,
        });
    }
    buildQueryExtension() {
        const qc = this.qc;
        return {
            async nodes(opts = {}) {
                const request = concat([
                    encodeUint64(1, opts.status ?? 1),
                    encodeEmbedded(2, encodePagination({ limit: opts.limit ?? 500 })),
                ]);
                const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNodes', request);
                const fields = decodeProto(new Uint8Array(response.value));
                return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value)));
            },
            async node(address) {
                try {
                    const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNode', encodeString(1, address));
                    const fields = decodeProto(new Uint8Array(response.value));
                    if (!fields[1]?.[0])
                        return null;
                    return decodeNode(decodeProto(fields[1][0].value));
                }
                catch {
                    return null;
                }
            },
            async nodesForPlan(planId, opts = {}) {
                const request = concat([
                    encodeUint64(1, planId),
                    encodeUint64(2, opts.status ?? 1),
                    encodeEmbedded(3, encodePagination({ limit: opts.limit ?? 500 })),
                ]);
                const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNodesForPlan', request);
                const fields = decodeProto(new Uint8Array(response.value));
                return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value)));
            },
            async balance(address, denom = 'udvpn') {
                const request = concat([encodeString(1, address), encodeString(2, denom)]);
                const response = await qc.queryAbci('/cosmos.bank.v1beta1.Query/Balance', request);
                const fields = decodeProto(new Uint8Array(response.value));
                if (!fields[1]?.[0])
                    return { denom, amount: '0' };
                const coinFields = decodeProto(fields[1][0].value);
                return {
                    denom: coinFields[1]?.[0] ? decodeStr(coinFields[1][0].value) : denom,
                    amount: coinFields[2]?.[0] ? decodeStr(coinFields[2][0].value) : '0',
                };
            },
            async sessionsForAccount(address, opts = {}) {
                const request = concat([encodeString(1, address), encodeEmbedded(2, encodePagination(opts))]);
                const response = await qc.queryAbci('/sentinel.session.v3.QueryService/QuerySessionsForAccount', request);
                const fields = decodeProto(new Uint8Array(response.value));
                return (fields[1] || []).map(entry => entry.value);
            },
            async subscriptionsForAccount(address, opts = {}) {
                const request = concat([encodeString(1, address), encodeEmbedded(2, encodePagination(opts))]);
                const response = await qc.queryAbci('/sentinel.subscription.v3.QueryService/QuerySubscriptionsForAccount', request);
                const fields = decodeProto(new Uint8Array(response.value));
                return (fields[1] || []).map(entry => entry.value);
            },
            async plan(planId) {
                try {
                    const response = await qc.queryAbci('/sentinel.plan.v3.QueryService/QueryPlan', encodeUint64(1, planId));
                    const fields = decodeProto(new Uint8Array(response.value));
                    return fields[1]?.[0]?.value || null;
                }
                catch {
                    return null;
                }
            },
        };
    }
}
/**
 * Real-time event subscription via Tendermint WebSocket.
 *
 * Usage:
 *   const ws = await SentinelWsClient.connect('wss://rpc.sentinel.co/websocket');
 *   ws.subscribe("tm.event='Tx'", (event) => console.log(event));
 *   ws.disconnect();
 */
export class SentinelWsClient {
    endpoint;
    ws = null;
    listeners = new Map();
    nextId = 1;
    constructor(endpoint) {
        this.endpoint = endpoint;
    }
    static async connect(endpoint) {
        const client = new SentinelWsClient(endpoint);
        await client.open();
        return client;
    }
    open() {
        return new Promise((resolve, reject) => {
            // Use globalThis.WebSocket (browser) or dynamic import of 'ws' (Node.js)
            const WS = typeof globalThis !== 'undefined' && globalThis.WebSocket
                ? globalThis.WebSocket
                : null;
            if (!WS) {
                reject(new Error('WebSocket not available. In Node.js, install the "ws" package.'));
                return;
            }
            this.ws = new WS(this.endpoint);
            this.ws.onopen = () => resolve();
            this.ws.onerror = (err) => reject(new Error(`WebSocket error: ${err}`));
            this.ws.onmessage = (msg) => this.handleMessage(msg.data);
        });
    }
    /**
     * Subscribe to chain events matching a Tendermint query.
     *
     * Common queries:
     * - "tm.event='Tx'" — all transactions
     * - "tm.event='Tx' AND sentinel.node.v3.EventCreateSession.session_id EXISTS" — session starts
     * - "tm.event='Tx' AND sentinel.session.v3.EventEnd.session_id EXISTS" — session ends
     */
    subscribe(query, callback) {
        const id = this.nextId++;
        if (!this.listeners.has(query)) {
            this.listeners.set(query, []);
        }
        this.listeners.get(query).push(callback);
        this.ws?.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'subscribe',
            id,
            params: { query },
        }));
    }
    handleMessage(data) {
        try {
            const msg = JSON.parse(data);
            if (msg.result?.events) {
                // Broadcast to all listeners
                for (const [, callbacks] of this.listeners) {
                    for (const cb of callbacks) {
                        const events = msg.result.events;
                        for (const [type, values] of Object.entries(events)) {
                            cb({ type, attributes: Array.isArray(values) ? values.map((v) => ({ key: type, value: v })) : [] });
                        }
                    }
                }
            }
        }
        catch {
            // Ignore parse errors
        }
    }
    disconnect() {
        this.ws?.close();
        this.ws = null;
        this.listeners.clear();
    }
}
//# sourceMappingURL=client.js.map