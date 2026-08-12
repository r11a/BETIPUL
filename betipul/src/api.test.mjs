import assert from 'node:assert/strict';
import { apiUrl } from './api.js';

assert.equal(apiUrl('/bootstrap'),'./api/bootstrap');
assert.equal(apiUrl('dashboard'),'./api/dashboard');
assert.equal(apiUrl('/bootstrap','/api/hassio_ingress/token'),'/api/hassio_ingress/token/api/bootstrap');
assert.equal(apiUrl('/bootstrap','/api/hassio_ingress/token/'),'/api/hassio_ingress/token/api/bootstrap');

console.log('API path checks passed');
