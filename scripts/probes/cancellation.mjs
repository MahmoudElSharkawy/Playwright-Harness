// Only the fixed CI parent sends this message. Standalone probes have no IPC channel.
const controller = new AbortController();
if (process.send) {
  process.on('message', message => {if (message?.type === 'cancel-native-proof') controller.abort(new Error('Native proof deadline exceeded.'));});
  process.channel?.unref();
}
export const proofSignal = controller.signal;
