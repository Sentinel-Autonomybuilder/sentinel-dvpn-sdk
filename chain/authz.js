/**
 * Sentinel SDK — Chain / Authz Module
 *
 * Authorization grants (cosmos.authz.v1beta1): granter allows grantee
 * to execute specific messages on their behalf.
 *
 * Usage:
 *   import { buildAuthzGrantMsg, buildAuthzExecMsg, encodeForExec } from './chain/authz.js';
 *   const msg = buildAuthzGrantMsg(userAddr, serverAddr, MSG_TYPES.PLAN_START_SESSION);
 */

import { protoString, protoEmbedded, protoInt64 } from '../v3protocol.js';
import { ChainError, ErrorCodes } from '../errors.js';
import { buildRegistry } from './client.js';

// ─── Protobuf Helpers ───────────────────────────────────────────────────────

function encodeGenericAuthorization(msgTypeUrl) {
  return protoString(1, msgTypeUrl);
}

// ─── Authz (cosmos.authz.v1beta1) ──────────────────────────────────────────
// Authorization grants: granter allows grantee to execute specific messages.
//
// Usage (server-side subscription management):
//   // User grants server permission to start sessions on their behalf
//   const msg = buildAuthzGrantMsg(userAddr, serverAddr, MSG_TYPES.PLAN_START_SESSION);
//   await broadcast(client, userAddr, [msg]);
//   // Server can now start sessions for the user
//   const innerMsg = { typeUrl: MSG_TYPES.PLAN_START_SESSION, value: { from: userAddr, ... } };
//   const execMsg = buildAuthzExecMsg(serverAddr, encodeForExec([innerMsg]));
//   await broadcast(serverClient, serverAddr, [execMsg]);

/**
 * Build a MsgGrant (authz) for a specific message type.
 * @param {string} granter - Address granting permission (sent1...)
 * @param {string} grantee - Address receiving permission (sent1...)
 * @param {string} msgTypeUrl - Message type URL to authorize (e.g. MSG_TYPES.START_SESSION)
 * @param {Date|string} expiration - Optional expiry date (default: no expiry)
 */
export function buildAuthzGrantMsg(granter, grantee, msgTypeUrl, expiration) {
  const authBytes = encodeGenericAuthorization(msgTypeUrl);

  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
    value: {
      granter,
      grantee,
      grant: {
        authorization: {
          typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
          value: Uint8Array.from(authBytes),
        },
        expiration: expiration
          ? { seconds: BigInt(Math.floor((expiration instanceof Date ? expiration : new Date(expiration)).getTime() / 1000)), nanos: 0 }
          : undefined,
      },
    },
  };
}

/**
 * Build a MsgRevoke (authz) to remove a specific grant.
 */
export function buildAuthzRevokeMsg(granter, grantee, msgTypeUrl) {
  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgRevoke',
    value: { granter, grantee, msgTypeUrl },
  };
}

/**
 * Build a MsgExec (authz) to execute messages on behalf of a granter.
 * @param {string} grantee - Address executing on behalf of granter
 * @param {Array} encodedMsgs - Pre-encoded messages (use encodeForExec() to prepare)
 */
export function buildAuthzExecMsg(grantee, encodedMsgs) {
  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgExec',
    value: { grantee, msgs: encodedMsgs },
  };
}

/**
 * Encode SDK message objects to the Any format required by MsgExec.
 * @param {Array<{typeUrl: string, value: object}>} msgs - Standard SDK messages
 * @returns {Array<{typeUrl: string, value: Uint8Array}>} Encoded messages for MsgExec
 */
export function encodeForExec(msgs) {
  const reg = buildRegistry();
  return msgs.map(msg => {
    const type = reg.lookupType(msg.typeUrl);
    if (!type) throw new ChainError(ErrorCodes.UNKNOWN_MSG_TYPE, `Unknown message type: ${msg.typeUrl}. Ensure it is registered in buildRegistry().`, { typeUrl: msg.typeUrl });
    return {
      typeUrl: msg.typeUrl,
      value: type.encode(type.fromPartial(msg.value)).finish(),
    };
  });
}

// queryAuthzGrants removed — use RPC-first version from chain/queries.js
