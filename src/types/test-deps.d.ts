declare module 'qunit' {
  interface Assert {
    ok(value: unknown, message?: string): void;
    notOk(value: unknown, message?: string): void;
    true(value: unknown, message?: string): void;
    false(value: unknown, message?: string): void;
    strictEqual(actual: unknown, expected: unknown, message?: string): void;
    notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => void, expected?: RegExp | Function, message?: string): void;
  }

  interface Hooks {
    before(fn: () => void | Promise<void>): void;
    beforeEach(fn: () => void | Promise<void>): void;
    afterEach(fn: () => void | Promise<void>): void;
    after(fn: () => void | Promise<void>): void;
  }

  type TestFn = (assert: Assert) => void | Promise<void>;
  type ModuleCallback = (hooks: Hooks) => void;

  interface QUnit {
    module(name: string, callback?: ModuleCallback): void;
    test(name: string, fn: TestFn): void;
  }

  const QUnit: QUnit;
  export default QUnit;
}

declare module 'sinon' {
  interface SinonSpy {
    (...args: unknown[]): unknown;
    calledOnce: boolean;
    called: boolean;
    firstCall: { args: unknown[] };
  }

  interface SinonStub extends SinonSpy {
    returns(value: unknown): SinonStub;
    resolves(value?: unknown): SinonStub;
    rejects(value?: unknown): SinonStub;
  }

  interface SinonStatic {
    spy(): SinonSpy;
    stub(): SinonStub;
    stub(obj: unknown, method: string): SinonStub;
    restore(): void;
  }

  const sinon: SinonStatic;
  export default sinon;
}

declare module 'stonyx/test-helpers' {
  interface Hooks {
    before(fn: () => void | Promise<void>): void;
    beforeEach(fn: () => void | Promise<void>): void;
    afterEach(fn: () => void | Promise<void>): void;
    after(fn: () => void | Promise<void>): void;
  }

  export function setupIntegrationTests(hooks: Hooks): void;
}

declare module '@stonyx/sockets/handler' {
  export default class Handler {
    static skipAuth: boolean;
    server?(data: unknown, client: unknown): unknown | Promise<unknown>;
    client?(response: unknown): void;
  }
}
