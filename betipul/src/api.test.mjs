import assert from 'node:assert/strict';
import { apiUrl } from './api.js';

assert.equal(apiUrl('/bootstrap','https://ha.local/assets/app.js'),'https://ha.local/api/bootstrap');
assert.equal(apiUrl('/bootstrap','https://ha.local/api/hassio_ingress/token/assets/app.js'),'https://ha.local/api/hassio_ingress/token/api/bootstrap');

console.log('API path checks passed');
