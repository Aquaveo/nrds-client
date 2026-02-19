// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock `window.location` with Jest spies and extend expect
import "jest-location-mock";

// MSW relies on TextEncoder/TextDecoder in Node test environments.
import { TextEncoder, TextDecoder } from 'util';
if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder;
}
if (!global.TextDecoder) {
  global.TextDecoder = TextDecoder;
}

if (!global.BroadcastChannel) {
  global.BroadcastChannel = class BroadcastChannel {
    constructor() {}
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  };
}

if (!global.ReadableStream || !global.WritableStream || !global.TransformStream) {
  try {
    const webStreams = require('stream/web');
    if (!global.ReadableStream) global.ReadableStream = webStreams.ReadableStream;
    if (!global.WritableStream) global.WritableStream = webStreams.WritableStream;
    if (!global.TransformStream) global.TransformStream = webStreams.TransformStream;
  } catch (err) {
    if (!global.ReadableStream) global.ReadableStream = class ReadableStream {};
    if (!global.WritableStream) global.WritableStream = class WritableStream {};
    if (!global.TransformStream) global.TransformStream = class TransformStream {};
  }
}

const { server } = require('./mocks/server.js');

// Make .env files accessible to tests (path relative to project root)
require('dotenv').config({ path: './reactapp/config/tests/test.env'});

// Setup mocked Tethys API
beforeAll(() => server.listen());
// if you need to add a handler after calling setupServer for some specific test
// this will remove that handler for the rest of them
// (which is important for test isolation):
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Mocks for tests involving plotly
window.URL.createObjectURL = jest.fn();
HTMLCanvasElement.prototype.getContext = jest.fn();
