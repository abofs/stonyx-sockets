import Handler from '../../../src/handler.js';

export default class HeartBeatHandler extends Handler {
  server() {
    return true;
  }

  client() {
    this.client.nextHeartBeat();
  }
}
