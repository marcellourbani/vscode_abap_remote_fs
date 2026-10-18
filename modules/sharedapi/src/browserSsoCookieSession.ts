import {
  AdtSessionFailure,
  fromException,
  isAuthenticationFailure,
  isCsrfError,
  type AdtSessionProvider
} from "abap-adt-api"
import type { AdtExtension, AdtNext } from "abap-adt-api/build/AdtExtensions"
import type { AdtHTTP } from "abap-adt-api/build/AdtHTTP"

export function createBrowserSsoClientOptions(
  id: string,
  renew: AdtSessionProvider["renew"],
  onStatefulFailure?: (client: Pick<AdtHTTP, "stateful">) => void
) {
  const session: AdtSessionProvider = { id, logoutMode: "local-only", renew }
  const extensions: AdtExtension[] = [
    {
      id: `${id}:stateful-session-recovery`,
      async handle(context, next: AdtNext) {
        try {
          return await next()
        } catch (error) {
          if (!context.isStateful || !isAuthenticationFailure(error)) throw error
          const exception = fromException(error)
          const reason = isCsrfError(exception) ? "csrf" : "expired"
          onStatefulFailure?.(context.client)
          await context.client.renewSession(reason, error)
          throw new AdtSessionFailure(reason, true, exception)
        }
      }
    }
  ]
  return {
    session,
    extensions
  }
}
