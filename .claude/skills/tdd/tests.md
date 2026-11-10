# Good and bad tests

Adapted from `mattpocock/skills` (MIT; `.claude/skills/LICENSE.mattpocock-skills.txt`). The examples are TypeScript
with a Vitest-style `expect`; write them in the project's own language and test runner. The names (`checkout`,
`saveConfig`, `renderLog`) are illustrations.

## Through the interface, not the inside

```typescript
// GOOD: checks what a caller sees
test("a cart with a valid card checks out", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, card);
  expect(result.status).toBe("confirmed");
});

// BAD: checks how the code does it
test("checkout calls payments.charge", async () => {
  const spy = vi.spyOn(payments, "charge");
  await checkout(cart, card);
  expect(spy).toHaveBeenCalledWith(cart.total);
});
```

Signs of a bad test: it mocks the project's own modules, tests a private function, counts calls, breaks on a refactor
that kept the behaviour, or has a name that says how instead of what.

```typescript
// BAD: goes around the interface to the database
test("createUser saves a row", async () => {
  await createUser({ name: "Alice" });
  expect(await db.query("SELECT * FROM users WHERE name = ?", ["Alice"])).toHaveLength(1);
});

// GOOD: checks through the interface
test("a created user can be read back", async () => {
  const user = await createUser({ name: "Alice" });
  expect((await getUser(user.id)).name).toBe("Alice");
});
```

## When bytes are the output, compare bytes

If the project writes files or messages, their exact bytes are part of the interface. A later read can hide a lost
BOM or a changed line ending.

```typescript
// GOOD: every byte outside the change is identical, CRLF and BOM included
test("saving one setting keeps the rest of the file", () => {
  const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
  fs.writeFileSync(file, Buffer.concat([BOM, Buffer.from("a=1\r\nb=2\r\n")]));
  saveConfig(file, { b: "3" });
  expect(fs.readFileSync(file)).toEqual(Buffer.concat([BOM, Buffer.from("a=1\r\nb=3\r\n")]));
});

// BAD: a later read cannot see the lost BOM or the changed line endings
test("saving one setting changes it", () => {
  saveConfig(file, { b: "3" });
  expect(loadConfig(file).b).toBe("3");
});
```

## An independent expected value

```typescript
// BAD: the expected value repeats the code's own computation
test("sums the line items", () => {
  const items = [{ price: 10 }, { price: 5 }];
  expect(total(items)).toBe(items.reduce((sum, i) => sum + i.price, 0));
});

// GOOD: a literal worked out by hand
test("sums the line items", () => {
  expect(total([{ price: 10 }, { price: 5 }])).toBe(15);
});
```

## A test for an absence has a negative control

The control runs the same call with the same assertion, with only the protection turned off. It must fail. If it
passes, the first test cannot see a leak.

```typescript
const request = { path: "/login", headers: { authorization: "Bearer sk-test-123" } };

test("a token never reaches the log", () => {
  expect(renderLog(request)).not.toContain("sk-test-123");
});

// The negative control: redaction off, the same assertion, and it must fail.
test("the leak test notices a token when redaction is off", () => {
  // The match on the token proves the assertion saw the leak, not some other error.
  expect(() => expect(renderLog(request, { redact: false })).not.toContain("sk-test-123")).toThrow(/sk-test-123/);
});
```
