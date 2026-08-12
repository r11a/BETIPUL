import assert from 'node:assert/strict';
import { apiUrl } from './api.js';

assert.equal(apiUrl('/bootstrap'),'./api/bootstrap');
assert.equal(apiUrl('dashboard'),'./api/dashboard');

console.log('API path checks passed');
