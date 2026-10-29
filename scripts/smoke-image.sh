#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: bash scripts/smoke-image.sh IMAGE}
container="research-reader-smoke-$(date +%s)-$$"
volume="${container}-data"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker logs "$container" 2>/dev/null || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null

start_container() {
  docker run -d --name "$container" --init --network none \
    --cap-drop ALL --security-opt no-new-privileges:true \
    --health-interval 1s --health-start-period 1s \
    -e APP_PASSWORD=container-smoke-test-only \
    -e AUTO_REFRESH=false \
    -v "$volume:/app/data" "$image" >/dev/null
  for attempt in $(seq 1 30); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy ]; then return; fi
    sleep 1
  done
  echo "Container did not become healthy." >&2
  return 1
}

check_container() {
  docker exec -i -e SMOKE_MODE="$1" "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
assert.equal(process.getuid(), 1000);
assert.ok(existsSync('/app/data/reader.sqlite'));
assert.equal(existsSync('/app/node_modules/vite'), false);
const base = 'http://127.0.0.1:4173';
const home = await fetch(base);
assert.equal(home.status, 200);
const html = await home.text();
const script = html.match(/src="([^" ]+\.js)"/);
assert.ok(script, 'Built client script is present');
assert.equal((await fetch(base + script[1])).status, 200);
assert.equal((await fetch(base + '/api/sources')).status, 401);
const session = await (await fetch(base + '/api/session')).json();
assert.equal(session.passwordRequired, true);
assert.equal(session.authenticated, false);
const login = await fetch(base + '/api/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: process.env.APP_PASSWORD }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
const sourcesResponse = await fetch(base + '/api/sources', { headers });
assert.equal(sourcesResponse.status, 200);
const sources = await sourcesResponse.json();
assert.equal(sources.length, 1, 'Only the seeded source is in the fresh volume');
if (process.env.SMOKE_MODE === 'write') {
  const update = await fetch(base + '/api/sources/' + sources[0].id, {
    method: 'PATCH', headers,
    body: JSON.stringify({ name: 'Persistent smoke test', enabled: false }),
  });
  assert.equal(update.status, 200);
} else {
  assert.equal(sources[0].name, 'Persistent smoke test');
  assert.equal(sources[0].enabled, 0);
}
console.log(`Container ${process.env.SMOKE_MODE} checks passed.`);
JS
}

start_container
check_container write
docker stop "$container" >/dev/null
docker rm "$container" >/dev/null
start_container
check_container read
echo "Image passed startup, authentication, client assets, non-root user, and volume persistence checks."
