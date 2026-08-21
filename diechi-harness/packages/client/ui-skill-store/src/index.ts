/**
 * Skill 商店 client plugin, node half.
 *
 * Deliberately empty. The store's host-side authority lives in the
 * dsh-web-app bundle (skill-store row): it owns the `skill.store` and
 * `skill.vision` settings namespaces and bridges the catalog onto the runtime
 * skill registry. This package's browser half renders the settings section;
 * the node half has nothing to mount.
 */

/** Host plugin body — registration is composition-owned by the web bundle. */
export function apply(): void {}