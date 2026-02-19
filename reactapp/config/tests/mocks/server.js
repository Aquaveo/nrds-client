import { http } from 'msw';
import { setupServer } from 'msw/node';
import { handlers } from './handlers.js';

const server = setupServer(...handlers);
const rest = http;
export { server, rest, http };
