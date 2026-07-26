import assert from "node:assert/strict";
import test from "node:test";
import { secureDatabaseUrl } from "../lib/database-url-security.ts";

test("remote PostgreSQL connections default to encrypted transport", () => {
  const secured = new URL(secureDatabaseUrl("postgresql://user:pass@db.example.com:5432/app"));
  assert.equal(secured.searchParams.get("sslmode"), "require");
  assert.equal(secured.searchParams.get("uselibpqcompat"), "true");
});

test("secure PostgreSQL modes are preserved", () => {
  for (const mode of ["require", "verify-ca", "verify-full"]) {
    const secured = new URL(secureDatabaseUrl(`postgresql://user:pass@db.example.com/app?sslmode=${mode}`));
    assert.equal(secured.searchParams.get("sslmode"), mode);
    assert.equal(secured.searchParams.get("uselibpqcompat"), mode === "require" ? "true" : null);
  }
});

test("remote PostgreSQL connections cannot disable TLS", () => {
  for (const mode of ["disable", "allow", "prefer"]) {
    assert.throws(
      () => secureDatabaseUrl(`postgresql://user:pass@db.example.com/app?sslmode=${mode}`),
      /禁止使用未加密连接/,
    );
  }
});

test("loopback development databases remain compatible", () => {
  const url = "postgresql://ci:ci@127.0.0.1:5432/app?sslmode=disable";
  assert.equal(secureDatabaseUrl(url), url);
});

test("query host overrides cannot disguise a remote insecure connection", () => {
  assert.throws(
    () => secureDatabaseUrl("postgresql://dev:dev@localhost:5432/app?host=db.example.com&sslmode=disable"),
    /禁止使用未加密连接/,
  );
});

test("duplicate connection-security parameters are rejected", () => {
  assert.throws(
    () => secureDatabaseUrl("postgresql://dev:dev@db.example.com/app?sslmode=require&sslmode=disable"),
    /不能包含重复/,
  );
  assert.throws(
    () => secureDatabaseUrl("postgresql://dev:dev@localhost/app?host=localhost&host=db.example.com&sslmode=disable"),
    /不能包含重复/,
  );
  assert.throws(
    () => secureDatabaseUrl("postgresql://dev:dev@db.example.com/app?sslmode=require&uselibpqcompat=true&uselibpqcompat=false"),
    /不能包含重复/,
  );
});
