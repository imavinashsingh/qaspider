import { createDemoServer } from '../demo/server.mjs';

// Object identity is the capability, not a page marker or a renderer-supplied URL.
const owned = new WeakSet();
export const isOwnedFixture = fixture => owned.has(fixture);

export async function startControlledFixture() {
  const server = createDemoServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const fixture = Object.freeze({
    origin: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      owned.delete(fixture);
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  });
  owned.add(fixture);
  return fixture;
}
