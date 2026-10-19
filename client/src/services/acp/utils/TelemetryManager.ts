// ABAP FS makes no external network calls, so agent telemetry events are dropped.

export function sendEvent(
  _eventName: string,
  _properties?: Record<string, string>,
  _measurements?: Record<string, number>,
): void {}

export function sendError(
  _eventName: string,
  _properties?: Record<string, string>,
  _measurements?: Record<string, number>,
): void {}

export function sendException(_error: Error, _properties?: Record<string, string>): void {}
