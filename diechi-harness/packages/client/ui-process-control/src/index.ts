/**
 * 外部服务进程控制 client plugin, node half.
 *
 * Deliberately empty: the sidebar toggle buttons live in the browser half
 * (./client). The node half mounts nothing — the diechi-process-control host
 * plugin owns the process RPC.
 */

/** Host plugin body — registration is composition-owned by the web bundle. */
export function apply(): void {}
