/**
 * 自进化可感知层 client plugin, node half.
 *
 * Deliberately empty: the sidebar badge and the overlay panel live in the
 * browser half (./client). The node half mounts nothing — the
 * diechi-supervisor host plugin owns the metrics RPC.
 */

/** Host plugin body — registration is composition-owned by the web bundle. */
export function apply(): void {}
