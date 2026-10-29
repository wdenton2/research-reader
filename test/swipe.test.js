import test from "node:test";
import assert from "node:assert/strict";
import { startSwipe, moveSwipe, finishSwipe } from "../shared/swipe.js";

test("deliberate horizontal swipes set read state by direction", () => {
  assert.equal(
    finishSwipe(moveSwipe(startSwipe(100, 200, 350), 200, 208)),
    true,
  );
  assert.equal(
    finishSwipe(moveSwipe(startSwipe(250, 200, 350), 150, 208)),
    false,
  );
  assert.equal(
    finishSwipe(moveSwipe(startSwipe(100, 200, 350), 140, 205)),
    null,
  );
  assert.equal(finishSwipe(startSwipe(100, 200, 350)), null);
});
test("vertical scrolling, diagonal motion, and a reversed drag do not mark an article read", () => {
  let gesture = moveSwipe(startSwipe(100, 200, 350), 104, 240);
  gesture = moveSwipe(gesture, 250, 245);
  assert.equal(finishSwipe(gesture), null, "Vertical intent stays locked");
  assert.equal(
    finishSwipe(moveSwipe(startSwipe(100, 200, 350), 200, 300)),
    null,
  );
  gesture = moveSwipe(startSwipe(100, 200, 350), 200, 205);
  gesture = moveSwipe(gesture, 110, 207);
  assert.equal(
    finishSwipe(gesture),
    null,
    "Returning near the start cancels the swipe",
  );
});
