import type { SecurityTestRunner } from "../runner.js";
import { baselineAuthenticatedAccessTest } from "./baselineAccess.js";
import { sessionExpiryBehaviorTest } from "./sessionExpiry.js";
import { membershipRevocationTest } from "./membershipRevocation.js";
import { directResourceAuthorizationTest } from "./directResourceAuthorization.js";
import { resourceIdentifierValidationTest } from "./resourceValidation.js";

/** Registers every built-in test category (A–E) on a runner. Called once, from service.ts, at startup. */
export function registerBuiltInSecurityTests(runner: SecurityTestRunner): void {
  runner.register(baselineAuthenticatedAccessTest);
  runner.register(sessionExpiryBehaviorTest);
  runner.register(membershipRevocationTest);
  runner.register(directResourceAuthorizationTest);
  runner.register(resourceIdentifierValidationTest);
}
