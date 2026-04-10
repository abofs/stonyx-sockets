export default class Handler {
  static skipAuth = false;

  declare server?: (data: unknown, client: unknown) => unknown | Promise<unknown>;
  declare client?: (response: unknown) => void;
}
