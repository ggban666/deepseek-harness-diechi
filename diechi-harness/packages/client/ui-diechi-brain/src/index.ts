/**
 * 阅历控制台 client plugin, node half.
 *
 * Deliberately empty: the settings-section registration and the controller
 * live in the browser half (./client). The node half has nothing to mount —
 * the diechi-brain host plugin owns the RPC and the inbox persistence.
 */

/** Host plugin body — registration is composition-owned by the web bundle. */
export function apply(): void {}