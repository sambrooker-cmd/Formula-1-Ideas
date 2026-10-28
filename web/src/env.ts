/** True for the hosted (Firebase) build: no local server, races come from published files. */
export const HOSTED = import.meta.env?.VITE_HOSTED === '1';
