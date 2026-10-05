import packageJson from '../../package.json';

/**
 * Single source of truth for the app version (v0.3 §P4). `package.json`'s
 * `version` is the one place to bump on release; every surface derives its
 * display label from here.
 */
export const APP_VERSION = packageJson.version;

/** Display label used across the UI, e.g. "V0.3". */
export const APP_VERSION_LABEL = `V${APP_VERSION.split('.').slice(0, 2).join('.')}`;
