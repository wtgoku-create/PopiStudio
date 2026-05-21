export const APP_UPDATE_CHANNEL = 'prod';
export const APP_UPDATE_PRODUCT = 'popiai';

// NOTE: This token is intentionally hardcoded for client-side read access
// because the current update service requires Authorization for latest-version
// checks. Keep write-capable tokens in CI secrets only.
const APP_UPDATE_READ_TOKEN = 'asdasdahoinnsdkfsodifh';

export const getAppUpdateReadAuthorization = (): string => `Bearer ${APP_UPDATE_READ_TOKEN}`;
